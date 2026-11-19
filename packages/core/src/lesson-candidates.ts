// S-23-T1: lesson candidates from one closed PR, built on the F-03 learning rules (`learning.ts`).
import {
  capProposals,
  mergeCandidate,
  MIN_PRS_FOR_LESSON,
  type LessonCandidate,
  type LessonProposal,
} from './learning.ts';
import { reason, type Check, type Reason } from './reason.ts';

export interface MergeCandidatesResult {
  /** Every candidate after the merge, the existing ones first. */
  candidates: LessonCandidate[];
  /** Ids of the candidates the proposals created. */
  created: string[];
  /** Ids of the existing candidates a proposal added this PR to (or found it already on). */
  merged: string[];
  /** One reason per kept proposal, in the analyst's order. */
  reasons: Reason[];
  /** Proposals over the cap of 5 per closed PR. */
  dropped: number;
}

/**
 * Adds one closed PR's proposals to the candidates. At most 5 are read, in the analyst's order. A
 * proposal marked as a duplicate of an open candidate (or with the same title) adds its PR to that
 * candidate instead of adding a new one, and the same PR never counts twice.
 */
export function mergeCandidates(
  existing: readonly LessonCandidate[],
  proposals: readonly LessonProposal[],
): MergeCandidatesResult {
  const { kept, dropped } = capProposals(proposals);
  let candidates = [...existing];
  const before = new Set(existing.map((c) => c.id));
  const created: string[] = [];
  const merged: string[] = [];
  const reasons: Reason[] = [];
  for (const proposal of kept) {
    const result = mergeCandidate(candidates, proposal);
    candidates = result.candidates;
    reasons.push(result.reason);
    const id = result.candidate.id;
    const list = before.has(id) ? merged : created;
    if (result.reason.code !== 'lesson_already_accepted' && !list.includes(id)) list.push(id);
  }
  return { candidates, created, merged, reasons, dropped };
}

/**
 * Whether an open candidate may become a lesson: it needs at least 2 PRs. The reason
 * `needs_more_prs` reads "1 of 2 PRs: waits for one more". The signature is checked where the
 * accept is signed.
 */
export function canAcceptLesson(candidate: Pick<LessonCandidate, 'status' | 'prs'>): Check {
  if (candidate.status !== 'proposed') {
    return { ok: false, reason: reason('candidate_not_open', { status: candidate.status }) };
  }
  const have = new Set(candidate.prs).size;
  if (have < MIN_PRS_FOR_LESSON) {
    return { ok: false, reason: reason('needs_more_prs', { have, need: MIN_PRS_FOR_LESSON }) };
  }
  return { ok: true, reason: reason('can_accept', { prs: have }) };
}
