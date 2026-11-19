import './reasons/push.ts';
import './reasons/rounds.ts';
import type { ActiveRun } from './model.ts';
import { reason, type Reason } from './reason.ts';

/** What the push rule reads from a patch. */
export type PushablePatch = {
  status: string;
  /** The PR head the patch was made on. */
  baseSha: string;
  /** Files the push would write: the patch's files that are not reverted. */
  files: number;
};

/** What the push rule reads from a PR. */
export type PushTarget = {
  number: number;
  /** The PR's state on GitHub right now: a closed or merged PR takes no push. */
  state: 'open' | 'closed' | 'merged';
  fork: boolean;
  activeRun: Pick<ActiveRun, 'kind' | 'status'> | null;
};

export type PushGate = { allowed: true } | { allowed: false; reason: Reason };

/**
 * Whether a ready patch may be pushed to the PR branch now (FR-051). The person types the PR
 * number; `freshHeadSha` is the head GitHub reports right now, so a push never lands on commits
 * nobody reviewed. A fork stays read-only, whatever else holds.
 */
export function canPush(
  patch: PushablePatch,
  pr: PushTarget,
  typedNumber: number,
  freshHeadSha: string,
): PushGate {
  const refuse = (refusal: Reason): PushGate => ({ allowed: false, reason: refusal });
  if (pr.fork) return refuse(reason('fork_read_only'));
  if (pr.state !== 'open') return refuse(reason('pr_closed'));
  if (patch.status !== 'ready') return refuse(reason('patch_not_ready', { status: patch.status }));
  if (typedNumber !== pr.number) return refuse(reason('pr_number_mismatch', { number: pr.number }));
  if (pr.activeRun) {
    const { kind, status } = pr.activeRun;
    return refuse(reason('run_active', { kind, status }));
  }
  if (freshHeadSha !== patch.baseSha)
    return refuse(reason('head_moved', { headSha: freshHeadSha }));
  if (patch.files === 0) return refuse(reason('patch_empty'));
  return { allowed: true };
}
