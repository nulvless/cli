import { CliError, ForbiddenError, SessionExpiredError, SudoRequiredError } from '../errors';

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

const SUDO_REQUIRED = 'protected_action_denied';

export async function failureFrom(response: Response, unauthorized: () => CliError): Promise<CliError> {
  const body = await errorBody(response);
  const message = joinMessage(body.message);

  if (response.status === 401) return unauthorized();
  if (response.status === 403 && body.code === SUDO_REQUIRED) return new SudoRequiredError();
  if (response.status === 403) return new ForbiddenError(message ?? 'You do not have permission to do this.');
  return new CliError(message ?? `The Nulvless API answered with status ${response.status}.`);
}

export function createApi({
  baseUrl,
  token,
  unauthorized = () => new SessionExpiredError(),
  fetchImpl = fetch,
  elevate,
}: {
  baseUrl: string;
  token: () => Promise<string>;
  unauthorized?: () => CliError;
  fetchImpl?: typeof fetch;
  elevate?: () => Promise<unknown>;
}): Api {
  async function send<T>(method: string, path: string, request: ApiRequest = {}, elevated = false): Promise<T> {
    const { organization, query, body, form } = request;
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

    if (!response.ok) {
      const failure = await failureFrom(response, unauthorized);
      if (failure instanceof SudoRequiredError && elevate && !elevated) {
        await elevate();
        return send<T>(method, path, request, true);
      }
      throw failure;
    }
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
