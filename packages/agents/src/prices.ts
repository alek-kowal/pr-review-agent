import type { AgentUsage } from './runner.ts';

/** US dollars per million tokens. */
export type ModelPrice = {
  input: number;
  output: number;
  cacheRead: number;
  /** 5-minute cache writes: 1.25 × input. */
  cacheWrite: number;
  /** A request whose prompt (input + cache) passes `aboveTokens` is billed at `price`. */
  longPrompt?: { aboveTokens: number; price: ModelPrice };
};

/**
 * Anthropic first-party API prices (claude-api skill model table, cached 2026-11-03). Used only
 * when a session stops before the SDK reports its own cost. Haiku 5.5 costs 5 × more for prompts
 * over 100K tokens; its cache read is 0.1 × input.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    longPrompt: {
      aboveTokens: 100_000,
      price: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
    },
  },
});

/**
 * An unknown model is priced at the highest first-party list price (Fable 5.1 / 5, $10 / $50;
 * cache at 0.1 × and 1.25 × input), so the cost guard never under-counts it.
 */
const FALLBACK_PRICE: ModelPrice = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 };

/** The price for `model`; a context suffix such as `[1m]` is ignored. */
export function priceOf(model: string): ModelPrice {
  return MODEL_PRICES[model.replace(/\[.*\]$/, '')] ?? FALLBACK_PRICE;
}

/** The cost of one request (one assistant message): long-prompt rates depend on its prompt size. */
export function costOf(model: string, usage: AgentUsage): number {
  const base = priceOf(model);
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const price =
    base.longPrompt && prompt > base.longPrompt.aboveTokens ? base.longPrompt.price : base;
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite) /
    1_000_000
  );
}
