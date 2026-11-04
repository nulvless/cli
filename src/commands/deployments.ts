import { Option, type Command } from 'commander';
import { resources, type Deployment, type PipelineStep } from '../api/resources';
import type { ContextFactory } from '../context';
import { formatDuration } from '../output';
import { examples } from '../ui/help';
import { statusTone } from '../ui/style';

function deployedTarget(deployment: Deployment) {
  const metadata = deployment.metadata ?? {};
  const value = metadata.function_slug ?? metadata.destination ?? metadata.environment;
  return typeof value === 'string' ? value : '';
}

function stepDuration(step: PipelineStep) {
  if (!step.started_at || !step.ended_at) return '';
  return formatDuration(new Date(step.ended_at).getTime() - new Date(step.started_at).getTime());
}

function failureOf(deployment: Deployment) {
  const failed = deployment.pipeline?.find((step) => step.status === 'failed');
  const message = failed?.detail?.message ?? deployment.metadata?.detail;
  return typeof message === 'string' ? message : null;
}

export function registerDeploymentCommands(program: Command, context: ContextFactory) {
  const deployments = program
    .command('deployments')
    .description('Inspect the deployments of a project: functions and environments')
    .addHelpText(
      'after',
      examples(['nulvless deployments list', 'nulvless deployments list --function checkout', 'nulvless deployments get dep_123']),
    );

  deployments
    .command('list')
    .description('List the deployments of the project, newest first')
    .option('--function <slug>', 'only the deployments of one Edge Function')
    .addOption(new Option('--context <context>', 'only functions or only environments').choices(['functions', 'environments']))
    .addOption(
      new Option('--status <status>', 'only deployments in this status').choices([
        'queued',
        'running',
        'succeeded',
        'failed',
        'cancelled',
      ]),
    )
    .action(async (options: { function?: string; context?: string; status?: string }, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      const rows = await output.task('Loading deployments', async () => {
        const fn = options.function ? await resources.function(api, target, options.function) : null;
        const filters: Record<string, string> = {
          ...(fn ? { context: 'functions', scope: String(fn.id) } : options.context ? { context: options.context } : {}),
          ...(options.status ? { status: options.status } : {}),
        };
        return resources.projectDeployments(api, target, filters);
      });

      output.table(
        rows,
        [
          { header: 'ID', value: (deployment) => deployment.id },
          { header: 'KIND', value: (deployment) => deployment.context ?? '' },
          { header: 'TARGET', value: deployedTarget },
          { header: 'VERSION', value: (deployment) => deployment.short_version },
          { header: 'STATUS', value: (deployment) => deployment.status, tone: (deployment) => statusTone(deployment.status) },
          { header: 'TRIGGER', value: (deployment) => deployment.trigger },
          { header: 'CREATED', value: (deployment) => new Date(deployment.created_at).toLocaleString() },
        ],
        { message: `No deployments in ${target.project} yet.` },
      );
    });

  deployments
    .command('get')
    .description('Show one deployment: its pipeline steps and why it failed')
    .argument('<id>', 'deployment id from `deployments list`')
    .action(async (id: string, _options, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      const deployment = await output.task(`Loading ${id}`, () => resources.deployment(api, target, id));
      if (output.json) return output.data(deployment);

      output.info(
        `${deployment.context ?? 'deployment'} ${deployedTarget(deployment)} ${deployment.short_version}: ${deployment.status}, ${deployment.trigger}, ${new Date(deployment.created_at).toLocaleString()}`,
      );
      output.table(
        deployment.pipeline ?? [],
        [
          { header: 'STEP', value: (step) => step.name },
          { header: 'STATUS', value: (step) => step.status, tone: (step) => statusTone(step.status) },
          { header: 'DURATION', value: stepDuration },
        ],
        { message: 'This deployment has no recorded steps.' },
      );

      const failure = failureOf(deployment);
      if (failure) output.info(`Failed: ${failure}`);
    });
}
