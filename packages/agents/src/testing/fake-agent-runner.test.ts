import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import type { AgentRunInput } from '../runner.ts';
import { FakeAgentRunner } from './fake-agent-runner.ts';

const Answer = z.object({ verdict: z.enum(['ok', 'not_ok']) });

function input(): AgentRunInput<z.infer<typeof Answer>> {
  return {
    role: 'reviewer',
    model: 'claude-sonnet-5-5',
    cwd: '/tmp',
    prompt: 'p',
    outputSchema: Answer,
    maxTurns: 5,
    maxCostUsd: 1,
    timeoutMs: 60_000,
  };
}

describe('FakeAgentRunner', () => {
  it('answers each run with the next scripted step and records the input', async () => {
    const runner = new FakeAgentRunner([
      { output: { verdict: 'ok' }, costUsd: 0.1 },
      { fail: 'max_turns_reached' },
      { fail: 'cancelled' },
      { output: { verdict: 'perhaps' } },
    ]);

    await expect(runner.run(input())).resolves.toMatchObject({
      status: 'completed',
      output: { verdict: 'ok' },
      costUsd: 0.1,
      costSource: 'reported',
    });
    await expect(runner.run(input())).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'max_turns_reached' },
    });
    await expect(runner.run(input())).resolves.toMatchObject({ status: 'cancelled' });
    await expect(runner.run(input())).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'output_invalid' },
    });
    expect(runner.calls).toHaveLength(4);
    expect(runner.remaining).toBe(0);
    await expect(runner.run(input())).rejects.toThrow(/no scripted step/);
  });

  it('runs a function step with the input', async () => {
    const runner = new FakeAgentRunner().enqueue((received) => ({
      status: 'completed',
      output: { verdict: received.role === 'reviewer' ? 'ok' : 'not_ok' },
      error: null,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0,
      costSource: 'reported',
      turns: 1,
      durationMs: 1,
      transcript: [],
    }));
    await expect(runner.run(input())).resolves.toMatchObject({ output: { verdict: 'ok' } });
  });
});
