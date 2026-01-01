import type { Command } from 'commander';
import { resources } from '../api/resources';
import type { ContextFactory } from '../context';
import { examples } from '../ui/help';
import { statusTone } from '../ui/style';

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
      ]),
    );

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
