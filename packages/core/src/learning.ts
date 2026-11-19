import './reasons/learning.ts';
import { reason, type Check, type Reason } from './reason.ts';
import type { Actor } from './vocabulary.ts';

export const MAX_PROPOSALS_PER_PR = 5;
export const MIN_PRS_FOR_LESSON = 2;

export interface PrComment {
  id: string;
  /** GitHub login of the comment's author. */
  author: string;
  body: string;
  path: string | null;
  line: number | null;
}

const sameLogin = (a: string, b: string) =>
  a.replace(/^@/, '').toLowerCase() === b.replace(/^@/, '').toLowerCase();

/** What the analyst reads: every comment on the PR except the PR author's own. */
export function buildCases(prComments: readonly PrComment[], authorLogin: string): PrComment[] {
  return prComments.filter((c) => !sameLogin(c.author, authorLogin));
}

export type CandidateStatus = 'proposed' | 'accepted' | 'rejected';

export interface LessonCandidate {
  id: string;
  title: string;
  rule: string;
  /** The PRs the lesson came from. */
  prs: number[];
  status: CandidateStatus;
}

export interface LessonProposal {
  /** Id for the candidate, used only when the proposal becomes a new one. */
  id: string;
  title: string;
  rule: string;
  pr: number;
  /** The analyst's own pointer to an existing candidate it repeats. */
  duplicateOf?: string | null;
}

const key = (title: string) =>
  title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?:;,\s]+$/, '')
    .trim();

export interface MergeResult {
  candidates: LessonCandidate[];
  candidate: LessonCandidate;
  reason: Reason;
}

/**
 * Adds a proposal to the candidates. A duplicate of an open candidate adds its PR to it; a
 * duplicate of a rejected candidate starts over as a new one.
 */
export function mergeCandidate(
  candidates: readonly LessonCandidate[],
  proposal: LessonProposal,
): MergeResult {
  const same = (c: LessonCandidate) =>
    c.id === proposal.duplicateOf || key(c.title) === key(proposal.title);
  const matches = candidates.filter(same);

  const open = matches.find((c) => c.status === 'proposed');
  if (open) {
    const merged = {
      ...open,
      prs: open.prs.includes(proposal.pr) ? open.prs : [...open.prs, proposal.pr],
    };
    return {
      candidates: candidates.map((c) => (c.id === open.id ? merged : c)),
      candidate: merged,
      reason: reason('candidate_merged', { id: open.id, prs: merged.prs.length }),
    };
  }
  const accepted = matches.find((c) => c.status === 'accepted');
  if (accepted) {
    return {
      candidates: [...candidates],
      candidate: accepted,
      reason: reason('lesson_already_accepted', { id: accepted.id }),
    };
  }
  const created: LessonCandidate = {
    id: proposal.id,
    title: proposal.title,
    rule: proposal.rule,
    prs: [proposal.pr],
    status: 'proposed',
  };
  const rejected = matches.find((c) => c.status === 'rejected');
  return {
    candidates: [...candidates, created],
    candidate: created,
    reason: rejected
      ? reason('candidate_started_over', { id: created.id, rejectedId: rejected.id })
      : reason('candidate_created', { id: created.id }),
  };
}

/** At most 5 proposals per closed PR, in the analyst's order. */
export function capProposals<T>(proposals: readonly T[]): {
  kept: T[];
  dropped: number;
  reason: Reason | null;
} {
  const kept = proposals.slice(0, MAX_PROPOSALS_PER_PR);
  const dropped = proposals.length - kept.length;
  return {
    kept,
    dropped,
    reason: dropped ? reason('proposals_capped', { kept: kept.length, dropped }) : null,
  };
}

/** A person accepts a lesson, with a signature, once it comes from at least 2 PRs. */
export function canAccept(candidate: LessonCandidate, signer?: Actor | null): Check {
  if (candidate.status !== 'proposed') {
    return { ok: false, reason: reason('candidate_not_open', { status: candidate.status }) };
  }
  const have = new Set(candidate.prs).size;
  if (have < MIN_PRS_FOR_LESSON) {
    return { ok: false, reason: reason('needs_more_prs', { have, need: MIN_PRS_FOR_LESSON }) };
  }
  if (signer?.kind !== 'member') return { ok: false, reason: reason('signature_required') };
  return { ok: true, reason: reason('can_accept', { prs: have }) };
}

/** The lessons file with an accepted lesson added at the end; the rest of the text is kept. */
export function withLesson(
  text: string,
  candidate: Pick<LessonCandidate, 'title' | 'rule'>,
): string {
  const heading = `## ${candidate.title.trim()}`;
  if (text.split('\n').some((line) => line.trim() === heading)) return text;
  const section = `${heading}\n\n${candidate.rule.trim()}\n`;
  const kept = text.trimEnd();
  return kept ? `${kept}\n\n${section}` : section;
}
