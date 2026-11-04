import { stripVTControlCharacters as plain } from 'node:util';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirmAction, type Context, type GlobalFlags } from '../../context';
import type { Example } from '../../examples';
import { createOutput } from '../../output';
import { buildProgram } from '../../program';
import type { Prompter } from '../../ui/prompter';

jest.mock('open', () => jest.fn());

const EXAMPLES_URL = 'https://examples.test';

const welcomeUser: Example = {
  name: 'welcome-user',
  kind: 'template',
  path: 'templates/email/welcome-user',
  title: 'Welcome email',
  description: 'Sent when an account is created.',
  features: ['comms'],
  frameworks: [],
  secrets: [],
  minCliVersion: '0.2.0',
  files: ['en-US.html'],
  template: { channel: 'email', subject: { 'en-US': 'Welcome to {{platform.name}}' }, variables: ['platform.name'] },
};

const verifySession: Example = {
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
};

const authVue: Example = {
  ...verifySession,
  name: 'auth-vue',
  kind: 'app',
  path: 'apps/auth-vue',
  title: 'Auth with Vue',
  description: 'A Vue app with sign-in.',
  secrets: [],
  files: ['package.json', 'src/main.ts'],
};

const served: Record<string, string> = {
  [`${EXAMPLES_URL}/catalog.json`]: JSON.stringify({
    version: 1,
    examples: [verifySession, authVue, welcomeUser],
  }),
  [`${EXAMPLES_URL}/templates/email/welcome-user/en-US.html`]: '<p>Welcome to {{platform.name}}</p>',
  [`${EXAMPLES_URL}/functions/verify-session/deno.json`]: '{"imports":{}}',
  [`${EXAMPLES_URL}/functions/verify-session/index.ts`]: 'export default () => new Response("ok");',
  [`${EXAMPLES_URL}/apps/auth-vue/package.json`]: '{"name":"auth-vue"}',
  [`${EXAMPLES_URL}/apps/auth-vue/src/main.ts`]: 'createApp()',
};

const COMMONS = {
  email: [{ key: 'welcome-user', name: 'Welcome', description: '', keys: [] }],
  sms: [{ key: 'phone-otp-verification', name: 'Code', description: '', keys: [] }],
};

async function harness(
  flags: Partial<GlobalFlags> = {},
  deployed: string[] = [],
  projectTemplates: Record<string, unknown>[] = [],
  routes: Record<string, unknown> = {},
) {
  const cwd = await mkdtemp(join(tmpdir(), 'nulvless-cli-'));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const prompter: Prompter = { interactive: false, choose: jest.fn(), confirm: jest.fn(), secret: jest.fn(), text: jest.fn() };
  const fetch = jest.fn(async (url: string) =>
    url in served ? new Response(served[url]) : new Response('', { status: 404 }),
  );

  const api = {
    get: jest.fn(async (path: string) => {
      if (path in routes) return routes[path];
      if (path === '/projects/templates/commons') return COMMONS;
      if (path.endsWith('/templates')) return { items: projectTemplates, total: projectTemplates.length };
      return { items: deployed.map((slug) => ({ slug })), total: deployed.length };
    }),
    post: jest.fn(async () => ({ slug: 'created', short_version: 'v1' })),
    put: jest.fn(async () => ({ slug: 'updated', short_version: 'v2' })),
    patch: jest.fn(async () => ({})),
    delete: jest.fn(),
  };

  const context = async (globals: GlobalFlags): Promise<Context> =>
    ({
      env: {},
      api,
      scope: async () => ({ organization: 'acme', project: 'shop' }),
      cwd,
      fetch,
      platform: { examplesUrl: EXAMPLES_URL },
      prompter,
      output: createOutput(Boolean(globals.json), {
        stdout: { write: (text: string) => stdout.push(plain(text)) },
        stderr: { write: (text: string) => stderr.push(plain(text)) },
      }),
      confirm: (message: string) => confirmAction({ ...globals, ...flags }, prompter, message),
    }) as unknown as Context;

  return {
    cwd,
    api,
    fetch,
    stdout,
    stderr,
    run: async (...args: string[]) => {
      const program = buildProgram(context, '0.2.0').exitOverride();
      await program.parseAsync(['node', 'nulvless', ...args]);
    },
  };
}

