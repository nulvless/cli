import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import type { Command } from 'commander';
import type { ContextFactory } from '../context';
import { CliError } from '../errors';
import { PACKAGE, planUpgrade } from '../upgrade';
import { latestVersion } from '../version-check';
import { versionCacheFile } from './doctor';

function runInstaller(command: string, args: string[], quiet: boolean) {
  return new Promise<number>((resolve, reject) => {
    const installer = spawn(command, args, {
      stdio: ['ignore', quiet ? 'ignore' : 'inherit', 'inherit'],
      shell: process.platform === 'win32',
    });
    installer.on('error', reject);
    installer.on('close', (code) => resolve(code ?? 1));
  });
}

export function registerUpgradeCommand(program: Command, context: ContextFactory, version: string) {
  program
    .command('upgrade')
    .description('Update the CLI to its latest version')
    .action(async (_options, command: Command) => {
      const { env, output } = await context(command.optsWithGlobals());

      const latest = await output.task('Checking the latest version', () =>
        latestVersion({ cache: versionCacheFile(env), fresh: true }),
      );
      if (!latest) {
        throw new CliError('Could not reach the npm registry to check the latest version.', {
          hint: 'Check your connection and try again.',
        });
      }

      const plan = planUpgrade(version, latest, realpathSync(process.argv[1] ?? ''));

      if (plan.action === 'temporary') {
        throw new CliError('This run came from npx, so there is no installed CLI to upgrade.', {
          hint: `Run \`npx ${PACKAGE}@latest\` to use ${latest}.`,
        });
      }
      if (plan.action === 'project') {
        throw new CliError('This CLI is installed as a dependency of a project.', {
          hint: `Update ${PACKAGE} in that project, such as with \`npm install ${PACKAGE}@latest\`.`,
        });
      }

      if (plan.action === 'run') {
        const installer = `${plan.command} ${plan.args.join(' ')}`;
        if (!output.json) output.step(`Upgrading from ${version} to ${latest} with \`${installer}\``);

        const code = await runInstaller(plan.command, plan.args, output.json).catch(() => 1);
        if (code !== 0) {
          throw new CliError(`${plan.command} could not upgrade the CLI.`, {
            hint: `Run \`${installer}\` yourself to see what went wrong.`,
          });
        }
      }

      const upgraded = plan.action === 'run';
      if (output.json) output.data({ current: version, latest, upgraded });
      else if (upgraded) output.success(`Nulvless CLI upgraded to ${latest}.`);
      else output.success(`You already have the latest version, ${version}.`);
    });
}
