import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  query as sdkQuery,
  type Options,
  type SDKMessage,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentRole } from '@pra/core';
import { z } from 'zod/v4';
import { costOf } from './prices.ts';
import {
  NO_USAGE,
  type AgentError,
  type AgentErrorCode,
  type AgentRunInput,
  type AgentRunner,
  type AgentRunResult,
  type AgentUsage,
} from './runner.ts';

/** The SDK's `query()`, or a test double with the same shape. */
export type QueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

/**
 * Built-in tools per role. Nobody gets a shell; the reviewer only reads its worktree.
 * P-06 adds the verifier and implementer here.
 */
export const ROLE_TOOLS: Partial<Record<AgentRole, readonly string[]>> = Object.freeze({
  reviewer: Object.freeze(['Read', 'Grep', 'Glob']),
});

export type ClaudeAgentRunnerOptions = {
  /** `ANTHROPIC_API_KEY`; without it every run fails with `model_access_not_configured`. */
  apiKey: string | undefined;
  query?: QueryFn;
  now?: () => number;
};

/** `AgentRunner` on the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). */
export class ClaudeAgentRunner implements AgentRunner {
  readonly #apiKey: string | undefined;
  readonly #query: QueryFn;
  readonly #now: () => number;

  constructor(options: ClaudeAgentRunnerOptions) {
    this.#apiKey = options.apiKey || undefined;
    this.#query = options.query ?? sdkQuery;
    this.#now = options.now ?? Date.now;
  }

  async run<T>(input: AgentRunInput<T>): Promise<AgentRunResult<T>> {
    const startedAt = this.#now();
    const notStarted = (code: AgentErrorCode, params: Record<string, unknown> = {}) =>
      result<T>({ status: code === 'cancelled' ? 'cancelled' : 'failed', error: { code, params } });

    if (!this.#apiKey) return notStarted('model_access_not_configured');
    const tools = ROLE_TOOLS[input.role];
    if (!tools) return notStarted('role_not_supported', { role: input.role });
    if (input.signal?.aborted) return notStarted('cancelled');

    // Linked before the first await, so a cancel at any moment reaches the session.
    const abort = new AbortController();
    const cancel = () => abort.abort();
    input.signal?.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, input.timeoutMs);

    const meter = new UsageMeter(input.model);
    const transcript: unknown[] = [];
    let final: SDKResultMessage | undefined;
    let costStopped = false;
    let thrown: unknown;
    let home: string | undefined;

    try {
      home = await mkdtemp(path.join(tmpdir(), 'pra-agent-'));
      if (abort.signal.aborted) throw new Error('aborted before the session started');
      const messages = this.#query({
        prompt: input.prompt,
        options: this.#options(input, tools, home, abort),
      });
      for await (const message of messages) {
        transcript.push(message);
        if (message.type === 'result') {
          final = message;
        } else if (message.type === 'assistant') {
          meter.add(message.message.id, message.message.usage);
          input.onProgress?.({ turns: meter.turns, costUsd: meter.costUsd, usage: meter.usage });
          if (meter.costUsd > input.maxCostUsd) {
            costStopped = true;
            abort.abort();
            break;
          }
        }
      }
    } catch (error) {
      thrown = error;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', cancel);
      if (home) await rm(home, { recursive: true, force: true });
    }

    // A session that finished keeps its result. One we stopped (cost, timeout, cancel) is
    // explained by why we stopped it, even if the SDK still sent an error result.
    if (final && (final.subtype === 'success' || !abort.signal.aborted)) {
      return fromResult(final, input, transcript);
    }

    const spent = final
      ? reportedSpend(final, transcript)
      : {
          usage: meter.usage,
          costUsd: meter.costUsd,
          costSource: 'computed' as const,
          turns: meter.turns,
          durationMs: this.#now() - startedAt,
          transcript,
        };
    if (costStopped) {
      return result<T>({
        ...spent,
        status: 'failed',
        error: error('cost_limit_reached', {
          maxCostUsd: input.maxCostUsd,
          costUsd: spent.costUsd,
        }),
      });
    }
    if (timedOut) {
      return result<T>({
        ...spent,
        status: 'failed',
        error: error('timeout', { timeoutMs: input.timeoutMs }),
      });
    }
    if (abort.signal.aborted) {
      return result<T>({ ...spent, status: 'cancelled', error: error('cancelled') });
    }
    return result<T>({
      ...spent,
      status: 'failed',
      error: error('agent_failed', thrown ? { detail: detailOf(thrown) } : { detail: 'no_result' }),
    });
  }

  #options(
    input: AgentRunInput<unknown>,
    tools: readonly string[],
    home: string,
    abort: AbortController,
  ): Options {
    return {
      model: input.model,
      cwd: input.cwd,
      additionalDirectories: input.readDirs ?? [],
      ...(input.systemPrompt === undefined ? {} : { systemPrompt: input.systemPrompt }),
      tools: [...tools],
      allowedTools: [...tools],
      // Anything not pre-approved is denied, never asked.
      permissionMode: 'dontAsk',
      // No user or project settings: no hooks, skills or CLAUDE.md from the machine or the PR.
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
      // Replaces the whole environment: the agent sees the model key and nothing else.
      env: {
        ANTHROPIC_API_KEY: this.#apiKey,
        PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: home,
      },
      maxTurns: input.maxTurns,
      maxBudgetUsd: input.maxCostUsd,
      abortController: abort,
      outputFormat: { type: 'json_schema', schema: jsonSchemaOf(input.outputSchema) },
    };
  }
}

