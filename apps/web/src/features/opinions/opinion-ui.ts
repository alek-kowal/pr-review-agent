import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { OpinionValue } from '@/lib/api-types.ts';

export const OPINION_VALUES: readonly OpinionValue[] = ['worth', 'not_worth'];

export const OPINION_ICONS: Record<OpinionValue, LucideIcon> = {
  worth: ThumbsUp,
  not_worth: ThumbsDown,
};
