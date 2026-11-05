import { stripVTControlCharacters as plain } from 'node:util';
import type { Api } from '../../api/http';
import { confirmAction, type Context, type GlobalFlags } from '../../context';
import { CliError } from '../../errors';
import { createOutput } from '../../output';
import { buildProgram } from '../../program';
import type { Prompter } from '../../ui/prompter';

jest.mock('open', () => jest.fn());

interface Harness {
  api: jest.Mocked<Api>;
  stdout: string[];
  stderr: string[];
  prompter: Prompter;
  run(...args: string[]): Promise<void>;
}

function tokenWith(claims: Record<string, unknown>) {
  return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

const store = { location: 'memory', read: jest.fn(), write: jest.fn(), clear: jest.fn(async () => undefined) };

function harness({ interactive = false, routes = {} }: { interactive?: boolean; routes?: Record<string, unknown> } = {}): Harness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const api = {
    get: jest.fn(async (path: string) => routes[path]),
    post: jest.fn(async (_path: string, request?: { body?: unknown }) => request?.body),
    delete: jest.fn(async () => undefined),
    patch: jest.fn(async () => ({})),
    put: jest.fn(async () => ({})),
  } as unknown as jest.Mocked<Api>;
  const prompter: Prompter = {
    interactive,
    choose: jest.fn(),
    confirm: jest.fn(async () => true),
    secret: jest.fn(async () => 'typed-secret'),
    text: jest.fn(),
  };

  const context = async (flags: GlobalFlags): Promise<Context> =>
    ({
      env: {},
      api,
      prompter,
      output: createOutput(Boolean(flags.json), {
        stdout: { write: (text: string) => stdout.push(plain(text)) },
        stderr: { write: (text: string) => stderr.push(plain(text)) },
      }),
      token: async () => tokenWith({ sub: 'usr_1', email: 'ada@example.com', name: 'Ada Lovelace' }),
      store,
      scope: async () => ({ organization: 'acme', project: 'shop' }),
      organization: async () => 'acme',
      platform: { consoleUrl: 'https://cloud.nulvless.com' },
      elevate: jest.fn(async () => ({ expiresIn: 600 })),
      confirm: (message: string) => confirmAction(flags, prompter, message),
    }) as unknown as Context;

  return {
    api,
    stdout,
    stderr,
    prompter,
    run: async (...args) => {
      const program = buildProgram(context, '0.0.0').exitOverride();
      await program.parseAsync(['node', 'nulvless', ...args]);
    },
  };
}

const functionsPage = {
  items: [{ slug: 'checkout', name: 'Checkout', status: 'active', short_version: 'v3' }],
  total: 1,
};

describe('functions list', () => {
  it('prints a table on stdout', async () => {
    const cli = harness({ routes: { '/projects/shop/functions': functionsPage } });

    await cli.run('functions', 'list');

    expect(cli.stdout.join('')).toContain('checkout');
    expect(cli.stdout.join('')).toContain('v3');
  });

  it('prints JSON with --json', async () => {
    const cli = harness({ routes: { '/projects/shop/functions': functionsPage } });

    await cli.run('functions', 'list', '--json');

    expect(JSON.parse(cli.stdout.join(''))).toEqual(functionsPage.items);
  });

  it('searches by name or slug', async () => {
    const cli = harness({ routes: { '/projects/shop/functions': functionsPage } });

    await cli.run('functions', 'list', '--search', 'check');

    expect(cli.api.get).toHaveBeenCalledWith('/projects/shop/functions', {
      organization: 'acme',
      query: { search: 'check', page: 1, page_size: 100 },
    });
  });

  it('says so when there are none', async () => {
    const cli = harness({ routes: { '/projects/shop/functions': { items: [], total: 0 } } });

    await cli.run('fn', 'list');

    expect(cli.stdout).toEqual([]);
    expect(cli.stderr.join('')).toContain('No Edge Functions in shop yet.');
  });
});

describe('destructive commands', () => {
  it('refuses to delete without --yes when it cannot ask', async () => {
    const cli = harness();

    await expect(cli.run('environments', 'delete', 'staging')).rejects.toMatchObject({
      hint: 'Pass --yes to confirm without a prompt.',
    });
    expect(cli.api.delete).not.toHaveBeenCalled();
  });

  it('deletes with --yes', async () => {
    const cli = harness();

    await cli.run('envs', 'delete', 'staging', '--yes');

    expect(cli.api.delete).toHaveBeenCalledWith('/projects/shop/environments/staging', { organization: 'acme' });
  });

  it('stops when the confirmation is declined', async () => {
    const cli = harness({ interactive: true });
    (cli.prompter.confirm as jest.Mock).mockResolvedValueOnce(false);

    await expect(cli.run('functions', 'delete', 'checkout')).rejects.toThrow('Cancelled.');
    expect(cli.api.delete).not.toHaveBeenCalled();
  });
});

describe('secrets set', () => {
  it('sends the key and value to the function', async () => {
    const cli = harness();
    cli.api.post.mockResolvedValueOnce({ key: 'STRIPE_KEY', version: 2, updated_at: null });

    await cli.run('secrets', 'set', 'STRIPE_KEY=sk_test', '--function', 'checkout');

    expect(cli.api.post).toHaveBeenCalledWith('/projects/shop/functions/checkout/secrets', {
      organization: 'acme',
      body: { key: 'STRIPE_KEY', value: 'sk_test' },
    });
    expect(cli.stderr.join('')).toContain('Saved STRIPE_KEY (version 2)');
  });

  it('asks for the value without echo when only the key is given', async () => {
    const cli = harness({ interactive: true });
    cli.api.post.mockResolvedValueOnce({ key: 'STRIPE_KEY', version: 1, updated_at: null });

    await cli.run('secrets', 'set', 'STRIPE_KEY', '-f', 'checkout');

    expect(cli.prompter.secret).toHaveBeenCalled();
    expect(cli.api.post.mock.calls[0]?.[1]).toMatchObject({ body: { key: 'STRIPE_KEY', value: 'typed-secret' } });
  });

  it('shows the API refusal for a reserved name', async () => {
    const cli = harness();
    cli.api.post.mockRejectedValueOnce(new CliError('This secret name is reserved.'));

    await expect(cli.run('secrets', 'set', 'NULVLESS_URL=x', '-f', 'checkout')).rejects.toMatchObject({
      message: 'This secret name is reserved.',
    });
  });

  it('needs the value inline when it cannot ask', async () => {
    const cli = harness();

    await expect(cli.run('secrets', 'set', 'STRIPE_KEY', '-f', 'checkout')).rejects.toMatchObject({
      message: 'No value for STRIPE_KEY.',
      hint: 'Pass it as STRIPE_KEY=VALUE.',
    });
  });
});

