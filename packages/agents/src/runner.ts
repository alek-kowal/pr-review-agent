import type { AgentRole, ModelProvider } from '@pra/core';
import type { ZodType } from 'zod/v4';

/** Runs one agent session. Adapters exist per SDK; tests use `FakeAgentRunner`. */
export interface AgentRunner {
  run<T>(input: AgentRunInput<T>): Promise<AgentRunResult<T>>;
}

export type AgentRunInput<T> = {
  role: AgentRole;
  /** From the frozen level (core `modelFor`). */
  model: string;
  /** The session's working directory: the run's worktree. */
  cwd: string;
  prompt: string;
  systemPrompt?: string;
  /** Extra read-only directories, e.g. the materialised instruction files. */
  readDirs?: string[];
  /** The answer's shape; the SDK enforces it as JSON schema and the runner parses it back. */
  outputSchema: ZodType<T>;
  maxTurns: number;
  /** The session is stopped once its cost passes this. */
  maxCostUsd: number;
  /** Wall-clock limit (the stage timeout); past it the session is stopped with `timeout`. */
  timeoutMs: number;
  /** Aborting it cancels the session (run cancel, S-09). */
  signal?: AbortSignal;
  /**
   * Called after every assistant turn with running totals: turns, tokens and the cost of that
   * usage at the model's price (spent money, never an estimate). The worker stores it live
   * (S-03-T3); the final cost is the SDK's reported total in the result.
   */
  onProgress?: (progress: AgentProgress) => void;
};

export type AgentStatus = 'completed' | 'failed' | 'cancelled';

export const AGENT_ERROR_CODES = [
  'model_access_not_configured',
  'role_not_supported',
  'cost_limit_reached',
  'max_turns_reached',
  'output_invalid',
  'agent_failed',
  /** The Claude subscription's usage limit (P-25); params `{ resetsAt }` (ISO or null). */
  'usage_limit_reached',
  'timeout',
  'cancelled',
] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];
export type AgentError = { code: AgentErrorCode; params: Record<string, unknown> };

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/**
 * `reported`: the SDK's own total from its result message. `computed`: the session stopped before
 * a result, so the cost comes from the streamed usage and the price table (NFR Cost truth).
 */
export type CostSource = 'reported' | 'computed';

export type AgentRunResult<T> = {
  status: AgentStatus;
  /** The parsed answer; only when `status` is `completed`. */
  output: T | null;
  error: AgentError | null;
  usage: AgentUsage;
  costUsd: number;
  costSource: CostSource;
  turns: number;
  durationMs: number;
  /** Every message the SDK sent, in order (stored as the session transcript). */
  transcript: unknown[];
  /** Where the call ran (P-26); unset means Anthropic. */
  provider?: ModelProvider;
  /** The model that actually answered, when the provider says (OpenRouter routes); else unset. */
  answeredModel?: string | null;
};

export type AgentProgress = {
  turns: number;
  costUsd: number;
  usage: AgentUsage;
};

export const NO_USAGE: AgentUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});
