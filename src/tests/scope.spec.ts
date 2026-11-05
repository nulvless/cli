import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Api } from '../api/http';
import { MissingOptionError } from '../errors';
import { offerToLink, resolveScope } from '../scope';
import type { Prompter } from '../ui/prompter';
import { initWorkspace, readWorkspaceConfig } from '../workspace';

function fakeApi(routes: Record<string, unknown>): Api {
  const get = jest.fn(async (path: string) => routes[path]);
  return { get, post: jest.fn(), delete: jest.fn() } as unknown as Api;
}

function fakePrompter(interactive: boolean, answers: string[] = []): Prompter {
  return {
    interactive,
    choose: jest.fn(async () => answers.shift()) as Prompter['choose'],
    confirm: jest.fn(),
    secret: jest.fn(),
    text: jest.fn(),
  };
}

const twoOrganizations = [
  { slug: 'acme', name: 'Acme' },
  { slug: 'globex', name: 'Globex' },
];

describe('resolveScope', () => {
  it('falls back to the workspace link after flags and environment variables', async () => {
    const api = fakeApi({});
    const linked = { organization: 'acme', project: 'shop' };

    await expect(resolveScope({ flags: {}, env: {}, linked, api, prompter: fakePrompter(false) })).resolves.toEqual(linked);
    await expect(
      resolveScope({ flags: { project: 'cart' }, env: { NULVLESS_ORG: 'globex' }, linked, api, prompter: fakePrompter(false) }),
    ).resolves.toEqual({ organization: 'globex', project: 'cart' });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('uses flags without calling the API', async () => {
    const api = fakeApi({});

    await expect(
      resolveScope({ flags: { org: 'acme', project: 'shop' }, env: {}, api, prompter: fakePrompter(false) }),
    ).resolves.toEqual({ organization: 'acme', project: 'shop' });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('falls back to environment variables', async () => {
    await expect(
      resolveScope({
        flags: {},
        env: { NULVLESS_ORG: 'acme', NULVLESS_PROJECT: 'shop' },
        api: fakeApi({}),
        prompter: fakePrompter(false),
      }),
    ).resolves.toEqual({ organization: 'acme', project: 'shop' });
  });

  it('picks the only organization automatically', async () => {
    const api = fakeApi({ '/organizations': [{ slug: 'acme', name: 'Acme' }] });

    await expect(
      resolveScope({ flags: { project: 'shop' }, env: {}, api, prompter: fakePrompter(false) }),
    ).resolves.toEqual({ organization: 'acme', project: 'shop' });
  });

  it('asks which organization and project in a terminal', async () => {
    const api = fakeApi({ '/organizations': twoOrganizations, '/projects': [{ slug: 'shop', name: 'Shop' }] });
    const prompter = fakePrompter(true, ['globex', 'shop']);

    await expect(resolveScope({ flags: {}, env: {}, api, prompter })).resolves.toEqual({
      organization: 'globex',
      project: 'shop',
    });
  });

  it('names the missing flag when it cannot ask', async () => {
    const api = fakeApi({ '/organizations': twoOrganizations });

    await expect(resolveScope({ flags: {}, env: {}, api, prompter: fakePrompter(false) })).rejects.toEqual(
      new MissingOptionError('organization', '--org <slug>', 'NULVLESS_ORG'),
    );
  });
});

describe('offerToLink', () => {
  const scope = { organization: 'acme', project: 'shop' };

  async function workspace() {
    const root = await mkdtemp(join(tmpdir(), 'nulvless-cli-'));
    await initWorkspace(root, {});
    return root;
  }

  function confirming(answer: boolean) {
    const prompter = fakePrompter(true);
    (prompter.confirm as jest.Mock).mockResolvedValue(answer);
    return prompter;
  }

  it('links the workspace to the project chosen in the terminal when the user agrees', async () => {
    const root = await workspace();
    const prompter = confirming(true);

    await expect(offerToLink(root, scope, { flags: {}, env: {}, linked: {}, api: fakeApi({}), prompter })).resolves.toBe(true);

    expect(prompter.confirm).toHaveBeenCalledWith('Link this workspace to shop in acme?');
    await expect(readWorkspaceConfig(root)).resolves.toMatchObject(scope);
  });

  it('leaves the workspace as it is when the user declines', async () => {
    const root = await workspace();

    await expect(
      offerToLink(root, scope, { flags: {}, env: {}, linked: {}, api: fakeApi({}), prompter: confirming(false) }),
    ).resolves.toBe(false);

    await expect(readWorkspaceConfig(root)).resolves.toEqual({ functions: {} });
  });

  it.each([
    ['flags', { flags: { org: 'acme', project: 'shop' }, env: {}, linked: {} }],
    ['environment variables', { flags: {}, env: { NULVLESS_ORG: 'acme', NULVLESS_PROJECT: 'shop' }, linked: {} }],
    ['the workspace link', { flags: {}, env: {}, linked: scope }],
  ])('does not ask when %s name the project', async (_source, sources) => {
    const prompter = confirming(true);

    await expect(offerToLink(await workspace(), scope, { ...sources, api: fakeApi({}), prompter })).resolves.toBe(false);

    expect(prompter.confirm).not.toHaveBeenCalled();
  });

  it('does not ask when it cannot prompt', async () => {
    const prompter = fakePrompter(false);

    await expect(offerToLink(await workspace(), scope, { flags: {}, env: {}, linked: {}, api: fakeApi({}), prompter })).resolves.toBe(
      false,
    );

    expect(prompter.confirm).not.toHaveBeenCalled();
  });
});
