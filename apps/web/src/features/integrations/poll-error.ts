import { copy } from '@/copy/index.ts';
import type { ReasonView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';

const p = copy.integrations.poller;

/**
 * The last poll's error in one line (P-28): a rate limit with its reset, the repositories or PRs
 * it could not read, or the reason. Settings → Integrations and the board's refresh show it.
 */
export function pollErrorText(error: ReasonView): string {
  if (error.code === 'github_rate_limited') {
    return p.rateLimited(new Date(String(error.params.resetAt)).toLocaleString());
  }
  if (error.code === 'github_poll_failed') {
    return p.pollFailed((error.params.items as string[] | undefined) ?? []);
  }
  return errorText(error.code);
}
