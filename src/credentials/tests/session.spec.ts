import { NotSignedInError, SessionExpiredError } from '../../errors';
import type { CredentialStore, StoredSession } from '../credential-store';
import { accessToken, storedSessionFrom } from '../session';

const NOW = 1_800_000_000_000;

function memoryStore(initial: StoredSession | null): CredentialStore & { current: StoredSession | null } {
  return {
    location: 'memory',
    current: initial,
    async read() {
      return this.current;
    },
    async write(session) {
      this.current = session;
    },
    async clear() {
      this.current = null;
    },
  };
}

const noRefresh = jest.fn(async () => null);

describe('accessToken', () => {
  it('prefers NULVLESS_TOKEN over the stored session', async () => {
    const store = memoryStore({ accessToken: 'stored', expiresAt: NOW + 3_600_000 });

    await expect(accessToken({ env: { NULVLESS_TOKEN: 'from-env' }, store, refresh: noRefresh, now: NOW })).resolves.toBe(
      'from-env',
    );
  });

  it('fails with a sign-in hint when nothing is stored', async () => {
    await expect(accessToken({ env: {}, store: memoryStore(null), refresh: noRefresh, now: NOW })).rejects.toBeInstanceOf(
      NotSignedInError,
    );
  });

  it('returns the stored token while it is far from expiring', async () => {
    const store = memoryStore({ accessToken: 'stored', refreshToken: 'r1', expiresAt: NOW + 3_600_000 });

    await expect(accessToken({ env: {}, store, refresh: noRefresh, now: NOW })).resolves.toBe('stored');
    expect(noRefresh).not.toHaveBeenCalled();
  });

  it('refreshes and stores the new tokens when close to expiring', async () => {
    const store = memoryStore({ accessToken: 'old', refreshToken: 'r1', expiresAt: NOW + 10_000 });
    const refresh = jest.fn(async () => ({ access_token: 'new', expires_in: 900 }));

    await expect(accessToken({ env: {}, store, refresh, now: NOW })).resolves.toBe('new');
    expect(refresh).toHaveBeenCalledWith('r1');
    expect(store.current).toEqual({ accessToken: 'new', refreshToken: 'r1', expiresAt: NOW + 900_000 });
  });

  it('reports an expired session when the refresh is rejected', async () => {
    const store = memoryStore({ accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1 });

    await expect(accessToken({ env: {}, store, refresh: noRefresh, now: NOW })).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('reports an expired session when there is no refresh token', async () => {
    const store = memoryStore({ accessToken: 'old', expiresAt: NOW - 1 });

    await expect(accessToken({ env: {}, store, refresh: noRefresh, now: NOW })).rejects.toBeInstanceOf(SessionExpiredError);
  });
});

describe('storedSessionFrom', () => {
  it('turns expires_in into an absolute expiry', () => {
    expect(storedSessionFrom({ access_token: 'a', refresh_token: 'r', expires_in: 60 }, NOW)).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: NOW + 60_000,
    });
  });
});
