import { stripVTControlCharacters as plain } from 'node:util';
import { renderCommanderFailure, renderFailure } from '../failure';

describe('renderFailure', () => {
  it('puts the hint under the message', () => {
    expect(plain(renderFailure('You are not signed in.', 'Run `nulvless login` to sign in.'))).toBe(
      '✗ You are not signed in.\n  Run `nulvless login` to sign in.\n',
    );
  });

  it('prints the message alone without a hint', () => {
    expect(plain(renderFailure('Something went wrong.'))).toBe('✗ Something went wrong.\n');
  });
});

describe('renderCommanderFailure', () => {
  it('turns a commander error into a sentence with a help hint', () => {
    expect(plain(renderCommanderFailure("error: unknown command 'deploy'\n"))).toBe(
      "✗ Unknown command 'deploy'.\n  Run `nulvless --help` to see the available commands.\n",
    );
  });

  it('keeps the suggestion commander offers as the hint', () => {
    expect(plain(renderCommanderFailure("error: unknown command 'whomai'\n(Did you mean whoami?)\n"))).toBe(
      "✗ Unknown command 'whomai'.\n  Did you mean whoami?\n",
    );
  });
});
