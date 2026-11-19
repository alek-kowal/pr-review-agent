import { Ban, ClipboardList, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Decision } from '@pra/core';
import type { PrView } from '@/lib/api-types.ts';

export const DECISION_ICONS: Record<Decision, LucideIcon> = {
  implement: Wrench,
  reject: Ban,
  defer: ClipboardList,
};

/** The triage key that opens each decision's form on the focused finding (S-17-T6). */
export const DECISION_KEYS: Record<Decision, string> = { implement: 'i', reject: 'r', defer: 'd' };

/** Findings can be decided while the PR is open (it is on the board). */
export const canDecide = (view: PrView): boolean => view.nextStep.lane !== null;
