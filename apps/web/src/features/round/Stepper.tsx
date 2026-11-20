import { cn } from 'cn';
import { copy } from '@/copy/index.ts';
import type { RoundStepView } from '@/lib/api-types.ts';
import { reasonText, stageName } from '@/lib/reasons.ts';
import { offStageText, offStepTexts } from './off-text.ts';
import { STEP_ICON, STEP_TONE } from './step-style.ts';

const spentMs = (step: RoundStepView): number | null =>
  step.startedAt && step.finishedAt
    ? new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()
    : null;

/** A step's second line: why it is off, its error, or its time and cost. */
function stepSub(step: RoundStepView, level: number, runFailed: boolean): string {
  const cost = step.costUsd > 0 ? copy.runs.stepCost(step.costUsd) : null;
  const ms = spentMs(step);
  const parts = (() => {
    switch (step.status) {
      case 'off':
        return [offStageText(step.offReason, level)];
      case 'queued':
        return [runFailed ? copy.runs.step.notRun : copy.runs.step.waiting];
      case 'failed':
        return [reasonText(step.errorCode ?? 'stage_error', step.errorParams), cost];
      case 'running':
        return [copy.runs.step.running, cost];
      case 'done':
        return [ms === null ? copy.runs.step.done : copy.runs.stepDuration(ms), cost];
    }
  })();
  return parts.filter(Boolean).join(' · ');
}

/**
 * Every stage of a round in run order with its state and cost; stages the level turns off stay
 * listed (spec: prototype `ui.js` `Stepper`).
 */
export function Stepper({
  steps,
  level,
  runFailed,
}: {
  steps: readonly RoundStepView[];
  level: number;
  runFailed: boolean;
}) {
  return (
    <ol
      aria-label={copy.runs.stepperLabel}
      data-testid="stepper"
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-px overflow-hidden rounded-lg border border-border bg-divider p-0"
    >
      {steps.map((step) => {
        const Icon = STEP_ICON[step.status];
        return (
          <li
            key={step.key}
            data-step={step.key}
            data-status={step.status}
            aria-current={step.status === 'running' ? 'step' : undefined}
            className={cn(
              'flex flex-col gap-0.5 bg-surface px-3 py-2',
              step.status === 'running' && 'bg-brand-bg',
            )}
          >
            <span
              className={cn(
                'flex items-center gap-1.5 text-[13px] font-medium',
                step.status === 'off' || step.status === 'queued' ? 'text-text-3' : 'text-text',
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  'size-3.5 shrink-0',
                  STEP_TONE[step.status],
                  step.status === 'running' && 'motion-safe:animate-spin',
                )}
              />
              {stageName(step.key)}
              <span className="sr-only">: {copy.runs.statusWords[step.status]}</span>
            </span>
            <span
              data-testid="step-sub"
              className={cn(
                'text-xs tabular-nums',
                step.status === 'failed' ? 'text-bad' : 'text-text-3',
              )}
            >
              {stepSub(step, level, runFailed)}
            </span>
            {offStepTexts(step.offSteps).map((text) => (
              <span key={text} data-testid="off-step" className="text-xs text-text-3">
                {text}
              </span>
            ))}
          </li>
        );
      })}
    </ol>
  );
}
