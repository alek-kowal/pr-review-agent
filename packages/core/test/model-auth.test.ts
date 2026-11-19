import { describe, expect, it } from 'vitest';
import { alertCommentText, modelAuthModeOf, MODEL_SECRET_ENV_NAMES, reason } from '../src/index.ts';

describe('modelAuthModeOf', () => {
  it('prefers the subscription token, then the API key; blank counts as unset', () => {
    expect(modelAuthModeOf({ CLAUDE_CODE_OAUTH_TOKEN: 'oat', ANTHROPIC_API_KEY: 'sk' })).toBe(
      'subscription',
    );
    expect(modelAuthModeOf({ ANTHROPIC_API_KEY: 'sk' })).toBe('api_key');
    expect(modelAuthModeOf({ CLAUDE_CODE_OAUTH_TOKEN: ' ', ANTHROPIC_API_KEY: '' })).toBe('none');
    expect(modelAuthModeOf({})).toBe('none');
  });

  it('lists both secret names', () => {
    expect([...MODEL_SECRET_ENV_NAMES].sort()).toEqual([
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
    ]);
  });
});

describe('alert comment on a subscription', () => {
  it('labels the amounts API-equivalent once per pair', () => {
    const text = alertCommentText({
      title: reason('alert_budget', { percent: 100, spentUsd: 12, budgetUsd: 10 }),
      nextStep: reason('alert_next_budget'),
      prNumber: null,
      link: 'http://app/activity',
      apiEquivalent: true,
    });
    expect(text).toContain('Daily budget reached: $12.00 of $10.00 API-equivalent.');
  });
});
