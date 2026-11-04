import { join } from 'node:path';
import { Option, type Command } from 'commander';
import type { Api } from '../api/http';
import { resources, type ListedTemplate, type PlatformTemplate, type Scope, type TemplateBody } from '../api/resources';
import type { ContextFactory } from '../context';
import { CliError } from '../errors';
import { downloadExample, fetchCatalog, findExample } from '../examples';
import {
  readTemplates,
  starterTemplate,
  TEMPLATE_CHANNELS,
  TEMPLATE_SLUG,
  templateFilesFor,
  templatePath,
  workspaceTemplatesOf,
  TEMPLATES_PATH,
  writeTemplate,
  type TemplateChannel,
} from '../templates';
import { examples } from '../ui/help';
import { findWorkspace, pathExists, writeFiles } from '../workspace';

const PRODUCTION_ENVIRONMENT = 'main';

const environmentOption = () => new Option('--env <environment>', 'environment slug, such as main or staging');

function requireEnvironment(env: string | undefined) {
  if (!env) throw new CliError('No environment selected.', { hint: 'Pass --env <environment>, such as --env staging.' });
  return env;
}

async function requireWorkspace(cwd: string) {
  const root = await findWorkspace(cwd);
  if (!root) throw new CliError('There is no Nulvless workspace here.', { hint: 'Run `nulvless init` first.' });
  return root;
}

interface TemplateRow {
  slug: string;
  channel: string;
  kind: 'default' | 'customized' | 'custom';
  languages: string[];
}

const templateKey = (template: { channel: string; slug: string }) => `${template.channel}/${template.slug}`;

export async function ownTemplates(api: Api, target: Scope, environment: string, slugs: string[] = []) {
  const listed = await resources.projectTemplates(api, target, environment);
  const wanted = listed.filter((template) => !slugs.length || slugs.includes(template.slug));
  return Promise.all(wanted.map((template) => resources.templateVersion(api, target, environment, template)));
}

function templateRows(platform: PlatformTemplate[], own: ListedTemplate[]): TemplateRow[] {
  const languages = new Map<string, string[]>();
  for (const entry of own) languages.set(templateKey(entry), [...(languages.get(templateKey(entry)) ?? []), entry.language]);

  const platformKeys = new Set(platform.map(templateKey));
  const builtIn: TemplateRow[] = platform
    .filter((template) => TEMPLATE_CHANNELS.includes(template.channel as TemplateChannel))
    .map((template) => {
      const customized = languages.get(templateKey(template)) ?? [];
      return { slug: template.slug, channel: template.channel, kind: customized.length ? 'customized' : 'default', languages: customized };
    });
  const custom: TemplateRow[] = [...languages]
    .filter(([key]) => !platformKeys.has(key))
    .map(([key, customLanguages]) => {
      const [channel, slug] = key.split('/') as [string, string];
      return { slug, channel, kind: 'custom', languages: customLanguages };
    });
  return [...builtIn, ...custom];
}

