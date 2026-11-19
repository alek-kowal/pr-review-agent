import { useEffect } from 'react';

// The command palette opens the PR header's "Start review ▾" without importing the PR page: a
// window event the header's Start review listens to (as `open-status-chip.ts` does).
const OPEN_START_REVIEW = 'pra:open-start-review';

/** Opens the open PR's Start review popover, when the page shows one. */
export function openStartReview(): void {
  window.dispatchEvent(new Event(OPEN_START_REVIEW));
}

/** Calls `open` whenever someone asks for Start review, while `enabled`. */
export function useOpenStartReview(open: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener(OPEN_START_REVIEW, open);
    return () => window.removeEventListener(OPEN_START_REVIEW, open);
  }, [open, enabled]);
}
