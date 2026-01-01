import type { CredentialStore, StoredSession } from '../../credentials/credential-store';
import { LoginNotConfiguredError } from '../../errors';
import type { Platform } from '../../platform';
import { login } from '../login';

const authorize = jest.fn();
const exchangeCodeForToken = jest.fn();
const dispose = jest.fn();

jest.mock('@nulvless/nulvless-js', () => ({
  Storage: { Memory: 'memory' },
  createClient: () => ({ auth: { dispose, oauth: { authorize, exchangeCodeForToken } } }),
}));

const platform: Platform = {
  issuer: 'https://io.example.com',
  publishableKey: 'pk-test',
  apiUrl: 'https://api.example.com',
  clientId: 'cli-client',
  docsUrl: 'https://www.example.com',
  consoleUrl: 'https://cloud.example.com',
};

function memoryStore(): CredentialStore & { current: StoredSession | null } {
  return {
    location: 'memory',
    current: null,
    async read() {
      return this.current;
    },
    async write(session) {
      this.current = session;
    },
    async clear() {
      this.current = null;
    },
  };
}

let browserLanding: Promise<Response>;

async function browserApproves(url: string) {
  const request = new URL(url);
  const redirect = new URL(request.searchParams.get('redirect_uri') ?? '');
  redirect.searchParams.set('code', 'code-123');
  redirect.searchParams.set('state', request.searchParams.get('state') ?? '');
  browserLanding = fetch(redirect, { redirect: 'manual' });
}

describe('login', () => {
  beforeEach(() => {
    authorize.mockImplementation(async (params: Record<string, string>) => {
      const url = new URL('https://io.example.com/oauth/authorize');
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
      return { data: { url: url.toString() }, error: null };
    });
    exchangeCodeForToken.mockResolvedValue({
      data: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 900, token_type: 'Bearer', scope: 'openid' },
      error: null,
    });
  });

  it('runs PKCE through the browser and stores the session', async () => {
    const store = memoryStore();
    const shown: string[] = [];

    const waitForApproval = jest.fn((approval: Promise<string>) => approval) as unknown as <T>(approval: Promise<T>) => Promise<T>;

    await login({ platform, store, showUrl: (url) => shown.push(url), openBrowser: browserApproves, waitForApproval });

    expect(waitForApproval).toHaveBeenCalledTimes(1);

    const params = authorize.mock.calls[0]?.[0] as Record<string, string>;
    expect(params).toMatchObject({
      client_id: 'cli-client',
      redirect_uri: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/callback$/),
      code_challenge_method: 'S256',
    });
    expect(exchangeCodeForToken).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'code-123', client_id: 'cli-client', redirect_uri: params.redirect_uri }),
    );
    expect(exchangeCodeForToken.mock.calls[0]?.[0].code_verifier).toEqual(expect.any(String));
    expect(store.current).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    expect(shown).toHaveLength(1);
    expect(dispose).toHaveBeenCalled();
  });

  it('sends the browser to the hosted success page once the session is stored', async () => {
    await login({ platform, store: memoryStore(), showUrl: () => undefined, openBrowser: browserApproves });

    const landing = await browserLanding;
    expect(landing.status).toBe(302);
    expect(landing.headers.get('location')).toBe('https://cloud.example.com/cli/authorized');
  });

  it('keeps going when the browser cannot be opened', async () => {
    const store = memoryStore();
    let shown = '';
    const pending = login({
      platform,
      store,
      showUrl: (url) => (shown = url),
      openBrowser: async () => {
        throw new Error('no display');
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await browserApproves(shown);

    await pending;
    expect(store.current?.accessToken).toBe('access-1');
  });

  it('explains a failed exchange', async () => {
    exchangeCodeForToken.mockResolvedValueOnce({ data: null, error: { message: 'invalid_grant' } });

    await expect(
      login({ platform, store: memoryStore(), showUrl: () => undefined, openBrowser: browserApproves }),
    ).rejects.toThrow('Could not finish the sign-in: invalid_grant');

    const landing = await browserLanding;
    expect(landing.status).toBe(400);
    expect(await landing.text()).toContain('Could not finish the sign-in: invalid_grant');
  });

  it('needs an OAuth client', async () => {
    await expect(
      login({ platform: { ...platform, clientId: '' }, store: memoryStore(), showUrl: jest.fn(), openBrowser: jest.fn() }),
    ).rejects.toBeInstanceOf(LoginNotConfiguredError);
  });
});
