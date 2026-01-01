import type { Command } from 'commander';
import open from 'open';
import { resources } from '../api/resources';
import { login } from '../auth/login';
import type { ContextFactory } from '../context';
import { claimsOf } from '../jwt';
import { consoleUrl } from '../platform';

function textClaim(claims: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const value = claims[name];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

export function registerAuthCommands(program: Command, context: ContextFactory) {
  program
    .command('login')
    .description('Sign in to Nulvless in the browser')
    .action(async (_options, command: Command) => {
      const { platform, store, output } = await context(command.optsWithGlobals());

      const tokens = await login({
        platform,
        store,
        showUrl: (url) => {
          output.step('Opening the browser to sign in');
          output.note(`Did not open? ${output.link('Open the sign-in page', url)}`);
          output.info('');
        },
        openBrowser: async (url) => {
          await open(url);
        },
        waitForApproval: (approval) => output.task('Waiting for you to approve in the browser', () => approval),
      });

      const claims = claimsOf(tokens.access_token);
      const name = textClaim(claims, 'name', 'preferred_username');
      const email = textClaim(claims, 'email');
      output.success(`Signed in${name || email ? ` as ${name ?? email}` : ''}`);
      if (name && email) output.note(email);
      output.note(`Session stored in ${store.location}`);
    });

  program
    .command('logout')
    .description('Remove the stored session from this computer')
    .action(async (_options, command: Command) => {
      const { store, output } = await context(command.optsWithGlobals());

      const session = await store.read().catch(() => null);
      if (!session) {
        output.info('You were not signed in on this computer.');
        return;
      }

      await store.clear().catch(() => undefined);
      const claims = claimsOf(session.accessToken);
      const account = textClaim(claims, 'name', 'preferred_username') ?? textClaim(claims, 'email');
      output.success(account ? `Signed out of ${account}` : 'Signed out');
      output.note(`Removed the session from ${store.location}`);
    });

  program
    .command('whoami')
    .description('Show the signed-in account and its organizations')
    .action(async (_options, command: Command) => {
      const { api, token, output } = await context(command.optsWithGlobals());

      const claims = claimsOf(await token());
      const account = {
        id: textClaim(claims, 'sub'),
        email: textClaim(claims, 'email'),
        name: textClaim(claims, 'name', 'preferred_username'),
      };
      const organizations = await output.task('Loading organizations', () => resources.organizations(api));

      if (output.json) return output.data({ account, organizations });

      output.info(`Signed in as ${account.name ?? account.email ?? account.id ?? 'an unknown account'}`);
      if (account.email && account.name) output.info(account.email);
      output.info('');
      output.table(
        organizations,
        [
          { header: 'ORGANIZATION', value: (organization) => organization.slug },
          { header: 'NAME', value: (organization) => organization.name },
        ],
        { message: 'You do not belong to any organization yet.', hint: `Create one in the console: ${consoleUrl}` },
      );
    });
}
