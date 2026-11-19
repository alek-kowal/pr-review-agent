import type { Tone } from '@pra/core';
import { CircleAlert, CircleCheck, CircleDashed, CircleX, LoaderCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** The Next step banner's border and fill by tone: colour means state. */
export const BANNER_TONE: Record<Tone, string> = {
  neutral: 'border-border bg-surface',
  working: 'border-brand-line bg-brand-bg',
  action: 'border-warn-line bg-warn-bg',
  failed: 'border-bad-line bg-bad-bg',
  ready: 'border-ok-line bg-ok-bg',
};

/** The banner icon's colour by tone. */
export const BANNER_ICON_TONE: Record<Tone, string> = {
  neutral: 'text-text-3',
  working: 'border-brand-line text-brand-text',
  action: 'border-warn-line text-warn',
  failed: 'border-bad-line text-bad',
  ready: 'border-ok-line text-ok',
};

export const BANNER_ICON: Record<Tone, LucideIcon> = {
  neutral: CircleDashed,
  working: LoaderCircle,
  action: CircleAlert,
  failed: CircleX,
  ready: CircleCheck,
};
