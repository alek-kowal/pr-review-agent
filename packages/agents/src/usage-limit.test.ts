import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { ClaudeAgentRunner, type QueryFn } from './claude-agent-runner.ts';
import { AnthropicJudge } from './judge/judge.ts';
import { usageLimitOf } from './usage-limit.ts';

// Shapes from SDK 0.3.328 `sdk.d.ts` (P-25).
const RESET_SECONDS = Date.parse('2026-11-19T15:00:00Z') / 1000;
const rejected = {
  type: 'rate_limit_event',
  rate_limit_info: { status: 'rejected', resetsAt: RESET_SECONDS, rateLimitType: 'five_hour' },
};
const limitText = {
  type: 'assistant',
  error: 'rate_limit',
  message: { id: 'm1', content: [{ type: 'text', text: "You've hit your limit · resets 3pm" }] },
};
const errorResult = {
  type: 'result',
  subtype: 'success',
  is_error: true,
  result: "You've hit your limit · resets 3pm",
  duration_ms: 900,
  num_turns: 1,
  total_cost_usd: 0,
  usage: { input_tokens: 0, output_tokens: 0 },
};
const okResult = { ...errorResult, is_error: false, result: 'done' };

const queryOf =
  (messages: unknown[], thrown?: Error): QueryFn =>
  () =>
    (async function* () {
      for (const message of messages) yield message as SDKMessage;
      if (thrown) throw thrown;
    })();

describe('usageLimitOf', () => {
  it('reads the reset from a rejected rate limit event of a session that ended in error', () => {
    expect(usageLimitOf([rejected, limitText, errorResult])).toEqual({
      resetsAt: '2026-11-19T15:00:00.000Z',
    });
  });

  it('knows the limit by its text when no event names a reset', () => {
    expect(usageLimitOf([limitText, errorResult])).toEqual({ resetsAt: null });
    expect(usageLimitOf([], new Error(`Claude AI usage limit reached|${RESET_SECONDS}`))).toEqual({
      resetsAt: '2026-11-19T15:00:00.000Z',
    });
  });

  it('is no limit when the session finished, or on a bare rate limit error', () => {
    expect(usageLimitOf([rejected, okResult])).toBeNull();
    const bare = { ...limitText, message: { id: 'm1', content: [{ type: 'text', text: '429' }] } };
    expect(usageLimitOf([bare, { ...errorResult, result: 'API Error: 429' }])).toBeNull();
    expect(usageLimitOf([], new Error('process exited with code 1'))).toBeNull();
  });
});

describe('ClaudeAgentRunner on a usage limit', () => {
  const input = {
    role: 'reviewer' as const,
    model: 'claude-sonnet-5-5',
    cwd: '/tmp/worktree',
    prompt: 'Review.',
    outputSchema: z.object({ ok: z.boolean() }),
    maxTurns: 5,
    maxCostUsd: 5,
    timeoutMs: 60_000,
  };

  it('fails with usage_limit_reached and the reset instead of output_invalid', async () => {
    const query = queryOf([rejected, limitText, errorResult]);
    const result = await new ClaudeAgentRunner({ oauthToken: 'oat', query }).run(input);
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'usage_limit_reached', params: { resetsAt: '2026-11-19T15:00:00.000Z' } },
      costSource: 'reported',
    });
    expect(result.transcript).toHaveLength(3);
  });

  it('maps a stream that throws the old CLI text', async () => {
    const thrown = new Error(`Claude AI usage limit reached|${RESET_SECONDS}`);
    const query = queryOf([], thrown);
    const result = await new ClaudeAgentRunner({ oauthToken: 'oat', query }).run(input);
    expect(result.error).toEqual({
      code: 'usage_limit_reached',
      params: { resetsAt: '2026-11-19T15:00:00.000Z' },
    });
  });

  it('fails any other error result with agent_failed', async () => {
    const query = queryOf([{ ...errorResult, result: 'API Error: 500' }]);
    const result = await new ClaudeAgentRunner({ oauthToken: 'oat', query }).run(input);
    expect(result.error).toEqual({ code: 'agent_failed', params: { subtype: 'success' } });
  });
});

describe('AgentSdkMessages on a usage limit', () => {
  it('lets the judge fail with usage_limit_reached', async () => {
    const query = queryOf([rejected, limitText, errorResult]);
    const result = await new AnthropicJudge({ oauthToken: 'oat', query }).judge({
      model: 'claude-haiku-5-5',
      instructions: { prompt: 'Classify.', rules: 'rules' },
      task: 'Add a button',
      changedFiles: ['src/a.ts'],
    });
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'usage_limit_reached', params: { resetsAt: '2026-11-19T15:00:00.000Z' } },
    });
  });
});
