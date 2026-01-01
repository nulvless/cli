import { CliError } from '../../errors';
import { listenForCallback } from '../loopback';

describe('listenForCallback', () => {
  it('resolves the code and holds the browser until the sign-in finishes', async () => {
    const callback = await listenForCallback('state-1', 5_000);
    const browser = fetch(`${callback.redirectUri}?code=abc&state=state-1`, { redirect: 'manual' });

    await expect(callback.code).resolves.toBe('abc');
    callback.redirectBrowserTo('https://cloud.example.com/cli/authorized');

    const response = await browser;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://cloud.example.com/cli/authorized');
    callback.close();
  });

  it('shows the failure in the browser when the sign-in cannot finish', async () => {
    const callback = await listenForCallback('state-1', 5_000);
    const browser = fetch(`${callback.redirectUri}?code=abc&state=state-1`);

    await callback.code;
    callback.showFailure('Could not finish the sign-in: <invalid_grant>');

    const response = await browser;
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Could not finish the sign-in: &lt;invalid_grant&gt;');
    callback.close();
  });

  it('answers the browser when closed before the sign-in finishes', async () => {
    const callback = await listenForCallback('state-1', 5_000);
    const browser = fetch(`${callback.redirectUri}?code=abc&state=state-1`);

    await callback.code;
    callback.close();

    expect((await browser).status).toBe(200);
  });

  it('rejects a response for another sign-in', async () => {
    const callback = await listenForCallback('state-1', 5_000);
    const settled = callback.code.catch((error: unknown) => error);
    await fetch(`${callback.redirectUri}?code=abc&state=other`);

    expect(await settled).toBeInstanceOf(CliError);
    callback.close();
  });

  it('rejects with the server description when authorization is denied', async () => {
    const callback = await listenForCallback('state-1', 5_000);
    const settled = callback.code.catch((error: unknown) => error);
    await fetch(`${callback.redirectUri}?error=access_denied&error_description=The%20user%20denied%20access.`);

    expect(((await settled) as Error).message).toBe('The user denied access.');
    callback.close();
  });

  it('listens on a free loopback port at /callback', async () => {
    const first = await listenForCallback('state-1', 5_000);
    const second = await listenForCallback('state-2', 5_000);

    expect(first.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(second.redirectUri).not.toBe(first.redirectUri);

    first.close();
    second.close();
  });

  it('answers 404 outside /callback', async () => {
    const callback = await listenForCallback('state-1', 5_000);
    const response = await fetch(callback.redirectUri.replace('/callback', '/other'));

    expect(response.status).toBe(404);
    callback.close();
  });

  it('times out when the browser never comes back', async () => {
    const callback = await listenForCallback('state-1', 20);

    await expect(callback.code).rejects.toThrow('Sign-in timed out');
    callback.close();
  });
});
