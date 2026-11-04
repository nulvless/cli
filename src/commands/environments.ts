import type { Command } from 'commander';
import { resources, type Deployment, type EnvironmentChange } from '../api/resources';
import type { ContextFactory } from '../context';
import { CliError } from '../errors';
import { examples } from '../ui/help';
import { statusTone } from '../ui/style';

const VALUE_WIDTH = 40;
const POLL_INTERVAL_MS = 2000;
const WAIT_LIMIT_MS = 5 * 60_000;
const FINISHED = new Set(['succeeded', 'failed', 'cancelled']);

function flattenDiff(diff: Record<string, EnvironmentChange[]>) {
  return Object.entries(diff).flatMap(([section, changes]) => changes.map((change) => ({ section, ...change })));
}

function displayValue(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  return text.length > VALUE_WIDTH ? `${text.slice(0, VALUE_WIDTH - 1)}…` : text;
}

async function waitForDeployment(load: () => Promise<Deployment>) {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const deployment = await load();
    if (FINISHED.has(deployment.status)) return deployment;
    if (Date.now() > deadline) {
      throw new CliError(`The merge is still ${deployment.status}.`, {
        hint: `Follow it with \`nulvless deployments get ${deployment.id}\`.`,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export function registerEnvironmentCommands(program: Command, context: ContextFactory) {
  const environments = program
    .command('environments')
    .alias('envs')
    .description('Manage the environments of a project')
    .addHelpText(
      'after',
      examples([
        'nulvless envs list --project shop',
        'nulvless envs create staging --name Staging',
        'nulvless envs delete staging --yes',
        'nulvless envs diff staging main',
        'nulvless envs merge staging main --wait',
      ]),
    );

  environments
    .command('diff')
    .description('Show the settings a merge would change in the destination environment')
    .argument('<origin>', 'environment the settings come from')
    .argument('<destination>', 'environment that would change')
    .action(async (origin: string, destination: string, _options, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      const changes = flattenDiff(
        await output.task(`Comparing ${origin} with ${destination}`, () =>
          resources.environmentsDiff(api, target, origin, destination),
        ),
      );

      if (output.json) return output.data(changes);
      if (!changes.length) return output.info(`${origin} and ${destination} have the same settings.`);

      output.table(
        changes,
        [
          { header: 'SECTION', value: (change) => change.section },
          { header: 'FIELD', value: (change) => change.field },
          { header: `${destination.toUpperCase()} NOW`, value: (change) => displayValue(change.before) },
          { header: `FROM ${origin.toUpperCase()}`, value: (change) => displayValue(change.after) },
        ],
        { message: '' },
      );
      output.info(`${changes.length} change(s) would be merged from ${origin} into ${destination}.`);
      output.note('Credentials and secrets are never merged; configure them in the destination by hand.');
    });

  environments
    .command('merge')
    .description('Copy the settings of one environment into another (never users, credentials or secrets)')
    .argument('<origin>', 'environment the settings come from')
    .argument('<destination>', 'environment to change')
    .option('--wait', 'wait until the merge deployment finishes')
    .action(async (origin: string, destination: string, options: { wait?: boolean }, command: Command) => {
      const { api, scope, output, confirm } = await context(command.optsWithGlobals());

      const target = await scope();
      const changes = flattenDiff(
        await output.task(`Comparing ${origin} with ${destination}`, () =>
          resources.environmentsDiff(api, target, origin, destination),
        ),
      );
      if (!changes.length) {
        if (output.json) return output.data({ merged: false, changes: 0 });
        return output.info(`Nothing to merge: ${origin} and ${destination} have the same settings.`);
      }

      await confirm(`Merge ${changes.length} change(s) from ${origin} into ${destination}?`);
      const queued = await output.task('Queuing the merge', () => resources.mergeEnvironments(api, target, origin, destination));
      const finished = options.wait
        ? await output.task('Merging', () => waitForDeployment(() => resources.deployment(api, target, queued.id)))
        : null;

      if (output.json) return output.data(finished ?? queued);
      if (!finished) {
        output.success(`Merge queued as ${queued.id}.`);
        return output.note(`Follow it: nulvless deployments get ${queued.id}`);
      }
      if (finished.status !== 'succeeded') {
        throw new CliError(`The merge ended as ${finished.status}.`, { hint: `Run \`nulvless deployments get ${finished.id}\`.` });
      }
      output.success(`Merged ${origin} into ${destination}.`);
    });

  environments
    .command('list')
    .description('List the environments of a project')
    .action(async (_options, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      const project = await output.task('Loading environments', () => resources.project(api, target));
      output.table(
        project.environments,
        [
          { header: 'SLUG', value: (environment) => environment.slug },
          { header: 'NAME', value: (environment) => environment.name },
          { header: 'STATUS', value: (environment) => environment.status, tone: (environment) => statusTone(environment.status) },
          { header: 'URL', value: (environment) => environment.url },
        ],
        {
          message: `${project.slug} has no environments yet.`,
          hint: 'Create one with `nulvless envs create <slug>`.',
        },
      );
    });

  environments
    .command('create')
    .description('Create an environment')
    .argument('<slug>', 'identifier used in the environment URL, like staging')
    .option('--name <name>', 'name shown in the console (defaults to the slug)')
    .action(async (slug: string, options: { name?: string }, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      const environment = await output.task(`Creating ${slug}`, () =>
        resources.createEnvironment(api, target, { slug, name: options.name ?? slug }),
      );
      if (output.json) return output.data(environment);
      output.success(`Created ${environment.slug}. It builds before it can serve traffic on ${environment.url}.`);
    });

  environments
    .command('delete')
    .description('Delete an environment and everything in it')
    .argument('<slug>', 'environment to delete')
    .action(async (slug: string, _options, command: Command) => {
      const { api, scope, output, confirm } = await context(command.optsWithGlobals());

      const target = await scope();
      await confirm(`Delete the environment ${slug} of ${target.project}, with its users, sessions and keys?`);
      await output.task(`Deleting ${slug}`, () => resources.deleteEnvironment(api, target, slug));
      output.success(`Deleted ${slug}.`);
    });
}