describe('init', () => {
  it('creates the workspace in the current folder, linked to the given project', async () => {
    const cli = await harness();

    await cli.run('init', '--org', 'acme', '--project', 'shop');

    const config = JSON.parse(await readFile(join(cli.cwd, 'nulvless/nulvless.jsonc'), 'utf8'));
    expect(config).toMatchObject({ organization: 'acme', project: 'shop', functions: {} });
    expect(cli.stderr.join('')).toContain('nulvless functions new hello');
  });

  it('prints the created files as JSON', async () => {
    const cli = await harness();

    await cli.run('init', '--json');

    expect(JSON.parse(cli.stdout.join(''))).toEqual({
      root: cli.cwd,
      files: ['nulvless/nulvless.jsonc', 'nulvless/.gitignore', 'nulvless/functions/'],
    });
  });
});

describe('functions new', () => {
  it('needs a workspace', async () => {
    const cli = await harness();

    await expect(cli.run('functions', 'new', 'hello')).rejects.toMatchObject({
      message: 'There is no Nulvless workspace here.',
      hint: 'Run `nulvless init` first.',
    });
  });

  it('creates a starter function without a template, offline', async () => {
    const cli = await harness();
    await cli.run('init');

    await cli.run('functions', 'new', 'hello');

    await expect(readFile(join(cli.cwd, 'nulvless/functions/hello/index.ts'), 'utf8')).resolves.toContain(
      'export default async function handler',
    );
    expect(cli.fetch).not.toHaveBeenCalled();
  });

  it('copies a template and names the secrets to set', async () => {
    const cli = await harness();
    await cli.run('init');

    await cli.run('functions', 'new', 'whoami', '--template', 'verify-session');

    await expect(readFile(join(cli.cwd, 'nulvless/functions/whoami/deno.json'), 'utf8')).resolves.toBe('{"imports":{}}');
    await expect(readFile(join(cli.cwd, 'nulvless/functions/whoami/index.ts'), 'utf8')).resolves.toContain('Response');
    expect(cli.stderr.join('')).toContain('nulvless secrets set PROJECT_SECRET_KEY --function whoami');
  });

  it('prints what it created as JSON', async () => {
    const cli = await harness();
    await cli.run('init');

    await cli.run('functions', 'new', 'whoami', '--template', 'verify-session', '--json');

    expect(JSON.parse(cli.stdout.join(''))).toEqual({
      slug: 'whoami',
      path: 'nulvless/functions/whoami',
      template: 'verify-session',
      files: ['deno.json', 'index.ts'],
      secrets: ['PROJECT_SECRET_KEY'],
    });
  });

  it.each(['My_Function', 'me', 'a'.repeat(51)])('rejects slugs the platform would refuse: %s', async (slug) => {
    const cli = await harness();
    await cli.run('init');

    await expect(cli.run('functions', 'new', slug)).rejects.toMatchObject({
      message: `${slug} is not a valid function slug.`,
      hint: 'Use 3 to 50 lowercase letters, numbers and dashes, such as send-email.',
    });
  });

  it('never overwrites an existing function', async () => {
    const cli = await harness();
    await cli.run('init');
    await cli.run('functions', 'new', 'hello');

    await expect(cli.run('functions', 'new', 'hello')).rejects.toMatchObject({
      message: 'nulvless/functions/hello already exists.',
    });
  });
});

describe('create', () => {
  it('copies an app example into a new folder', async () => {
    const cli = await harness();

    await cli.run('create', 'my-app', '--example', 'auth-vue');

    await expect(readFile(join(cli.cwd, 'my-app/src/main.ts'), 'utf8')).resolves.toBe('createApp()');
    expect(cli.stderr.join('')).toContain('cd my-app');
  });

  it('refuses a folder that is not empty', async () => {
    const cli = await harness();
    await mkdir(join(cli.cwd, 'my-app'));
    await writeFile(join(cli.cwd, 'my-app/notes.txt'), 'keep me');

    await expect(cli.run('create', 'my-app', '--example', 'auth-vue')).rejects.toMatchObject({
      message: 'my-app is not empty.',
      hint: 'Choose a new folder name.',
    });
  });

  it('needs an example', async () => {
    const cli = await harness();

    await expect(cli.run('create', 'my-app')).rejects.toMatchObject({ message: 'No example selected.' });
  });

  it('points functions to the right command', async () => {
    const cli = await harness();

    await expect(cli.run('create', 'my-app', '--example', 'verify-session')).rejects.toMatchObject({
      message: 'verify-session is a function, not an app.',
    });
  });
});

