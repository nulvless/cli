import { NotSignedInError, SessionExpiredError } from '../errors';
import type { CredentialStore, StoredSession } from './credential-store';

export interface IssuedTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export type RefreshTokens = (refreshToken: string) => Promise<IssuedTokens | null>;

const REFRESH_MARGIN_MS = 60_000;

export function storedSessionFrom(tokens: IssuedTokens, now: number): StoredSession {
  return {
    accessToken: tokens.access_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    expiresAt: now + tokens.expires_in * 1000,
  };
}

export async function accessToken({
  env,
  store,
  refresh,
  now = Date.now(),
}: {
  env: NodeJS.ProcessEnv;
  store: CredentialStore;
  refresh: RefreshTokens;
  now?: number;
}): Promise<string> {
  if (env.NULVLESS_TOKEN) return env.NULVLESS_TOKEN;

  const session = await store.read();
  if (!session) throw new NotSignedInError();
  if (session.expiresAt - now > REFRESH_MARGIN_MS) return session.accessToken;
  if (!session.refreshToken) throw new SessionExpiredError();

  const renewed = await refresh(session.refreshToken);
  if (!renewed) throw new SessionExpiredError();

  const next = storedSessionFrom(renewed, now);
  await store.write({ ...next, refreshToken: next.refreshToken ?? session.refreshToken });
  return next.accessToken;
}
