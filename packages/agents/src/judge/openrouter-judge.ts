import {
  DEFAULT_MODELS,
  isOpenRouterModel,
  OPENROUTER_API_KEY_ENV,
  openRouterModelId,
} from '@pra/core';
import type { ModelProvider } from '@pra/core';
import {
  createOpenRouterClient,
  type OpenRouterChat,
  type OpenRouterChatRequest,
  type OpenRouterClient,
} from '@pra/integrations';
import {
  agentError as error,
  agentResult,
  detailOf,
  issuesOf,
  jsonSchemaOf,
} from '../agent-result.ts';
import type { z } from 'zod/v4';
import { costOf } from '../prices.ts';
import type { AgentError, AgentRunResult, AgentUsage } from '../runner.ts';
import {
  JudgeAnswerSchema,
  judgeRequest,
  TIERS,
  type Judge,
  type JudgeInput,
  type JudgeOutput,
} from './judge.ts';

const MAX_TOKENS = 1024;

export type OpenRouterJudgeOptions = {
  /** Null without `OPENROUTER_API_KEY`: every call fails `model_access_not_configured`. */
  client: OpenRouterClient | null;
  now?: () => number;
};

/**
 * `Judge` on an OpenRouter model (P-26), e.g. `openrouter/typesafe/jev-router`. One chat
 * completion with a JSON-schema answer; it sends the same user message as the Claude judge and
 * nothing else, and only to providers that do not collect data. Cost is OpenRouter's own figure
 * (real spend); the model that answered is recorded, since a router model picks one per call.
 */
export class OpenRouterJudge implements Judge {
  readonly #client: OpenRouterClient | null;
  readonly #now: () => number;

  constructor(options: OpenRouterJudgeOptions) {
    this.#client = options.client;
    this.#now = options.now ?? Date.now;
  }

  async judge(input: JudgeInput): Promise<AgentRunResult<JudgeOutput>> {
    const startedAt = this.#now();
    if (!this.#client) {
      const params = { provider: 'openrouter', missing: [OPENROUTER_API_KEY_ENV] };
      return result({ status: 'failed', error: error('model_access_not_configured', params) });
    }
    if (input.signal?.aborted) return result({ status: 'cancelled', error: error('cancelled') });

    const request = openRouterJudgeRequest(input);
    const transcript: unknown[] = [{ type: 'request', request }];
    let response: OpenRouterChat;
    try {
      response = await this.#client.chat(request, { signal: input.signal });
    } catch (thrown) {
      const durationMs = this.#now() - startedAt;
      transcript.push({ type: 'error', detail: detailOf(thrown) });
      if (input.signal?.aborted) {
        return result({ status: 'cancelled', error: error('cancelled'), durationMs, transcript });
      }
      return result({ status: 'failed', error: failureOf(thrown), durationMs, transcript });
    }

    transcript.push(response);
    const usage = usageOf(response);
    const reported = response.usage?.cost;
    const spent = {
      usage,
      ...(typeof reported === 'number' && Number.isFinite(reported)
        ? { costUsd: reported, costSource: 'reported' as const }
        : // No figure from OpenRouter: priced at the highest list price, never under-counted.
          { costUsd: costOf(input.model, usage), costSource: 'computed' as const }),
      turns: 1,
      durationMs: this.#now() - startedAt,
      transcript,
      answeredModel: response.model ?? null,
    };
    const choice = response.choices[0];
    const answer = parseAnswer(choice?.message?.content ?? '');
    if (!answer.success) {
      return result({
        ...spent,
        status: 'failed',
        error: error('output_invalid', {
          provider: 'openrouter',
          finishReason: choice?.finish_reason ?? null,
          issues: answer.issues,
        }),
      });
    }
    return result({
      ...spent,
      status: 'completed',
      output: { changeType: TIERS[answer.data.tier], reason: answer.data.reason },
    });
  }
}

/** `OpenRouterJudge` with `OPENROUTER_API_KEY` from `env` (unconfigured without it). */
export function createOpenRouterJudge(env: NodeJS.ProcessEnv = process.env): OpenRouterJudge {
  return new OpenRouterJudge({ client: createOpenRouterClient(env) });
}

/**
 * The chat request: the Claude judge's one user message, the answer schema as strict JSON
 * schema, and `data_collection: deny`. Usage accounting asks for the call's cost.
 */
