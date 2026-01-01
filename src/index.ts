import { createContext } from './context';
import { CliError, ExitCode } from './errors';
import { buildProgram } from './program';
import { renderFailure, renderJsonFailure } from './ui/failure';
import { CLEAR_LINE, SHOW_CURSOR } from './ui/spinner';
import { version } from '../package.json';

process.on('SIGINT', () => {
  process.stderr.write(`${CLEAR_LINE}${SHOW_CURSOR}`);
  process.exit(ExitCode.Interrupted);
});

try {
  await buildProgram(createContext, version).parseAsync(process.argv);
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
