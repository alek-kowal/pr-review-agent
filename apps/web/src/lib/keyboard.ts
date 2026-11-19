// Shared rules for single-key shortcuts (S-17-T5, T6): they never fire while someone types or
// while a dialog is open.

/** True when the key goes to a text field, a select or an editable element. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(
    type,
  );
}

/** True while a dialog, alert dialog or popover is open. */
export function isDialogOpen(): boolean {
  return (
    document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]') !== null
  );
}

/** True when a single-key shortcut must be ignored for this event. */
export function ignoreSingleKey(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing ||
    isTypingTarget(event.target) ||
    isDialogOpen()
  );
}
