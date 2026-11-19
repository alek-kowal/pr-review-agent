import { MAX_AGENT_SLOTS } from '@pra/core';

/** "12.5" → 12.5; empty, zero, negative or not a number → null. */
export function parseBudget(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(value) && value > 0 ? value : null;
}

/** "3" → 3; anything but a whole number from 1 to `MAX_AGENT_SLOTS` → null. */
export function parseSlots(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(value) && value >= 1 && value <= MAX_AGENT_SLOTS
    ? value
    : null;
}
