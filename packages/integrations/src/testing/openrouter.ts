import { IntegrationError } from '../errors.ts';
import type {
  OpenRouterChat,
  OpenRouterChatRequest,
  OpenRouterClient,
} from '../openrouter/openrouter-client.ts';

/** What the double answers: a chat, an error to throw, or a function of the request. */
export type FakeOpenRouterReply =
  | OpenRouterChat
  | Error
  | ((request: OpenRouterChatRequest) => OpenRouterChat | Error | Promise<OpenRouterChat | Error>);

/**
 * `OpenRouterClient` for tests: records every request and answers from a queue of replies (the
 * last one repeats). No network.
 */
export class FakeOpenRouterClient implements OpenRouterClient {
  readonly requests: OpenRouterChatRequest[] = [];
  readonly #replies: FakeOpenRouterReply[];

  constructor(...replies: FakeOpenRouterReply[]) {
    this.#replies = replies.length > 0 ? replies : [openRouterChat()];
  }

  async chat(
    request: OpenRouterChatRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<OpenRouterChat> {
    this.requests.push(structuredClone(request));
    if (options.signal?.aborted) throw options.signal.reason;
    const next = this.#replies.length > 1 ? this.#replies.shift()! : this.#replies[0]!;
    const reply = typeof next === 'function' ? await next(request) : next;
    if (reply instanceof Error) throw reply;
    return reply;
  }
}

/** A completed chat whose content is `answer` as JSON (default: a valid judge answer). */
export function openRouterChat(
  answer: unknown = { tier: 'extends', reason: 'It changes how retries behave.' },
  overrides: Partial<OpenRouterChat> = {},
): OpenRouterChat {
  return {
    id: 'gen-1',
    model: 'acme/small-model',
    provider: 'Acme',
    choices: [
      {
        message: {
          role: 'assistant',
          content: typeof answer === 'string' ? answer : JSON.stringify(answer),
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1200, completion_tokens: 40, total_tokens: 1240, cost: 0.00042 },
    ...overrides,
  };
}

/** An `IntegrationError` as `HttpOpenRouterClient` throws it. */
export function openRouterError(code: string, params: Record<string, unknown> = {}): Error {
  return new IntegrationError(code, params);
}