describe('examples', () => {
  it('lists every example', async () => {
    const cli = await harness();

    await cli.run('examples');

    const table = cli.stdout.join('');
    expect(table).toContain('verify-session');
    expect(table).toContain('auth-vue');
  });

  it('lists templates with their own kind', async () => {
    const cli = await harness();

    await cli.run('examples', '--kind', 'template', '--json');

    expect(JSON.parse(cli.stdout.join('')).map((example: Example) => example.name)).toEqual(['welcome-user']);
  });

  it('filters by kind and prints JSON', async () => {
    const cli = await harness();

    await cli.run('examples', '--kind', 'app', '--json');

    expect(JSON.parse(cli.stdout.join('')).map((example: Example) => example.name)).toEqual(['auth-vue']);
  });
});

function sentFiles(form: FormData) {
  return (form.getAll('files') as File[]).map((file) => file.name).sort();
}

describe('functions deploy', () => {
  it('creates functions that do not exist yet and updates the others', async () => {
    const cli = await harness({}, ['billing']);
    await cli.run('init');
    await cli.run('functions', 'new', 'hello');
    await cli.run('functions', 'new', 'billing');

    await cli.run('functions', 'deploy');

    expect(cli.api.post).toHaveBeenCalledTimes(1);
    const [createPath, create] = cli.api.post.mock.calls[0] as unknown as [string, { organization: string; form: FormData }];
    expect(createPath).toBe('/projects/shop/functions');
    expect(create.organization).toBe('acme');
    expect(create.form.get('slug')).toBe('hello');
    expect(create.form.get('name')).toBe('hello');
    expect(sentFiles(create.form)).toEqual(['index.ts']);

    const [updatePath, update] = cli.api.put.mock.calls[0] as unknown as [string, { form: FormData }];
    expect(updatePath).toBe('/projects/shop/functions/billing');
    expect(sentFiles(update.form)).toEqual(['index.ts']);
  });

  it('deploys only the named functions and never the shared folders', async () => {
    const cli = await harness();
    await cli.run('init');
    await cli.run('functions', 'new', 'hello');
    await cli.run('functions', 'new', 'other');
    await mkdir(join(cli.cwd, 'nulvless/functions/_shared'));
    await writeFile(join(cli.cwd, 'nulvless/functions/_shared/cors.ts'), '');

    await cli.run('functions', 'deploy', 'hello', '--json');

    expect(cli.api.post).toHaveBeenCalledTimes(1);
    expect(JSON.parse(cli.stdout.join(''))).toEqual([{ slug: 'hello', action: 'created', version: 'v1' }]);
  });

  it('sends only files the platform accepts', async () => {
    const cli = await harness();
    await cli.run('init');
    await cli.run('functions', 'new', 'whoami', '--template', 'verify-session');
    await writeFile(join(cli.cwd, 'nulvless/functions/whoami/README.md'), '# Me');

    await cli.run('functions', 'deploy', 'whoami');

    const [, create] = cli.api.post.mock.calls[0] as unknown as [string, { form: FormData }];
    expect(sentFiles(create.form)).toEqual(['deno.json', 'index.ts']);
  });

  it('uses the display name from nulvless.jsonc', async () => {
    const cli = await harness();
    await cli.run('init');
    await cli.run('functions', 'new', 'checkout');
    await writeFile(
      join(cli.cwd, 'nulvless/nulvless.jsonc'),
      '{ "functions": { "checkout": { "name": "Checkout" } } }',
    );

    await cli.run('functions', 'deploy', 'checkout');

    const [, create] = cli.api.post.mock.calls[0] as unknown as [string, { form: FormData }];
    expect(create.form.get('name')).toBe('Checkout');
  });

  it('refuses functions with files in subfolders', async () => {
    const cli = await harness();
    await cli.run('init');
    await cli.run('functions', 'new', 'hello');
    await mkdir(join(cli.cwd, 'nulvless/functions/hello/lib'));
    await writeFile(join(cli.cwd, 'nulvless/functions/hello/lib/util.ts'), '');

    await expect(cli.run('functions', 'deploy', 'hello')).rejects.toMatchObject({
      message: 'hello has files in subfolders (lib/util.ts), which Edge Functions do not support yet.',
      hint: 'Move them next to index.ts.',
    });
  });

  it('names a function that is not in the workspace', async () => {
    const cli = await harness();
    await cli.run('init');

    await expect(cli.run('functions', 'deploy', 'ghost')).rejects.toMatchObject({
      message: 'There is no function ghost in nulvless/functions.',
      hint: 'Create it with `nulvless functions new ghost`.',
    });
  });

  it('says so when there is nothing to deploy', async () => {
    const cli = await harness();
    await cli.run('init');

    await expect(cli.run('functions', 'deploy')).rejects.toMatchObject({
      message: 'There are no functions in nulvless/functions yet.',
      hint: 'Create one with `nulvless functions new <slug>`.',
    });
  });
});

