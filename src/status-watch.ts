import pc from 'picocolors';
import { CliError } from './errors';
import { issueKey, renderStatus, type StatusChanges, type StatusReport } from './status';

export interface WatchOptions {
  load: () => Promise<StatusReport>;
  intervalMs: number;
  untilOk: boolean;
  timeoutMs?: number;
  bell: boolean;
  terminal: boolean;
  write: (text: string) => void;
  link: (text: string, url: string) => string;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const CLEAR_SCREEN = '\x1b[2J';
const CURSOR_HOME = '\x1b[H';
const CLEAR_LINE_END = '\x1b[K';
const CLEAR_BELOW = '\x1b[J';
const BELL = '\x07';

export function changesBetween(previous: StatusReport | null, current: StatusReport): StatusChanges {
  if (!previous) return { appeared: [], resolved: [] };
  const before = new Set(previous.issues.map(issueKey));
  const after = new Set(current.issues.map(issueKey));
  return {
    appeared: current.issues.filter((issue) => !before.has(issueKey(issue))),
    resolved: previous.issues.filter((issue) => !after.has(issueKey(issue))),
  };
}

function frame(text: string, first: boolean) {
  const lines = text.split('\n').map((line) => `${line}${CLEAR_LINE_END}`);
  return `${first ? CLEAR_SCREEN : ''}${CURSOR_HOME}${lines.join('\n')}\n${CLEAR_BELOW}`;
}

const needsAttention = (report: StatusReport) => report.tone === 'problem' || report.tone === 'building';

export async function watchStatus(options: WatchOptions): Promise<StatusReport> {
  const startedAt = options.now();
  const seconds = options.intervalMs / 1000;
  let previous: StatusReport | null = null;

  for (;;) {
    const report = await options.load();
    const changes = changesBetween(previous, report);
    const time = new Date(options.now()).toLocaleTimeString();

    if (options.terminal) {
      const footer = pc.dim(`Updated ${time}. Refreshing every ${seconds} seconds. Press Ctrl+C to stop.`);
      options.write(frame(`${renderStatus(report, options.link, changes)}\n\n${footer}`, previous === null));
      if (options.bell && changes.appeared.some((issue) => issue.severity === 'problem')) options.write(BELL);
    } else if (report.headline !== previous?.headline) {
      options.write(`${time} ${report.headline}`);
    }

    if (options.untilOk && !needsAttention(report)) return report;
    if (options.timeoutMs !== undefined && options.now() - startedAt >= options.timeoutMs) {
      throw new CliError(`${report.headline} Gave up after ${options.timeoutMs / 1000} seconds.`);
    }

    previous = report;
    await options.sleep(options.intervalMs);
  }
}
