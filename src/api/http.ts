import { CliError, ForbiddenError, SessionExpiredError } from '../errors';

export interface ApiRequest {
  organization?: string;
  query?: Record<string, string | number>;
  body?: unknown;
  form?: FormData;
}

export interface Api {
  get<T>(path: string, request?: ApiRequest): Promise<T>;
  post<T>(path: string, request?: ApiRequest): Promise<T>;
  put<T>(path: string, request?: ApiRequest): Promise<T>;
  patch<T>(path: string, request?: ApiRequest): Promise<T>;
  delete<T>(path: string, request?: ApiRequest): Promise<T>;
}

interface ErrorBody {
  message?: string | string[];
  code?: string;
}

async function errorBody(response: Response): Promise<ErrorBody> {
  try {
    return (await response.json()) as ErrorBody;
  } catch {
    return {};
  }
}

function joinMessage(message: ErrorBody['message']) {
  return Array.isArray(message) ? message.join(' ') : message;
}

export async function failureFrom(response: Response, unauthorized: () => CliError): Promise<CliError> {
  const body = await errorBody(response);
  const message = joinMessage(body.message);

  if (response.status === 401) return unauthorized();
  if (response.status === 403) return new ForbiddenError(message ?? 'You do not have permission to do this.');
  return new CliError(message ?? `The Nulvless API answered with status ${response.status}.`);
}

export function createApi({
  baseUrl,
  token,
  unauthorized = () => new SessionExpiredError(),
  fetchImpl = fetch,
}: {
  baseUrl: string;
  token: () => Promise<string>;
  unauthorized?: () => CliError;
  fetchImpl?: typeof fetch;
}): Api {
  async function send<T>(method: string, path: string, { organization, query, body, form }: ApiRequest = {}): Promise<T> {
    const url = new URL(path, baseUrl);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, String(value));

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${await token()}`,
    };
    if (organization) headers['x-nulvless-org'] = organization;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(form ? { body: form } : {}),
      });
    } catch {
      throw new CliError(`Could not reach the Nulvless API at ${url.host}.`, { hint: 'Check your connection and try again.' });
    }

    if (!response.ok) throw await failureFrom(response, unauthorized);
    if (response.status === 204) return undefined as T;

    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    get: (path, request) => send('GET', path, request),
    post: (path, request) => send('POST', path, request),
    put: (path, request) => send('PUT', path, request),
    patch: (path, request) => send('PATCH', path, request),
    delete: (path, request) => send('DELETE', path, request),
  };
}
