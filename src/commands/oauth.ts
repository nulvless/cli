import { Option, type Command } from 'commander';
import { resources, type OAuthClient } from '../api/resources';
import type { ContextFactory } from '../context';
import { CliError } from '../errors';
import { environmentLabel, environmentOption } from '../environment-option';
import { examples } from '../ui/help';

interface EnvironmentFlag {
  env: string;
}

interface ClientFlags extends EnvironmentFlag {
  name?: string;
  type?: 'public' | 'confidential';
  redirectUri?: string[];
  clientUri?: string;
  logoUri?: string;
  refreshTokens?: boolean;
}

const AUTH_METHOD: Record<'public' | 'confidential', string> = {
  public: 'none',
  confidential: 'client_secret_basic',
};

const collect = (value: string, previous: string[] = []) => [...previous, value];

function grantTypes(refreshTokens: boolean | undefined) {
  return refreshTokens === false ? ['authorization_code'] : ['authorization_code', 'refresh_token'];
}

function clientOptions(command: Command) {
  return command
    .option('--redirect-uri <uri>', 'allowed redirect URI, exact match (repeat for more)', collect)
    .option('--client-uri <url>', 'home page shown on the consent screen')
    .option('--logo-uri <url>', 'logo shown on the consent screen')
    .option('--no-refresh-tokens', 'do not issue refresh tokens to this app')
    .addOption(environmentOption());
}

