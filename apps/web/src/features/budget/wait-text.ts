import { useQuery } from '@tanstack/react-query';
import { copy } from '@/copy/index.ts';
import { statusQuery } from '@/features/shell/status-query.ts';
import type { ReasonView } from '@/lib/api-types.ts';
import { actorName } from '@/lib/next-step.ts';

/**
 * Names a queued banner, card or row may show: the member who paused (the status chip's
 * `pausedBy`). A stored `paused` wait always names the current pause, the drainer refreshes it.
 */
export function usePauseNames(): ReadonlyMap<string, string> {
  const by = useQuery(statusQuery()).data?.pausedBy;
  return by ? new Map([[by.id, by.name]]) : EMPTY;
}

const EMPTY: ReadonlyMap<string, string> = new Map();

/** "Queued: paused by Tomek (release freeze)", or plain "Queued" without a known reason. */
export function waitText(wait: ReasonView | null, names: ReadonlyMap<string, string>): string {
  const t = copy.activity.inProgress;
  const p = wait?.params ?? {};
  switch (wait?.code) {
    case 'paused':
      return t.waits.paused({ by: actorName(p.by, names), note: (p.note as string) ?? null });
    case 'budget_reached':
      return t.waits.budget_reached({
        spentUsd: Number(p.spentUsd),
        budgetUsd: Number(p.budgetUsd),
      });
    case 'slots_busy':
      return t.waits.slots_busy({
        slots: Number(p.slots),
        prs: Array.isArray(p.prs) ? (p.prs as number[]) : [],
      });
    case 'usage_limit_reached':
      return t.waits.usage_limit_reached({ until: String(p.until) });
    default:
      return t.queued;
  }
}
