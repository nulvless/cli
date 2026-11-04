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
  } as unknown as jest.Mocked<Api>;
  const prompter: Prompter = {
    interactive,
    choose: jest.fn(),
    confirm: jest.fn(async () => true),
    secret: jest.fn(async () => 'typed-secret'),
  };

  const context = async (flags: GlobalFlags): Promise<Context> =>
    ({
      env: {},
      api,
      prompter,
      output: createOutput(Boolean(flags.json), {
        stdout: { write: (text: string) => stdout.push(text) },
        stderr: { write: (text: string) => stderr.push(text) },
      }),
      token: async () => tokenWith({ sub: 'usr_1', email: 'ada@example.com', name: 'Ada Lovelace' }),
      store,
      scope: async () => ({ organization: 'acme', project: 'shop' }),
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

  it('rejects reserved names before calling the API', async () => {
    const cli = harness();

    await expect(cli.run('secrets', 'set', 'NULVLESS_URL=x', '-f', 'checkout')).rejects.toBeInstanceOf(CliError);
    expect(cli.api.post).not.toHaveBeenCalled();
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

describe('secrets unset', () => {
  it('removes the secret after confirming', async () => {
    const cli = harness();

    await cli.run('secrets', 'unset', 'STRIPE_KEY', '-f', 'checkout', '--yes');

    expect(cli.api.delete).toHaveBeenCalledWith('/projects/shop/functions/checkout/secrets/STRIPE_KEY', {
      organization: 'acme',
    });
  });
});
