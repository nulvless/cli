import { downloadExample, fetchCatalog, findExample, isOlderVersion, type Example } from '../examples';

const EXAMPLES_URL = 'https://raw.githubusercontent.com/nulvless/examples/main';

function example(fields: Partial<Example> = {}): Example {
  return {
    name: 'verify-session',
    kind: 'function',
    path: 'functions/verify-session',
    title: 'Verify a user session',
    description: 'Rejects requests without a valid access token.',
    features: ['auth'],
    frameworks: [],
    secrets: ['PROJECT_SECRET_KEY'],
    minCliVersion: '0.2.0',
    files: ['deno.json', 'index.ts'],
    ...fields,
  };
}

function serving(files: Record<string, { status?: number; body: string }>) {
  return jest.fn(async (url: string) => {
    const file = files[url];
    return new Response(file?.body ?? '', { status: file ? (file.status ?? 200) : 404 });
  });
}

describe('fetchCatalog', () => {
  it('reads the examples from catalog.json', async () => {
    const fetchImpl = serving({
      [`${EXAMPLES_URL}/catalog.json`]: { body: JSON.stringify({ version: 1, examples: [example()] }) },
    });

    await expect(fetchCatalog(EXAMPLES_URL, fetchImpl)).resolves.toEqual([example()]);
  });

  it('asks for a newer CLI when the catalog format changed', async () => {
    const fetchImpl = serving({ [`${EXAMPLES_URL}/catalog.json`]: { body: JSON.stringify({ version: 2, examples: [] }) } });

    await expect(fetchCatalog(EXAMPLES_URL, fetchImpl)).rejects.toMatchObject({
      message: 'This version of the CLI cannot read the examples catalog.',
      hint: 'Update with `npm install --global @nulvless/cli@latest`.',
    });
  });

  it('explains when the examples cannot be reached', async () => {
    const failing = jest.fn(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(fetchCatalog(EXAMPLES_URL, failing)).rejects.toMatchObject({
      message: 'Could not reach the Nulvless examples at raw.githubusercontent.com.',
      hint: 'Check your connection and try again.',
    });
  });

  it('reports an unexpected status', async () => {
    const fetchImpl = serving({ [`${EXAMPLES_URL}/catalog.json`]: { status: 503, body: '' } });

    await expect(fetchCatalog(EXAMPLES_URL, fetchImpl)).rejects.toMatchObject({
      message: 'The Nulvless examples answered with status 503.',
    });
  });
});

describe('findExample', () => {
  const catalog = [example(), example({ name: 'auth-vue', kind: 'app', path: 'apps/auth-vue' })];

  it('finds an example of the requested kind', () => {
    expect(findExample(catalog, 'verify-session', 'function', '0.2.0')).toEqual(catalog[0]);
  });

  it('lists the choices when the name is unknown', () => {
    expect(() => findExample(catalog, 'nope', 'function', '0.2.0')).toThrow(
      expect.objectContaining({
        message: 'There is no function example named nope.',
        hint: 'Run `nulvless examples` to see every example.',
      }),
    );
  });

  it('points to the right command when the kind does not match', () => {
    expect(() => findExample(catalog, 'auth-vue', 'function', '0.2.0')).toThrow(
      expect.objectContaining({
        message: 'auth-vue is an app, not a function.',
        hint: 'Run `nulvless create <dir> --example auth-vue`.',
      }),
    );
    expect(() => findExample(catalog, 'verify-session', 'app', '0.2.0')).toThrow(
      expect.objectContaining({ hint: 'Run `nulvless functions new <slug> --template verify-session`.' }),
    );
  });

  it('explains that templates are pasted into the console', () => {
    const template = example({ name: 'welcome-user', kind: 'template', path: 'templates/welcome-user' });

    expect(() => findExample([template], 'welcome-user', 'function', '0.2.0')).toThrow(
      expect.objectContaining({
        message: 'welcome-user is a communication template, not a function.',
        hint: 'Paste it into Communications → Templates in the console: https://github.com/nulvless/examples/tree/main/templates/welcome-user',
      }),
    );
  });

  it('asks for a newer CLI when the example needs one', () => {
    expect(() => findExample([example({ minCliVersion: '0.10.0' })], 'verify-session', 'function', '0.9.3')).toThrow(
      expect.objectContaining({
        message: 'verify-session needs Nulvless CLI 0.10.0 or later. You have 0.9.3.',
        hint: 'Update with `npm install --global @nulvless/cli@latest`.',
      }),
    );
  });
});

describe('isOlderVersion', () => {
  it('compares each part as a number', () => {
    expect(isOlderVersion('0.9.0', '0.10.0')).toBe(true);
    expect(isOlderVersion('1.0.0', '0.10.0')).toBe(false);
    expect(isOlderVersion('0.2.0', '0.2.0')).toBe(false);
    expect(isOlderVersion('0.2.0-beta.1', '0.2.0')).toBe(false);
  });
});

describe('downloadExample', () => {
  it('downloads every file of the example', async () => {
    const fetchImpl = serving({
      [`${EXAMPLES_URL}/functions/verify-session/deno.json`]: { body: '{}' },
      [`${EXAMPLES_URL}/functions/verify-session/index.ts`]: { body: 'export default () => {}' },
    });

    await expect(downloadExample(EXAMPLES_URL, example(), fetchImpl)).resolves.toEqual([
      { path: 'deno.json', content: '{}' },
      { path: 'index.ts', content: 'export default () => {}' },
    ]);
  });

  it('fails when a file is missing', async () => {
    const fetchImpl = serving({ [`${EXAMPLES_URL}/functions/verify-session/deno.json`]: { body: '{}' } });

    await expect(downloadExample(EXAMPLES_URL, example(), fetchImpl)).rejects.toMatchObject({
      message: 'Could not download index.ts of verify-session.',
    });
  });
});
