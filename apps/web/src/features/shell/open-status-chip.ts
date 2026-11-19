import { useEffect } from 'react';

// Other features open the status chip's popover (the banner's Resume… points to it) without
// importing the top bar: a window event the chip listens to.
const OPEN_STATUS_CHIP = 'pra:open-status-chip';

/** Opens the status chip's popover, where pause, resume and the budget live. */
export function openStatusChip(): void {
  window.dispatchEvent(new Event(OPEN_STATUS_CHIP));
}

/** Calls `open` whenever someone asks for the status chip. */
export function useOpenStatusChip(open: () => void): void {
  useEffect(() => {
    window.addEventListener(OPEN_STATUS_CHIP, open);
    return () => window.removeEventListener(OPEN_STATUS_CHIP, open);
  }, [open]);
}
