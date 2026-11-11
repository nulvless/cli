import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isOlderVersion } from './examples';

const REGISTRY_URL = 'https://registry.npmjs.org/@nulvless/cli/latest';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 1500;

interface CachedCheck {
  checkedAt: number;
  latest: string;
}

type FetchJson = (url: string, init: RequestInit) => Promise<Response>;

async function readCache(cache: string): Promise<CachedCheck | null> {
  return readFile(cache, 'utf8').then(
    (text) => JSON.parse(text) as CachedCheck,
    () => null,
  );
}

export async function latestVersion({
  cache,
  fetchImpl = fetch,
  now = Date.now(),
  fresh = false,
}: {
  cache: string;
  fetchImpl?: FetchJson;
  now?: number;
  fresh?: boolean;
}): Promise<string | null> {
  const cached = fresh ? null : await readCache(cache);
  if (cached && now - cached.checkedAt < CACHE_TTL_MS) return cached.latest;

  try {
    const response = await fetchImpl(REGISTRY_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) return null;
    const { version } = (await response.json()) as { version: string };
    await mkdir(dirname(cache), { recursive: true });
    await writeFile(cache, JSON.stringify({ checkedAt: now, latest: version }));
    return version;
  } catch {
    return null;
  }
}

export function newerVersionNotice(current: string, latest: string | null) {
  if (!latest || !isOlderVersion(current, latest)) return null;
  return `Nulvless CLI ${latest} is available (you have ${current}). Update with \`nulvless upgrade\`.`;
}
