import { join } from 'node:path';
import type { Command } from 'commander';
import { resources } from '../api/resources';
import type { ContextFactory } from '../context';
import { configDirectory } from '../credentials/credential-store';
import { runChecks, type CheckStatus } from '../doctor';
import { CliError } from '../errors';
import { claimsOf } from '../jwt';
import { latestVersion } from '../version-check';
import { findWorkspace, readWorkspaceConfig } from '../workspace';

const STATUS_LABEL: Record<CheckStatus, string> = { ok: 'ok', warn: 'warning', fail: 'problem' };
const STATUS_TONE = { ok: 'good', warn: 'pending', fail: 'bad' } as const;

export function versionCacheFile(env: NodeJS.ProcessEnv) {
  return join(configDirectory(env), 'version-check.json');
}

export function registerDoctorCommand(program: Command, context: ContextFactory, version: string) {
  program
    .command('doctor')
    .description('Check your setup and get the command that fixes each problem')
    .action(async (_options, command: Command) => {
      const { api, env, cwd, platform, store, token, output } = await context(command.optsWithGlobals());

      const checks = await output.task('Checking your setup', () =>
        runChecks({
          nodeVersion: process.versions.node,
          cliVersion: version,
          latestVersion: () => latestVersion({ cache: versionCacheFile(env) }),
          usingToken: Boolean(env.NULVLESS_TOKEN),
          sessionLocation: store.location,
          account: async () => {
            const claims = claimsOf(await token());
            return String(claims.email ?? claims.sub ?? 'an unknown account');
          },
          apiReachable: () =>
            fetch(platform.apiUrl).then(
              () => true,
              () => false,
            ),
          workspace: async () => {
            const root = await findWorkspace(cwd);
            if (!root) return null;
            const config = await readWorkspaceConfig(root);
            return {
              root,
              ...(config.organization ? { organization: config.organization } : {}),
              ...(config.project ? { project: config.project } : {}),
            };
          },
          projectAccessible: (organization, project) =>
            resources.project(api, { organization, project }).then(
              () => true,
              () => false,
            ),
        }),
      );

      if (output.json) output.data(checks);
      else {
        output.table(
          checks,
          [
            { header: 'CHECK', value: (check) => check.name },
            { header: 'STATUS', value: (check) => STATUS_LABEL[check.status], tone: (check) => STATUS_TONE[check.status] },
            { header: 'DETAIL', value: (check) => check.detail },
          ],
          { message: '' },
        );
        for (const check of checks) if (check.fix) output.note(`${check.name}: ${check.fix}`);
      }

      const failed = checks.filter((check) => check.status === 'fail').length;
      if (failed) throw new CliError(`${failed} check(s) found a problem.`, { hint: 'Run the fix shown for each one.' });
      if (!output.json) output.success('Everything needed to use the CLI is in place.');
    });
}
