import { Option, type Command } from 'commander';
import { resources, type Scope } from '../api/resources';
import type { Api } from '../api/http';
import type { ContextFactory } from '../context';
import { environmentOption } from '../environment-option';
import { CliError } from '../errors';
import { renderStatus, statusReportOf, type Severity } from '../status';
import { examples } from '../ui/help';

const WATCH_INTERVAL_MS = 5_000;
const CLEAR_SCREEN = '\x1b[2J\x1b[H';
const LATEST: Parameters<typeof resources.projectDeployments>[3] = { page: 1, limit: 1, sort: 'desc', all: false };

interface StatusFlags {
  env: string;
  watch?: boolean;
  failOn?: Severity;
}

async function loadReport(api: Api, target: Scope, environment: string, consoleUrl: string) {
  const [project, overview, health, deployments] = await Promise.all([
    resources.project(api, target),
    resources.projectOverview(api, target, environment),
    resources.projectHealth(api, target).catch(() => null),
    resources.projectDeployments(api, target, {}, LATEST).catch(() => ({ items: [] })),
  ]);
  return statusReportOf({ project, overview, health, deployments: deployments.items, consoleUrl });
}

export function registerStatusCommands(program: Command, context: ContextFactory) {
  program
    .command('status')
    .description('Show what needs attention in a project, with the command that fixes each problem')
    .addOption(environmentOption())
    .option('--watch', `refresh every ${WATCH_INTERVAL_MS / 1000} seconds until you press Ctrl+C`)
    .addOption(
      new Option('--fail-on <severity>', 'exit with code 1 when there is a problem, or any warning').choices(['problem', 'warning']),
    )
    .addHelpText(
      'after',
      examples(['nulvless status', 'nulvless status --env staging --watch', 'nulvless status --json --fail-on problem']),
    )
    .action(async (options: StatusFlags, command: Command) => {
      const { api, scope, output, platform } = await context(command.optsWithGlobals());

      if (options.watch && (output.json || !process.stdout.isTTY)) {
        throw new CliError('status --watch needs a terminal.', { hint: 'Run it without --watch to print the status once.' });
      }

      const target = await scope();
      const load = () => loadReport(api, target, options.env, platform.consoleUrl);

      if (options.watch) {
        for (;;) {
          const report = await load();
          output.print(`${CLEAR_SCREEN}${renderStatus(report, output.link)}\n`);
          output.note(`Refreshing every ${WATCH_INTERVAL_MS / 1000} seconds. Press Ctrl+C to stop.`);
          await new Promise((resolve) => setTimeout(resolve, WATCH_INTERVAL_MS));
        }
      }

      const report = await output.task(`Checking ${target.project}`, load);
      if (output.json) output.data(report);
      else output.print(renderStatus(report, output.link));

      const failing = report.issues.some((issue) => options.failOn === 'warning' || issue.severity === options.failOn);
      if (options.failOn && failing) throw new CliError(report.headline);
    });
}