describe('secrets list', () => {
  it('never prints values', async () => {
    const cli = harness({
      routes: {
        '/projects/shop/functions/checkout/secrets': {
          items: [{ key: 'STRIPE_KEY', version: 2, updated_at: '2026-11-03T12:00:00.000Z' }],
          total: 1,
        },
      },
    });

    await cli.run('secrets', 'list', '-f', 'checkout');

    expect(cli.stdout.join('')).toContain('STRIPE_KEY');
  });
});

describe('whoami', () => {
  it('shows the account from the token and its organizations', async () => {
    const cli = harness({ routes: { '/organizations': [{ slug: 'acme', name: 'Acme' }] } });

    await cli.run('whoami');

    expect(cli.stderr.join('')).toContain('Signed in as Ada Lovelace');
    expect(cli.stdout.join('')).toContain('acme');
  });

  it('prints the account and organizations as JSON', async () => {
    const cli = harness({ routes: { '/organizations': [{ slug: 'acme', name: 'Acme' }] } });

    await cli.run('whoami', '--json');

    expect(JSON.parse(cli.stdout.join(''))).toEqual({
      account: { id: 'usr_1', email: 'ada@example.com', name: 'Ada Lovelace' },
      organizations: [{ slug: 'acme', name: 'Acme' }],
    });
  });
});

describe('logout', () => {
  it('clears the stored session and names the account', async () => {
    store.read.mockResolvedValueOnce({ accessToken: tokenWith({ name: 'Ada Lovelace' }) });
    const cli = harness();

    await cli.run('logout');

    expect(store.clear).toHaveBeenCalled();
    expect(cli.stderr.join('')).toContain('Signed out of Ada Lovelace');
  });

  it('says so when nobody was signed in', async () => {
    store.read.mockResolvedValueOnce(null);
    store.clear.mockClear();
    const cli = harness();

    await cli.run('logout');

    expect(store.clear).not.toHaveBeenCalled();
    expect(cli.stderr.join('')).toContain('You were not signed in on this computer.');
  });
});

describe('environments', () => {
  it('lists the environments of the project', async () => {
    const cli = harness({
      routes: {
        '/projects/shop': {
          slug: 'shop',
          name: 'Shop',
          environments: [{ slug: 'main', name: 'Production', status: 'ready', url: 'https://shop.nulvless.co', version: 'v3' }],
        },
      },
    });

    await cli.run('environments', 'list');

    expect(cli.stdout.join('')).toContain('https://shop.nulvless.co');
  });

  it('creates an environment named after its slug by default', async () => {
    const cli = harness();
    cli.api.post.mockResolvedValueOnce({ slug: 'staging', name: 'staging', status: 'building', url: 'https://shop-staging.nulvless.co', version: null });

    await cli.run('environments', 'create', 'staging');

    expect(cli.api.post).toHaveBeenCalledWith('/projects/shop/environments', {
      organization: 'acme',
      body: { slug: 'staging', name: 'staging' },
    });
    expect(cli.stderr.join('')).toContain('Created staging');
  });
});

describe('functions deployments', () => {
  it('lists the deployments of a function', async () => {
    const cli = harness({
      routes: {
        '/projects/shop/functions/checkout': { slug: 'checkout', version: 'ver-3' },
        '/projects/shop/functions/checkout/deployments': {
          items: [{ id: 'dep_1', version: 'ver-3', short_version: 'v3', trigger: 'secret_change', status: 'succeeded', created_by: null, created_at: '2026-11-03T12:00:00.000Z' }],
          total: 1,
        },
      },
    });

    await cli.run('functions', 'deployments', 'checkout');

    expect(cli.stdout.join('')).toContain('dep_1');
  });
});

const checkoutHistory = {
  '/projects/shop/functions/checkout': { slug: 'checkout', version: 'ver-3', short_version: 'v3' },
  '/projects/shop/functions/checkout/deployments': {
    items: [
      { id: 'dep_3', version: 'ver-3', short_version: 'v3', trigger: 'deploy', status: 'succeeded', created_by: null, created_at: '2026-11-04T12:00:00.000Z', promote_available: false },
      { id: 'dep_2', version: 'ver-2', short_version: 'v2', trigger: 'deploy', status: 'succeeded', created_by: null, created_at: '2026-11-03T12:00:00.000Z', promote_available: true },
      { id: 'dep_1', version: 'ver-1', short_version: 'v1', trigger: 'deploy', status: 'failed', created_by: null, created_at: '2026-11-02T12:00:00.000Z', promote_available: false },
    ],
    total: 3,
  },
};

describe('functions deployments marks versions', () => {
  it('shows which version is live and which can be promoted', async () => {
    const cli = harness({ routes: checkoutHistory });

    await cli.run('functions', 'deployments', 'checkout');

    const lines = cli.stdout.join('').split('\n');
    expect(lines.find((line) => line.includes('dep_3'))).toContain('live');
    expect(lines.find((line) => line.includes('dep_2'))).toContain('yes');
    expect(lines.find((line) => line.includes('dep_1'))).not.toContain('yes');
  });

  it('pages through the history and filters it', async () => {
    const cli = harness({ routes: checkoutHistory });

    await cli.run('functions', 'deployments', 'checkout', '--status', 'failed', '--limit', '5', '--page', '2');

    expect(cli.api.get).toHaveBeenCalledWith('/projects/shop/functions/checkout/deployments', {
      organization: 'acme',
      query: { status: 'failed', sort: 'desc', page: 2, page_size: 5 },
    });
  });

  it('adds live to the JSON', async () => {
    const cli = harness({ routes: checkoutHistory });

    await cli.run('functions', 'deployments', 'checkout', '--json');

    const rows = JSON.parse(cli.stdout.join(''));
    expect(rows.map((row: { id: string; live: boolean }) => [row.id, row.live])).toEqual([
      ['dep_3', true],
      ['dep_2', false],
      ['dep_1', false],
    ]);
  });
});

