import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configDirectory, fileStore } from '../credential-store';

describe('fileStore', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nulvless-cli-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes the session readable only by the owner', async () => {
    const store = fileStore(join(directory, 'nested', 'session.json'));

    await store.write({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });

    await expect(store.read()).resolves.toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    expect((await stat(join(directory, 'nested', 'session.json'))).mode & 0o777).toBe(0o600);
  });

  it('reads nothing when the file is missing or malformed', async () => {
    const path = join(directory, 'session.json');
    const store = fileStore(path);

    await expect(store.read()).resolves.toBeNull();
    await store.write({ accessToken: 'a', expiresAt: 1 });
    await rm(path);
    await expect(store.read()).resolves.toBeNull();
  });

  it('clears the session', async () => {
    const path = join(directory, 'session.json');
    const store = fileStore(path);
    await store.write({ accessToken: 'a', expiresAt: 1 });

    await store.clear();

    await expect(readFile(path)).rejects.toThrow();
  });
});

describe('configDirectory', () => {
  it('follows XDG_CONFIG_HOME', () => {
    expect(configDirectory({ XDG_CONFIG_HOME: '/tmp/config' })).toBe('/tmp/config/nulvless');
  });
});
