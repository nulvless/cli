import { createHash, randomBytes } from 'node:crypto';

export function randomVerifier() {
  return randomBytes(48).toString('base64url');
}

export function randomState() {
  return randomBytes(18).toString('base64url');
}

export function codeChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}
