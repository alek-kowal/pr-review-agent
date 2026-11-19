/**
 * OpenRouter's OpenAI-compatible chat completions (P-26): the change-type judge may run on an
 * OpenRouter model. Other code depends on `OpenRouterClient`, never on the HTTP call.
 */
export interface OpenRouterClient {
  /** One non-streaming completion. Throws `IntegrationError` with an `openrouter_*` code. */
  chat(request: OpenRouterChatRequest, options?: { signal?: AbortSignal }): Promise<OpenRouterChat>;
}

export const OPENROUTER_ENV = ['OPENROUTER_API_KEY'] as const;

/** Error codes (`IntegrationError.code`); params never hold the key. */
export const OPENROUTER_ERROR = {
  /** 401: the key is wrong or revoked. */
  auth: 'openrouter_auth_failed',
  /** 402: the account or the key's credit limit is used up. */
  noCredits: 'openrouter_no_credits',
  /** 408 or the client's own timeout. */
  timeout: 'openrouter_timeout',
  /** 429. */
  rateLimited: 'openrouter_rate_limited',
  /** 502 / 503: the model or every allowed provider is down, or none matches the preferences. */
  unavailable: 'openrouter_unavailable',
  /** Any other non-2xx, an error body, a network failure or a body that is not JSON. */
  failed: 'openrouter_error',
} as const;
export type OpenRouterErrorCode = (typeof OPENROUTER_ERROR)[keyof typeof OPENROUTER_ERROR];

export type OpenRouterMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** Where OpenRouter may route the request (`provider` preferences). */
export type OpenRouterProviderPreferences = {
  /** `deny`: only providers that do not store or train on the data. */
  data_collection?: 'allow' | 'deny';
  require_parameters?: boolean;
  allow_fallbacks?: boolean;
};

export type OpenRouterChatRequest = {
  /** OpenRouter's id, e.g. `typesafe/jev-router` (without this app's `openrouter/` prefix). */
  model: string;
  messages: OpenRouterMessage[];
  max_tokens?: number;
  response_format?: {
    type: 'json_schema';
    json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
  };
  provider?: OpenRouterProviderPreferences;
  /** Usage accounting: the response's `usage` then carries `cost` in US dollars (credits). */
  usage?: { include: boolean };
};

export type OpenRouterUsage = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  /** What the call cost, in credits (1 credit = 1 US dollar). */
  cost?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
};

export type OpenRouterChat = {
  id?: string;
  /** The model that actually answered (a router model names the one it picked). */
  model?: string;
  /** The provider that served it. */
  provider?: string;
  choices: {
    message?: { role?: string; content?: string | null } | null;
    finish_reason?: string | null;
  }[];
  usage?: OpenRouterUsage | null;
};
