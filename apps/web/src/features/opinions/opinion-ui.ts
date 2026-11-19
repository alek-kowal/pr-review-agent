import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { OpinionValue } from '@/lib/api-types.ts';

export const OPINION_VALUES: readonly OpinionValue[] = ['worth', 'not_worth'];

export const OPINION_ICONS: Record<OpinionValue, LucideIcon> = {
  worth: ThumbsUp,
  not_worth: ThumbsDown,
};

/** The triage key that toggles each value in the focused finding's draft (S-17-T6). */
export const OPINION_KEYS: Record<OpinionValue, string> = { worth: 'w', not_worth: 'n' };
