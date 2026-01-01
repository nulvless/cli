import { claimsOf } from '../jwt';
import { callbackUrl, platformFrom } from '../platform';

describe('platformFrom', () => {
  it('signs in with the Nulvless CLI client by default', () => {
    expect(platformFrom({}).clientId).toBe('ivjzj27zleas22zxhsado518');
  });

  it('lets the environment point the CLI elsewhere', () => {
    expect(
      platformFrom({ NULVLESS_API_URL: 'http://localhost:3000', NULVLESS_CLIENT_ID: 'local-client' }),
    ).toMatchObject({ apiUrl: 'http://localhost:3000', clientId: 'local-client' });
  });

  it('opens the console at cloud.nulvless.com unless told otherwise', () => {
    expect(platformFrom({}).consoleUrl).toBe('https://cloud.nulvless.com');
    expect(platformFrom({ NULVLESS_CONSOLE_URL: 'http://localhost:5173' }).consoleUrl).toBe('http://localhost:5173');
  });

  it('builds loopback callback URLs', () => {
    expect(callbackUrl(41753)).toBe('http://127.0.0.1:41753/callback');
  });
});

describe('claimsOf', () => {
  it('decodes the payload of a JWT', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'usr_1' })).toString('base64url');

    expect(claimsOf(`header.${payload}.signature`)).toEqual({ sub: 'usr_1' });
  });

  it('returns no claims for an opaque token', () => {
    expect(claimsOf('opaque-token')).toEqual({});
  });
});
