import type { AgentUsage } from './runner.ts';

/** US dollars per million tokens. */
export type ModelPrice = {
  input: number;
  output: number;
  cacheRead: number;
  /** 5-minute cache writes: 1.25 × input. */
  cacheWrite: number;
};

/**
 * Anthropic first-party API prices (claude-api skill model table, cached 2026-11-03). Used only
 * when a session stops before the SDK reports its own cost. Haiku 5.5 is priced at its rate for
 * prompts up to 100K tokens; its cache read is 0.1 × input.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
});

/** The most expensive known price: an unknown model is never under-counted by the cost guard. */
const FALLBACK_PRICE: ModelPrice = Object.values(MODEL_PRICES).reduce((max, price) =>
  price.output > max.output ? price : max,
);

/** The price for `model`; a context suffix such as `[1m]` is ignored. */
export function priceOf(model: string): ModelPrice {
  return MODEL_PRICES[model.replace(/\[.*\]$/, '')] ?? FALLBACK_PRICE;
}

export function costOf(model: string, usage: AgentUsage): number {
  const price = priceOf(model);
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite) /
    1_000_000
  );
}