describe('functions promote', () => {
  it('promotes a deployment by its short version', async () => {
    const cli = harness({ routes: checkoutHistory });

    await cli.run('functions', 'promote', 'checkout', 'v2', '--yes');

    expect(cli.api.post).toHaveBeenCalledWith('/projects/shop/functions/checkout/deployments/dep_2/promote', {
      organization: 'acme',
    });
    expect(cli.stderr.join('')).toContain('checkout now serves v2.');
  });

  it('promotes a deployment by its id and prints JSON', async () => {
    const cli = harness({ routes: checkoutHistory });

    await cli.run('functions', 'promote', 'checkout', 'dep_2', '--yes', '--json');

    expect(JSON.parse(cli.stdout.join(''))).toEqual({ slug: 'checkout', deployment: 'dep_2', version: 'v2' });
  });

  it('asks which version when none is given in a terminal', async () => {
    const cli = harness({ interactive: true, routes: checkoutHistory });
    (cli.prompter.choose as jest.Mock).mockResolvedValue('dep_2');

    await cli.run('functions', 'promote', 'checkout');

    const [, choices] = (cli.prompter.choose as jest.Mock).mock.calls[0];
    expect(choices.map((choice: { value: string }) => choice.value)).toEqual(['dep_2']);
    expect(cli.api.post).toHaveBeenCalledWith('/projects/shop/functions/checkout/deployments/dep_2/promote', {
      organization: 'acme',
    });
  });

  it('needs the version outside a terminal', async () => {
    const cli = harness({ routes: checkoutHistory });

    await expect(cli.run('functions', 'promote', 'checkout', '--yes')).rejects.toMatchObject({
      message: 'No version selected.',
      hint: 'Pass the version, such as `nulvless functions promote checkout v2`.',
    });
  });

  it('refuses to promote without --yes when it cannot ask', async () => {
    const cli = harness({ routes: checkoutHistory });

    await expect(cli.run('functions', 'promote', 'checkout', 'v2')).rejects.toThrow(CliError);
    expect(cli.api.post).not.toHaveBeenCalled();
  });

  it('names an unknown version', async () => {
    const cli = harness({ routes: checkoutHistory });

    await expect(cli.run('functions', 'promote', 'checkout', 'v9', '--yes')).rejects.toMatchObject({
      message: 'checkout has no deployment v9.',
      hint: 'Run `nulvless functions deployments checkout` to see its versions.',
    });
  });

  it('says so when the version is already live', async () => {
    const cli = harness({ routes: checkoutHistory });

    await expect(cli.run('functions', 'promote', 'checkout', 'v3', '--yes')).rejects.toMatchObject({
      message: 'v3 is already live.',
    });
  });

  it('explains which versions can be promoted', async () => {
    const cli = harness({ routes: checkoutHistory });

    await expect(cli.run('functions', 'promote', 'checkout', 'v1', '--yes')).rejects.toMatchObject({
      message: 'v1 cannot be promoted.',
      hint: 'Only successful deploys among the last versions of a function are kept. Run `nulvless functions deployments checkout` to see which ones.',
    });
  });

  it('says so when nothing can be promoted', async () => {
    const cli = harness({
      interactive: true,
      routes: {
        ...checkoutHistory,
        '/projects/shop/functions/checkout/deployments': { items: [checkoutHistory['/projects/shop/functions/checkout/deployments'].items[0]], total: 1 },
      },
    });

    await expect(cli.run('functions', 'promote', 'checkout')).rejects.toMatchObject({
      message: 'checkout has no other version to promote.',
    });
  });
});

const projectDeployments = {
  '/projects/shop/functions/checkout': { id: 'fn_1', slug: 'checkout', version: 'ver-3' },
  '/projects/shop/deployments': {
    items: [
      { id: 'dep_9', context: 'environments', scope: 'env_1', short_version: 'e1', trigger: 'merge', status: 'running', created_at: '2026-11-04T12:00:00.000Z', metadata: { destination: 'staging' } },
      { id: 'dep_3', context: 'functions', scope: 'fn_1', short_version: 'v3', trigger: 'deploy', status: 'succeeded', created_at: '2026-11-04T11:00:00.000Z', metadata: { function_slug: 'checkout' } },
    ],
    total: 2,
  },
  '/projects/shop/deployments/dep_3': {
    id: 'dep_3',
    context: 'functions',
    short_version: 'v3',
    trigger: 'deploy',
    status: 'failed',
    created_at: '2026-11-04T11:00:00.000Z',
    metadata: { function_slug: 'checkout' },
    pipeline: [
      { name: 'initialize', status: 'succeeded', started_at: '2026-11-04T11:00:00.000Z', ended_at: '2026-11-04T11:00:00.200Z' },
      { name: 'build', status: 'failed', started_at: '2026-11-04T11:00:00.200Z', ended_at: '2026-11-04T11:00:03.000Z', detail: { message: 'Module not found: ./util.ts' } },
      { name: 'deploy', status: 'skipped', started_at: null, ended_at: null },
    ],
  },
};

describe('deployments', () => {
  it('lists every deployment of the project with what it deployed', async () => {
    const cli = harness({ routes: projectDeployments });

    await cli.run('deployments', 'list');

    const output = cli.stdout.join('');
    expect(output).toContain('staging');
    expect(output).toContain('checkout');
  });

  it('filters the deployments of one function', async () => {
    const cli = harness({ routes: projectDeployments });

    await cli.run('deployments', 'list', '--function', 'checkout', '--status', 'succeeded');

    expect(cli.api.get).toHaveBeenCalledWith('/projects/shop/deployments', {
      organization: 'acme',
      query: { context: 'functions', scope: 'fn_1', status: 'succeeded', sort: 'desc', page: 1, page_size: 30 },
    });
  });

  it('filters by version and trigger and pages through them, oldest first', async () => {
    const cli = harness({ routes: projectDeployments });

    await cli.run('deployments', 'list', '--version-contains', 'v3', '--trigger', 'promote', '--page', '2', '--limit', '10', '--oldest-first');

    expect(cli.api.get).toHaveBeenCalledWith('/projects/shop/deployments', {
      organization: 'acme',
      query: { version: 'v3', trigger: 'promote', sort: 'asc', page: 2, page_size: 10 },
    });
  });

  it('tells how to reach the next page', async () => {
    const cli = harness({
      routes: { '/projects/shop/deployments': { items: [projectDeployments['/projects/shop/deployments'].items[0]], total: 45 } },
    });

    await cli.run('deployments', 'list', '--limit', '1', '--page', '3');

    expect(cli.stderr.join('')).toContain('Showing 3–3 of 45. Next page: --page 4, or --all for every one.');
  });

  it('loads every page with --all', async () => {
    const cli = harness();
    const deployment = projectDeployments['/projects/shop/deployments'].items[0];
    cli.api.get
      .mockResolvedValueOnce({ items: Array.from({ length: 100 }, () => deployment), total: 101 })
      .mockResolvedValueOnce({ items: [deployment], total: 101 });

    await cli.run('deployments', 'list', '--all', '--json');

    expect(JSON.parse(cli.stdout.join(''))).toHaveLength(101);
    expect(cli.api.get).toHaveBeenLastCalledWith('/projects/shop/deployments', {
      organization: 'acme',
      query: { sort: 'desc', page: 2, page_size: 100 },
    });
  });

  it('refuses --page together with --all', async () => {
    const cli = harness({ routes: projectDeployments });

    await expect(cli.run('deployments', 'list', '--all', '--page', '2')).rejects.toMatchObject({
      message: 'Choose either --all or --page.',
    });
  });

  it('shows the steps of a deployment and why it failed', async () => {
    const cli = harness({ routes: projectDeployments });

    await cli.run('deployments', 'get', 'dep_3');

    const output = cli.stdout.join('') + cli.stderr.join('');
    expect(output).toMatch(/build\s+failed\s+2\.8s/);
    expect(output).toContain('Module not found: ./util.ts');
  });
});

