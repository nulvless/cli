import type { Command } from 'commander';
import { resources } from '../api/resources';
import type { ContextFactory } from '../context';
import { consoleUrl } from '../platform';
import { examples } from '../ui/help';
import { statusTone } from '../ui/style';

export function registerFunctionCommands(program: Command, context: ContextFactory) {
  const functions = program
    .command('functions')
    .alias('fn')
    .description('Inspect and manage Edge Functions')
    .addHelpText(
      'after',
      examples(['nulvless fn list --project shop', 'nulvless fn deployments checkout', 'nulvless fn delete checkout']),
    );

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
        { message: `No Edge Functions in ${target.project} yet.`, hint: `Create one in the console: ${consoleUrl}` },
      );
    });

  functions
    .command('deployments')
    .description('List the deployments of an Edge Function')
    .argument('<slug>', 'function slug')
    .action(async (slug: string, _options, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      output.table(
        await output.task(`Loading deployments of ${slug}`, () => resources.deployments(api, target, slug)),
        [
          { header: 'VERSION', value: (deployment) => deployment.short_version },
          { header: 'STATUS', value: (deployment) => deployment.status, tone: (deployment) => statusTone(deployment.status) },
          { header: 'TRIGGER', value: (deployment) => deployment.trigger },
          { header: 'CREATED', value: (deployment) => new Date(deployment.created_at).toLocaleString() },
          { header: 'ID', value: (deployment) => deployment.id },
        ],
        { message: `${slug} has no deployments yet.`, hint: 'Deployments appear here once the function is published.' },
      );
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
