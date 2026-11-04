export function parseAssignment(assignment: string): { key: string; value: string | null } {
  const separator = assignment.indexOf('=');
  const key = separator === -1 ? assignment : assignment.slice(0, separator);

  return { key, value: separator === -1 ? null : assignment.slice(separator + 1) };
}
