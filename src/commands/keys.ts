import { Option, type Command } from 'commander';
import { resources } from '../api/resources';
import type { ContextFactory } from '../context';
import { CliError } from '../errors';
import { environmentLabel, environmentOption } from '../environment-option';
import { examples } from '../ui/help';
import { statusTone } from '../ui/style';

interface EnvironmentFlag {
  env: string;
}

type SigningKeyAction = 'promote' | 'restore' | 'revoke' | 'delete';

const SIGNING_KEY_ACTIONS: { action: SigningKeyAction; description: string; question: (kid: string) => string; done: string }[] = [
  {
    action: 'promote',
    description: 'Make a key sign new tokens; the current one keeps verifying until its tokens expire',
    question: (kid) => `Sign new tokens with ${kid}?`,
    done: 'now signs new tokens',
  },
  {
    action: 'restore',
    description: 'Put a revoked key back in standby',
    question: (kid) => `Restore ${kid} to standby?`,
    done: 'is back in standby',
  },
  {
    action: 'revoke',
    description: 'Stop publishing a key; tokens it signed stop validating',
    question: (kid) => `Revoke ${kid}? Tokens it signed stop validating immediately.`,
    done: 'is revoked',
  },
  {
    action: 'delete',
    description: 'Delete a revoked key for good',
    question: (kid) => `Delete ${kid} for good? This cannot be undone.`,
    done: 'is deleted',
  },
];

export function registerKeyCommands(program: Command, context: ContextFactory) {
  const keys = program
    .command('keys')
    .description('Manage the API keys of an environment')
    .addHelpText(
      'after',
      examples(['nulvless keys list', 'nulvless keys create CI --type private --env staging', 'nulvless keys revoke key_123']),
    );

  keys
    .command('list')
    .description('List the API keys; secret keys show only their prefix')
    .addOption(environmentOption())
    .action(async (options: EnvironmentFlag, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      output.table(
        await output.task(`Loading API keys of ${options.env}`, () => resources.apiKeys(api, target, options.env)),
        [
          { header: 'ID', value: (key) => key.id },
          { header: 'NAME', value: (key) => key.name },
          { header: 'TYPE', value: (key) => key.type },
          { header: 'KEY', value: (key) => (key.type === 'public' && key.key ? key.key : (key.alias ?? '')) },
          { header: 'CREATED', value: (key) => new Date(key.created_at).toLocaleDateString() },
        ],
        { message: `No API keys in ${options.env} yet.`, hint: 'Create one with `nulvless keys create <name> --type public`.' },
      );
    });

  keys
    .command('create')
    .description('Create an API key and print it once')
    .argument('<name>', 'a name to recognize the key by')
    .addOption(
      new Option('--type <type>', 'public keys go in browsers and apps; private keys stay on servers')
        .choices(['public', 'private']),
    )
    .addOption(environmentOption())
    .action(async (name: string, options: EnvironmentFlag & { type?: string }, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const type = options.type;
      if (!type) {
        throw new CliError('Choose the key type.', {
          hint: 'Pass --type public for browsers and apps, or --type private for servers.',
        });
      }

      const target = await scope();
      const key = await output.task(`Creating ${name} in ${options.env}`, () =>
        resources.createApiKey(api, target, options.env, { name, type }),
      );

      if (output.json) return output.data(key);
      output.print(key.key ?? '');
      output.success(`Created the ${key.type} key ${name} in ${environmentLabel(options.env)}.`);
      if (key.type === 'private') output.note('Copy it now: secret keys are shown only once.');
    });

  keys
    .command('revoke')
    .description('Revoke an API key; requests with it stop working immediately')
    .argument('<id>', 'key id from `keys list`')
    .addOption(environmentOption())
    .action(async (id: string, options: EnvironmentFlag, command: Command) => {
      const { api, scope, output, confirm } = await context(command.optsWithGlobals());

      const target = await scope();
      await confirm(`Revoke ${id} in ${environmentLabel(options.env)}? Requests with it stop working immediately.`);
      await output.task(`Revoking ${id}`, () => resources.revokeApiKey(api, target, options.env, id));
      output.success(`Revoked ${id}.`);
    });

  const signingKeys = program
    .command('signing-keys')
    .description('Rotate the keys that sign the access tokens of an environment')
    .addHelpText(
      'after',
      examples([
        'nulvless signing-keys list',
        'nulvless signing-keys create --algorithm ES256',
        'nulvless signing-keys promote <kid>',
      ]),
    );

  signingKeys
    .command('list')
    .description('List the signing keys and which one signs new tokens')
    .addOption(environmentOption())
    .action(async (options: EnvironmentFlag, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      output.table(
        await output.task(`Loading signing keys of ${options.env}`, () => resources.signingKeys(api, target, options.env)),
        [
          { header: 'KID', value: (key) => key.id },
          { header: 'ALGORITHM', value: (key) => key.algorithm },
          { header: 'STATUS', value: (key) => key.status, tone: (key) => (key.status === 'current' ? 'good' : statusTone(key.status)) },
          { header: 'SIGNING SINCE', value: (key) => (key.promoted_at ? new Date(key.promoted_at).toLocaleString() : '') },
        ],
        { message: `No signing keys in ${options.env}.` },
      );
    });

  signingKeys
    .command('create')
    .description('Add a key in standby: published and verifying, not signing yet')
    .addOption(new Option('--algorithm <algorithm>', 'key algorithm').choices(['ES256', 'RS256', 'EdDSA']).default('ES256'))
    .addOption(environmentOption())
    .action(async (options: EnvironmentFlag & { algorithm: string }, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      const key = await output.task(`Adding a signing key to ${options.env}`, () =>
        resources.createSigningKey(api, target, options.env, { algorithm: options.algorithm }),
      );

      if (output.json) return output.data(key);
      output.success(`Added ${key.id} in standby.`);
      output.note(`Promote it once clients refreshed their keys: nulvless signing-keys promote ${key.id} --env ${options.env}`);
    });

  for (const { action, description, question, done } of SIGNING_KEY_ACTIONS) {
    signingKeys
      .command(action)
      .description(description)
      .argument('<kid>', 'key id from `signing-keys list`')
      .addOption(environmentOption())
      .action(async (kid: string, options: EnvironmentFlag, command: Command) => {
        const { api, scope, output, confirm } = await context(command.optsWithGlobals());

        const target = await scope();
        await confirm(`${question(kid)} (${environmentLabel(options.env)})`);
        await output.task(`${action[0]!.toUpperCase()}${action.slice(1)} ${kid}`, () =>
          resources.signingKeyAction(api, target, options.env, kid, action),
        );
        output.success(`${kid} ${done}.`);
      });
  }
}
