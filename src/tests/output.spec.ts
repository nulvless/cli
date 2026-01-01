import { stripVTControlCharacters as plain } from 'node:util';
import { createOutput, formatDuration, renderTable } from '../output';
import { statusTone, supportsHyperlinks } from '../ui/style';

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    streams: {
      stdout: { write: (text: string) => stdout.push(text) },
      stderr: { write: (text: string) => stderr.push(text) },
    },
  };
}

describe('renderTable', () => {
  it('aligns columns on the visible text, not on color codes', () => {
    const rendered = plain(
      renderTable(
        [
          { slug: 'checkout', status: 'active' },
          { slug: 'webhooks', status: 'failed' },
        ],
        [
          { header: 'SLUG', value: (row) => row.slug },
          { header: 'STATUS', value: (row) => row.status, tone: (row) => statusTone(row.status) },
        ],
      ),
    );

    expect(rendered.split('\n')).toEqual(['SLUG      STATUS', 'checkout  active', 'webhooks  failed']);
  });
});

describe('statusTone', () => {
  it.each([
    ['active', 'good'],
    ['Succeeded', 'good'],
    ['building', 'pending'],
    ['failed', 'bad'],
    ['something-else', 'plain'],
  ])('%s is %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });
});

describe('supportsHyperlinks', () => {
  it.each([
    [{ TERM_PROGRAM: 'iTerm.app' }, true],
    [{ TERM_PROGRAM: 'vscode' }, true],
    [{ TERM_PROGRAM: 'WezTerm' }, true],
    [{ TERM_PROGRAM: 'ghostty' }, true],
    [{ WT_SESSION: 'abc' }, true],
    [{ VTE_VERSION: '7600' }, true],
    [{ VTE_VERSION: '4600' }, false],
    [{ KONSOLE_VERSION: '230800' }, true],
    [{ TERM: 'xterm-kitty' }, true],
    [{ TERM_PROGRAM: 'Apple_Terminal' }, false],
    [{ TERM: 'xterm-256color' }, false],
    [{ TERM_PROGRAM: 'vscode', FORCE_HYPERLINK: '0' }, false],
    [{ FORCE_HYPERLINK: '1' }, true],
  ])('%j → %s', (env, expected) => {
    expect(supportsHyperlinks(env)).toBe(expected);
  });
});

describe('formatDuration', () => {
  it.each([
    [12.4, '12ms'],
    [999, '999ms'],
    [1000, '1.0s'],
    [2345, '2.3s'],
  ])('%s ms reads as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe('createOutput', () => {
  it('hides the address behind clickable text where the terminal supports links', () => {
    const output = createOutput(false, capture().streams, { decorated: true, hyperlinks: true });

    const link = output.link('Open the sign-in page', 'https://io.example.com/authorize?state=abc');

    expect(plain(link)).toBe('Open the sign-in page');
    expect(link).toContain('\x1b]8;;https://io.example.com/authorize?state=abc\x07');
  });

  it('spells the address out where links are not clickable', () => {
    const plainTerminal = createOutput(false, capture().streams, { decorated: true, hyperlinks: false });
    const piped = createOutput(false, capture().streams, { hyperlinks: true });

    expect(plain(plainTerminal.link('Open the sign-in page', 'https://io.example.com/a'))).toBe(
      'Open the sign-in page: https://io.example.com/a',
    );
    expect(piped.link('Open the sign-in page', 'https://io.example.com/a')).toBe(
      'Open the sign-in page: https://io.example.com/a',
    );
  });

  it('times the last task on the next success', async () => {
    const io = capture();
    const output = createOutput(false, io.streams);

    await output.task('Loading', async () => undefined);
    output.success('Loaded');
    output.success('Again');

    const [timed, untimed] = plain(io.stderr.join('')).trimEnd().split('\n');
    expect(timed).toMatch(/^✓ Loaded \[\d+ms\]$/);
    expect(untimed).toBe('✓ Again');
  });

  it('turns an empty table into a message and a hint', () => {
    const io = capture();

    createOutput(false, io.streams).table([], [{ header: 'SLUG', value: (row: { slug: string }) => row.slug }], {
      message: 'No Edge Functions in shop yet.',
      hint: 'Create one in the console.',
    });

    expect(io.stdout).toEqual([]);
    expect(plain(io.stderr.join(''))).toBe('No Edge Functions in shop yet.\n  Create one in the console.\n');
  });

  it('keeps stdout for results and stderr for messages', () => {
    const io = capture();
    const output = createOutput(false, io.streams);

    output.step('Opening the browser');
    output.note('first\nsecond');
    output.success('Signed in');

    expect(io.stdout).toEqual([]);
    expect(plain(io.stderr.join(''))).toBe('> Opening the browser\n  first\n  second\n✓ Signed in\n');
  });

  it('stays silent on stderr with --json', () => {
    const io = capture();
    const output = createOutput(true, io.streams);

    output.step('Opening the browser');
    output.success('Signed in');
    output.data({ ok: true });

    expect(io.stderr).toEqual([]);
    expect(JSON.parse(io.stdout.join(''))).toEqual({ ok: true });
  });

  it('shows the banner only in a decorated terminal', () => {
    const io = capture();

    createOutput(false, io.streams).banner('1.2.3');
    expect(io.stderr).toEqual([]);

    createOutput(false, io.streams, { decorated: true }).banner('1.2.3');
    expect(plain(io.stderr.join(''))).toBe('Nulvless CLI 1.2.3\n');
  });

  it('runs a task without a spinner outside a terminal', async () => {
    const io = capture();

    await expect(createOutput(false, io.streams).task('Loading', async () => 42)).resolves.toBe(42);
    expect(io.stderr).toEqual([]);
  });

  it('draws a spinner in a terminal and clears it when done', async () => {
    const io = capture();

    await createOutput(false, io.streams, { decorated: true }).task('Loading functions', async () => 'done');

    const drawn = io.stderr.join('');
    expect(plain(drawn)).toContain('Loading functions');
    expect(drawn.endsWith('\r\x1b[2K\x1b[?25h')).toBe(true);
  });

  it('clears the spinner when the task fails', async () => {
    const io = capture();

    await expect(
      createOutput(false, io.streams, { decorated: true }).task('Loading', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(io.stderr.join('').endsWith('\x1b[?25h')).toBe(true);
  });
});
