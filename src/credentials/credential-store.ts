import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Entry } from '@napi-rs/keyring';

export interface StoredSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface CredentialStore {
  readonly location: string;
  read(): Promise<StoredSession | null>;
  write(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

const KEYRING_SERVICE = 'nulvless-cli';
const KEYRING_ACCOUNT = 'session';

function parseSession(raw: string | null | undefined): StoredSession | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<StoredSession>;
    return typeof value.accessToken === 'string' && typeof value.expiresAt === 'number'
      ? (value as StoredSession)
      : null;
  } catch {
    return null;
  }
}

export function keyringStore(entry = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT)): CredentialStore {
  return {
    location: 'the system keychain',
    async read() {
      return parseSession(entry.getPassword());
    },
    async write(session) {
      entry.setPassword(JSON.stringify(session));
    },
    async clear() {
      entry.deletePassword();
    },
  };
}

export function configDirectory(env: NodeJS.ProcessEnv) {
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'nulvless');
}

export function fileStore(path: string): CredentialStore {
  return {
    location: path,
    async read() {
      try {
        return parseSession(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    async write(session) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, JSON.stringify(session), { mode: 0o600 });
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
}

export async function defaultCredentialStore(env: NodeJS.ProcessEnv): Promise<CredentialStore> {
  const keyring = keyringStore();

  try {
    await keyring.read();
    return keyring;
  } catch {
    return fileStore(join(configDirectory(env), 'session.json'));
  }
}