const diffRoutes = {
  '/projects/shop/diff/staging/into/main': {
    auth: [
      { field: 'signup.enabled', before: false, after: true },
      { field: 'password.min_length', before: 8, after: 12 },
    ],
    communications: [{ field: 'email.provider', before: 'smtp', after: 'resend' }],
    payments: [],
  },
  '/projects/shop/diff/main/into/staging': { auth: [], communications: [], payments: [] },
  '/projects/shop/deployments/dep_merge': { id: 'dep_merge', status: 'succeeded', short_version: 'm1', trigger: 'merge', created_at: '2026-11-04T12:00:00.000Z' },
};

describe('environments diff', () => {
  it('lists every setting that would change in the destination', async () => {
    const cli = harness({ routes: diffRoutes });

    await cli.run('environments', 'diff', 'staging', 'main');

    const lines = cli.stdout.join('').split('\n');
    expect(lines.find((line) => line.includes('password.min_length'))).toMatch(/auth\s+password\.min_length\s+8\s+12/);
    expect(cli.stderr.join('')).toContain('3 change(s) would be merged from staging into main.');
  });

  it('says so when the environments match', async () => {
    const cli = harness({ routes: diffRoutes });

    await cli.run('environments', 'diff', 'main', 'staging');

    expect(cli.stderr.join('')).toContain('main and staging have the same settings.');
  });
});

describe('environments merge', () => {
  it('confirms, queues the merge and points to its deployment', async () => {
    const cli = harness({ routes: diffRoutes });
    cli.api.post.mockResolvedValueOnce({ id: 'dep_merge', status: 'queued' });

    await cli.run('environments', 'merge', 'staging', 'main', '--yes');

    expect(cli.api.post).toHaveBeenCalledWith('/projects/shop/merge/staging/into/main', { organization: 'acme' });
    expect(cli.stderr.join('')).toContain('nulvless deployments get dep_merge');
  });

  it('waits for the merge to finish with --wait', async () => {
    const cli = harness({ routes: diffRoutes });
    cli.api.post.mockResolvedValueOnce({ id: 'dep_merge', status: 'queued' });

    await cli.run('environments', 'merge', 'staging', 'main', '--yes', '--wait');

    expect(cli.stderr.join('')).toContain('Merged staging into main.');
  });

  it('refuses without --yes when it cannot ask', async () => {
    const cli = harness({ routes: diffRoutes });

    await expect(cli.run('environments', 'merge', 'staging', 'main')).rejects.toMatchObject({
      hint: 'Pass --yes to confirm without a prompt.',
    });
    expect(cli.api.post).not.toHaveBeenCalled();
  });

  it('does nothing when there is nothing to merge', async () => {
    const cli = harness({ routes: diffRoutes });

    await cli.run('environments', 'merge', 'main', 'staging', '--yes');

    expect(cli.api.post).not.toHaveBeenCalled();
    expect(cli.stderr.join('')).toContain('Nothing to merge');
  });
});

const keyRoutes = {
  '/projects/shop/main/api-keys': [
    { id: 'key_1', name: 'Web', type: 'public', alias: 'pk-ab…', key: 'pk-abc', created_at: '2026-11-01T00:00:00.000Z' },
    { id: 'key_2', name: 'Server', type: 'private', alias: 'sk-cd…', key: null, created_at: '2026-11-02T00:00:00.000Z' },
  ],
  '/projects/shop/staging/auth/signing-keys': [
    { id: 'kid_current', algorithm: 'ES256', status: 'current', promoted_at: '2026-10-01T00:00:00.000Z' },
    { id: 'kid_next', algorithm: 'ES256', status: 'standby', promoted_at: null },
  ],
};

describe('keys', () => {
  it('lists the API keys of production by default, never the full secret', async () => {
    const cli = harness({ routes: keyRoutes });

    await cli.run('keys', 'list');

    const output = cli.stdout.join('');
    expect(output).toContain('sk-cd…');
    expect(cli.api.get).toHaveBeenCalledWith('/projects/shop/main/api-keys', { organization: 'acme' });
  });

  it('creates a key and prints it once', async () => {
    const cli = harness({ routes: keyRoutes });
    cli.api.post.mockResolvedValueOnce({ id: 'key_3', name: 'CI', type: 'private', key: 'sk-secret' });

    await cli.run('keys', 'create', 'CI', '--type', 'private', '--env', 'staging');

    expect(cli.api.post).toHaveBeenCalledWith('/projects/shop/staging/api-keys', {
      organization: 'acme',
      body: { name: 'CI', type: 'private' },
    });
    expect(cli.stdout.join('')).toBe('sk-secret\n');
    expect(cli.stderr.join('')).toContain('shown only once');
  });

  it('revokes a key after confirming', async () => {
    const cli = harness({ routes: keyRoutes });

    await cli.run('keys', 'revoke', 'key_2', '--yes');

    expect(cli.api.delete).toHaveBeenCalledWith('/projects/shop/main/api-keys/key_2', { organization: 'acme' });
  });
});