export function openRouterJudgeRequest(input: JudgeInput): OpenRouterChatRequest {
  const content = judgeRequest(input).messages[0]!.content;
  return {
    model: openRouterModelId(input.model),
    messages: [{ role: 'user', content: typeof content === 'string' ? content : '' }],
    max_tokens: MAX_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'judge_answer', strict: true, schema: jsonSchemaOf(JudgeAnswerSchema) },
    },
    provider: { data_collection: 'deny' },
    usage: { include: true },
  };
}

/** OpenRouter's counts: cached prompt tokens are reported inside `prompt_tokens`. */
function usageOf(response: OpenRouterChat): AgentUsage {
  const prompt = response.usage?.prompt_tokens ?? 0;
  const cached = Math.min(response.usage?.prompt_tokens_details?.cached_tokens ?? 0, prompt);
  return {
    inputTokens: prompt - cached,
    outputTokens: response.usage?.completion_tokens ?? 0,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
}

/** An `IntegrationError` (`openrouter_*`) as `agent_failed` with its reason; other throws too. */
function failureOf(thrown: unknown): AgentError {
  const code = (thrown as { code?: unknown } | null)?.code;
  const params = (thrown as { params?: unknown } | null)?.params;
  if (typeof code === 'string' && code.startsWith('openrouter_')) {
    return error('agent_failed', {
      provider: 'openrouter',
      reason: code,
      ...(params && typeof params === 'object' ? params : {}),
    });
  }
  return error('agent_failed', {
    provider: 'openrouter',
    reason: 'openrouter_error',
    detail: detailOf(thrown),
  });
}

type Parsed =
  | { success: true; data: z.output<typeof JudgeAnswerSchema> }
  | { success: false; issues: { path: PropertyKey[]; code: string }[] };

function parseAnswer(text: string): Parsed {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { success: false, issues: [{ path: [], code: 'invalid_json' }] };
  }
  const parsed = JudgeAnswerSchema.safeParse(json);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, issues: issuesOf(parsed.error) };
}

const result = (partial: Parameters<typeof agentResult<JudgeOutput>>[0]) =>
  agentResult<JudgeOutput>({ provider: 'openrouter', answeredModel: null, ...partial });

/** One judge call as the Change type stage records it: a session. */
export type JudgeCall = {
  model: string;
  provider: ModelProvider;
  result: AgentRunResult<JudgeOutput>;
};

/** The Claude judge took over from a failed OpenRouter call. */
export type JudgeFallback = {
  from: string;
  to: string;
  /** `openrouter_no_credits`, `openrouter_timeout`, `output_invalid`, ... with its params. */
  reason: { code: string; params: Record<string, unknown> };
};

export type JudgedWithFallback = {
  /** The answer the stage uses: the last call's. */
  result: AgentRunResult<JudgeOutput>;
  calls: JudgeCall[];
  fallback: JudgeFallback | null;
};

/**
 * Runs the judge on the provider its model names. An OpenRouter call that fails for any reason
 * but a cancel is followed by exactly one Claude call (`fallbackModel`), so the review goes on;
 * there is no retry of OpenRouter.
 */
export async function judgeWithFallback(
  judges: { claude: Judge; openRouter: Judge },
  input: JudgeInput,
  fallbackModel: string = DEFAULT_MODELS.judge,
): Promise<JudgedWithFallback> {
  if (!isOpenRouterModel(input.model)) {
    const result = await judges.claude.judge(input);
    return {
      result,
      calls: [{ model: input.model, provider: 'anthropic', result }],
      fallback: null,
    };
  }
  const first = await judges.openRouter.judge(input);
  const calls: JudgeCall[] = [{ model: input.model, provider: 'openrouter', result: first }];
  if (first.status !== 'failed') return { result: first, calls, fallback: null };

  const fallback: JudgeFallback = {
    from: input.model,
    to: fallbackModel,
    reason: fallbackReasonOf(first.error),
  };
  const second = await judges.claude.judge({ ...input, model: fallbackModel });
  calls.push({ model: fallbackModel, provider: 'anthropic', result: second });
  return { result: second, calls, fallback };
}

function fallbackReasonOf(failure: AgentError | null): JudgeFallback['reason'] {
  if (!failure) return { code: 'agent_failed', params: {} };
  const { reason, ...params } = failure.params;
  return typeof reason === 'string' ? { code: reason, params } : { code: failure.code, params };
}
