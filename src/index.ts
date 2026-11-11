import { createContext } from './context';
import { CliError, ExitCode } from './errors';
import { buildProgram } from './program';
import { renderFailure, renderJsonFailure } from './ui/failure';
import { CLEAR_LINE, SHOW_CURSOR } from './ui/spinner';
import { versionCacheFile } from './commands/doctor';
import { latestVersion, newerVersionNotice } from './version-check';
import { version } from '../package.json';

process.on('SIGINT', () => {
  process.stderr.write(`${CLEAR_LINE}${SHOW_CURSOR}`);
  process.exit(ExitCode.Interrupted);
});

const wantsVersionNotice =
  Boolean(process.stderr.isTTY) && !process.env.CI && !process.argv.includes('--json') && !process.argv.includes('upgrade');

async function showVersionNotice() {
  const notice = newerVersionNotice(version, await latestVersion({ cache: versionCacheFile(process.env) }));
  if (notice) process.stderr.write(`\n${notice}\n`);
}

try {
  await buildProgram(createContext, version).parseAsync(process.argv);
  if (wantsVersionNotice) await showVersionNotice();
} catch (error) {
  const failure =
    error instanceof CliError
      ? error
      : new CliError(`Something went wrong: ${(error as Error).message}`, {
          hint: 'If it keeps happening, report it with the command you ran.',
        });

  process.stderr.write(
    process.argv.includes('--json') ? renderJsonFailure(failure) : renderFailure(failure.message, failure.hint),
  );
  process.exitCode = failure.exitCode;
}