describe('signing-keys', () => {
  it('lists the signing keys of an environment', async () => {
    const cli = harness({ routes: keyRoutes });

    await cli.run('signing-keys', 'list', '--env', 'staging');

    expect(cli.stdout.join('')).toMatch(/kid_next\s+ES256\s+standby/);
  });

  it('adds a standby key with the chosen algorithm', async () => {
    const cli = harness({ routes: keyRoutes });
    cli.api.post.mockResolvedValueOnce({ id: 'kid_new', algorithm: 'EdDSA', status: 'standby' });

    await cli.run('signing-keys', 'create', '--algorithm', 'EdDSA', '--env', 'staging');

    expect(cli.api.post).toHaveBeenCalledWith('/projects/shop/staging/auth/signing-keys', {
      organization: 'acme',
      body: { algorithm: 'EdDSA' },
    });
    expect(cli.stderr.join('')).toContain('nulvless signing-keys promote kid_new --env staging');
  });

  it.each([
    ['promote', 'patch', '/projects/shop/staging/auth/signing-keys/kid_next/promote'],
    ['restore', 'patch', '/projects/shop/staging/auth/signing-keys/kid_next/restore'],
    ['revoke', 'delete', '/projects/shop/staging/auth/signing-keys/kid_next'],
    ['delete', 'delete', '/projects/shop/staging/auth/signing-keys/kid_next/permanent'],
  ] as const)('%s calls the API after confirming', async (action, method, path) => {
    const cli = harness({ routes: keyRoutes });

    await cli.run('signing-keys', action, 'kid_next', '--env', 'staging', '--yes');

    expect(cli.api[method]).toHaveBeenCalledWith(path, { organization: 'acme' });
  });
});

