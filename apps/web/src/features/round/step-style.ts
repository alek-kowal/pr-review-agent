import {
  Circle,
  CircleCheck,
  CircleOff,
  CircleX,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react';
import type { RunStepStatus } from '@/lib/api-types.ts';

/** A step's icon and colour by status, shared by the stepper and Run detail. */
export const STEP_ICON: Record<RunStepStatus, LucideIcon> = {
  done: CircleCheck,
  running: LoaderCircle,
  queued: Circle,
  off: CircleOff,
  failed: CircleX,
};

export const STEP_TONE: Record<RunStepStatus, string> = {
  done: 'text-ok',
  running: 'text-brand-text',
  queued: 'text-text-4',
  off: 'text-text-4',
  failed: 'text-bad',
};