export function registerOAuthCommands(program: Command, context: ContextFactory) {
  const oauth = program
    .command('oauth')
    .description('Configure the OAuth Server of an environment and its client apps')
    .addHelpText(
      'after',
      examples([
        'nulvless oauth settings',
        'nulvless oauth clients create "Acme Analytics" --type confidential --redirect-uri https://acme.com/callback',
        'nulvless oauth clients rotate-secret <client-id>',
      ]),
    );

  const settings = oauth
    .command('settings')
    .description('Show the OAuth Server settings')
    .addOption(environmentOption())
    .action(async (options: EnvironmentFlag, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      const current = await output.task(`Loading OAuth settings of ${options.env}`, () =>
        resources.oauthSettings(api, target, options.env),
      );
      if (output.json) return output.data(current);

      const consentBase = current.authorization_base_url || current.site_url || '';
      output.table(
        [
          { setting: 'Enabled', value: current.enabled ? 'yes' : 'no' },
          { setting: 'Issuer', value: current.issuer },
          { setting: 'Consent screen', value: `${consentBase}${current.authorization_path}` },
          { setting: 'Dynamic clients', value: current.allow_dynamic_clients ? 'allowed' : 'not allowed' },
        ],
        [
          { header: 'SETTING', value: (row) => row.setting },
          { header: 'VALUE', value: (row) => row.value },
        ],
        { message: '' },
      );
    });

  settings
    .command('update')
    .description('Change OAuth Server settings; anything not passed stays as it is')
    .option('--enable', 'turn the OAuth Server on')
    .option('--disable', 'turn the OAuth Server off; /oauth/authorize answers 403')
    .option('--dynamic-clients', 'let apps register themselves')
    .option('--no-dynamic-clients', 'only clients registered here can sign in')
    .option('--authorization-path <path>', 'path of your consent screen, such as /oauth/consent')
    .option('--consent-url <url>', 'where your consent screen is hosted, if not on the site URL')
    .addOption(environmentOption())
    .action(
      async (
        options: EnvironmentFlag & {
          enable?: boolean;
          disable?: boolean;
          dynamicClients?: boolean;
          authorizationPath?: string;
          consentUrl?: string;
        },
        command: Command,
      ) => {
        const { api, scope, output, confirm } = await context(command.optsWithGlobals());

        if (options.enable && options.disable) throw new CliError('Pass --enable or --disable, not both.');
        const passed = command.getOptionValueSource('dynamicClients') === 'cli';
        const body = {
          ...(options.enable ? { enabled: true } : {}),
          ...(options.disable ? { enabled: false } : {}),
          ...(passed ? { allow_dynamic_clients: Boolean(options.dynamicClients) } : {}),
          ...(options.authorizationPath ? { authorization_path: options.authorizationPath } : {}),
          ...(options.consentUrl ? { authorization_base_url: options.consentUrl } : {}),
        };
        if (!Object.keys(body).length) {
          throw new CliError('Nothing to update.', { hint: 'Pass at least one option, such as --enable. See `nulvless oauth settings update --help`.' });
        }

        const target = await scope();
        await confirm(`Update the OAuth Server of ${environmentLabel(options.env)}?`);
        const updated = await output.task('Saving OAuth settings', () =>
          resources.updateOAuthSettings(api, target, options.env, body),
        );
        if (output.json) return output.data(updated);
        output.success(`Updated the OAuth Server of ${options.env}.`);
      },
    );

  const clients = oauth.command('clients').description('Manage the apps that can sign users in through the OAuth Server');

  clients
    .command('list')
    .description('List the client apps')
    .addOption(environmentOption())
    .action(async (options: EnvironmentFlag, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      output.table(
        await output.task(`Loading OAuth clients of ${options.env}`, () => resources.oauthClients(api, target, options.env)),
        [
          { header: 'CLIENT ID', value: (client: OAuthClient) => client.client_id },
          { header: 'NAME', value: (client: OAuthClient) => client.client_name ?? '' },
          { header: 'TYPE', value: (client: OAuthClient) => client.client_type },
          { header: 'REDIRECT URIS', value: (client: OAuthClient) => client.redirect_uris.join(', ') },
        ],
        { message: `No OAuth clients in ${options.env} yet.`, hint: 'Register one with `nulvless oauth clients create <name>`.' },
      );
    });

  clients
    .command('get')
    .description('Show one client app')
    .argument('<client-id>', 'client id from `oauth clients list`')
    .addOption(environmentOption())
    .action(async (clientId: string, options: EnvironmentFlag, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      output.data(await output.task(`Loading ${clientId}`, () => resources.oauthClient(api, target, options.env, clientId)));
    });

  clientOptions(
    clients
      .command('create')
      .description('Register a client app; a confidential app gets a secret, shown once')
      .argument('<name>', 'name people see on the consent screen')
      .addOption(
        new Option('--type <type>', 'public for apps that cannot keep a secret, confidential for servers').choices([
          'public',
          'confidential',
        ]),
      ),
  ).action(async (name: string, options: ClientFlags, command: Command) => {
    const { api, scope, output } = await context(command.optsWithGlobals());

    if (!options.type) {
      throw new CliError('Choose the client type.', {
        hint: 'Pass --type public for browser and mobile apps, or --type confidential for servers.',
      });
    }
    if (!options.redirectUri?.length) {
      throw new CliError('Add at least one redirect URI.', { hint: 'Pass --redirect-uri <uri>; it must match exactly.' });
    }

    const target = await scope();
    const client = await output.task(`Registering ${name}`, () =>
      resources.createOAuthClient(api, target, options.env, {
        client_name: name,
        client_type: options.type,
        token_endpoint_auth_method: AUTH_METHOD[options.type!],
        redirect_uris: options.redirectUri,
        grant_types: grantTypes(options.refreshTokens),
        ...(options.clientUri ? { client_uri: options.clientUri } : {}),
        ...(options.logoUri ? { logo_uri: options.logoUri } : {}),
      }),
    );

    if (output.json) return output.data(client);
    output.print(client.client_secret ?? client.client_id);
    output.success(`Registered ${name} as ${client.client_id}.`);
    if (client.client_secret) output.note('That is the client secret. Copy it now: it is shown only once.');
  });

  clientOptions(
    clients
      .command('update')
      .description('Change a client app; anything not passed stays as it is')
      .argument('<client-id>', 'client id from `oauth clients list`')
      .option('--name <name>', 'name people see on the consent screen'),
  ).action(async (clientId: string, options: ClientFlags, command: Command) => {
    const { api, scope, output } = await context(command.optsWithGlobals());

    const target = await scope();
    const current = await output.task(`Loading ${clientId}`, () => resources.oauthClient(api, target, options.env, clientId));
    const refreshPassed = command.getOptionValueSource('refreshTokens') === 'cli';
    const updated = await output.task(`Updating ${clientId}`, () =>
      resources.updateOAuthClient(api, target, options.env, clientId, {
        client_name: options.name ?? current.client_name,
        token_endpoint_auth_method: current.token_endpoint_auth_method,
        redirect_uris: options.redirectUri?.length ? options.redirectUri : current.redirect_uris,
        grant_types: refreshPassed ? grantTypes(options.refreshTokens) : current.grant_types,
        ...(options.clientUri ? { client_uri: options.clientUri } : {}),
        ...(options.logoUri ? { logo_uri: options.logoUri } : {}),
      }),
    );

    if (output.json) return output.data(updated);
    output.success(`Updated ${clientId}.`);
  });

  clients
    .command('delete')
    .description('Delete a client app; its users must authorize it again if it is registered again')
    .argument('<client-id>', 'client id from `oauth clients list`')
    .addOption(environmentOption())
    .action(async (clientId: string, options: EnvironmentFlag, command: Command) => {
      const { api, scope, output, confirm } = await context(command.optsWithGlobals());

      const target = await scope();
      await confirm(`Delete ${clientId} from ${environmentLabel(options.env)}? Its tokens stop working.`);
      await output.task(`Deleting ${clientId}`, () => resources.deleteOAuthClient(api, target, options.env, clientId));
      output.success(`Deleted ${clientId}.`);
    });

  clients
    .command('rotate-secret')
    .description('Issue a new secret for a confidential app; the old one stops working')
    .argument('<client-id>', 'client id from `oauth clients list`')
    .addOption(environmentOption())
    .action(async (clientId: string, options: EnvironmentFlag, command: Command) => {
      const { api, scope, output, confirm } = await context(command.optsWithGlobals());

      const target = await scope();
      await confirm(`Issue a new secret for ${clientId}? The current one stops working immediately.`);
      const client = await output.task(`Rotating the secret of ${clientId}`, () =>
        resources.rotateOAuthClientSecret(api, target, options.env, clientId),
      );

      if (output.json) return output.data(client);
      output.print(client.client_secret ?? '');
      output.success(`Issued a new secret for ${clientId}.`);
      output.note('Copy it now: it is shown only once.');
    });
}
