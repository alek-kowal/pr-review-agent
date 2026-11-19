import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { QueryFn } from './claude-agent-runner.ts';
import { AnthropicJudge } from './judge/judge.ts';
import { credentialsFrom, modelAccessOf, withoutSecret } from './model-access.ts';

describe('modelAccessOf', () => {
  it('picks the subscription over the API key, then the key, then none', () => {
    expect(modelAccessOf({ oauthToken: 'oat', apiKey: 'sk' })).toEqual({
      mode: 'subscription',
      secret: 'oat',
      env: { CLAUDE_CODE_OAUTH_TOKEN: 'oat' },
    });
    expect(modelAccessOf({ apiKey: 'sk' })).toEqual({
      mode: 'api_key',
      secret: 'sk',
      env: { ANTHROPIC_API_KEY: 'sk' },
    });
    expect(modelAccessOf({ oauthToken: '  ', apiKey: '' })).toEqual({ mode: 'none' });
    expect(modelAccessOf({})).toEqual({ mode: 'none' });
  });

  it('reads both names from the env', () => {
    expect(credentialsFrom({ CLAUDE_CODE_OAUTH_TOKEN: 'oat', ANTHROPIC_API_KEY: 'sk' })).toEqual({
      oauthToken: 'oat',
      apiKey: 'sk',
    });
  });

  it('redacts the active secret from text', () => {
    const access = modelAccessOf({ oauthToken: 'oat-1' });
    expect(withoutSecret('bad oat-1 here', access)).toBe('bad [redacted] here');
  });
});

describe('AnthropicJudge on a subscription', () => {
  const judgeInput = {
    model: 'claude-haiku-5-5',
    instructions: { prompt: 'Classify.', rules: 'rules' },
    task: 'Add a button',
    changedFiles: ['src/a.ts'],
  };

  it('runs one Agent SDK query with no tools and only the token in its env', async () => {
    const calls: Options[] = [];
    const query: QueryFn = (params) => {
      calls.push(params.options);
      return (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          uuid: 'u1',
          result: '',
          structured_output: { tier: 'extends', reason: 'Changes a flow.' },
          usage: { input_tokens: 10, output_tokens: 5 },
        } as unknown as SDKMessage;
      })();
    };
    const judge = new AnthropicJudge({ oauthToken: 'oat-test', apiKey: 'sk-test', query });
    const result = await judge.judge(judgeInput);

    expect(result).toMatchObject({
      status: 'completed',
      output: { changeType: 'changes_behaviour' },
    });
    expect(calls).toHaveLength(1);
    const options = calls[0]!;
    expect(options.tools).toEqual([]);
    expect(options.settingSources).toEqual([]);
    expect(options.model).toBe('claude-haiku-5-5');
    expect(Object.keys(options.env ?? {}).sort()).toEqual([
      'CLAUDE_CODE_OAUTH_TOKEN',
      'HOME',
      'PATH',
    ]);
    expect(options.outputFormat).toMatchObject({ type: 'json_schema' });
  });

  it('fails without a session when neither is set', async () => {
    const result = await new AnthropicJudge({}).judge(judgeInput);
    expect(result.error?.code).toBe('model_access_not_configured');
  });
});
