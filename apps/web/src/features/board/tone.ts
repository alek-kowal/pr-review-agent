import type { Tone } from '@pra/core';

/** The text colour of each Next step tone: colour means state. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-text-3',
  working: 'text-brand-text',
  action: 'text-warn',
  failed: 'text-bad',
  ready: 'text-ok',
};
