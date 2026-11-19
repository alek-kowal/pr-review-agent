// The one HTTP client for the api. Every request carries `X-PRA-Request: 1` (the CSRF guard), and
// every failure becomes an `ApiError` with a reason code; the UI maps codes to copy.

export type ApiErrorCode = 'network_error' | 'http_error' | (string & {});

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly params: Record<string, unknown>;
  /** HTTP status; 0 when the request never got an answer. */
  readonly status: number;
  constructor(code: ApiErrorCode, params: Record<string, unknown>, status: number) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.params = params;
    this.status = status;
  }
}

export const CSRF_HEADER = 'X-PRA-Request';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const headers: Record<string, string> = { Accept: 'application/json', [CSRF_HEADER]: '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      credentials: 'same-origin',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError('network_error', {}, 0);
  }

  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw toApiError(payload, response.status);
  return payload as T;
}

export const apiGet = <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { signal });

function toApiError(payload: unknown, status: number): ApiError {
  const error = (payload as { error?: { code?: unknown; params?: unknown } } | undefined)?.error;
  if (error && typeof error.code === 'string') {
    const params =
      error.params && typeof error.params === 'object'
        ? (error.params as Record<string, unknown>)
        : {};
    return new ApiError(error.code, params, status);
  }
  return new ApiError('http_error', { status }, status);
}
