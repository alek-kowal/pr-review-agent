import { existsSync } from 'node:fs';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { ClaudeAgentRunner, type QueryFn } from './claude-agent-runner.ts';
import { costOf } from './prices.ts';
import type { AgentRunInput } from './runner.ts';

const Answer = z.object({ verdict: z.enum(['ok', 'not_ok']), notes: z.array(z.string()) });
type Answer = z.infer<typeof Answer>;

const MODEL = 'claude-sonnet-5-5';

function input(overrides: Partial<AgentRunInput<Answer>> = {}): AgentRunInput<Answer> {
  return {
    role: 'reviewer',
    model: MODEL,
    cwd: '/tmp/worktree',
    prompt: 'Review the diff.',
    outputSchema: Answer,
    maxTurns: 20,
    maxCostUsd: 5,
    timeoutMs: 60_000,
    ...overrides,
  };
}

function assistant(id: string, usage: Record<string, number>): SDKMessage {
  return {
    type: 'assistant',
    message: { id, usage },
    parent_tool_use_id: null,
    uuid: `${id}-uuid`,
    session_id: 's1',
  } as unknown as SDKMessage;
}

function success(structured: unknown, extra: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1234,
    num_turns: 3,
    total_cost_usd: 0.42,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 5,
    },
    structured_output: structured,
    ...extra,
  } as unknown as SDKMessage;
}

function failure(subtype: string): SDKMessage {
  return { ...(success(undefined) as object), subtype } as unknown as SDKMessage;
}

/** A fake `query` that records its options and yields `messages`, honouring the abort signal. */
function fakeQuery(messages: SDKMessage[], options: { waitForAbort?: boolean } = {}) {
  const calls: Options[] = [];
  const query: QueryFn = (params) => {
    calls.push(params.options);
    const signal = params.options.abortController!.signal;
    return (async function* () {
      for (const message of messages) {
        if (signal.aborted) throw new Error('aborted');
        yield message;
      }
      if (options.waitForAbort) {
        if (signal.aborted) throw new Error('AbortError');
        await new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('AbortError'))),
        );
      }
    })();
  };
  return { query, calls };
}