async function templateWorkspace(projectTemplates: Record<string, unknown>[] = [], flags: Partial<GlobalFlags> = {}) {
  const cli = await harness(flags, [], projectTemplates);
  await cli.run('init');
  return cli;
}

describe('templates new', () => {
  it('copies an example template with its subject', async () => {
    const cli = await templateWorkspace();

    await cli.run('templates', 'new', 'welcome-user', '--template', 'welcome-user');

    const folder = join(cli.cwd, 'nulvless/templates/email/welcome-user');
    expect(JSON.parse(await readFile(join(folder, 'template.json'), 'utf8'))).toEqual({
      subject: { 'en-US': 'Welcome to {{platform.name}}' },
    });
    await expect(readFile(join(folder, 'en-US.html'), 'utf8')).resolves.toContain('{{platform.name}}');
    expect(cli.stderr.join('')).toContain('nulvless templates push welcome-user --env <environment>');
  });

  it('starts a custom SMS template offline', async () => {
    const cli = await templateWorkspace();

    await cli.run('templates', 'new', 'order-shipped', '--channel', 'sms');

    const folder = join(cli.cwd, 'nulvless/templates/sms/order-shipped');
    expect(JSON.parse(await readFile(join(folder, 'template.json'), 'utf8'))).toEqual({ name: 'order-shipped' });
    await expect(readFile(join(folder, 'en-US.txt'), 'utf8')).resolves.toContain('{{platform.name}}');
    expect(cli.fetch).not.toHaveBeenCalled();
  });

  it('refuses an example that is not a template', async () => {
    const cli = await templateWorkspace();

    await expect(cli.run('templates', 'new', 'x-y', '--template', 'auth-vue')).rejects.toMatchObject({
      message: 'auth-vue is an app, not a communication template.',
    });
  });
});

describe('templates push', () => {
  async function withTemplates(projectTemplates: Record<string, unknown>[] = [], flags: Partial<GlobalFlags> = {}) {
    const cli = await templateWorkspace(projectTemplates, flags);
    await cli.run('templates', 'new', 'welcome-user', '--template', 'welcome-user');
    await cli.run('templates', 'new', 'order-shipped', '--channel', 'sms');
    return cli;
  }

  it('needs an environment', async () => {
    const cli = await withTemplates();

    await expect(cli.run('templates', 'push')).rejects.toMatchObject({
      message: 'No environment selected.',
      hint: 'Pass --env <environment>, such as --env staging.',
    });
  });

  it('creates the templates the environment does not have and updates the others', async () => {
    const cli = await withTemplates([{ slug: 'welcome-user', channel: 'email', language: 'en-US' }]);

    await cli.run('templates', 'push', '--env', 'staging');

    expect(cli.api.patch).toHaveBeenCalledWith('/projects/shop/staging/templates/email/welcome-user/en-US', {
      organization: 'acme',
      body: { subject: 'Welcome to {{platform.name}}', content: '<p>Welcome to {{platform.name}}</p>' },
    });
    expect(cli.api.post).toHaveBeenCalledWith('/projects/shop/staging/templates', {
      organization: 'acme',
      body: expect.objectContaining({ slug: 'order-shipped', channel: 'sms', language: 'en-US', name: 'order-shipped' }),
    });
    expect(cli.api.get).toHaveBeenCalledWith('/projects/shop/staging/templates', {
      organization: 'acme',
      query: { source: 'project', page: 1, page_size: 100 },
    });
  });

  it('never sends a name or description for a platform template', async () => {
    const cli = await withTemplates();
    await writeFile(
      join(cli.cwd, 'nulvless/templates/email/welcome-user/template.json'),
      JSON.stringify({ name: 'Mine', subject: { 'en-US': 'Hi' } }),
    );

    await cli.run('templates', 'push', 'welcome-user', '--env', 'staging');

    expect(cli.api.post).toHaveBeenCalledWith('/projects/shop/staging/templates', {
      organization: 'acme',
      body: { slug: 'welcome-user', channel: 'email', language: 'en-US', subject: 'Hi', content: '<p>Welcome to {{platform.name}}</p>' },
    });
  });

  it('asks before changing production', async () => {
    const cli = await withTemplates();

    await expect(cli.run('templates', 'push', '--env', 'main')).rejects.toMatchObject({
      hint: 'Pass --yes to confirm without a prompt.',
    });
    expect(cli.api.post).not.toHaveBeenCalled();
  });

  it('pushes to production with --yes and prints JSON', async () => {
    const cli = await withTemplates([], { yes: true });

    await cli.run('templates', 'push', 'order-shipped', '--env', 'main', '--json');

    expect(JSON.parse(cli.stdout.join(''))).toEqual([
      { slug: 'order-shipped', channel: 'sms', language: 'en-US', action: 'created' },
    ]);
  });
});

