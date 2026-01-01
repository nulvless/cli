import { createClient, Storage } from '@nulvless/nulvless-js';
import { LoginNotConfiguredError, SignInError } from '../errors';
import type { Platform } from '../platform';
import type { CredentialStore } from '../credentials/credential-store';
import { storedSessionFrom, type IssuedTokens } from '../credentials/session';
import { listenForCallback } from './loopback';
import { codeChallenge, randomState, randomVerifier } from './pkce';

const SCOPE = 'openid email profile';
const LOGIN_TIMEOUT_MS = 5 * 60_000;

async function withPlatformClient<T>(platform: Platform, run: (client: ReturnType<typeof createClient>) => Promise<T>) {
  const client = createClient(platform.issuer, platform.publishableKey, { storage: Storage.Memory });

  try {
    return await run(client);
  } finally {
    client.auth.dispose();
  }
}

function messageOf(error: { message: string | string[] }) {
  return Array.isArray(error.message) ? error.message.join(' ') : error.message;
}

export async function login({
  platform,
  store,
  showUrl,
  openBrowser,
  waitForApproval = (approval) => approval,
}: {
  platform: Platform;
  store: CredentialStore;
  showUrl: (url: string) => void;
  openBrowser: (url: string) => Promise<void>;
  waitForApproval?: <T>(approval: Promise<T>) => Promise<T>;
}) {
  if (!platform.clientId) throw new LoginNotConfiguredError();

  const verifier = randomVerifier();
  const state = randomState();
  const callback = await listenForCallback(state, LOGIN_TIMEOUT_MS);

  try {
    return await withPlatformClient(platform, async (client) => {
      const authorization = await client.auth.oauth.authorize({
        client_id: platform.clientId,
        redirect_uri: callback.redirectUri,
        code_challenge: codeChallenge(verifier),
        code_challenge_method: 'S256',
        scope: SCOPE,
        state,
      });
      if (authorization.error) throw new SignInError(`Could not start the sign-in: ${messageOf(authorization.error)}`);

      showUrl(authorization.data.url);
      await openBrowser(authorization.data.url).catch(() => undefined);

      const code = await waitForApproval(callback.code);
      const { data, error } = await client.auth.oauth.exchangeCodeForToken({
        code,
        code_verifier: verifier,
        redirect_uri: callback.redirectUri,
        client_id: platform.clientId,
      });
      if (error) {
        const failure = new SignInError(`Could not finish the sign-in: ${messageOf(error)}`);
        callback.showFailure(failure.message);
        throw failure;
      }

      await store.write(storedSessionFrom(data, Date.now()));
      callback.redirectBrowserTo(`${platform.consoleUrl}/cli/authorized`);
      return data;
    });
  } finally {
    callback.close();
  }
}

export function refreshWith(platform: Platform) {
  return (refreshToken: string) =>
    withPlatformClient(platform, async (client): Promise<IssuedTokens | null> => {
      const { data, error } = await client.auth.oauth.refreshToken({
        refresh_token: refreshToken,
        client_id: platform.clientId,
      });
      return error ? null : data;
    });
}
