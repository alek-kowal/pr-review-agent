import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { copy } from '@/copy/index.ts';
import { clock } from '@/copy/format.ts';
import type { PrTabProps } from '@/features/pr/tabs.ts';
import { useMemberNames } from '@/features/team/use-member-names.ts';
import { isActiveStatus, type RoundView, type RoundProgressView } from '@/lib/api-types.ts';
import { actorName } from '@/lib/next-step.ts';
import { ROUND_LINE_LINKS } from './slots.ts';
import { Stepper } from './Stepper.tsx';

/** The round line's status part: queued, running with the cost so far, failed, finished. */
function statusPart(round: RoundView, costUsd: number): string {
  switch (round.status) {
    case 'queued':
      return copy.runs.line.queued;
    case 'running':
      return copy.runs.line.running(costUsd);
    case 'failed':
      return copy.runs.line.failed(costUsd);
    case 'cancelled':
      return copy.runs.line.cancelled(costUsd);
    case 'completed':
      return copy.runs.line.completed(clock(round.finishedAt ?? round.createdAt), costUsd);
  }
}

/**
 * The latest round on the PR page (FR-025, `docs/03-design-decisions.md` §Simplification pass):
 * the full stepper while the round is queued or running and after a failure; otherwise one line
 * such as "Round 1 of 3 · started by hand · finished 14:02 · $1.84" whose Stages control opens
 * the stepper. Live updates refresh the PR view, so the stage and cost follow the round.
 */
export function RoundProgress({ view }: PrTabProps) {
  const round = view.latestRound;
  const progress = view.roundProgress;
  if (!round || !progress || view.pullRequest.state !== 'open') return null;
  return <RoundLine round={round} progress={progress} />;
}

function RoundLine({ round, progress }: { round: RoundView; progress: RoundProgressView }) {
  const [open, setOpen] = useState(false);
  const names = useMemberNames();
  const full = isActiveStatus(round.status) || round.status === 'failed';
  const label = progress.label
    ? copy.runs.roundLabel(progress.label.params, (actor) => actorName(actor, names))
    : copy.runs.roundLabelFallback(round.number);

  return (
    <div data-testid="round-progress" data-round-status={round.status} className="mt-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-text-2">
        <span data-testid="round-line" className="tabular-nums">
          {label} · {statusPart(round, progress.costUsd)}
        </span>
        {!full && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-0.5 border-0 bg-transparent p-0 text-brand-text"
          >
            {copy.runs.stagesToggle}
            {open ? (
              <ChevronUp aria-hidden="true" className="size-3" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-3" />
            )}
          </button>
        )}
        {ROUND_LINE_LINKS.map(({ key, Component }) => (
          <Component key={key} runId={progress.runId} />
        ))}
      </p>
      {(full || open) && (
        <div className="mt-1.5">
          <Stepper
            steps={progress.steps}
            level={round.level.number}
            runFailed={round.status === 'failed'}
          />
        </div>
      )}
    </div>
  );
}