describe('templates pull', () => {
  const stored = [
    { slug: 'welcome-user', channel: 'email', language: 'en-US', subject: 'Hello', content: '<p>Hello</p>', common: true },
    { slug: 'welcome-user', channel: 'email', language: 'pt-BR', subject: 'Olá', content: '<p>Olá</p>', common: true },
    { slug: 'order-shipped', channel: 'sms', language: 'en-US', subject: null, content: 'Shipped', name: 'Order shipped', description: 'Sent on dispatch', common: false },
  ];

  it('writes the project templates of an environment into the workspace', async () => {
    const cli = await templateWorkspace(stored);

    await cli.run('templates', 'pull', '--env', 'main');

    const welcome = join(cli.cwd, 'nulvless/templates/email/welcome-user');
    expect(JSON.parse(await readFile(join(welcome, 'template.json'), 'utf8'))).toEqual({
      subject: { 'en-US': 'Hello', 'pt-BR': 'Olá' },
    });
    await expect(readFile(join(welcome, 'pt-BR.html'), 'utf8')).resolves.toBe('<p>Olá</p>');
    expect(JSON.parse(await readFile(join(cli.cwd, 'nulvless/templates/sms/order-shipped/template.json'), 'utf8'))).toEqual({
      name: 'Order shipped',
      description: 'Sent on dispatch',
    });
  });

  it('asks before overwriting local templates', async () => {
    const cli = await templateWorkspace(stored);
    await cli.run('templates', 'new', 'welcome-user', '--template', 'welcome-user');

    await expect(cli.run('templates', 'pull', '--env', 'main')).rejects.toMatchObject({
      hint: 'Pass --yes to confirm without a prompt.',
    });
    await expect(readFile(join(cli.cwd, 'nulvless/templates/email/welcome-user/en-US.html'), 'utf8')).resolves.toContain(
      'Welcome to',
    );
  });

  it('says so when the environment has no project templates', async () => {
    const cli = await templateWorkspace([]);

    await expect(cli.run('templates', 'pull', '--env', 'main')).rejects.toMatchObject({
      message: 'main has no templates of its own yet.',
    });
  });
});

describe('templates list', () => {
  const platform = [
    { slug: 'welcome-user', channel: 'email', name: 'Welcome', description: '', keys: [], overrides: ['pt-BR'] },
    { slug: 'phone-otp-verification', channel: 'sms', name: 'Code', description: '', keys: [], overrides: [] },
  ];
  const own = [
    { slug: 'welcome-user', channel: 'email', language: 'pt-BR', content: '<p>Olá</p>', common: true },
    { slug: 'order-shipped', channel: 'sms', language: 'en-US', content: 'Shipped', common: false },
    { slug: 'order-shipped', channel: 'sms', language: 'pt-BR', content: 'Enviado', common: false },
  ];

  async function listing() {
    const cli = await harness();
    cli.api.get.mockImplementation(async (_path: string, request?: { query?: { source?: string } }) =>
      request?.query?.source === 'platform' ? { items: platform, total: platform.length } : { items: own, total: own.length },
    );
    return cli;
  }

  it('shows which templates are the default, customized or the project own', async () => {
    const cli = await listing();

    await cli.run('templates', 'list', '--env', 'staging');

    const lines = cli.stdout.join('').split('\n');
    expect(lines.find((line) => line.includes('welcome-user'))).toMatch(/email\s+customized\s+pt-BR/);
    expect(lines.find((line) => line.includes('phone-otp-verification'))).toMatch(/sms\s+default/);
    expect(lines.find((line) => line.includes('order-shipped'))).toMatch(/sms\s+custom\s+en-US, pt-BR/);
  });

  it('asks the API for one channel', async () => {
    const cli = await listing();

    await cli.run('templates', 'list', '--env', 'main', '--channel', 'sms');

    expect(cli.api.get).toHaveBeenCalledWith('/projects/shop/main/templates', {
      organization: 'acme',
      query: { source: 'platform', channel: 'sms' },
    });
  });

  it('prints the same rows as JSON', async () => {
    const cli = await listing();

    await cli.run('templates', 'list', '--env', 'main', '--json');

    expect(JSON.parse(cli.stdout.join(''))).toContainEqual({
      slug: 'order-shipped',
      channel: 'sms',
      kind: 'custom',
      languages: ['en-US', 'pt-BR'],
    });
  });
});

