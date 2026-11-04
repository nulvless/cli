import { ForbiddenError, SessionExpiredError, SudoRequiredError } from '../../errors';
import { createApi } from '../http';
import { resources } from '../resources';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function apiWith(fetchImpl: jest.Mock) {
  return createApi({ baseUrl: 'https://api.example.com', token: async () => 'token-1', fetchImpl });
}

describe('createApi', () => {
  it('sends the bearer token and the organization header', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, []));

    await apiWith(fetchImpl).get('/projects', { organization: 'acme' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.example.com/projects');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token-1', 'x-nulvless-org': 'acme' });
  });

  it('serializes JSON bodies', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(201, { key: 'A' }));

    await apiWith(fetchImpl).post('/secrets', { body: { key: 'A', value: 'b' } });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.body).toBe('{"key":"A","value":"b"}');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('sends forms as multipart without forcing a content type', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { slug: 'hello' }));
    const form = new FormData();
    form.append('slug', 'hello');

    await apiWith(fetchImpl).put('/projects/shop/functions/hello', { form });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(form);
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('turns 401 into an expired session', async () => {
    const api = apiWith(jest.fn(async () => jsonResponse(401, { message: 'Unauthorized' })));

    await expect(api.get('/projects')).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('asks for sudo, then repeats the request once with the elevated token', async () => {
    const tokens = ['token-1', 'token-2'];
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(403, { message: 'Confirm it is you.', code: 'protected_action_denied' }))
      .mockResolvedValueOnce(jsonResponse(201, { id: 'key_1' }));
    const elevate = jest.fn(async () => {
      tokens.shift();
    });
    const api = createApi({ baseUrl: 'https://api.example.com', token: async () => tokens[0]!, fetchImpl, elevate });

    await expect(api.post('/keys', { body: { name: 'ci' } })).resolves.toEqual({ id: 'key_1' });

    expect(elevate).toHaveBeenCalledTimes(1);
    const [, retry] = fetchImpl.mock.calls[1] as [URL, RequestInit];
    expect(retry.headers).toMatchObject({ Authorization: 'Bearer token-2' });
  });

  it('explains sudo when it cannot elevate', async () => {
    const api = apiWith(jest.fn(async () => jsonResponse(403, { message: 'Confirm it is you.', code: 'protected_action_denied' })));

    await expect(api.post('/keys')).rejects.toBeInstanceOf(SudoRequiredError);
  });

  it('does not loop when sudo is still denied after elevating', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(403, { message: 'Confirm it is you.', code: 'protected_action_denied' }));
    const elevate = jest.fn(async () => undefined);
    const api = createApi({ baseUrl: 'https://api.example.com', token: async () => 't', fetchImpl, elevate });

    await expect(api.post('/keys')).rejects.toBeInstanceOf(SudoRequiredError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps the API message on 403', async () => {
    const api = apiWith(jest.fn(async () => jsonResponse(403, { message: 'Only owners can do this.' })));

    await expect(api.get('/projects')).rejects.toEqual(new ForbiddenError('Only owners can do this.'));
  });

  it('joins validation messages', async () => {
    const api = apiWith(jest.fn(async () => jsonResponse(400, { message: ['Slug is invalid.', 'Name is too short.'] })));

    await expect(api.get('/projects')).rejects.toThrow('Slug is invalid. Name is too short.');
  });

  it('says when to try again after a rate limit', async () => {
    const api = apiWith(jest.fn(async () => jsonResponse(429, { message: 'Too many feedback submissions.', retryAfterSeconds: 130 })));

    await expect(api.post('/organizations/feedback')).rejects.toMatchObject({
      message: 'Too many feedback submissions.',
      hint: 'Try again in 3 minutes.',
    });
  });

  it('explains when the API cannot be reached', async () => {
    const api = apiWith(
      jest.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    await expect(api.get('/projects')).rejects.toMatchObject({
      message: 'Could not reach the Nulvless API at api.example.com.',
      hint: 'Check your connection and try again.',
    });
  });
});

describe('resources', () => {
  it('follows pages until the last one', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ slug: `fn-${index}` }));
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { items: first, total: 101 }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [{ slug: 'fn-100' }], total: 101 }));

    const functions = await resources.functions(apiWith(fetchImpl), { organization: 'acme', project: 'shop' });

    expect(functions).toHaveLength(101);
    const [secondUrl] = fetchImpl.mock.calls[1] as [URL];
    expect(secondUrl.searchParams.get('page')).toBe('2');
    expect(secondUrl.searchParams.get('page_size')).toBe('100');
  });

  it('keeps going when the server sends smaller pages than asked, until the total', async () => {
    const page = (from: number) => Array.from({ length: 50 }, (_, index) => ({ slug: `fn-${from + index}` }));
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { items: page(0), total: 120 }))
      .mockResolvedValueOnce(jsonResponse(200, { items: page(50), total: 120 }))
      .mockResolvedValueOnce(jsonResponse(200, { items: page(100).slice(0, 20), total: 120 }));

    const functions = await resources.functions(apiWith(fetchImpl), { organization: 'acme', project: 'shop' });

    expect(functions).toHaveLength(120);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('stops at an empty page even if the total says otherwise', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { items: [{ slug: 'fn-0' }], total: 5 }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [], total: 5 }));

    const functions = await resources.functions(apiWith(fetchImpl), { organization: 'acme', project: 'shop' });

    expect(functions).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops at a short page when the API sends no total', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse(200, { items: [{ slug: 'fn-0' }] }));

    await expect(resources.functions(apiWith(fetchImpl), { organization: 'acme', project: 'shop' })).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
