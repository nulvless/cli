import { join } from 'node:path';
import type { Command } from 'commander';
import type { Api } from '../api/http';
import { resources, type Scope } from '../api/resources';
import type { ContextFactory } from '../context';
import { CliError } from '../errors';
import { downloadExample, fetchCatalog, findExample } from '../examples';
import { examples } from '../ui/help';
import { statusTone } from '../ui/style';
import {
  findWorkspace,
  FUNCTION_SLUG,
  functionSlugs,
  FUNCTIONS_DIR,
  pathExists,
  readFunctionSources,
  readWorkspaceConfig,
  STARTER_FUNCTION,
  WORKSPACE_DIR,
  writeFiles,
  type FunctionSource,
} from '../workspace';

async function loadHistory(api: Api, target: Scope, slug: string) {
  const [edgeFunction, deployments] = await Promise.all([
    resources.function(api, target, slug),
    resources.deployments(api, target, slug),
  ]);
  return deployments.map((deployment) => ({ ...deployment, live: deployment.version === edgeFunction.version }));
}

const NO_WORKSPACE = () => new CliError('There is no Nulvless workspace here.', { hint: 'Run `nulvless init` first.' });

function deployForm(sources: FunctionSource[], fields: Record<string, string>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  for (const source of sources) form.append('files', new Blob([new Uint8Array(source.content)]), source.path);
  return form;
}