describe('functions pull', () => {
  const sources = {
    '/projects/shop/functions': { items: [{ slug: 'checkout' }, { slug: 'hello' }], total: 2 },
    '/projects/shop/functions/checkout/source': {
      files: [
        { path: 'index.ts', content: 'export default () => new Response("checkout");' },
        { path: 'deno.json', content: '{}' },
      ],
    },
    '/projects/shop/functions/hello/source': { files: [{ path: 'index.ts', content: 'hello' }] },
  };

  it('writes every function of the project into the workspace', async () => {
    const cli = await harness({}, [], [], sources);
    await cli.run('init');

    await cli.run('functions', 'pull');

    await expect(readFile(join(cli.cwd, 'nulvless/functions/checkout/deno.json'), 'utf8')).resolves.toBe('{}');
    await expect(readFile(join(cli.cwd, 'nulvless/functions/hello/index.ts'), 'utf8')).resolves.toBe('hello');
    expect(cli.stderr.join('')).toContain('Pulled 2 function(s) into nulvless/functions.');
  });

  it('pulls only the named functions and prints JSON', async () => {
    const cli = await harness({}, [], [], sources);
    await cli.run('init');

    await cli.run('functions', 'pull', 'hello', '--json');

    expect(JSON.parse(cli.stdout.join(''))).toEqual([{ slug: 'hello', path: 'nulvless/functions/hello', files: ['index.ts'] }]);
  });

  it('asks before overwriting a local function', async () => {
    const cli = await harness({}, [], [], sources);
    await cli.run('init');
    await cli.run('functions', 'new', 'hello');

    await expect(cli.run('functions', 'pull', 'hello')).rejects.toMatchObject({
      hint: 'Pass --yes to confirm without a prompt.',
    });
    await expect(readFile(join(cli.cwd, 'nulvless/functions/hello/index.ts'), 'utf8')).resolves.toContain('handler');
  });
});

describe('secrets pull', () => {
  const secretRoutes = {
    '/projects/shop/functions/checkout/secrets': {
      items: [{ key: 'STRIPE_SECRET_KEY' }, { key: 'GREETING' }],
      total: 2,
    },
    '/projects/shop/functions/checkout/secrets/STRIPE_SECRET_KEY/reveal': { value: 'sk_test_123' },
    '/projects/shop/functions/checkout/secrets/GREETING/reveal': { value: 'hello "world"\nbye' },
  };

  it('writes the values into the function .env.local, readable only by the user', async () => {
    const cli = await harness({}, [], [], secretRoutes);
    await cli.run('init');
    await cli.run('functions', 'new', 'checkout');

    await cli.run('secrets', 'pull', '--function', 'checkout');

    const file = join(cli.cwd, 'nulvless/functions/checkout/.env.local');
    await expect(readFile(file, 'utf8')).resolves.toBe('STRIPE_SECRET_KEY="sk_test_123"\nGREETING="hello \\"world\\"\\nbye"\n');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(cli.stderr.join('')).not.toContain('sk_test_123');
  });

  it('writes to --output and never prints values in JSON', async () => {
    const cli = await harness({}, [], [], secretRoutes);

    await cli.run('secrets', 'pull', '--function', 'checkout', '--output', 'checkout.env', '--json');

    expect(JSON.parse(cli.stdout.join(''))).toEqual({ path: join(cli.cwd, 'checkout.env'), keys: ['STRIPE_SECRET_KEY', 'GREETING'] });
  });

  it('needs --output outside a workspace', async () => {
    const cli = await harness({}, [], [], secretRoutes);

    await expect(cli.run('secrets', 'pull', '--function', 'checkout')).rejects.toMatchObject({
      message: 'Choose where to write the secrets.',
      hint: 'Pass --output <file>, or run it inside a workspace to use nulvless/functions/checkout/.env.local.',
    });
  });
});
