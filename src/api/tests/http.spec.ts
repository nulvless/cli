import { ForbiddenError, SessionExpiredError } from '../../errors';
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

  it('keeps the API message on 403', async () => {
    const api = apiWith(jest.fn(async () => jsonResponse(403, { message: 'Only owners can do this.' })));

    await expect(api.get('/projects')).rejects.toEqual(new ForbiddenError('Only owners can do this.'));
  });

  it('joins validation messages', async () => {
    const api = apiWith(jest.fn(async () => jsonResponse(400, { message: ['Slug is invalid.', 'Name is too short.'] })));

    await expect(api.get('/projects')).rejects.toThrow('Slug is invalid. Name is too short.');
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
});
