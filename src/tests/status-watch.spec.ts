import { stripVTControlCharacters as plain } from 'node:util';
import type { StatusIssue, StatusReport } from '../status';
import { changesBetween, watchStatus, type WatchOptions } from '../status-watch';

const issue = (title: string, severity: StatusIssue['severity'] = 'problem'): StatusIssue => ({
  code: 'deployment_failed',
  severity,
  title,
  detail: 'The previous version is still live.',
  fix: { command: 'nulvless deployments get dep_1' },
});

const report = (issues: StatusIssue[]): StatusReport => {
  const problems = issues.filter((entry) => entry.severity === 'problem').length;
  return {
    project: { slug: 'shop', name: 'Shop' },
    environment: 'main',
    tone: problems ? 'problem' : issues.length ? 'warning' : 'ok',
    headline: problems ? `${problems} problem needs you.` : 'All good in production.',
    summary: null,
    issues,
    environments: [],
    pulse: [],
    services: [],
    setup: { done: 0, total: 0, next: null },
  };
};

function watching(reports: StatusReport[], options: Partial<WatchOptions> = {}) {
  let clock = 0;
  const written: string[] = [];
  const raw: string[] = [];
  const sleep = jest.fn(async (ms: number) => {
    clock += ms;
  });
  const queue = [...reports];
  const run = watchStatus({
    load: async () => (queue.length > 1 ? queue.shift()! : queue[0]!),
    intervalMs: 10_000,
    untilOk: false,
    bell: false,
    terminal: true,
    write: (text) => {
      raw.push(text);
      written.push(plain(text));
    },
    link: (text, url) => `${text}: ${url}`,
    sleep,
    now: () => clock,
    ...options,
  });
  return { run, written, raw, sleep };
}

describe('changesBetween', () => {
  it('finds what appeared and what was resolved since the last refresh', () => {
    const changes = changesBetween(report([issue('Old one'), issue('Stays')]), report([issue('Stays'), issue('New one')]));

    expect(changes.appeared.map((entry) => entry.title)).toEqual(['New one']);
    expect(changes.resolved.map((entry) => entry.title)).toEqual(['Old one']);
  });

  it('marks nothing on the first refresh', () => {
    expect(changesBetween(null, report([issue('First')]))).toEqual({ appeared: [], resolved: [] });
  });
});

describe('watchStatus', () => {
  it('stops once nothing needs attention, waiting the interval between refreshes', async () => {
    const { run, sleep } = watching([report([issue('Deploy failed')]), report([])], { untilOk: true });

    await expect(run).resolves.toMatchObject({ tone: 'ok' });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it('does not wait for warnings to go away', async () => {
    const { run } = watching([report([issue('Shared sender', 'warning')])], { untilOk: true });

    await expect(run).resolves.toMatchObject({ tone: 'warning' });
  });

  it('gives up after the timeout', async () => {
    const { run } = watching([report([issue('Deploy failed')])], { untilOk: true, timeoutMs: 20_000 });

    await expect(run).rejects.toMatchObject({ message: '1 problem needs you. Gave up after 20 seconds.' });
  });

  it('flags a new problem and shows a resolved one for a refresh', async () => {
    const { run, written } = watching(
      [report([issue('Stays')]), report([issue('Stays'), issue('Appeared')]), report([issue('Appeared')]), report([])],
      { untilOk: true },
    );

    await run;

    expect(written[1]).toMatch(/✗ Appeared new/);
    expect(written[2]).toMatch(/✓ Stays resolved/);
    expect(written[3]).toMatch(/✓ Appeared resolved/);
    expect(written[3]).not.toContain('Stays');
  });

  it('redraws in place and says when it refreshed', async () => {
    const { run, written } = watching([report([])], { untilOk: true });

    await run;

    expect(written[0]).toContain('Refreshing every 10 seconds. Press Ctrl+C to stop.');
  });

  it('rings the terminal bell when a new problem appears', async () => {
    const { run, raw } = watching([report([issue('First')]), report([issue('First'), issue('Appeared')]), report([])], {
      untilOk: true,
      bell: true,
    });

    await run;

    expect(raw.filter((text) => text.includes('\x07'))).toHaveLength(1);
  });

  it('writes one line per change outside a terminal', async () => {
    const { run, written } = watching([report([issue('Deploy failed')]), report([issue('Deploy failed')]), report([])], {
      untilOk: true,
      terminal: false,
    });

    await run;

    expect(written).toEqual([expect.stringContaining('1 problem needs you.'), expect.stringContaining('All good in production.')]);
  });
});
