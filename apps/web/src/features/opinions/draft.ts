// The opinions a person is drafting on a PR's findings, before they save them as one signed
// review. Kept per PR in memory, so switching tabs or pages keeps the draft (as in the prototype).
import { useSyncExternalStore } from 'react';
import type { OpinionValue } from '@/lib/api-types.ts';

export type DraftOpinion = { value: OpinionValue; comment: string };
export type ReviewDraft = ReadonlyMap<number, DraftOpinion>;

const EMPTY: ReviewDraft = new Map();
const drafts = new Map<string, ReviewDraft>();
const listeners = new Set<() => void>();

const keyOf = (repo: string, number: string) => `${repo}/${number}`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(key: string, change: (draft: Map<number, DraftOpinion>) => void) {
  const next = new Map(drafts.get(key) ?? EMPTY);
  change(next);
  if (next.size === 0) drafts.delete(key);
  else drafts.set(key, next);
  for (const listener of listeners) listener();
}

/** Forgets every draft; for tests, which share this module. */
export function clearReviewDrafts() {
  drafts.clear();
  for (const listener of listeners) listener();
}

export function useReviewDraft(repo: string, number: string) {
  const key = keyOf(repo, number);
  const draft = useSyncExternalStore(subscribe, () => drafts.get(key) ?? EMPTY);
  return {
    draft,
    /** Picks a value; picking the drafted value again takes the opinion back. */
    toggle: (findingId: number, value: OpinionValue) =>
      update(key, (next) => {
        const current = next.get(findingId);
        if (current?.value === value) next.delete(findingId);
        else next.set(findingId, { value, comment: current?.comment ?? '' });
      }),
    setComment: (findingId: number, comment: string) =>
      update(key, (next) => {
        const current = next.get(findingId);
        if (current) next.set(findingId, { ...current, comment });
      }),
    clear: () => update(key, (next) => next.clear()),
  };
}
