import { HttpOpenRouterClient } from '@pra/integrations';
import { FakeOpenRouterClient, openRouterChat, openRouterError } from '@pra/integrations/testing';
import { describe, expect, test } from 'vitest';
import { FakeJudge } from '../testing/fake-judge.ts';
import { judgeRequest, type JudgeInput } from './judge.ts';
import { createOpenRouterJudge, judgeWithFallback, OpenRouterJudge } from './openrouter-judge.ts';

const JEV = 'openrouter/typesafe/jev-router';
const KEY = 'sk-or-v1-never-in-output';

const input: JudgeInput = {
  model: JEV,
  instructions: {
    prompt: 'Read {{knowledgeDir}}/classify-rules.md. The task is in task.md, paths in files.txt.',
    rules: '# Rules\nPick the higher tier when unsure.',
  },
  task: 'Add a retry button to the export dialog.',
  changedFiles: ['apps/web/src/export/Dialog.tsx'],
};

/** A clock that moves 250 ms per read. */
const ticking = () => {
  let t = 1_000;
  return () => (t += 250);
};

describe('OpenRouterJudge', () => {
  test('maps the answer and records cost, tokens, latency and the model that answered', async () => {
    const client = new FakeOpenRouterClient(
      openRouterChat(
        { tier: 'one-way', reason: 'It changes a public contract.' },
        {
          model: 'acme/routed-small',
          usage: {
            prompt_tokens: 1500,
            completion_tokens: 30,
            cost: 0.00031,
            prompt_tokens_details: { cached_tokens: 500 },
          },
        },
      ),
    );
    const result = await new OpenRouterJudge({ client, now: ticking() }).judge(input);

    expect(result.status).toBe('completed');
    expect(result.output).toEqual({
      changeType: 'one_way_door',
      reason: 'It changes a public contract.',
    });
    expect(result).toMatchObject({
      provider: 'openrouter',
      answeredModel: 'acme/routed-small',
      costUsd: 0.00031,
      costSource: 'reported',
      turns: 1,
      durationMs: 250,
      usage: { inputTokens: 1000, cacheReadTokens: 500, outputTokens: 30, cacheWriteTokens: 0 },
    });
  });

  test('sends only the Claude judge message, a strict schema and data_collection: deny', async () => {
    const client = new FakeOpenRouterClient();
    await new OpenRouterJudge({ client }).judge(input);

    expect(client.requests).toHaveLength(1);
    const request = client.requests[0]!;
    expect(Object.keys(request).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'provider',
      'response_format',
      'usage',
    ]);
    expect(request.model).toBe('typesafe/jev-router');
    expect(request.messages).toEqual([
      { role: 'user', content: judgeRequest(input).messages[0]!.content },
    ]);
    expect(request.provider).toEqual({ data_collection: 'deny' });
    expect(request.usage).toEqual({ include: true });
    expect(request.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'judge_answer',
        strict: true,
        schema: { properties: { tier: { enum: ['composes', 'extends', 'one-way'] } } },
      },
    });
  });

  test.each([
    ['not JSON', 'Sure! It extends.', [{ path: [], code: 'invalid_json' }]],
    ['an unknown tier', JSON.stringify({ tier: 'huge', reason: 'x' }), [{ path: ['tier'] }]],
  ])('an answer that is %s fails output_invalid, with its cost kept', async (_, text, issues) => {
    const client = new FakeOpenRouterClient(openRouterChat(text));
    const result = await new OpenRouterJudge({ client }).judge(input);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('output_invalid');
    expect(result.error?.params).toMatchObject({ provider: 'openrouter', finishReason: 'stop' });
    expect(result.error?.params.issues).toMatchObject(issues);
    expect(result.costUsd).toBe(0.00042);
  });

  test('without a cost figure it prices the tokens at the highest list price', async () => {
    const client = new FakeOpenRouterClient(
      openRouterChat(undefined, { usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } }),
    );
    const result = await new OpenRouterJudge({ client }).judge(input);
    expect(result.costSource).toBe('computed');
    expect(result.costUsd).toBe(10);
  });

  test('an OpenRouter error fails agent_failed with its reason', async () => {
    const client = new FakeOpenRouterClient(
      openRouterError('openrouter_no_credits', { status: 402, detail: 'Insufficient credits' }),
    );
    const result = await new OpenRouterJudge({ client }).judge(input);
    expect(result.status).toBe('failed');
    expect(result.error).toEqual({
      code: 'agent_failed',
      params: {
        provider: 'openrouter',
        reason: 'openrouter_no_credits',
        status: 402,
        detail: 'Insufficient credits',
      },
    });
  });

  test('without OPENROUTER_API_KEY it fails model_access_not_configured, naming the key', async () => {
    const result = await createOpenRouterJudge({}).judge(input);
    expect(result.status).toBe('failed');
    expect(result.error).toEqual({
      code: 'model_access_not_configured',
      params: { provider: 'openrouter', missing: ['OPENROUTER_API_KEY'] },
    });
  });

  test('a cancelled call is cancelled, not failed', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new OpenRouterJudge({ client: new FakeOpenRouterClient() }).judge({
      ...input,
      signal: controller.signal,
    });
    expect(result.status).toBe('cancelled');
  });

  test('the key never reaches the result, its transcript or its error', async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ error: { code: 401, message: `bad key ${KEY}` } }), {
        status: 401,
      })) as unknown as typeof globalThis.fetch;
    const client = new HttpOpenRouterClient({ apiKey: KEY, fetch });
    const result = await new OpenRouterJudge({ client }).judge(input);

    expect(result.error?.params.reason).toBe('openrouter_auth_failed');
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});

