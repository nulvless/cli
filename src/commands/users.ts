import type { Command } from 'commander';
import { resources, type ProjectUser, type UserSession } from '../api/resources';
import type { ContextFactory } from '../context';
import { CliError } from '../errors';
import { environmentLabel, environmentOption } from '../environment-option';
import { notePage, pageRequest, withPageOptions, type PageFlags } from '../pagination';
import { examples } from '../ui/help';

interface EnvironmentFlag {
  env: string;
}

interface ListFlags extends EnvironmentFlag, PageFlags {
  email?: string;
  phone?: string;
  username?: string;
  banned?: boolean;
  unconfirmed?: boolean;
}

interface CreateFlags extends EnvironmentFlag {
  email?: string;
  phone?: string;
  username?: string;
  name?: string;
  password?: boolean;
  confirmed?: boolean;
}

type UserAction = 'ban' | 'unban' | 'delete' | 'sign-out';

const USER_ACTIONS: { action: UserAction; description: string; question: (id: string) => string; done: string }[] = [
  {
    action: 'ban',
    description: 'Ban a user: their sessions end and they cannot sign in',
    question: (id) => `Ban ${id}? Their sessions end and they cannot sign in.`,
    done: 'is banned',
  },
  {
    action: 'unban',
    description: 'Let a banned user sign in again',
    question: (id) => `Unban ${id}?`,
    done: 'can sign in again',
  },
  {
    action: 'delete',
    description: 'Delete a user and their identities, sessions and factors',
    question: (id) => `Delete ${id} with their identities, sessions and factors? This cannot be undone.`,
    done: 'is deleted',
  },
  {
    action: 'sign-out',
    description: 'End every session of a user',
    question: (id) => `Sign ${id} out of every device?`,
    done: 'is signed out everywhere',
  },
];

function identifier(user: ProjectUser) {
  if (user.email) return user.email;
  if (user.username) return user.username;
  if (typeof user.phone === 'string') return user.phone;
  return user.phone ? `${user.phone.code ?? ''}${user.phone.number ?? ''}` : '';
}

function device(session: UserSession) {
  const browser = session.finger_print?.browser?.name;
  const os = session.finger_print?.os?.name;
  return [browser, os].filter(Boolean).join(' on ');
}

const yesNo = (value: boolean | undefined) => (value ? 'yes' : 'no');

