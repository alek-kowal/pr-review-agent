// The signed reviews saved on this page whose author is not notified yet (S-08-T11). Kept per PR in
// memory, like drafted opinions: the card offers Notify author right after the save, and Not now
// or a posted comment removes it.
import { useSyncExternalStore } from 'react';
import type { ReviewView } from '@/lib/api-types.ts';

const EMPTY: readonly ReviewView[] = [];
const pending = new Map<string, readonly ReviewView[]>();
const listeners = new Set<() => void>();

const keyOf = (repo: string, number: string) => `${repo}/${number}`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(key: string, reviews: readonly ReviewView[]) {
  if (reviews.length === 0) pending.delete(key);
  else pending.set(key, reviews);
  for (const listener of listeners) listener();
}

/** A review was just saved: its card shows until Notify author or Not now. */
export function addPendingNotify(repo: string, number: string, review: ReviewView) {
  const key = keyOf(repo, number);
  const rest = (pending.get(key) ?? EMPTY).filter((r) => r.id !== review.id);
  set(key, [...rest, review]);
}

export function dismissPendingNotify(repo: string, number: string, reviewId: number) {
  const key = keyOf(repo, number);
  set(
    key,
    (pending.get(key) ?? EMPTY).filter((r) => r.id !== reviewId),
  );
}

/** Forgets every pending card; for tests, which share this module. */
export function clearPendingNotifies() {
  pending.clear();
  for (const listener of listeners) listener();
}

export function usePendingNotifies(repo: string, number: string): readonly ReviewView[] {
  const key = keyOf(repo, number);
  return useSyncExternalStore(subscribe, () => pending.get(key) ?? EMPTY);
}
