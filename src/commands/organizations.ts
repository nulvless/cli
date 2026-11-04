import type { Command } from 'commander';
import { resources, type Member } from '../api/resources';
import type { ContextFactory } from '../context';
import { CliError } from '../errors';
import { examples } from '../ui/help';
import { statusTone } from '../ui/style';

const MEMBER_GROUPS = ['granted', 'invitations', 'requesteds', 'blockeds'];
const DEFAULT_ROLE = 'developer';

function memberLabel(member: Member) {
  return member.email ?? member.username ?? member.id;
}

export function registerOrganizationCommands(program: Command, context: ContextFactory) {
  const orgs = program.command('orgs').description('List the organizations of your account');

  orgs
    .command('list')
    .description('List the organizations you belong to')
    .action(async (_options, command: Command) => {
      const { api, output } = await context(command.optsWithGlobals());

      output.table(
        await output.task('Loading organizations', () => resources.organizations(api)),
        [
          { header: 'SLUG', value: (organization) => organization.slug },
          { header: 'NAME', value: (organization) => organization.name },
        ],
        { message: 'You do not belong to any organization yet.' },
      );
    });

  const members = program
    .command('members')
    .description('Manage who belongs to an organization')
    .addHelpText(
      'after',
      examples(['nulvless members list', 'nulvless members invite ada@acme.com --role admin', 'nulvless members remove ada@acme.com']),
    );

  async function loadMembers(api: Parameters<typeof resources.members>[0], organization: string) {
    const grouped = await resources.members(api, organization);
    return MEMBER_GROUPS.flatMap((group) => grouped[group] ?? []);
  }

  members
    .command('list')
    .description('List members, pending invitations, requests and blocked members')
    .action(async (_options, command: Command) => {
      const { api, organization, output } = await context(command.optsWithGlobals());

      const org = await organization();
      output.table(
        await output.task(`Loading members of ${org}`, () => loadMembers(api, org)),
        [
          { header: 'EMAIL', value: memberLabel },
          { header: 'ROLE', value: (member) => member.membership.key },
          {
            header: 'STATUS',
            value: (member) => member.membership.status,
            tone: (member) => statusTone(member.membership.status),
          },
          { header: 'NAME', value: (member) => member.name ?? '' },
        ],
        { message: `${org} has no members.` },
      );
    });

  members
    .command('invite')
    .description('Invite people to the organization by email')
    .argument('<emails...>', 'one or more email addresses')
    .option('--role <role>', 'role of the new members', DEFAULT_ROLE)
    .action(async (emails: string[], options: { role: string }, command: Command) => {
      const { api, organization, output, platform } = await context(command.optsWithGlobals());

      const org = await organization();
      const roles = await output.task('Loading roles', () => resources.memberRoles(api, org));
      const wanted = options.role.toLowerCase();
      const role = roles.find((entry) => (entry.key ?? entry.name).toLowerCase() === wanted || entry.name.toLowerCase() === wanted);
      if (!role) {
        throw new CliError(`There is no role ${options.role}.`, {
          hint: `Use one of: ${roles.map((entry) => entry.key ?? entry.name.toLowerCase()).join(', ')}.`,
        });
      }

      const invited = await output.task(`Inviting ${emails.length} person(s)`, () =>
        resources.inviteMembers(api, org, {
          invites: emails.map((email) => ({ email, role_id: role.id })),
          redirect_uri: `${platform.consoleUrl}/organizations/join`,
        }),
      );

      if (output.json) return output.data(invited);
      output.success(`Invited ${emails.join(', ')} to ${org} as ${role.key ?? role.name}.`);
    });

  members
    .command('remove')
    .description('Remove a member or cancel an invitation')
    .argument('<email>', 'email of the member')
    .action(async (email: string, _options, command: Command) => {
      const { api, organization, output, confirm } = await context(command.optsWithGlobals());

      const org = await organization();
      const member = (await output.task(`Loading members of ${org}`, () => loadMembers(api, org))).find(
        (entry) => entry.email?.toLowerCase() === email.toLowerCase(),
      );
      if (!member) {
        throw new CliError(`${email} is not a member of ${org}.`, { hint: 'Run `nulvless members list` to see who is.' });
      }

      await confirm(`Remove ${email} from ${org}? They lose access immediately.`);
      await output.task(`Removing ${email}`, () => resources.removeMember(api, org, member.membership.id));
      output.success(`Removed ${email} from ${org}.`);
    });
}
