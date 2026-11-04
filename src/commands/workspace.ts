import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Option, type Command } from 'commander';
import { resources } from '../api/resources';
import type { ContextFactory, GlobalFlags } from '../context';
import { environmentOption } from '../environment-option';
import { CliError, forItem } from '../errors';
import { downloadExample, fetchCatalog, findExample, type ExampleKind } from '../examples';
import { templatePath, workspaceTemplatesOf, writeTemplate } from '../templates';
import { ownTemplates } from './templates';
import { examples } from '../ui/help';
import {
  findWorkspace,
  FUNCTIONS_DIR,
  initWorkspace,
  pathExists,
  WORKSPACE_DIR,
  writeFiles,
  type WorkspaceLink,
} from '../workspace';

function linkFrom(flags: GlobalFlags): WorkspaceLink {
  return {
    ...(flags.org ? { organization: flags.org } : {}),
    ...(flags.project ? { project: flags.project } : {}),
  };
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

async function isEmptyOrMissing(directory: string) {
  return readdir(directory).then(
    (entries) => entries.length === 0,
    () => true,
  );
}

export function registerWorkspaceCommands(program: Command, context: ContextFactory, version: string) {
  program
    .command('init')
    .description('Create a Nulvless workspace (nulvless/) in this folder')
    .addHelpText('after', examples(['nulvless init', 'nulvless init --org acme --project shop']))
    .action(async (_options, command: Command) => {
      const flags = command.optsWithGlobals<GlobalFlags>();
      const { cwd, output } = await context(flags);

      const files = await initWorkspace(cwd, linkFrom(flags));

      if (output.json) return output.data({ root: cwd, files });
      output.success('Created the Nulvless workspace in nulvless/.');
      output.note('Next: nulvless functions new hello');
    });

  program
    .command('pull')
    .description("Write the project's Edge Functions and an environment's own templates into the workspace")
    .addOption(environmentOption())
    .addHelpText('after', examples(['nulvless pull', 'nulvless pull --env staging --yes']))
    .action(async (options: { env: string }, command: Command) => {
      const { api, cwd, scope, output, confirm } = await context(command.optsWithGlobals());

      const root = await findWorkspace(cwd);
      if (!root) throw new CliError('There is no Nulvless workspace here.', { hint: 'Run `nulvless init` first.' });

      const target = await scope();
      const [functions, stored] = await output.task('Loading functions and templates', () =>
        Promise.all([resources.functions(api, target), ownTemplates(api, target, options.env)]),
      );
      const functionPaths = functions.map((fn) => ({ slug: fn.slug, path: `${WORKSPACE_DIR}/${FUNCTIONS_DIR}/${fn.slug}` }));
      const templates = workspaceTemplatesOf(stored).map((template) => ({
        template,
        path: templatePath(template.channel, template.slug),
      }));

      if (!functionPaths.length && !templates.length) {
        if (output.json) return output.data({ environment: options.env, functions: [], templates: [] });
        output.info(
          `Nothing to pull: ${target.project} has no Edge Functions and ${options.env} has no templates of its own.`,
        );
        return;
      }

      const overwritten = [];
      for (const { path } of [...functionPaths, ...templates]) {
        if (await pathExists(join(root, path))) overwritten.push(path);
      }
      if (overwritten.length) await confirm(`Overwrite ${overwritten.join(', ')}?`);

      const pulledFunctions = [];
      for (const { slug, path } of functionPaths) {
        const { files } = await forItem(slug, output.task(`Pulling ${slug}`, () => resources.functionSource(api, target, slug)));
        await writeFiles(join(root, path), files);
        pulledFunctions.push({ slug, path, files: files.map((file) => file.path) });
      }
      for (const { template } of templates) await writeTemplate(root, template);

      if (output.json) {
        return output.data({
          environment: options.env,
          functions: pulledFunctions,
          templates: templates.map(({ template, path }) => ({
            slug: template.slug,
            channel: template.channel,
            path,
            languages: template.versions.map((version) => version.language),
          })),
        });
      }
      const pulled = [
        ...(functionPaths.length ? [plural(functionPaths.length, 'function', 'functions')] : []),
        ...(templates.length ? [plural(templates.length, 'template', 'templates')] : []),
      ];
      output.success(`Pulled ${pulled.join(' and ')} from ${options.env}.`);
    });

  program
    .command('create')
    .description('Create a new project from an example app')
    .argument('<dir>', 'folder to create')
    .option('--example <name>', 'example app to copy (see `nulvless examples --kind app`)')
    .addHelpText(
      'after',
      examples(['nulvless create my-app --example auth-nextjs', 'nulvless examples --kind app']),
    )
    .action(async (dir: string, options: { example?: string }, command: Command) => {
      const { cwd, fetch, platform, output } = await context(command.optsWithGlobals());

      const name = options.example;
      if (!name) {
        throw new CliError('No example selected.', {
          hint: 'Pass --example <name>. Run `nulvless examples --kind app` to see them.',
        });
      }

      const target = resolve(cwd, dir);
      if (!(await isEmptyOrMissing(target))) throw new CliError(`${dir} is not empty.`, { hint: 'Choose a new folder name.' });

      const { example, files } = await output.task(`Downloading ${name}`, async () => {
        const found = findExample(await fetchCatalog(platform.examplesUrl, fetch), name, 'app', version);
        return { example: found, files: await downloadExample(platform.examplesUrl, found, fetch) };
      });
      await writeFiles(target, files);

      if (output.json) return output.data({ directory: target, example: example.name, files: files.map((file) => file.path) });
      output.success(`Created ${dir} from ${example.name}.`);
      output.note(`Next: cd ${dir}, then follow README.md to configure and run it.`);
    });

  program
    .command('examples')
    .description('List the example functions, apps and communication templates you can start from')
    .addOption(
      new Option('--kind <kind>', 'only functions, apps or communication templates').choices(['function', 'app', 'template']),
    )
    .addHelpText('after', examples(['nulvless examples', 'nulvless examples --kind function --json']))
    .action(async (options: { kind?: ExampleKind }, command: Command) => {
      const { fetch, platform, output } = await context(command.optsWithGlobals());

      const catalog = await output.task('Loading examples', () => fetchCatalog(platform.examplesUrl, fetch));
      output.table(
        catalog.filter((example) => !options.kind || example.kind === options.kind),
        [
          { header: 'NAME', value: (example) => example.name },
          { header: 'KIND', value: (example) => example.kind },
          { header: 'DESCRIPTION', value: (example) => example.description },
        ],
        { message: 'There are no examples yet.' },
      );
      if (!output.json) {
        output.note('Functions: nulvless functions new <slug> --template <name>');
        output.note('Apps: nulvless create <dir> --example <name>');
        output.note('Templates: paste into Communications → Templates in the console');
      }
    });
}
