import { describe, expect, it } from 'vitest';
import {
  invalidRunModel,
  openRouterConfigured,
  openRouterModelId,
  providerOf,
  RoleModelsSchema,
  validModelNameFor,
  validOpenRouterModel,
} from '../src/index.ts';

const JEV = 'openrouter/typesafe/jev-router';

describe('OpenRouter models (P-26)', () => {
  it('reads openrouter/<vendor>/<model> and strips the prefix for OpenRouter', () => {
    expect(validOpenRouterModel(JEV)).toBe(true);
    expect(validOpenRouterModel('openrouter/openai/gpt-5-mini:free')).toBe(true);
    expect(validOpenRouterModel('openrouter/typesafe')).toBe(false);
    expect(validOpenRouterModel('openrouter/a/b/c')).toBe(false);
    expect(validOpenRouterModel('openrouter/-x/y')).toBe(false);
    expect(validOpenRouterModel('openrouter/a b/c')).toBe(false);
    expect(openRouterModelId(JEV)).toBe('typesafe/jev-router');
    expect(providerOf(JEV)).toBe('openrouter');
    expect(providerOf('claude-haiku-5-5')).toBe('anthropic');
  });

  it('lets only the judge pick an OpenRouter model', () => {
    expect(validModelNameFor('judge', JEV)).toBe(true);
    expect(validModelNameFor('judge', 'claude-haiku-5-5')).toBe(true);
    expect(validModelNameFor('reviewer', JEV)).toBe(false);
    expect(validModelNameFor('analyst', JEV)).toBe(false);
  });

  it('Settings → Models accepts it for the judge only', () => {
    const models = {
      reviewer: 'claude-opus-5-5',
      verifier: 'claude-sonnet-5-5',
      implementer: 'claude-opus-5-5',
      judge: JEV,
      analyst: 'claude-sonnet-5-5',
    };
    expect(RoleModelsSchema.safeParse(models).success).toBe(true);
    const wrong = RoleModelsSchema.safeParse({ ...models, reviewer: JEV });
    expect(wrong.success).toBe(false);
    expect(wrong.error?.issues[0]).toMatchObject({
      path: ['reviewer'],
      message: 'invalid_model_name',
    });
  });

  it('a run may freeze an OpenRouter judge, not an OpenRouter reviewer', () => {
    expect(invalidRunModel({ judge: { model: JEV, source: 'settings', level: null } })).toBeNull();
    expect(
      invalidRunModel({ reviewer: { model: JEV, source: 'settings', level: null } }),
    ).toMatchObject({ code: 'model_invalid', params: { role: 'reviewer' } });
  });

  it('the key counts as set only when it is not blank', () => {
    expect(openRouterConfigured({})).toBe(false);
    expect(openRouterConfigured({ OPENROUTER_API_KEY: ' ' })).toBe(false);
    expect(openRouterConfigured({ OPENROUTER_API_KEY: 'x' })).toBe(true);
  });
});
