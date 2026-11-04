import { createClient, Storage, type Authenticated, type Challenge, type SudoMethod } from '@nulvless/nulvless-js';
import type { CredentialStore } from '../credentials/credential-store';
import { storedSessionFrom } from '../credentials/session';
import { CliError, SudoRequiredError } from '../errors';
import type { Platform } from '../platform';
import type { Prompter } from '../ui/prompter';

const MAX_ATTEMPTS = 3;

interface Result<T> {
  data: T | null;
  error: { message: string | string[] } | null;
}

export interface SudoClient {
  request(method?: SudoMethod): Promise<Result<{ challenge: Challenge }>>;
  verify(code: string): Promise<Result<Authenticated>>;
  dispose?(): void;
}

const METHOD_LABELS: Record<SudoMethod, string> = {
  totp: 'Authenticator app',
  email_otp: 'Code by email',
  sms_otp: 'Code by SMS',
};

function messageOf(error: { message: string | string[] }) {
  return Array.isArray(error.message) ? error.message.join(' ') : error.message;
}

export function sudoClientFor(platform: Platform, token: string): SudoClient {
  const client = createClient(platform.issuer, platform.publishableKey, { storage: Storage.Memory });
  const options = { headers: { Authorization: `Bearer ${token}` } };

  return {
    request: (method) => client.auth.sessions.sudo(method, options),
    verify: (code) => client.auth.sessions.sudoVerify({ code }, options),
    dispose: () => client.auth.dispose(),
  };
}

async function sendChallenge(client: SudoClient, prompter: Prompter) {
  const first = await client.request();
  if (first.error || !first.data) {
    throw new CliError(`Could not start the sudo confirmation: ${messageOf(first.error ?? { message: 'no challenge' })}`);
  }
  if (first.data.challenge.preferred) return first.data.challenge;

  const methods = first.data.challenge.factors.map((factor) => factor.type as SudoMethod);
  const method = await prompter.choose(
    'How do you want to confirm it is you?',
    methods.map((value) => ({ value, label: METHOD_LABELS[value] ?? value })),
  );
  const chosen = await client.request(method);
  if (chosen.error || !chosen.data) {
    throw new CliError(`Could not start the sudo confirmation: ${messageOf(chosen.error ?? { message: 'no challenge' })}`);
  }
  return chosen.data.challenge;
}

export async function elevateSession({
  client,
  store,
  prompter,
  now = Date.now(),
}: {
  client: SudoClient;
  store: CredentialStore;
  prompter: Prompter;
  now?: number;
}): Promise<{ expiresIn: number }> {
  if (!prompter.interactive) throw new SudoRequiredError();

  const challenge = await sendChallenge(client, prompter);
  const question =
    challenge.preferred === 'totp' || !challenge.identifier
      ? 'Enter the code from your authenticator app'
      : `Enter the code sent to ${challenge.identifier}`;

  let lastError = '';
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = (await prompter.text(question)).trim();
    const { data, error } = await client.verify(code);
    if (data?.access_token && data.expires_in) {
      const previous = await store.read();
      const refreshToken = data.refresh_token ?? previous?.refreshToken;
      await store.write(
        storedSessionFrom(
          { access_token: data.access_token, expires_in: data.expires_in, ...(refreshToken ? { refresh_token: refreshToken } : {}) },
          now,
        ),
      );
      return { expiresIn: data.sudo?.expires_in ?? 0 };
    }
    lastError = error ? messageOf(error) : 'the code was not accepted';
  }

  throw new CliError(`Could not confirm it is you: ${lastError}`, { hint: 'Run `nulvless sudo` to try again.' });
}