const VALID: Answer = { verdict: 'ok', notes: ['looks fine'] };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ClaudeAgentRunner', () => {
  it('gives the reviewer exactly Read, Grep and Glob and a minimal environment', async () => {
    vi.stubEnv('GITHUB_APP_ID', '1');
    vi.stubEnv('CLICKUP_API_KEY', 'secret');
    vi.stubEnv('DATABASE_URL', 'postgres://x');
    const { query, calls } = fakeQuery([success(VALID)]);
    await new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run(
      input({ readDirs: ['/tmp/instructions'] }),
    );

    expect(calls).toHaveLength(1);
    const options = calls[0]!;
    expect(options.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(options.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
    expect(options.permissionMode).toBe('dontAsk');
    expect(options.settingSources).toEqual([]);
    expect(options.mcpServers).toEqual({});
    expect(options.strictMcpConfig).toBe(true);
    expect(options.model).toBe(MODEL);
    expect(options.cwd).toBe('/tmp/worktree');
    expect(options.additionalDirectories).toEqual(['/tmp/instructions']);
    expect(options.maxTurns).toBe(20);
    expect(Object.keys(options.env ?? {}).sort()).toEqual(['ANTHROPIC_API_KEY', 'HOME', 'PATH']);
    expect(options.env?.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(options.outputFormat).toMatchObject({
      type: 'json_schema',
      schema: { type: 'object', required: ['verdict', 'notes'] },
    });
    // The temporary HOME is removed after the session.
    expect(existsSync(options.env!.HOME!)).toBe(false);
  });

  it('returns the parsed answer with the cost reported by the SDK', async () => {
    const { query } = fakeQuery([
      assistant('m1', { input_tokens: 1, output_tokens: 1 }),
      success(VALID),
    ]);
    const result = await new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run(input());

    expect(result).toMatchObject({
      status: 'completed',
      output: VALID,
      error: null,
      costUsd: 0.42,
      costSource: 'reported',
      turns: 3,
      durationMs: 1234,
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 },
    });
    expect(result.transcript).toHaveLength(2);
  });

  it('stops the session once the computed cost passes the limit, counting each message once', async () => {
    const usage = { input_tokens: 100_000, output_tokens: 10_000, cache_read_input_tokens: 0 };
    // The SDK repeats an assistant message once per content block, with the same id.
    const { query, calls } = fakeQuery(
      [assistant('m1', usage), assistant('m1', usage), assistant('m2', usage), success(VALID)],
      { waitForAbort: true },
    );
    const progress = vi.fn();
    const result = await new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run(
      input({ maxCostUsd: 0.5, onProgress: progress }),
    );

    const perMessage = costOf(MODEL, {
      inputTokens: 100_000,
      outputTokens: 10_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(perMessage).toBeCloseTo(0.3);
    expect(result.status).toBe('failed');
    expect(result.error).toEqual({
      code: 'cost_limit_reached',
      params: { maxCostUsd: 0.5, costUsd: perMessage * 2 },
    });
    expect(result.costSource).toBe('computed');
    expect(result.costUsd).toBeCloseTo(0.6);
    expect(result.turns).toBe(2);
    expect(result.usage.inputTokens).toBe(200_000);
    expect(calls[0]!.abortController!.signal.aborted).toBe(true);
    expect(progress).toHaveBeenCalledTimes(3);
  });

  it('prices each message on its own, so two short Haiku 5.5 prompts stay at the short rate', async () => {
    const usage = { input_tokens: 60_000, output_tokens: 1_000, cache_read_input_tokens: 0 };
    const { query } = fakeQuery([assistant('m1', usage), assistant('m2', usage)], {
      waitForAbort: true,
    });
    const result = await new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run(
      input({ model: 'claude-haiku-5-5', maxCostUsd: 0.01 }),
    );

    // 120K prompt tokens in total, but each request is under the 100K long-prompt threshold.
    expect(result.usage.inputTokens).toBe(120_000);
    expect(result.costUsd).toBeCloseTo((2 * (60_000 * 0.1 + 1_000 * 0.5)) / 1_000_000);
  });

  it('fails with model_access_not_configured without starting a session when the key is missing', async () => {
    const query = vi.fn<QueryFn>();
    const result = await new ClaudeAgentRunner({ apiKey: '', query }).run(input());

    expect(query).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'model_access_not_configured', params: {} },
      costUsd: 0,
    });
  });

  it('fails with role_not_supported for a role without tools', async () => {
    const query = vi.fn<QueryFn>();
    const result = await new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run(
      input({ role: 'implementer' }),
    );
    expect(query).not.toHaveBeenCalled();
    expect(result.error).toEqual({ code: 'role_not_supported', params: { role: 'implementer' } });
  });

  it('is cancelled when the caller aborts mid-session', async () => {
    const controller = new AbortController();
    const { query, calls } = fakeQuery(
      [assistant('m1', { input_tokens: 1_000, output_tokens: 100 })],
      { waitForAbort: true },
    );
    const result = await new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run(
      input({
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    );

    expect(calls[0]!.abortController!.signal.aborted).toBe(true);
    expect(result).toMatchObject({
      status: 'cancelled',
      error: { code: 'cancelled', params: {} },
      costSource: 'computed',
      turns: 1,
    });
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('is cancelled without a session when the signal is already aborted', async () => {
    const query = vi.fn<QueryFn>();
    const result = await new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run(
      input({ signal: AbortSignal.abort() }),
    );
    expect(query).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
  });

  it('is cancelled without a session when the signal aborts while the session is being set up', async () => {
    const controller = new AbortController();
    const { query, calls } = fakeQuery([success(VALID)]);
    const pending = new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run(
      input({ signal: controller.signal }),
    );
    controller.abort();
    const result = await pending;

    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ status: 'cancelled', error: { code: 'cancelled' } });
  });

  it('stops the session with timeout once timeoutMs passes', async () => {
    const { query, calls } = fakeQuery(
      [assistant('m1', { input_tokens: 1_000, output_tokens: 100 })],
      { waitForAbort: true },
    );
    const result = await new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run(
      input({ timeoutMs: 20 }),
    );

    expect(calls[0]!.abortController!.signal.aborted).toBe(true);
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'timeout', params: { timeoutMs: 20 } },
      costSource: 'computed',
      turns: 1,
    });
  });

  it('reports a cancel, with the reported cost, when the SDK answers the abort with an error result', async () => {
    const controller = new AbortController();
    const query: QueryFn = (params) =>
      (async function* () {
        yield assistant('m1', { input_tokens: 10, output_tokens: 10 });
        const signal = params.options.abortController!.signal;
        if (!signal.aborted) {
          await new Promise((resolve) => signal.addEventListener('abort', resolve));
        }
        yield failure('error_during_execution');
      })();
    const result = await new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run(
      input({ signal: controller.signal, onProgress: () => controller.abort() }),
    );

    expect(result).toMatchObject({
      status: 'cancelled',
      error: { code: 'cancelled' },
      costUsd: 0.42,
      costSource: 'reported',
    });
  });

  it('fails with output_invalid when the structured answer does not match the schema', async () => {
    const { query } = fakeQuery([success({ verdict: 'maybe', notes: 'x' })]);
    const result = await new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run(input());

    expect(result.status).toBe('failed');
    expect(result.output).toBeNull();
    expect(result.error?.code).toBe('output_invalid');
    expect(result.costSource).toBe('reported');
  });

  it.each([
    ['error_max_turns', 'max_turns_reached'],
    ['error_max_budget_usd', 'cost_limit_reached'],
    ['error_max_structured_output_retries', 'output_invalid'],
    ['error_during_execution', 'agent_failed'],
  ])('maps the SDK result %s to %s', async (subtype, code) => {
    const { query } = fakeQuery([failure(subtype)]);
    const result = await new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run(input());

    expect(result).toMatchObject({
      status: 'failed',
      error: { code, params: { subtype } },
      costUsd: 0.42,
      costSource: 'reported',
    });
  });

  it('fails with agent_failed when the session throws before a result', async () => {
    const query: QueryFn = () =>
      (async function* () {
        yield assistant('m1', { input_tokens: 10, output_tokens: 10 });
        throw new Error('process exited with code 1');
      })();
    const result = await new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run(input());

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'agent_failed', params: { detail: 'Error: process exited with code 1' } },
      costSource: 'computed',
      turns: 1,
    });
  });
});
