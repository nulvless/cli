import type { CredentialStore } from '../../credentials/credential-store';
import type { Prompter } from '../../ui/prompter';
import { elevateSession, type SudoClient } from '../sudo';

function memoryStore(): CredentialStore & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    location: 'memory',
    read: jest.fn(async () => null),
    write: jest.fn(async (session) => {
      saved.push(session);
    }),
    clear: jest.fn(async () => undefined),
  } as unknown as CredentialStore & { saved: unknown[] };
}

function prompter(answers: { codes?: string[]; choice?: string } = {}): Prompter {
  const codes = [...(answers.codes ?? ['123456'])];
  return {
    interactive: true,
    choose: jest.fn(async () => answers.choice) as Prompter['choose'],
    confirm: jest.fn(),
    secret: jest.fn(),
    text: jest.fn(async () => codes.shift() ?? ''),
  };
}

const elevated = { access_token: 'sudo-access', refresh_token: 'sudo-refresh', expires_in: 900, sudo: { expires_in: 600 } };

function client(overrides: Partial<SudoClient> = {}): SudoClient {
  return {
    request: jest.fn(async () => ({
      data: { challenge: { preferred: 'email_otp', identifier: 'a***@example.com', factors: [], token: 't', expires_in: 300 } },
      error: null,
    })),
    verify: jest.fn(async () => ({ data: elevated, error: null })),
    ...overrides,
  } as SudoClient;
}

describe('elevateSession', () => {
  it('sends the challenge, asks for the code and stores the elevated session', async () => {
    const store = memoryStore();
    const ask = prompter();
    const sudo = client();

    await expect(elevateSession({ client: sudo, store, prompter: ask, now: 1_000 })).resolves.toEqual({ expiresIn: 600 });

    expect((ask.text as jest.Mock).mock.calls[0][0]).toBe('Enter the code sent to a***@example.com');
    expect(sudo.verify).toHaveBeenCalledWith('123456');
    expect(store.saved).toEqual([{ accessToken: 'sudo-access', refreshToken: 'sudo-refresh', expiresAt: 901_000 }]);
  });

  it('keeps the stored refresh token when the elevated session has none', async () => {
    const store = memoryStore();
    (store.read as jest.Mock).mockResolvedValue({ accessToken: 'old', refreshToken: 'kept', expiresAt: 1 });
    const verify = jest.fn(async () => ({ data: { access_token: 'sudo-access', expires_in: 900 }, error: null }));

    await elevateSession({ client: client({ verify }), store, prompter: prompter(), now: 0 });

    expect(store.saved).toEqual([{ accessToken: 'sudo-access', refreshToken: 'kept', expiresAt: 900_000 }]);
  });

  it('lets the user pick a method when there are several', async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        data: { challenge: { preferred: null, factors: [{ type: 'totp' }, { type: 'sms_otp' }], token: null, expires_in: 300 } },
        error: null,
      })
      .mockResolvedValueOnce({ data: { challenge: { preferred: 'sms_otp', identifier: '+55 ***99', factors: [] } }, error: null });
    const ask = prompter({ choice: 'sms_otp' });

    await elevateSession({ client: client({ request }), store: memoryStore(), prompter: ask });

    expect(request).toHaveBeenNthCalledWith(2, 'sms_otp');
  });

  it('asks again after a wrong code, up to three times', async () => {
    const verify = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'Invalid code.' } })
      .mockResolvedValueOnce({ data: elevated, error: null });

    await elevateSession({ client: client({ verify }), store: memoryStore(), prompter: prompter({ codes: ['000000', '123456'] }) });

    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('gives up after three wrong codes', async () => {
    const verify = jest.fn(async () => ({ data: null, error: { message: 'Invalid code.' } }));

    await expect(
      elevateSession({ client: client({ verify }), store: memoryStore(), prompter: prompter({ codes: ['1', '2', '3'] }) }),
    ).rejects.toMatchObject({ message: 'Could not confirm it is you: Invalid code.' });
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it('needs a terminal', async () => {
    await expect(
      elevateSession({ client: client(), store: memoryStore(), prompter: { ...prompter(), interactive: false } }),
    ).rejects.toMatchObject({ message: 'This action needs you to confirm it is you (sudo).' });
  });

  it('explains when the challenge cannot be sent', async () => {
    const request = jest.fn(async () => ({ data: null, error: { message: 'Too many attempts.' } }));

    await expect(elevateSession({ client: client({ request }), store: memoryStore(), prompter: prompter() })).rejects.toMatchObject({
      message: 'Could not start the sudo confirmation: Too many attempts.',
    });
  });
});