const oauthRoutes = {
  '/projects/shop/main/oauth/settings': {
    enabled: true,
    allow_dynamic_clients: false,
    authorization_path: '/oauth/consent',
    issuer: 'https://shop.nulvless.co/auth',
    authorization_base_url: 'https://shop.example.com',
    site_url: 'https://shop.example.com',
  },
  '/projects/shop/main/oauth/clients': [
    { client_id: 'cli_1', client_name: 'Acme Analytics', client_type: 'confidential', redirect_uris: ['https://acme.example.com/callback'], created_at: '2026-11-01T00:00:00.000Z' },
  ],
  '/projects/shop/main/oauth/clients/cli_1': {
    client_id: 'cli_1',
    client_name: 'Acme Analytics',
    client_type: 'confidential',
    token_endpoint_auth_method: 'client_secret_basic',
    redirect_uris: ['https://acme.example.com/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
  },
};

describe('oauth', () => {
  it('shows the server settings', async () => {
    const cli = harness({ routes: oauthRoutes });

    await cli.run('oauth', 'settings');

    expect(cli.stdout.join('')).toMatch(/Consent screen\s+https:\/\/shop\.example\.com\/oauth\/consent/);
  });

  it('updates only the settings that were passed', async () => {
    const cli = harness({ routes: oauthRoutes });

    await cli.run('oauth', 'settings', 'update', '--disable', '--consent-url', 'https://id.example.com', '--yes');

    expect(cli.api.patch).toHaveBeenCalledWith('/projects/shop/main/oauth/settings', {
      organization: 'acme',
      body: { enabled: false, authorization_base_url: 'https://id.example.com' },
    });
  });

  it('needs at least one setting to update', async () => {
    const cli = harness({ routes: oauthRoutes });

    await expect(cli.run('oauth', 'settings', 'update')).rejects.toMatchObject({ message: 'Nothing to update.' });
  });

  it('lists the clients', async () => {
    const cli = harness({ routes: oauthRoutes });

    await cli.run('oauth', 'clients', 'list');

    expect(cli.stdout.join('')).toMatch(/cli_1\s+Acme Analytics\s+confidential/);
  });

  it('registers a confidential client and prints its secret once', async () => {
    const cli = harness({ routes: oauthRoutes });
    cli.api.post.mockResolvedValueOnce({ client_id: 'cli_2', client_secret: 'shh', client_type: 'confidential' });

    await cli.run(
      'oauth', 'clients', 'create', 'Acme Analytics',
      '--type', 'confidential',
      '--redirect-uri', 'https://acme.example.com/callback',
      '--redirect-uri', 'http://localhost:3000/callback',
    );

    expect(cli.api.post).toHaveBeenCalledWith('/projects/shop/main/oauth/clients', {
      organization: 'acme',
      body: {
        client_name: 'Acme Analytics',
        client_type: 'confidential',
        token_endpoint_auth_method: 'client_secret_basic',
        redirect_uris: ['https://acme.example.com/callback', 'http://localhost:3000/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
      },
    });
    expect(cli.stdout.join('')).toContain('shh');
    expect(cli.stderr.join('')).toContain('shown only once');
  });

  it('leaves the redirect URI rules to the API', async () => {
    const cli = harness({ routes: oauthRoutes });
    cli.api.post.mockResolvedValueOnce({ client_id: 'cli_3', client_type: 'public' });

    await cli.run('oauth', 'clients', 'create', 'Acme', '--type', 'public');

    expect(cli.api.post).toHaveBeenCalledWith(
      '/projects/shop/main/oauth/clients',
      expect.objectContaining({ body: expect.objectContaining({ redirect_uris: [] }) }),
    );
  });

  it('updates a client keeping what was not passed', async () => {
    const cli = harness({ routes: oauthRoutes });

    await cli.run('oauth', 'clients', 'update', 'cli_1', '--name', 'Acme');

    expect(cli.api.put).toHaveBeenCalledWith('/projects/shop/main/oauth/clients/cli_1', {
      organization: 'acme',
      body: {
        client_name: 'Acme',
        token_endpoint_auth_method: 'client_secret_basic',
        redirect_uris: ['https://acme.example.com/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
      },
    });
  });

  it('asks for a fresh sign-in after the default max age', async () => {
    const cli = harness({ routes: oauthRoutes });

    await cli.run('oauth', 'clients', 'update', 'cli_1', '--default-max-age', '3600');

    expect(cli.api.put).toHaveBeenCalledWith(
      '/projects/shop/main/oauth/clients/cli_1',
      expect.objectContaining({ body: expect.objectContaining({ default_max_age: 3600 }) }),
    );
  });

  it('turns the default max age off', async () => {
    const cli = harness({ routes: oauthRoutes });

    await cli.run('oauth', 'clients', 'update', 'cli_1', '--no-default-max-age');

    expect(cli.api.put).toHaveBeenCalledWith(
      '/projects/shop/main/oauth/clients/cli_1',
      expect.objectContaining({ body: expect.objectContaining({ default_max_age: null }) }),
    );
  });

  it('refuses a default max age that is not whole seconds', async () => {
    const cli = harness({ routes: oauthRoutes });

    await expect(cli.run('oauth', 'clients', 'update', 'cli_1', '--default-max-age', '1h')).rejects.toMatchObject({
      message: '1h is not a number of seconds.',
    });
  });

  it('rotates a secret after confirming', async () => {
    const cli = harness({ routes: oauthRoutes });
    cli.api.post.mockResolvedValueOnce({ client_id: 'cli_1', client_secret: 'new-secret' });

    await cli.run('oauth', 'clients', 'rotate-secret', 'cli_1', '--yes');

    expect(cli.api.post).toHaveBeenCalledWith('/projects/shop/main/oauth/clients/cli_1/regenerate-secret', { organization: 'acme' });
    expect(cli.stdout.join('')).toBe('new-secret\n');
  });

  it('deletes a client after confirming', async () => {
    const cli = harness({ routes: oauthRoutes });

    await cli.run('oauth', 'clients', 'delete', 'cli_1', '--yes');

    expect(cli.api.delete).toHaveBeenCalledWith('/projects/shop/main/oauth/clients/cli_1', { organization: 'acme' });
  });
});

const orgRoutes = {
  '/projects': [
    { slug: 'shop', name: 'Shop', status: 'ready', services: ['auth'] },
    { slug: 'blog', name: 'Blog', status: 'paused', services: ['auth'] },
  ],
  '/projects/shop': { slug: 'shop', name: 'Shop', status: 'ready', environments: [{ slug: 'main', name: 'Production', status: 'ready', url: 'https://shop.nulvless.co' }] },
  '/projects/shop/health': {
    status: 'degraded',
    checked_at: '2026-11-04T12:00:00.000Z',
    services: [
      { service: 'auth', status: 'up', latency_ms: 42, error: null },
      { service: 'communications', status: 'down', latency_ms: 3000, error: { reason: 'timeout', message: 'timed out after 3s' } },
    ],
  },
  '/projects/shop/domains': [
    { hostname: 'id.shop.com', status: 'pending', verification: 'pending', certificate: 'pending', dns: { type: 'CNAME', name: 'id.shop.com', value: 'shop.nulvless.co' } },
  ],
  '/organizations/acme/members': {
    granted: [{ id: 'usr_1', name: 'Ada', email: 'ada@acme.com', membership: { id: 'mem_1', key: 'owner', status: 'granted' } }],
    invitations: [{ id: 'usr_2', email: 'bob@acme.com', membership: { id: 'mem_2', key: 'developer', status: 'invited' } }],
    requesteds: [],
    blockeds: [],
  },
  '/organizations/members/roles': [
    { id: 'role_admin', name: 'Admin', key: 'admin' },
    { id: 'role_dev', name: 'Developer', key: 'developer' },
  ],
};

describe('projects', () => {
  it('lists the projects of the organization', async () => {
    const cli = harness({ routes: orgRoutes });

    await cli.run('projects', 'list');

    expect(cli.stdout.join('')).toMatch(/blog\s+Blog\s+paused/);
    expect(cli.api.get).toHaveBeenCalledWith('/projects', { organization: 'acme' });
  });

  it('creates a project with every service by default', async () => {
    const cli = harness({ routes: orgRoutes });
    cli.api.post.mockResolvedValueOnce({ slug: 'store', name: 'Store', status: 'building' });

    await cli.run('projects', 'create', 'Store');

    expect(cli.api.post).toHaveBeenCalledWith('/projects', {
      organization: 'acme',
      body: { name: 'Store', services: ['auth', 'logs', 'communications'] },
    });
    expect(cli.stderr.join('')).toContain('Created store');
  });

  it('shows the health of each service', async () => {
    const cli = harness({ routes: orgRoutes });

    await cli.run('projects', 'health');

    expect(cli.stdout.join('')).toMatch(/communications\s+down\s+3000ms\s+timed out after 3s/);
  });

  it.each([
    ['pause', '/projects/shop/pause'],
    ['restore', '/projects/shop/restore'],
  ])('%s asks first, then calls the API', async (action, path) => {
    const cli = harness({ routes: orgRoutes });

    await cli.run('projects', action, 'shop', '--yes');

    expect(cli.api.patch).toHaveBeenCalledWith(path, { organization: 'acme' });
  });

  it('deletes a project only after confirming', async () => {
    const cli = harness({ routes: orgRoutes });

    await expect(cli.run('projects', 'delete', 'shop')).rejects.toMatchObject({ hint: 'Pass --yes to confirm without a prompt.' });
    expect(cli.api.delete).not.toHaveBeenCalled();
  });
});

describe('domains', () => {
  it('lists the domains with the DNS record to create', async () => {
    const cli = harness({ routes: orgRoutes });

    await cli.run('domains', 'list');

    expect(cli.stdout.join('')).toMatch(/id\.shop\.com\s+pending.*CNAME id\.shop\.com → shop\.nulvless\.co/);
  });

  it('adds a domain and prints the record to create', async () => {
    const cli = harness({ routes: orgRoutes });
    cli.api.post.mockResolvedValueOnce(orgRoutes['/projects/shop/domains'][0]);

    await cli.run('domains', 'add', 'id.shop.com');

    expect(cli.api.post).toHaveBeenCalledWith('/projects/shop/domains', { organization: 'acme', body: { hostname: 'id.shop.com' } });
    expect(cli.stderr.join('')).toContain('CNAME id.shop.com → shop.nulvless.co');
  });

  it('removes a domain after confirming', async () => {
    const cli = harness({ routes: orgRoutes });

    await cli.run('domains', 'remove', 'id.shop.com', '--yes');

    expect(cli.api.delete).toHaveBeenCalledWith('/projects/shop/domains/id.shop.com', { organization: 'acme' });
  });
});

describe('members', () => {
  it('lists members and pending invitations', async () => {
    const cli = harness({ routes: orgRoutes });

    await cli.run('members', 'list');

    const output = cli.stdout.join('');
    expect(output).toMatch(/ada@acme\.com\s+owner\s+granted/);
    expect(output).toMatch(/bob@acme\.com\s+developer\s+invited/);
  });

  it('invites people with a role by its name', async () => {
    const cli = harness({ routes: orgRoutes });
    cli.api.post.mockResolvedValueOnce([]);

    await cli.run('members', 'invite', 'eve@acme.com', 'joe@acme.com', '--role', 'developer');

    expect(cli.api.post).toHaveBeenCalledWith('/organizations/acme/members/invites', {
      organization: 'acme',
      body: {
        invites: [
          { email: 'eve@acme.com', role_id: 'role_dev' },
          { email: 'joe@acme.com', role_id: 'role_dev' },
        ],
        redirect_uri: 'https://cloud.nulvless.com/organizations/join',
      },
    });
  });

  it('names the roles when the one given does not exist', async () => {
    const cli = harness({ routes: orgRoutes });

    await expect(cli.run('members', 'invite', 'eve@acme.com', '--role', 'boss')).rejects.toMatchObject({
      message: 'There is no role boss.',
      hint: 'Use one of: admin, developer.',
    });
  });

  it('removes a member by email after confirming', async () => {
    const cli = harness({ routes: orgRoutes });

    await cli.run('members', 'remove', 'bob@acme.com', '--yes');

    expect(cli.api.delete).toHaveBeenCalledWith('/organizations/acme/members/mem_2', { organization: 'acme' });
  });
});

describe('orgs', () => {
  it('lists the organizations of the account', async () => {
    const cli = harness({ routes: { '/organizations': [{ slug: 'acme', name: 'Acme' }] } });

    await cli.run('orgs', 'list');

    expect(cli.stdout.join('')).toMatch(/acme\s+Acme/);
  });
});

const userRoutes = {
  '/projects/shop/users': {
    items: [
      { id: 'usr_1', email: 'ada@acme.com', is_confirmed: true, is_banned: false, last_sign_in_at: '2026-11-03T10:00:00.000Z' },
      { id: 'usr_2', username: 'bob', is_confirmed: false, is_banned: true, last_sign_in_at: null },
    ],
    total: 2,
  },
  '/projects/shop/users/usr_1': { id: 'usr_1', email: 'ada@acme.com', profile: { name: 'Ada' } },
  '/projects/shop/users/usr_1/sessions': [
    { id: 'ses_1', aal: 'aal2', created_at: '2026-11-03T10:00:00.000Z', finger_print: { browser: { name: 'Firefox' }, os: { name: 'Linux' } } },
  ],
  '/projects/shop/users/usr_1/factors': [{ id: 'fac_1', type: 'totp', created_at: '2026-10-01T00:00:00.000Z' }],
};

describe('users', () => {
  it('lists one page of users of production, filtered', async () => {
    const cli = harness({ routes: userRoutes });

    await cli.run('users', 'list', '--email', 'ada@acme.com', '--banned', '--limit', '20');

    expect(cli.api.get).toHaveBeenCalledWith('/projects/shop/users', {
      organization: 'acme',
      query: { environment: 'main', email: 'ada@acme.com', is_banned: 'true', sort: 'desc', page: 1, page_size: 20 },
    });
    expect(cli.stdout.join('')).toMatch(/usr_2\s+bob\s+no\s+yes/);
  });

  it('pages through users, oldest first', async () => {
    const cli = harness({ routes: userRoutes });

    await cli.run('users', 'list', '--page', '2', '--oldest-first');

    expect(cli.api.get).toHaveBeenCalledWith('/projects/shop/users', {
      organization: 'acme',
      query: { environment: 'main', sort: 'asc', page: 2, page_size: 30 },
    });
  });

  it('shows one user', async () => {
    const cli = harness({ routes: userRoutes });

    await cli.run('users', 'get', 'usr_1', '--env', 'staging');

    expect(cli.api.get).toHaveBeenCalledWith('/projects/shop/users/usr_1', { organization: 'acme', query: { environment: 'staging' } });
    expect(JSON.parse(cli.stdout.join(''))).toMatchObject({ id: 'usr_1' });
  });

  it('creates a user, asking for the password without echo', async () => {
    const cli = harness({ interactive: true, routes: userRoutes });
    cli.api.post.mockResolvedValueOnce({ id: 'usr_3', email: 'eve@acme.com' });

    await cli.run('users', 'create', '--email', 'eve@acme.com', '--name', 'Eve', '--confirmed', '--password');

    expect(cli.api.post).toHaveBeenCalledWith('/projects/shop/users', {
      organization: 'acme',
      query: { environment: 'main' },
      body: { email: 'eve@acme.com', password: 'typed-secret', profile: { name: 'Eve' }, email_verified: true },
    });
    expect(cli.stderr.join('')).toContain('Created usr_3');
  });

  it('needs an email, phone or username to create a user', async () => {
    const cli = harness({ routes: userRoutes });

    await expect(cli.run('users', 'create')).rejects.toMatchObject({ message: 'Give the user an email, phone or username.' });
  });

  it.each([
    ['ban', 'patch', '/projects/shop/users/usr_1/ban'],
    ['unban', 'patch', '/projects/shop/users/usr_1/unban'],
    ['delete', 'delete', '/projects/shop/users/usr_1'],
    ['sign-out', 'delete', '/projects/shop/users/usr_1/sessions'],
  ] as const)('%s calls the API after confirming', async (action, method, path) => {
    const cli = harness({ routes: userRoutes });

    await cli.run('users', action, 'usr_1', '--yes');

    expect(cli.api[method]).toHaveBeenCalledWith(path, { organization: 'acme', query: { environment: 'main' } });
  });

  it('ends only one session with --session', async () => {
    const cli = harness({ routes: userRoutes });

    await cli.run('users', 'sign-out', 'usr_1', '--session', 'ses_1', '--yes');

    expect(cli.api.delete).toHaveBeenCalledWith('/projects/shop/users/usr_1/sessions/ses_1', {
      organization: 'acme',
      query: { environment: 'main' },
    });
    expect(cli.stderr.join('')).toContain('Ended session ses_1 of usr_1.');
  });

  it('names the session when asking to end it', async () => {
    const cli = harness({ routes: userRoutes });

    await expect(cli.run('users', 'sign-out', 'usr_1', '--session', 'ses_1')).rejects.toMatchObject({
      message: 'End session ses_1 of usr_1? That device is signed out. (production (main))',
    });
  });

  it('lists the sessions of a user', async () => {
    const cli = harness({ routes: userRoutes });

    await cli.run('users', 'sessions', 'usr_1');

    expect(cli.stdout.join('')).toMatch(/ses_1\s+Firefox on Linux\s+aal2/);
  });

  it('lists and removes MFA factors', async () => {
    const cli = harness({ routes: userRoutes });

    await cli.run('users', 'factors', 'usr_1');
    await cli.run('users', 'remove-factor', 'usr_1', 'fac_1', '--yes');

    expect(cli.stdout.join('')).toMatch(/fac_1\s+totp/);
    expect(cli.api.delete).toHaveBeenCalledWith('/projects/shop/users/usr_1/factors/fac_1', {
      organization: 'acme',
      query: { environment: 'main' },
    });
  });
});

describe('sudo', () => {
  it('confirms the user and says how long sudo lasts', async () => {
    const cli = harness();

    await cli.run('sudo');

    expect(cli.stderr.join('')).toContain('Sudo is active for 10 minutes.');
  });

  it('prints the remaining seconds as JSON', async () => {
    const cli = harness();

    await cli.run('sudo', '--json');

    expect(JSON.parse(cli.stdout.join(''))).toEqual({ expires_in: 600 });
  });
});

describe('secrets unset', () => {
  it('removes the secret after confirming', async () => {
    const cli = harness();

    await cli.run('secrets', 'unset', 'STRIPE_KEY', '-f', 'checkout', '--yes');

    expect(cli.api.delete).toHaveBeenCalledWith('/projects/shop/functions/checkout/secrets/STRIPE_KEY', {
      organization: 'acme',
    });
  });
});

const statusRoutes = {
  '/projects/shop': { slug: 'shop', name: 'Shop', status: 'ready', environments: [] },
  '/projects/shop/overview': {
    environment: 'main',
    environments: [
      { name: 'Production', slug: 'main', production: true, status: 'ready', url: 'https://shop.nulvless.co', failed_services: [], custom_domain: null },
    ],
    issues: [{ code: 'deployment_failed', severity: 'problem', deployment_id: 'dep_8f2k', function_slug: 'checkout' }],
    steps: [{ code: 'api_key', done: true }],
    pulse: { users: null, functions: null, messages: { sent: 940, failed: 0, trend: [0, 4, 8] }, events: null },
  },
  '/projects/shop/health': { status: 'ok', checked_at: '2026-11-04T12:00:00.000Z', services: [{ service: 'auth', status: 'up', latency_ms: 40, error: null }] },
  '/projects/shop/deployments': { items: [], total: 0 },
};

describe('status', () => {
  it('leads with the verdict and pairs each problem with its fix', async () => {
    const cli = harness({ routes: statusRoutes });

    await cli.run('status');

    const output = cli.stdout.join('');
    expect(output.split('\n')[1]).toBe('● 1 problem needs you.');
    expect(output).toMatch(/✗ The checkout deploy failed\n\s+The previous version is still live.\n\s+nulvless deployments get dep_8f2k/);
    expect(output).toContain('▁▅█');
  });

  it('asks the API about the chosen environment', async () => {
    const cli = harness({ routes: statusRoutes });

    await cli.run('status', '--env', 'staging');

    expect(cli.api.get).toHaveBeenCalledWith('/projects/shop/overview', { organization: 'acme', query: { environment: 'staging' } });
  });

  it('prints the report as JSON with the fix of each problem', async () => {
    const cli = harness({ routes: statusRoutes });

    await cli.run('status', '--json');

    expect(JSON.parse(cli.stdout.join(''))).toMatchObject({
      tone: 'problem',
      issues: [{ code: 'deployment_failed', fix: { command: 'nulvless deployments get dep_8f2k' } }],
    });
  });

  it('fails a CI step when there is a problem, after printing the report', async () => {
    const cli = harness({ routes: statusRoutes });

    await expect(cli.run('status', '--fail-on', 'problem')).rejects.toMatchObject({ message: '1 problem needs you.' });
    expect(cli.stdout.join('')).toContain('The checkout deploy failed');
  });

  it('passes --fail-on warning when nothing needs attention', async () => {
    const cli = harness({ routes: { ...statusRoutes, '/projects/shop/overview': { ...statusRoutes['/projects/shop/overview'], issues: [] } } });

    await expect(cli.run('status', '--fail-on', 'warning')).resolves.toBeUndefined();
  });

  it('only takes --timeout together with --until-ok', async () => {
    const cli = harness({ routes: statusRoutes });

    await expect(cli.run('status', '--timeout', '60')).rejects.toMatchObject({ message: '--timeout needs --until-ok.' });
  });

  it('waits until nothing needs attention, then prints the report as JSON', async () => {
    const healthy = { ...statusRoutes, '/projects/shop/overview': { ...statusRoutes['/projects/shop/overview'], issues: [] } };
    const cli = harness({ routes: healthy });

    await cli.run('status', '--until-ok', '--json');

    expect(JSON.parse(cli.stdout.join(''))).toMatchObject({ tone: 'ok' });
  });

  it('refuses to watch outside a terminal', async () => {
    const cli = harness({ routes: statusRoutes });

    await expect(cli.run('status', '--watch', '--json')).rejects.toMatchObject({ message: 'status --watch needs a terminal.' });
  });
});

describe('feedback', () => {
  it('sends the message, saying it came from the CLI and its version', async () => {
    const cli = harness();

    await cli.run('feedback', 'Deploys', 'are', 'great');

    expect(cli.api.post).toHaveBeenCalledWith('/organizations/feedback', {
      body: { feedback: 'Deploys are great', path: 'cli/0.0.0' },
    });
    expect(cli.stderr.join('')).toContain('Thanks, your feedback was sent.');
  });

  it('asks for the message in a terminal', async () => {
    const cli = harness({ interactive: true });
    (cli.prompter.text as jest.Mock).mockResolvedValueOnce('The status command helps a lot');

    await cli.run('feedback');

    expect(cli.api.post).toHaveBeenCalledWith('/organizations/feedback', {
      body: { feedback: 'The status command helps a lot', path: 'cli/0.0.0' },
    });
  });

  it('needs the message outside a terminal', async () => {
    const cli = harness();

    await expect(cli.run('feedback')).rejects.toMatchObject({ message: 'Write your feedback.' });
  });

  it('leaves the length rules to the API', async () => {
    const cli = harness();

    await cli.run('feedback', 'ok');

    expect(cli.api.post).toHaveBeenCalledWith('/organizations/feedback', { body: { feedback: 'ok', path: 'cli/0.0.0' } });
  });
});
