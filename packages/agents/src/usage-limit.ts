// P-25: the Claude subscription's usage limit, as the Agent SDK reports it (SDK 0.3.328
// `sdk.d.ts`): a `rate_limit_event` whose `rate_limit_info.status` is `rejected` (`resetsAt` in
// Unix seconds), an assistant message with text that starts with one of
// `USAGE_LIMIT_ERROR_PREFIXES` ("You've hit your limit · resets 3pm"), and a result with
// `is_error: true`. Older CLIs said "Claude AI usage limit reached|<unix seconds>".
import { USAGE_LIMIT_ERROR_PREFIXES } from '@anthropic-ai/claude-agent-sdk';

/** A session stopped by the usage limit; `resetsAt` (ISO) when the SDK named the reset. */
export type UsageLimit = { resetsAt: string | null };

const LEGACY_TEXT = /Claude AI usage limit reached(?:\|(\d{9,11}))?/;

/**
 * The usage limit that ended this session, or null. Only a session that ended in error counts
 * (no result, an error result, or `is_error`): a rejected event a session got past is not one.
 * `thrown` is the error the SDK's stream threw, if any. A bare `rate_limit` error (a per-minute
 * 429 on an API key) is no usage limit.
 */
export function usageLimitOf(transcript: readonly unknown[], thrown?: unknown): UsageLimit | null {
  const result = transcript.findLast((message) => typeOf(message) === 'result') as
    { subtype?: string; is_error?: boolean; result?: unknown; errors?: unknown } | undefined;
  if (result && result.subtype === 'success' && !result.is_error) return null;

  let limited = false;
  let resetsAt: string | null = null;
  const fromText = (text: unknown) => {
    if (typeof text !== 'string') return;
    const legacy = LEGACY_TEXT.exec(text);
    if (legacy) {
      limited = true;
      resetsAt = legacy[1] ? isoOfSeconds(Number(legacy[1])) : resetsAt;
    } else if (USAGE_LIMIT_ERROR_PREFIXES.some((prefix) => text.trimStart().startsWith(prefix))) {
      limited = true;
    }
  };

  for (const message of transcript) {
    const type = typeOf(message);
    if (type === 'rate_limit_event') {
      const info = (message as { rate_limit_info?: { status?: string; resetsAt?: number } })
        .rate_limit_info;
      if (info?.status === 'rejected') {
        limited = true;
        if (typeof info.resetsAt === 'number') resetsAt = isoOfSeconds(info.resetsAt);
      }
    } else if (type === 'assistant') {
      const content = (message as { message?: { content?: unknown } }).message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && 'text' in block) fromText(block.text);
        }
      }
    }
  }
  fromText(result?.result);
  if (Array.isArray(result?.errors)) result.errors.forEach(fromText);
  if (thrown !== undefined) fromText(thrown instanceof Error ? thrown.message : String(thrown));
  return limited ? { resetsAt } : null;
}

/**
 * Thrown by `AgentSdkMessages` (the judge's and the analyst's one call on a subscription) when
 * the call hit the usage limit; the adapters map it to `usage_limit_reached`.
 */
export class UsageLimitError extends Error {
  readonly resetsAt: string | null;

  constructor(limit: UsageLimit) {
    super('usage_limit_reached');
    this.name = 'UsageLimitError';
    this.resetsAt = limit.resetsAt;
  }
}

function typeOf(message: unknown): unknown {
  return message && typeof message === 'object' && 'type' in message ? message.type : undefined;
}

function isoOfSeconds(seconds: number): string | null {
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
