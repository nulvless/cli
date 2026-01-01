import type { Api } from '../api/http';
import { MissingOptionError } from '../errors';
import { resolveScope } from '../scope';
import type { Prompter } from '../ui/prompter';

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
  };
}

const twoOrganizations = [
  { slug: 'acme', name: 'Acme' },
  { slug: 'globex', name: 'Globex' },
];

describe('resolveScope', () => {
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
