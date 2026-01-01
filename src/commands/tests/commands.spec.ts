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
        '/projects/shop/functions/checkout/deployments': {
          items: [{ id: 'dep_1', short_version: 'v3', trigger: 'secret_change', status: 'succeeded', created_by: null, created_at: '2026-11-03T12:00:00.000Z' }],
          total: 1,
        },
      },
    });

    await cli.run('functions', 'deployments', 'checkout');

    expect(cli.stdout.join('')).toContain('dep_1');
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