export function registerUserCommands(program: Command, context: ContextFactory) {
  const users = program
    .command('users')
    .description('Manage the users of a project environment')
    .addHelpText(
      'after',
      examples([
        'nulvless users list --email ada@acme.com',
        'nulvless users create --email ada@acme.com --confirmed --password',
        'nulvless users ban usr_123',
        'nulvless users sign-out usr_123 --env staging',
      ]),
    );

  withPageOptions(
    users
      .command('list')
      .description('List users, newest first; filters match exactly')
      .option('--email <email>', 'only this email')
      .option('--phone <phone>', 'only this phone number')
      .option('--username <username>', 'only this username')
      .option('--banned', 'only banned users')
      .option('--unconfirmed', 'only users who did not confirm their account')
      .addOption(environmentOption()),
  ).action(async (options: ListFlags, command: Command) => {
    const { api, scope, output } = await context(command.optsWithGlobals());

    const request = pageRequest(options, command);
    const target = await scope();
    const filters: Record<string, string> = {
      ...(options.email ? { email: options.email } : {}),
      ...(options.phone ? { phone: options.phone } : {}),
      ...(options.username ? { username: options.username } : {}),
      ...(options.banned ? { is_banned: 'true' } : {}),
      ...(options.unconfirmed ? { is_confirmed: 'false' } : {}),
    };
    const page = await output.task(`Loading users of ${options.env}`, () =>
      resources.users(api, target, options.env, filters, request),
    );

    output.table(
      page.items,
      [
        { header: 'ID', value: (user) => user.id },
        { header: 'USER', value: identifier },
        { header: 'CONFIRMED', value: (user) => yesNo(user.is_confirmed) },
        { header: 'BANNED', value: (user) => yesNo(user.is_banned), tone: (user) => (user.is_banned ? 'bad' : 'plain') },
        {
          header: 'LAST SIGN-IN',
          value: (user) => (user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'never'),
        },
      ],
      { message: `No users in ${options.env} match.` },
    );
    notePage(output, page, request);
  });

  users
    .command('get')
    .description('Show one user')
    .argument('<id>', 'user id')
    .addOption(environmentOption())
    .action(async (id: string, options: EnvironmentFlag, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      output.data(await output.task(`Loading ${id}`, () => resources.user(api, target, options.env, id)));
    });

  users
    .command('create')
    .description('Create a user without the sign-up flow')
    .option('--email <email>', 'email address')
    .option('--phone <phone>', 'phone number')
    .option('--username <username>', 'username')
    .option('--name <name>', 'display name')
    .option('--password', 'ask for a password, without echo')
    .option('--confirmed', 'mark the email and phone as already confirmed')
    .addOption(environmentOption())
    .action(async (options: CreateFlags, command: Command) => {
      const { api, scope, output, prompter } = await context(command.optsWithGlobals());

      if (!options.email && !options.phone && !options.username) {
        throw new CliError('Give the user an email, phone or username.', {
          hint: 'Pass --email, --phone or --username.',
        });
      }
      if (options.password && !prompter.interactive) {
        throw new CliError('The password can only be typed in a terminal.', {
          hint: 'Run it in a terminal, or leave --password out and let the user recover their account.',
        });
      }

      const password = options.password ? await prompter.secret('Password for the new user') : undefined;
      const target = await scope();
      const user = await output.task(`Creating the user in ${options.env}`, () =>
        resources.createUser(api, target, options.env, {
          ...(options.email ? { email: options.email } : {}),
          ...(options.phone ? { phone: options.phone } : {}),
          ...(options.username ? { username: options.username } : {}),
          ...(password ? { password } : {}),
          ...(options.name ? { profile: { name: options.name } } : {}),
          ...(options.confirmed && options.email ? { email_verified: true } : {}),
          ...(options.confirmed && options.phone ? { phone_verified: true } : {}),
        }),
      );

      if (output.json) return output.data(user);
      output.success(`Created ${user.id} in ${environmentLabel(options.env)}.`);
    });

  for (const { action, description, question, done } of USER_ACTIONS) {
    users
      .command(action)
      .description(description)
      .argument('<id>', 'user id')
      .addOption(environmentOption())
      .action(async (id: string, options: EnvironmentFlag, command: Command) => {
        const { api, scope, output, confirm } = await context(command.optsWithGlobals());

        const target = await scope();
        await confirm(`${question(id)} (${environmentLabel(options.env)})`);
        await output.task(`Updating ${id}`, () => resources.userAction(api, target, options.env, id, action));
        output.success(`${id} ${done}.`);
      });
  }

  users
    .command('sessions')
    .description('List the active sessions of a user')
    .argument('<id>', 'user id')
    .addOption(environmentOption())
    .action(async (id: string, options: EnvironmentFlag, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      output.table(
        await output.task(`Loading sessions of ${id}`, () => resources.userSessions(api, target, options.env, id)),
        [
          { header: 'ID', value: (session) => session.id },
          { header: 'DEVICE', value: device },
          { header: 'LEVEL', value: (session) => session.aal ?? '' },
          { header: 'STARTED', value: (session) => new Date(session.created_at).toLocaleString() },
        ],
        { message: `${id} has no active sessions.` },
      );
    });

  users
    .command('factors')
    .description('List the MFA factors of a user')
    .argument('<id>', 'user id')
    .addOption(environmentOption())
    .action(async (id: string, options: EnvironmentFlag, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      output.table(
        await output.task(`Loading factors of ${id}`, () => resources.userFactors(api, target, options.env, id)),
        [
          { header: 'ID', value: (factor) => factor.id },
          { header: 'TYPE', value: (factor) => factor.type },
          { header: 'ADDED', value: (factor) => (factor.created_at ? new Date(factor.created_at).toLocaleDateString() : '') },
        ],
        { message: `${id} has no MFA factors.` },
      );
    });

  users
    .command('remove-factor')
    .description('Remove an MFA factor, such as when a user lost their phone')
    .argument('<id>', 'user id')
    .argument('<factor-id>', 'factor id from `users factors`')
    .addOption(environmentOption())
    .action(async (id: string, factorId: string, options: EnvironmentFlag, command: Command) => {
      const { api, scope, output, confirm } = await context(command.optsWithGlobals());

      const target = await scope();
      await confirm(`Remove the factor ${factorId} from ${id}? (${environmentLabel(options.env)})`);
      await output.task(`Removing ${factorId}`, () => resources.removeUserFactor(api, target, options.env, id, factorId));
      output.success(`Removed ${factorId} from ${id}.`);
    });
}
