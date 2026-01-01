export function claimsOf(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  if (!payload) return {};

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}
