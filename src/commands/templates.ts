import { join } from 'node:path';
import { Option, type Command } from 'commander';
import type { Api } from '../api/http';
import { resources, type Scope, type StoredTemplate, type TranslationBody } from '../api/resources';
import type { ContextFactory } from '../context';
import { CliError, forItem } from '../errors';
import { downloadExample, fetchCatalog, findExample } from '../examples';
import {
  languageFile,
  readTemplates,
  starterTemplate,
  TEMPLATE_CHANNELS,
  templateFilesFor,
  templatePath,
  workspaceTemplateOf,
  TEMPLATES_PATH,
  writeTemplate,
  type TemplateChannel,
  type TemplateVersion,
} from '../templates';
import { examples } from '../ui/help';
import { assertFolderName, findWorkspace, pathExists, writeFiles } from '../workspace';

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

const languagesOf = (template: StoredTemplate) => template.translations.map((translation) => translation.language);

export async function ownTemplates(api: Api, target: Scope, environment: string, slugs: string[] = []) {
  const listed = await resources.storedTemplates(api, target, environment);
  const wanted = listed.filter((template) => !slugs.length || slugs.includes(template.slug));
  return Promise.all(wanted.map((template) => resources.template(api, target, environment, template)));
}

function templateRows(platform: StoredTemplate[], stored: StoredTemplate[]): TemplateRow[] {
  const builtIn: TemplateRow[] = platform
    .filter((template) => TEMPLATE_CHANNELS.includes(template.channel))
    .map((template) => ({
      slug: template.slug,
      channel: template.channel,
      kind: template.customized ? 'customized' : 'default',
      languages: languagesOf(template),
    }));
  const custom: TemplateRow[] = stored
    .filter((template) => !template.common)
    .map((template) => ({ slug: template.slug, channel: template.channel, kind: 'custom', languages: languagesOf(template) }));
  return [...builtIn, ...custom];
}

function translationBody(version: TemplateVersion): TranslationBody {
  return { ...(version.subject ? { subject: version.subject } : {}), content: version.content };
}

function fallbackOf(template: StoredTemplate, deleted: string[]) {
  const remaining = template.translations.filter((translation) => !deleted.includes(translation.language));
  const oldest = [...remaining].sort((one, other) => (one.created_at ?? '').localeCompare(other.created_at ?? ''))[0];
  return remaining.find((translation) => translation.language === 'en-US') ?? oldest;
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
      const [platform, stored] = await output.task(`Loading templates of ${env}`, () =>
        Promise.all([
          resources.platformTemplates(api, target, env, filters),
          resources.storedTemplates(api, target, env, filters),
        ]),
      );

      output.table(
        templateRows(platform.items, stored),
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
      assertFolderName(slug);

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
        Promise.all([resources.commonTemplates(api, target), resources.storedTemplates(api, target, env)]),
      );
      const platformSlugs = new Set(
        Object.entries(commons).flatMap(([channel, entries]) => entries.map((entry) => `${channel}/${entry.key}`)),
      );
      const storedLanguages = new Map(stored.map((template) => [templateKey(template), languagesOf(template)]));

      const results = [];
      for (const template of local) {
        const details = platformSlugs.has(templateKey(template))
          ? {}
          : {
              ...(template.name ? { name: template.name } : {}),
              ...(template.description ? { description: template.description } : {}),
            };
        const languages = storedLanguages.get(templateKey(template));

        for (const [index, version] of template.versions.entries()) {
          const label = `${template.slug} (${version.language})`;
          const creating = !languages && index === 0;

          await forItem(
            label,
            output.task(`Pushing ${label}`, () =>
              creating
                ? resources.createTemplate(api, target, env, {
                    slug: template.slug,
                    channel: template.channel,
                    ...details,
                    language: version.language,
                    ...translationBody(version),
                  })
                : resources.putTemplateTranslation(api, target, env, template, version.language, translationBody(version)),
            ),
          );
          const action = languages?.includes(version.language) ? 'updated' : 'created';
          results.push({ slug: template.slug, channel: template.channel, language: version.language, action });
          if (!output.json) output.success(`${action === 'created' ? 'Created' : 'Updated'} ${label} in ${env}.`);
        }

        if (languages && Object.keys(details).length) {
          await forItem(
            template.slug,
            output.task(`Naming ${template.slug}`, () => resources.updateTemplateDetails(api, target, env, template, details)),
          );
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
      const pulled = stored.map(workspaceTemplateOf);
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

  templates
    .command('delete')
    .description('Delete a template from an environment, in every language or one')
    .argument('<template>', 'template slug, or channel/slug when it is in both channels')
    .addOption(environmentOption())
    .option('--language <language>', 'only this language, such as pt-BR')
    .action(async (selector: string, options: { env?: string; language?: string }, command: Command) => {
      const { api, cwd, scope, output, confirm } = await context(command.optsWithGlobals());

      const env = requireEnvironment(options.env);
      const target = await scope();
      const listed = await output.task(`Loading templates of ${env}`, () => resources.storedTemplates(api, target, env));

      const matching = listed.filter((template) => selector === template.slug || selector === templateKey(template));
      if (!matching.length) {
        throw new CliError(`${env} has no template ${selector}.`, {
          hint: `Run \`nulvless templates list --env ${env}\` to see them.`,
        });
      }
      const channels = matching.map((template) => template.channel);
      if (channels.length > 1) {
        throw new CliError(`${selector} is in ${channels.join(' and ')}.`, {
          hint: `Pass ${channels.map((channel) => `${channel}/${selector}`).join(' or ')}.`,
        });
      }

      const template = matching[0]!;
      const key = templateKey(template);
      const storedLanguages = languagesOf(template);
      const languages: string[] = options.language ? [options.language] : storedLanguages;
      if (options.language && !storedLanguages.some((language) => language === options.language)) {
        throw new CliError(`${env} has no template ${selector} in ${options.language}.`, {
          hint: `Run \`nulvless templates list --env ${env}\` to see them.`,
        });
      }

      const fallback = fallbackOf(template, languages);
      const consequence = fallback
        ? `Messages in ${languages.join(', ')} fall back to ${fallback.language}.`
        : template.common
          ? 'Nulvless goes back to sending its default.'
          : 'Messages sent with it stop working.';
      await confirm(`Delete ${key} (${languages.join(', ')}) from ${env}? ${consequence}`);

      await forItem(
        fallback ? `${template.slug} (${languages[0]})` : template.slug,
        output.task(`Deleting ${key} (${languages.join(', ')})`, () =>
          fallback
            ? resources.deleteTemplateTranslation(api, target, env, template, languages[0]!)
            : resources.deleteTemplate(api, target, env, template),
        ),
      );

      if (output.json) return output.data({ slug: template.slug, channel: template.channel, languages });
      output.success(`Deleted ${key} (${languages.join(', ')}) from ${env}.`);

      const root = await findWorkspace(cwd);
      if (!root) return;
      for (const language of languages) {
        const file = `${templatePath(template.channel, template.slug)}/${languageFile(template.channel, language)}`;
        if (await pathExists(join(root, file))) output.note(`${file} is still in the workspace; the next push sends it back.`);
      }
    });
}
