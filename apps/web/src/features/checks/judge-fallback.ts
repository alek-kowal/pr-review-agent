import { copy } from '@/copy/index.ts';
import { isRecord, str } from '@/features/runs/output-values.ts';

/**
 * "openrouter/… failed: no OpenRouter credits left. claude-haiku-5-5 answered instead." from a
 * Change type output's `judgeFallback` (P-26); null without one.
 */
export function judgeFallbackText(output: unknown): string | null {
  if (!isRecord(output) || !isRecord(output.judgeFallback)) return null;
  const { from, to, reason } = output.judgeFallback;
  const code = isRecord(reason) ? (str(reason.code) ?? 'agent_failed') : 'agent_failed';
  const t = copy.checks.output;
  return t.fallbackText(str(from) ?? '', str(to) ?? '', t.fallbackWhy(code));
}
