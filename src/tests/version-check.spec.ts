import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { latestVersion, newerVersionNotice } from '../version-check';

const DAY_MS = 24 * 60 * 60 * 1000;

function registry(version: string) {
  return jest.fn(async () => new Response(JSON.stringify({ version })));
}

async function cacheFile() {
  return join(await mkdtemp(join(tmpdir(), 'nulvless-version-')), 'version-check.json');
}

describe('latestVersion', () => {
  it('asks the npm registry and caches the answer for a day', async () => {
    const cache = await cacheFile();
    const fetchImpl = registry('0.3.0');

    await expect(latestVersion({ cache, fetchImpl, now: 1_000 })).resolves.toBe('0.3.0');
    await expect(latestVersion({ cache, fetchImpl, now: 1_000 + DAY_MS - 1 })).resolves.toBe('0.3.0');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://registry.npmjs.org/@nulvless/cli/latest', expect.anything());
    expect(JSON.parse(await readFile(cache, 'utf8'))).toEqual({ checkedAt: 1_000, latest: '0.3.0' });
  });

  it('asks again once the cache is a day old', async () => {
    const cache = await cacheFile();
    await writeFile(cache, JSON.stringify({ checkedAt: 0, latest: '0.2.0' }));

    await expect(latestVersion({ cache, fetchImpl: registry('0.4.0'), now: DAY_MS + 1 })).resolves.toBe('0.4.0');
  });

  it('stays quiet when the registry cannot be reached', async () => {
    const failing = jest.fn(async () => {
      throw new TypeError('offline');
    });

    await expect(latestVersion({ cache: await cacheFile(), fetchImpl: failing, now: 0 })).resolves.toBeNull();
  });
});

describe('newerVersionNotice', () => {
  it('says how to update when a newer version exists', () => {
    expect(newerVersionNotice('0.2.0', '0.3.1')).toBe(
      'Nulvless CLI 0.3.1 is available (you have 0.2.0). Update with `npm install --global @nulvless/cli@latest`.',
    );
  });

  it('says nothing when up to date', () => {
    expect(newerVersionNotice('0.3.1', '0.3.1')).toBeNull();
    expect(newerVersionNotice('0.3.1', null)).toBeNull();
  });
});
