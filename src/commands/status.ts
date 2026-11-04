import { InvalidArgumentError, Option, type Command } from 'commander';
import { resources, type Scope } from '../api/resources';
import type { Api } from '../api/http';
import type { ContextFactory } from '../context';
import { environmentOption } from '../environment-option';
import { CliError } from '../errors';
import { renderStatus, statusReportOf, type Severity } from '../status';
import { watchStatus } from '../status-watch';
import { examples } from '../ui/help';

const DEFAULT_INTERVAL_SECONDS = 10;
const MIN_INTERVAL_SECONDS = 5;
const LATEST: Parameters<typeof resources.projectDeployments>[3] = { page: 1, limit: 1, sort: 'desc', all: false };

interface StatusFlags {
  env: string;
  watch?: boolean | number;
  untilOk?: boolean;
  timeout?: number;
  bell?: boolean;
  failOn?: Severity;
}

function seconds(minimum: number) {
  return (value: string) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum) {
      throw new InvalidArgumentError(`Use a whole number of seconds, ${minimum} or more.`);
    }
    return number;
  };
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
    .option(
      '--watch [seconds]',
      `refresh in place every few seconds (default ${DEFAULT_INTERVAL_SECONDS}) until you press Ctrl+C`,
      seconds(MIN_INTERVAL_SECONDS),
    )
    .option('--until-ok', 'keep checking and exit once nothing needs attention; works in CI too')
    .option('--timeout <seconds>', 'with --until-ok, give up after this long', seconds(1))
    .option('--bell', 'ring the terminal bell when a new problem appears')
    .addOption(
      new Option('--fail-on <severity>', 'exit with code 1 when there is a problem, or any warning').choices(['problem', 'warning']),
    )
    .addHelpText(
      'after',
      examples([
        'nulvless status',
        'nulvless status --env staging --watch --bell',
        'nulvless status --until-ok --timeout 600',
        'nulvless status --json --fail-on problem',
      ]),
    )
    .action(async (options: StatusFlags, command: Command) => {
      const { api, scope, output, platform } = await context(command.optsWithGlobals());

      const terminal = !output.json && Boolean(process.stdout.isTTY);
      if (options.timeout !== undefined && !options.untilOk) throw new CliError('--timeout needs --until-ok.');
      if (options.watch && !options.untilOk && !terminal) {
        throw new CliError('status --watch needs a terminal.', {
          hint: 'Run it without --watch to print the status once, or add --until-ok to wait in CI.',
        });
      }

      const target = await scope();
      const load = () => loadReport(api, target, options.env, platform.consoleUrl);

      if (options.watch || options.untilOk) {
        const report = await watchStatus({
          load,
          intervalMs: (typeof options.watch === 'number' ? options.watch : DEFAULT_INTERVAL_SECONDS) * 1000,
          untilOk: Boolean(options.untilOk),
          ...(options.timeout !== undefined ? { timeoutMs: options.timeout * 1000 } : {}),
          bell: Boolean(options.bell),
          terminal,
          write: (text) => (terminal ? process.stdout.write(text) : output.info(text)),
          link: output.link,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: Date.now,
        });
        if (output.json) return output.data(report);
        return output.success('Nothing needs attention anymore.');
      }

      const report = await output.task(`Checking ${target.project}`, load);
      if (output.json) output.data(report);
      else output.print(renderStatus(report, output.link));

      const failing = report.issues.some((issue) => options.failOn === 'warning' || issue.severity === options.failOn);
      if (options.failOn && failing) throw new CliError(report.headline);
    });
}