export function registerTemplateCommands(program: Command, context: ContextFactory, version: string) {
  const templates = program
    .command('templates')
    .description('Keep email and SMS templates in the workspace and push them to an environment')
    .addHelpText(
      'after',
      examples([
        'nulvless templates list --env main',
        'nulvless templates new welcome-user --template welcome-user',
        'nulvless templates push --env staging',
        'nulvless templates pull --env main',
      ]),
    );

  templates
    .command('list')
    .description('List the templates of an environment: the defaults, the ones you customized and your own')
    .addOption(new Option('--channel <channel>', 'only email or only SMS').choices(['email', 'sms']))
    .addOption(environmentOption())
    .action(async (options: { env?: string; channel?: TemplateChannel }, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const env = requireEnvironment(options.env);
      const target = await scope();
      const filters: Record<string, string> = options.channel ? { channel: options.channel } : {};
      const [platform, own] = await output.task(`Loading templates of ${env}`, () =>
        Promise.all([
          resources.platformTemplates(api, target, env, filters),
          resources.projectTemplates(api, target, env, filters),
        ]),
      );

      output.table(
        templateRows(platform.items, own),
        [
          { header: 'SLUG', value: (row) => row.slug },
          { header: 'CHANNEL', value: (row) => row.channel },
          { header: 'KIND', value: (row) => row.kind, tone: (row) => (row.kind === 'default' ? 'plain' : 'good') },
          { header: 'LANGUAGES', value: (row) => row.languages.join(', ') },
        ],
        { message: `${env} has no templates.` },
      );
      if (!output.json) output.note('Replace a default: nulvless templates new <slug>, then templates push');
    });

  templates
    .command('new')
    .description('Create a template in the workspace, from scratch or from an example')
    .argument('<slug>', 'template slug; use a platform slug such as welcome-user to replace that template')
    .option('--template <example>', 'start from an example (see `nulvless examples --kind template`)')
    .addOption(new Option('--channel <channel>', 'channel of a new template').choices(['email', 'sms']).default('email'))
    .action(async (slug: string, options: { template?: string; channel: TemplateChannel }, command: Command) => {
      const { cwd, fetch, platform, output } = await context(command.optsWithGlobals());

      const root = await requireWorkspace(cwd);
      if (!TEMPLATE_SLUG.test(slug)) {
        throw new CliError(`${slug} is not a valid template slug.`, {
          hint: 'Use lowercase letters, numbers and dashes, such as order-shipped.',
        });
      }

      const example = options.template
        ? await output.task(`Downloading ${options.template}`, async () => {
            const found = findExample(await fetchCatalog(platform.examplesUrl, fetch), options.template!, 'template', version);
            return { found, files: await downloadExample(platform.examplesUrl, found, fetch) };
          })
        : null;
      const channel = example?.found.template?.channel ?? options.channel;
      const path = templatePath(channel, slug);
      if (await pathExists(join(root, path))) throw new CliError(`${path} already exists.`, { hint: 'Choose another slug.' });

      const subject = example?.found.template?.subject;
      const files = example ? templateFilesFor(subject ? { subject } : {}, example.files) : starterTemplate[channel](slug);

      await writeFiles(join(root, path), files);

      if (output.json) return output.data({ slug, path, template: options.template ?? null, files: files.map((file) => file.path) });
      output.success(`Created ${path}.`);
      output.note(`Push it: nulvless templates push ${slug} --env <environment>`);
    });

  templates
    .command('push')
    .description('Create or update templates of an environment from the workspace')
    .argument('[slugs...]', 'templates to push (default: every folder in nulvless/templates)')
    .addOption(environmentOption())
    .action(async (slugs: string[], options: { env?: string }, command: Command) => {
      const { api, cwd, scope, output, confirm } = await context(command.optsWithGlobals());

      const env = requireEnvironment(options.env);
      const root = await requireWorkspace(cwd);
      const local = await readTemplates(root, slugs);
      if (!local.length) {
        throw new CliError(`There are no templates in ${TEMPLATES_PATH} yet.`, {
          hint: 'Create one with `nulvless templates new <slug>`.',
        });
      }

      const target = await scope();
      if (env === PRODUCTION_ENVIRONMENT) {
        await confirm(`Push ${local.length} template(s) to production? People receive them from the next message.`);
      }

      const [commons, stored] = await output.task(`Loading templates of ${env}`, () =>
        Promise.all([resources.commonTemplates(api, target), resources.projectTemplates(api, target, env)]),
      );
      const platformSlugs = new Set(
        Object.entries(commons).flatMap(([channel, entries]) => entries.map((entry) => `${channel}/${entry.key}`)),
      );
      const existing = new Set(stored.map((entry) => `${entry.channel}/${entry.slug}/${entry.language}`));

      const results = [];
      for (const template of local) {
        const isPlatformTemplate = platformSlugs.has(`${template.channel}/${template.slug}`);
        const naming = isPlatformTemplate
          ? {}
          : {
              ...(template.name ? { name: template.name } : {}),
              ...(template.description ? { description: template.description } : {}),
            };

        for (const templateVersion of template.versions) {
          const key = { slug: template.slug, channel: template.channel, language: templateVersion.language };
          const content: TemplateBody = {
            ...(templateVersion.subject ? { subject: templateVersion.subject } : {}),
            content: templateVersion.content,
            ...naming,
          };
          const action = existing.has(`${key.channel}/${key.slug}/${key.language}`) ? 'updated' : 'created';

          await output.task(`Pushing ${key.slug} (${key.language})`, () =>
            action === 'updated'
              ? resources.updateTemplate(api, target, env, key, content)
              : resources.createTemplate(api, target, env, { ...key, ...content }),
          );
          results.push({ ...key, action });
          if (!output.json) output.success(`${action === 'created' ? 'Created' : 'Updated'} ${key.slug} (${key.language}) in ${env}.`);
        }
      }

      if (output.json) output.data(results);
    });

  templates
    .command('pull')
    .description("Write an environment's own templates into the workspace")
    .argument('[slugs...]', 'templates to pull (default: all of them)')
    .addOption(environmentOption())
    .action(async (slugs: string[], options: { env?: string }, command: Command) => {
      const { api, cwd, scope, output, confirm } = await context(command.optsWithGlobals());

      const env = requireEnvironment(options.env);
      const root = await requireWorkspace(cwd);
      const target = await scope();
      const stored = await output.task(`Loading templates of ${env}`, () => ownTemplates(api, target, env, slugs));
      const pulled = workspaceTemplatesOf(stored);
      if (!pulled.length) {
        throw new CliError(`${env} has no templates of its own yet.`, {
          hint: 'Change one in the console, or create one with `nulvless templates new` and push it.',
        });
      }

      const overwritten = [];
      for (const template of pulled) {
        if (await pathExists(join(root, templatePath(template.channel, template.slug)))) {
          overwritten.push(`${template.channel}/${template.slug}`);
        }
      }
      if (overwritten.length) await confirm(`Overwrite ${overwritten.join(', ')} in ${TEMPLATES_PATH}?`);

      for (const template of pulled) await writeTemplate(root, template);

      if (output.json) {
        return output.data(pulled.map((template) => ({ slug: template.slug, channel: template.channel, languages: template.versions.map((entry) => entry.language) })));
      }
      output.success(`Pulled ${pulled.length} template(s) from ${env} into ${TEMPLATES_PATH}.`);
    });
}
