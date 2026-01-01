import { CliError, ExitCode } from '../../errors';
import { renderJsonFailure } from '../failure';

describe('renderJsonFailure', () => {
  it('describes the failure as one JSON line', () => {
    const failure = new CliError('You are not signed in.', { exitCode: ExitCode.Unauthorized, hint: 'Run `nulvless login`.' });

    expect(JSON.parse(renderJsonFailure(failure))).toEqual({
      error: { message: 'You are not signed in.', hint: 'Run `nulvless login`.', exitCode: 2 },
    });
  });
});