describe('judgeWithFallback', () => {
  const claudeAnswer = { changeType: 'changes_behaviour' as const, reason: 'Claude says so.' };

  test('a Claude model goes straight to the Claude judge', async () => {
    const claude = new FakeJudge([claudeAnswer]);
    const openRouter = new FakeJudge();
    const judged = await judgeWithFallback(
      { claude, openRouter },
      { ...input, model: 'claude-haiku-5-5' },
    );
    expect(judged.fallback).toBeNull();
    expect(judged.calls.map((c) => [c.provider, c.model])).toEqual([
      ['anthropic', 'claude-haiku-5-5'],
    ]);
    expect(openRouter.calls).toHaveLength(0);
  });

  test('an OpenRouter answer is used as it is', async () => {
    const openRouter = new OpenRouterJudge({ client: new FakeOpenRouterClient() });
    const claude = new FakeJudge();
    const judged = await judgeWithFallback({ claude, openRouter }, input);
    expect(judged.result.output?.changeType).toBe('changes_behaviour');
    expect(judged.fallback).toBeNull();
    expect(judged.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(0);
  });

  test.each([
    [
      'no credits',
      openRouterError('openrouter_no_credits', { status: 402 }),
      'openrouter_no_credits',
    ],
    [
      'a timeout',
      openRouterError('openrouter_timeout', { timeoutMs: 60000 }),
      'openrouter_timeout',
    ],
    ['an invalid answer', openRouterChat('nope'), 'output_invalid'],
  ])('on %s it falls back to one Claude call and records why', async (_, reply, code) => {
    const openRouter = new OpenRouterJudge({ client: new FakeOpenRouterClient(reply) });
    const claude = new FakeJudge([claudeAnswer]);
    const judged = await judgeWithFallback({ claude, openRouter }, input);

    expect(judged.result.status).toBe('completed');
    expect(judged.result.output).toEqual(claudeAnswer);
    expect(judged.fallback).toMatchObject({ from: JEV, to: 'claude-haiku-5-5', reason: { code } });
    expect(judged.calls.map((c) => [c.provider, c.model, c.result.status])).toEqual([
      ['openrouter', JEV, 'failed'],
      ['anthropic', 'claude-haiku-5-5', 'completed'],
    ]);
    expect(claude.calls[0]!.model).toBe('claude-haiku-5-5');
  });

  test('a missing key falls back too, with model_access_not_configured', async () => {
    const claude = new FakeJudge([claudeAnswer]);
    const judged = await judgeWithFallback(
      { claude, openRouter: new OpenRouterJudge({ client: null }) },
      input,
    );
    expect(judged.fallback?.reason).toEqual({
      code: 'model_access_not_configured',
      params: { provider: 'openrouter', missing: ['OPENROUTER_API_KEY'] },
    });
  });

  test('a cancel does not fall back, and a failing Claude call is not retried', async () => {
    const controller = new AbortController();
    controller.abort();
    const claude = new FakeJudge();
    const cancelled = await judgeWithFallback(
      { claude, openRouter: new OpenRouterJudge({ client: new FakeOpenRouterClient() }) },
      { ...input, signal: controller.signal },
    );
    expect(cancelled.result.status).toBe('cancelled');
    expect(claude.calls).toHaveLength(0);

    const failing = new FakeJudge([{ fail: 'agent_failed' }]);
    const judged = await judgeWithFallback(
      { claude: failing, openRouter: new OpenRouterJudge({ client: null }) },
      input,
    );
    expect(judged.result.status).toBe('failed');
    expect(judged.calls).toHaveLength(2);
  });
});
