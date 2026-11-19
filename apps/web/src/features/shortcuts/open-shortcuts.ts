import { useEffect } from 'react';

// The palette's "Show keyboard shortcuts" action opens the list without importing it: a window
// event the dialog listens to (as `open-status-chip.ts` does for the status chip).
const OPEN_SHORTCUTS = 'pra:open-shortcuts';

/** Opens the Keyboard shortcuts dialog. */
export function openShortcuts(): void {
  window.dispatchEvent(new Event(OPEN_SHORTCUTS));
}

/** Calls `open` whenever someone asks for the shortcut list. */
export function useOpenShortcuts(open: () => void): void {
  useEffect(() => {
    window.addEventListener(OPEN_SHORTCUTS, open);
    return () => window.removeEventListener(OPEN_SHORTCUTS, open);
  }, [open]);
}