/** `ClaudeAgentRunner` with the key from `ANTHROPIC_API_KEY`. */
export function createClaudeAgentRunner(env: NodeJS.ProcessEnv = process.env): ClaudeAgentRunner {
  return new ClaudeAgentRunner({ apiKey: env.ANTHROPIC_API_KEY });
}

/** Sums usage over assistant messages; the SDK repeats a message (same id) once per content block. */
class UsageMeter {
  readonly #model: string;
  readonly #byMessage = new Map<string, AgentUsage>();

  constructor(model: string) {
    this.#model = model;
  }

  add(messageId: string, usage: SdkUsage | undefined): void {
    if (!usage) return;
    this.#byMessage.set(messageId, toUsage(usage));
  }

  get turns(): number {
    return this.#byMessage.size;
  }

  get usage(): AgentUsage {
    const total = { ...NO_USAGE };
    for (const usage of this.#byMessage.values()) {
      total.inputTokens += usage.inputTokens;
      total.outputTokens += usage.outputTokens;
      total.cacheReadTokens += usage.cacheReadTokens;
      total.cacheWriteTokens += usage.cacheWriteTokens;
    }
    return total;
  }

  get costUsd(): number {
    return costOf(this.#model, this.usage);
  }
}

type SdkUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

function toUsage(usage: SdkUsage): AgentUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

const RESULT_ERRORS: Record<Exclude<SDKResultMessage['subtype'], 'success'>, AgentErrorCode> = {
  error_max_turns: 'max_turns_reached',
  error_max_budget_usd: 'cost_limit_reached',
  error_max_structured_output_retries: 'output_invalid',
  error_during_execution: 'agent_failed',
};

function reportedSpend(final: SDKResultMessage, transcript: unknown[]) {
  return {
    usage: toUsage(final.usage),
    costUsd: final.total_cost_usd,
    costSource: 'reported' as const,
    turns: final.num_turns,
    durationMs: final.duration_ms,
    transcript,
  };
}

function fromResult<T>(
  final: SDKResultMessage,
  input: AgentRunInput<T>,
  transcript: unknown[],
): AgentRunResult<T> {
  const reported = reportedSpend(final, transcript);
  if (final.subtype !== 'success') {
    const code = RESULT_ERRORS[final.subtype] ?? 'agent_failed';
    return result<T>({
      ...reported,
      status: 'failed',
      error: error(code, { subtype: final.subtype }),
    });
  }
  const parsed = input.outputSchema.safeParse(final.structured_output);
  if (!parsed.success) {
    return result<T>({
      ...reported,
      status: 'failed',
      error: error('output_invalid', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code })),
      }),
    });
  }
  return result<T>({ ...reported, status: 'completed', output: parsed.data });
}

function result<T>(
  partial: Partial<AgentRunResult<T>> & Pick<AgentRunResult<T>, 'status'>,
): AgentRunResult<T> {
  return {
    output: null,
    error: null,
    usage: { ...NO_USAGE },
    costUsd: 0,
    costSource: 'computed',
    turns: 0,
    durationMs: 0,
    transcript: [],
    ...partial,
  };
}

function error(code: AgentErrorCode, params: Record<string, unknown> = {}): AgentError {
  return { code, params };
}

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function detailOf(thrown: unknown): string {
  const text = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
  return text.slice(0, 500);
}