export function registerFunctionCommands(program: Command, context: ContextFactory, version: string) {
  const functions = program
    .command('functions')
    .alias('fn')
    .description('Inspect and manage Edge Functions')
    .addHelpText(
      'after',
      examples([
        'nulvless fn new checkout',
        'nulvless fn new whoami --template verify-session',
        'nulvless fn deploy',
        'nulvless fn pull checkout',
        'nulvless fn list --project shop',
        'nulvless fn deployments checkout',
        'nulvless fn promote checkout v2',
      ]),
    );

  functions
    .command('new')
    .description('Create an Edge Function in the workspace, from scratch or from an example')
    .argument('<slug>', 'function slug, used in its URL')
    .option('--template <example>', 'start from an example (see `nulvless examples --kind function`)')
    .action(async (slug: string, options: { template?: string }, command: Command) => {
      const { cwd, fetch, platform, output } = await context(command.optsWithGlobals());

      const root = await findWorkspace(cwd);
      if (!root) throw NO_WORKSPACE();
      if (!FUNCTION_SLUG.test(slug)) {
        throw new CliError(`${slug} is not a valid function slug.`, {
          hint: 'Use 3 to 50 lowercase letters, numbers and dashes, such as send-email.',
        });
      }

      const path = `${WORKSPACE_DIR}/${FUNCTIONS_DIR}/${slug}`;
      const target = join(root, path);
      if (await pathExists(target)) throw new CliError(`${path} already exists.`, { hint: 'Choose another slug.' });

      const template = options.template
        ? await output.task(`Downloading ${options.template}`, async () => {
            const example = findExample(await fetchCatalog(platform.examplesUrl, fetch), options.template!, 'function', version);
            return { example, files: await downloadExample(platform.examplesUrl, example, fetch) };
          })
        : null;
      const files = template?.files ?? STARTER_FUNCTION;
      const secrets = template?.example.secrets ?? [];

      await writeFiles(target, files);

      if (output.json) {
        return output.data({ slug, path, template: options.template ?? null, files: files.map((file) => file.path), secrets });
      }
      output.success(`Created ${path}.`);
      output.note(`Deploy it: nulvless functions deploy ${slug}`);
      for (const secret of secrets) output.note(`Then set ${secret}: nulvless secrets set ${secret} --function ${slug}`);
    });

  functions
    .command('deploy')
    .description('Deploy Edge Functions from the workspace, creating the ones that do not exist yet')
    .argument('[slugs...]', 'functions to deploy (default: every folder in nulvless/functions)')
    .action(async (slugs: string[], _options, command: Command) => {
      const { api, cwd, scope, output } = await context(command.optsWithGlobals());

      const root = await findWorkspace(cwd);
      if (!root) throw NO_WORKSPACE();

      const selected = slugs.length ? slugs : await functionSlugs(root);
      if (!selected.length) {
        throw new CliError(`There are no functions in ${WORKSPACE_DIR}/${FUNCTIONS_DIR} yet.`, {
          hint: 'Create one with `nulvless functions new <slug>`.',
        });
      }

      const sources = new Map<string, FunctionSource[]>();
      for (const slug of selected) sources.set(slug, await readFunctionSources(root, slug));

      const declared = (await readWorkspaceConfig(root)).functions ?? {};
      const target = await scope();
      const existing = new Set(
        (await output.task('Loading functions', () => resources.functions(api, target))).map((fn) => fn.slug),
      );

      const results = [];
      for (const slug of selected) {
        const files = sources.get(slug) ?? [];
        const action = existing.has(slug) ? 'updated' : 'created';
        const deployed = await output.task(`Deploying ${slug}`, () =>
          action === 'updated'
            ? resources.updateFunction(api, target, slug, deployForm(files, {}))
            : resources.createFunction(api, target, deployForm(files, { slug, name: declared[slug]?.name ?? slug })),
        );
        results.push({ slug, action, version: deployed.short_version });
        if (!output.json) output.success(`${action === 'created' ? 'Created' : 'Updated'} ${slug} (${deployed.short_version}).`);
      }

      if (output.json) output.data(results);
    });

  functions
    .command('pull')
    .description('Write the code of existing Edge Functions into the workspace')
    .argument('[slugs...]', 'functions to pull (default: every function of the project)')
    .action(async (slugs: string[], _options, command: Command) => {
      const { api, cwd, scope, output, confirm } = await context(command.optsWithGlobals());

      const root = await findWorkspace(cwd);
      if (!root) throw NO_WORKSPACE();

      const target = await scope();
      const selected = slugs.length
        ? slugs
        : (await output.task('Loading functions', () => resources.functions(api, target))).map((fn) => fn.slug);
      if (!selected.length) throw new CliError(`${target.project} has no Edge Functions yet.`);

      const existing = [];
      for (const slug of selected) {
        if (await pathExists(join(root, WORKSPACE_DIR, FUNCTIONS_DIR, slug))) existing.push(slug);
      }
      if (existing.length) await confirm(`Overwrite ${existing.join(', ')} in ${WORKSPACE_DIR}/${FUNCTIONS_DIR}?`);

      const pulled = [];
      for (const slug of selected) {
        const { files } = await output.task(`Pulling ${slug}`, () => resources.functionSource(api, target, slug));
        const path = `${WORKSPACE_DIR}/${FUNCTIONS_DIR}/${slug}`;
        await writeFiles(join(root, path), files);
        pulled.push({ slug, path, files: files.map((file) => file.path) });
      }

      if (output.json) return output.data(pulled);
      output.success(`Pulled ${pulled.length} function(s) into ${WORKSPACE_DIR}/${FUNCTIONS_DIR}.`);
    });

  functions
    .command('list')
    .description('List the Edge Functions of a project')
    .action(async (_options, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      output.table(
        await output.task('Loading functions', () => resources.functions(api, target)),
        [
          { header: 'SLUG', value: (fn) => fn.slug },
          { header: 'NAME', value: (fn) => fn.name },
          { header: 'STATUS', value: (fn) => fn.status, tone: (fn) => statusTone(fn.status) },
          { header: 'VERSION', value: (fn) => fn.short_version },
        ],
        {
          message: `No Edge Functions in ${target.project} yet.`,
          hint: 'Create one with `nulvless functions new <slug>` and `nulvless functions deploy`.',
        },
      );
    });

  functions
    .command('deployments')
    .description('List the deployments of an Edge Function, with the live version and the ones you can promote')
    .argument('<slug>', 'function slug')
    .action(async (slug: string, _options, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      output.table(
        await output.task(`Loading deployments of ${slug}`, () => loadHistory(api, target, slug)),
        [
          { header: 'VERSION', value: (deployment) => deployment.short_version },
          { header: 'STATUS', value: (deployment) => deployment.status, tone: (deployment) => statusTone(deployment.status) },
          { header: 'LIVE', value: (deployment) => (deployment.live ? 'live' : ''), tone: () => 'good' },
          { header: 'PROMOTE', value: (deployment) => (deployment.promote_available ? 'yes' : '') },
          { header: 'TRIGGER', value: (deployment) => deployment.trigger },
          { header: 'CREATED', value: (deployment) => new Date(deployment.created_at).toLocaleString() },
          { header: 'ID', value: (deployment) => deployment.id },
        ],
        { message: `${slug} has no deployments yet.`, hint: 'Deployments appear here once the function is published.' },
      );
      if (!output.json) output.note(`Serve an earlier version again: nulvless functions promote ${slug} <version>`);
    });

  functions
    .command('promote')
    .description('Serve another kept version of an Edge Function, such as the one before a bad deploy')
    .argument('<slug>', 'function slug')
    .argument('[version]', 'version or deployment id from `functions deployments` (asked when omitted)')
    .addHelpText('after', examples(['nulvless fn deployments checkout', 'nulvless fn promote checkout v2 --yes']))
    .action(async (slug: string, version: string | undefined, _options, command: Command) => {
      const { api, scope, output, prompter, confirm } = await context(command.optsWithGlobals());

      const target = await scope();
      const history = await output.task(`Loading deployments of ${slug}`, () => loadHistory(api, target, slug));
      const listHint = `Run \`nulvless functions deployments ${slug}\` to see its versions.`;

      let deploymentId = version;
      if (!deploymentId) {
        const promotable = history.filter((deployment) => deployment.promote_available);
        if (!promotable.length) throw new CliError(`${slug} has no other version to promote.`, { hint: listHint });
        if (!prompter.interactive) {
          throw new CliError('No version selected.', {
            hint: `Pass the version, such as \`nulvless functions promote ${slug} ${promotable[0]?.short_version}\`.`,
          });
        }
        deploymentId = await prompter.choose(
          'Which version should go live?',
          promotable.map((deployment) => ({
            value: deployment.id,
            label: deployment.short_version,
            hint: new Date(deployment.created_at).toLocaleString(),
          })),
        );
      }

      const deployment = history.find((entry) => entry.id === deploymentId || entry.short_version === deploymentId);
      if (!deployment) throw new CliError(`${slug} has no deployment ${deploymentId}.`, { hint: listHint });
      if (deployment.live) throw new CliError(`${deployment.short_version} is already live.`);
      if (!deployment.promote_available) {
        throw new CliError(`${deployment.short_version} cannot be promoted.`, {
          hint: `Only successful deploys among the last versions of a function are kept. Run \`nulvless functions deployments ${slug}\` to see which ones.`,
        });
      }

      await confirm(`Serve ${deployment.short_version} of ${slug}? It replaces the live version immediately.`);
      await output.task(`Promoting ${deployment.short_version}`, () =>
        resources.promoteDeployment(api, target, slug, deployment.id),
      );

      if (output.json) return output.data({ slug, deployment: deployment.id, version: deployment.short_version });
      output.success(`${slug} now serves ${deployment.short_version}.`);
    });

  functions
    .command('delete')
    .description('Delete an Edge Function')
    .argument('<slug>', 'function slug')
    .action(async (slug: string, _options, command: Command) => {
      const { api, scope, output, confirm } = await context(command.optsWithGlobals());

      const target = await scope();
      await confirm(`Delete the function ${slug} from ${target.project}? Its URL stops answering immediately.`);
      await output.task(`Deleting ${slug}`, () => resources.deleteFunction(api, target, slug));
      output.success(`Deleted ${slug}.`);
    });
}
