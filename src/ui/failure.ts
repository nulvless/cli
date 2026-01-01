import pc from 'picocolors';
import type { CliError } from '../errors';

const HINT_INDENT = '  ';

export function renderFailure(message: string, hint?: string) {
  const lines = [`${pc.red('✗')} ${message}`];
  if (hint) lines.push(`${HINT_INDENT}${pc.dim(hint)}`);
  return `${lines.join('\n')}\n`;
}

export function renderCommanderFailure(text: string) {
  const [first = '', ...rest] = text.trim().split('\n');
  const message = first.replace(/^error:\s*/, '');
  const sentence = `${message.charAt(0).toUpperCase()}${message.slice(1)}${/[.?!]$/.test(message) ? '' : '.'}`;
  const hint = rest.map((line) => line.replace(/^\((.*)\)$/, '$1')).join(' ').trim();

  return renderFailure(sentence, hint || 'Run `nulvless --help` to see the available commands.');
}

export function renderJsonFailure(failure: CliError) {
  return `${JSON.stringify({ error: { message: failure.message, hint: failure.hint, exitCode: failure.exitCode } })}\n`;
}
