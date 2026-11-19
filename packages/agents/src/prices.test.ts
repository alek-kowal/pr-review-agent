import { describe, expect, it } from 'vitest';
import { costOf, MODEL_PRICES, priceOf } from './prices.ts';
import { NO_USAGE } from './runner.ts';

const MILLION = 1_000_000;

describe('prices', () => {
  it('prices a request at the list price per million tokens', () => {
    expect(costOf('claude-opus-5-5', { ...NO_USAGE, inputTokens: MILLION })).toBe(4);
    expect(costOf('claude-fable-5-2', { ...NO_USAGE, outputTokens: MILLION })).toBe(40);
  });

  it('prices a Haiku 5.5 request over 100K prompt tokens at the long-prompt rate', () => {
    const short = { ...NO_USAGE, inputTokens: 100_000, outputTokens: 1_000 };
    const long = { ...NO_USAGE, inputTokens: 60_000, cacheReadTokens: 40_001, outputTokens: 1_000 };

    expect(costOf('claude-haiku-5-5', short)).toBeCloseTo((100_000 * 0.1 + 1_000 * 0.5) / MILLION);
    expect(costOf('claude-haiku-5-5', long)).toBeCloseTo(
      (60_000 * 0.5 + 40_001 * 0.05 + 1_000 * 2.5) / MILLION,
    );
  });

  it('prices an unknown model above every known one, so the guard never under-counts', () => {
    const unknown = priceOf('claude-fable-5-1');
    for (const known of Object.values(MODEL_PRICES)) {
      expect(unknown.input).toBeGreaterThanOrEqual(known.input);
      expect(unknown.output).toBeGreaterThanOrEqual(known.output);
    }
    expect(priceOf('claude-opus-5-5[1m]')).toBe(MODEL_PRICES['claude-opus-5-5']);
  });
});
