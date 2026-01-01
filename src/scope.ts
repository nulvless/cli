import type { Api } from './api/http';
import { resources, type Scope } from './api/resources';
import { CliError, MissingOptionError } from './errors';
import { consoleUrl } from './platform';
import type { Prompter } from './ui/prompter';

export interface ScopeFlags {
  org?: string;
  project?: string;
}

export async function resolveOrganization({
  flags,
  env,
  api,
  prompter,
}: {
  flags: ScopeFlags;
  env: NodeJS.ProcessEnv;
  api: Api;
  prompter: Prompter;
}) {
  const explicit = flags.org ?? env.NULVLESS_ORG;
  if (explicit) return explicit;

  const organizations = await resources.organizations(api);
  const [only] = organizations;
  if (!only) throw new CliError('Your account has no organizations yet.', { hint: `Create one in the console: ${consoleUrl}` });
  if (organizations.length === 1) return only.slug;
  if (!prompter.interactive) throw new MissingOptionError('organization', '--org <slug>', 'NULVLESS_ORG');

  return prompter.choose(
    'Which organization?',
    organizations.map((organization) => ({ value: organization.slug, label: organization.name, hint: organization.slug })),
  );
}

export async function resolveScope(context: {
  flags: ScopeFlags;
  env: NodeJS.ProcessEnv;
  api: Api;
  prompter: Prompter;
}): Promise<Scope> {
  const organization = await resolveOrganization(context);
  const explicit = context.flags.project ?? context.env.NULVLESS_PROJECT;
  if (explicit) return { organization, project: explicit };

  const projects = await resources.projects(context.api, organization);
  if (projects.length === 0) throw new CliError(`The organization ${organization} has no projects yet.`, {
      hint: `Create one in the console: ${consoleUrl}`,
    });
  if (!context.prompter.interactive) throw new MissingOptionError('project', '--project <slug>', 'NULVLESS_PROJECT');

  const project = await context.prompter.choose(
    'Which project?',
    projects.map((entry) => ({ value: entry.slug, label: entry.name, hint: entry.slug })),
  );
  return { organization, project };
}
