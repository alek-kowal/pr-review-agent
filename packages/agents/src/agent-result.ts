import { z } from 'zod/v4';
import {
  NO_USAGE,
  type AgentError,
  type AgentErrorCode,
  type AgentRunResult,
  type AgentUsage,
} from './runner.ts';

/** An `AgentRunResult` with empty usage, no output and no error unless given. */
export function agentResult<T>(
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

export function agentError(code: AgentErrorCode, params: Record<string, unknown> = {}): AgentError {
  return { code, params };
}

/** Token usage as both Anthropic SDKs report it. */
export type ApiUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function toUsage(usage: ApiUsage): AgentUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/** The JSON schema the API enforces for `schema`, without the `$schema` key. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** Zod issues reduced to path and code (no input values in stored errors). */
export function issuesOf(error: z.ZodError): { path: PropertyKey[]; code: string }[] {
  return error.issues.map((issue) => ({ path: issue.path, code: issue.code }));
}

export function detailOf(thrown: unknown): string {
  const text = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
  return text.slice(0, 500);
}
