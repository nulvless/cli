import pc from 'picocolors';

export type Tone = 'good' | 'pending' | 'bad' | 'plain';

const BRAND_TRUECOLOR = '\x1b[38;2;141;122;248m';
const RESET_FOREGROUND = '\x1b[39m';

function supportsTrueColor(env: NodeJS.ProcessEnv) {
  return env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit';
}

const HYPERLINK_PROGRAMS = ['iTerm.app', 'vscode', 'WezTerm', 'ghostty', 'Hyper', 'Tabby', 'rio'];
const MIN_VTE_VERSION_WITH_LINKS = 5000;

export function supportsHyperlinks(env: NodeJS.ProcessEnv) {
  if (env.FORCE_HYPERLINK !== undefined) return env.FORCE_HYPERLINK !== '0';
  if (env.TERM_PROGRAM && HYPERLINK_PROGRAMS.includes(env.TERM_PROGRAM)) return true;
  if (env.WT_SESSION || env.KONSOLE_VERSION || env.TERM === 'xterm-kitty') return true;
  return Number(env.VTE_VERSION ?? 0) >= MIN_VTE_VERSION_WITH_LINKS;
}

export function hyperlink(text: string, url: string) {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

export function brand(text: string, env: NodeJS.ProcessEnv = process.env) {
  if (!pc.isColorSupported) return text;
  return supportsTrueColor(env) ? `${BRAND_TRUECOLOR}${text}${RESET_FOREGROUND}` : pc.magenta(text);
}

export function toned(text: string, tone: Tone) {
  if (tone === 'good') return pc.green(text);
  if (tone === 'pending') return pc.yellow(text);
  if (tone === 'bad') return pc.red(text);
  return text;
}

const GOOD_STATUSES = ['active', 'ready', 'succeeded', 'success', 'healthy', 'deployed'];
const PENDING_STATUSES = ['building', 'queued', 'running', 'pending', 'deploying', 'initializing'];
const BAD_STATUSES = ['failed', 'error', 'errored', 'canceled', 'cancelled', 'inactive', 'paused'];

export function statusTone(status: string): Tone {
  const normalized = status.toLowerCase();
  if (GOOD_STATUSES.includes(normalized)) return 'good';
  if (PENDING_STATUSES.includes(normalized)) return 'pending';
  if (BAD_STATUSES.includes(normalized)) return 'bad';
  return 'plain';
}
