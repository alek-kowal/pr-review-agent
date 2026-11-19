import { IntegrationError } from '../errors.ts';
import {
  OPENROUTER_ENV,
  OPENROUTER_ERROR,
  type OpenRouterChat,
  type OpenRouterChatRequest,
  type OpenRouterClient,
} from './openrouter-client.ts';

export const OPENROUTER_API = 'https://openrouter.ai/api/v1';
/** One judge call is small; past this the call fails `openrouter_timeout` (no retry). */
export const OPENROUTER_TIMEOUT_MS = 60_000;
/** Error text from OpenRouter is kept for the run's record, this long at most. */
const DETAIL_MAX = 300;

export type HttpOpenRouterClientOptions = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/**
 * `OpenRouterClient` over HTTP with a bearer key. It sends only the request body it is given:
 * no attribution headers, no user id. The key never appears in a thrown error.
 */
export class HttpOpenRouterClient implements OpenRouterClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: HttpOpenRouterClientOptions) {
    this.#apiKey = options.apiKey.trim();
    this.#baseUrl = options.baseUrl ?? OPENROUTER_API;
    this.#timeoutMs = options.timeoutMs ?? OPENROUTER_TIMEOUT_MS;
    this.#fetch = options.fetch ?? fetch;
  }

  async chat(
    request: OpenRouterChatRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<OpenRouterChat> {
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    let body: unknown;
    try {
      response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(request),
        signal,
      });
      body = await response.json().catch(() => null);
    } catch (thrown) {
      if (options.signal?.aborted) throw options.signal.reason ?? thrown;
      if (timeout.aborted) {
        throw new IntegrationError(OPENROUTER_ERROR.timeout, { timeoutMs: this.#timeoutMs });
      }
      throw new IntegrationError(OPENROUTER_ERROR.failed, {
        status: null,
        detail: this.#clean(thrown instanceof Error ? thrown.message : String(thrown)),
      });
    }

    const error = errorOf(body);
    if (!response.ok || error) {
      const status = error?.code ?? response.status;
      throw new IntegrationError(codeOf(status), {
        status,
        ...(error?.message ? { detail: this.#clean(error.message) } : {}),
      });
    }
    if (!isChat(body)) {
      throw new IntegrationError(OPENROUTER_ERROR.failed, {
        status: response.status,
        detail: 'no choices',
      });
    }
    return body;
  }

  /** Error text with the key removed, cut to `DETAIL_MAX`. */
  #clean(text: string): string {
    const safe = this.#apiKey ? text.replaceAll(this.#apiKey, '[redacted]') : text;
    return safe.slice(0, DETAIL_MAX);
  }
}

/** `HttpOpenRouterClient` with `OPENROUTER_API_KEY` from `env`, or null without one. */
export function createOpenRouterClient(
  env: NodeJS.ProcessEnv = process.env,
): HttpOpenRouterClient | null {
  const apiKey = env[OPENROUTER_ENV[0]]?.trim();
  return apiKey ? new HttpOpenRouterClient({ apiKey }) : null;
}

function codeOf(status: number): string {
  if (status === 401) return OPENROUTER_ERROR.auth;
  if (status === 402) return OPENROUTER_ERROR.noCredits;
  if (status === 408) return OPENROUTER_ERROR.timeout;
  if (status === 429) return OPENROUTER_ERROR.rateLimited;
  if (status === 502 || status === 503) return OPENROUTER_ERROR.unavailable;
  return OPENROUTER_ERROR.failed;
}

/** OpenRouter's error body `{ error: { code, message } }`, also sent with a 200. */
function errorOf(body: unknown): { code: number | null; message: string | null } | null {
  if (!body || typeof body !== 'object' || !('error' in body)) return null;
  const error = (body as { error: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return {
    code: typeof code === 'number' ? code : null,
    message: typeof message === 'string' ? message : null,
  };
}

function isChat(body: unknown): body is OpenRouterChat {
  return (
    !!body &&
    typeof body === 'object' &&
    Array.isArray((body as { choices?: unknown }).choices) &&
    (body as { choices: unknown[] }).choices.length > 0
  );
}
