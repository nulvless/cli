import { CliError } from './errors';

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_PREFIXES = ['NULVLESS_', 'NVL_'];
const RESERVED_KEYS = ['EDGE_REGION'];

export function assertSecretKey(key: string) {
  if (!KEY_PATTERN.test(key)) {
    throw new CliError(`${key} is not a valid secret name.`, {
      hint: 'Use letters, numbers and underscores, not starting with a number.',
    });
  }

  const upper = key.toUpperCase();
  if (RESERVED_PREFIXES.some((prefix) => upper.startsWith(prefix)) || RESERVED_KEYS.includes(upper)) {
    throw new CliError(`${key} is reserved for values Nulvless sets.`, {
      hint: `Choose a name that does not start with ${RESERVED_PREFIXES.join(' or ')}.`,
    });
  }
}

export function parseAssignment(assignment: string): { key: string; value: string | null } {
  const separator = assignment.indexOf('=');
  const key = separator === -1 ? assignment : assignment.slice(0, separator);
  assertSecretKey(key);

  return { key, value: separator === -1 ? null : assignment.slice(separator + 1) };
}
