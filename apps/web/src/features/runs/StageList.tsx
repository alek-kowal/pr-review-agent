import { cn } from 'cn';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { copy } from '@/copy/index.ts';
import { duration, money } from '@/copy/format.ts';
import { STEP_ICON, STEP_TONE } from '@/features/round/step-style.ts';
import type { RunDetail, RunSessionView, RunStageView } from '@/lib/api-types.ts';
import { reasonText, stageName } from '@/lib/reasons.ts';
import { STAGE_OUTPUTS } from './stage-outputs.ts';
import { GenericOutput } from './StageOutputs.tsx';

const openByDefault = (stage: RunStageView) =>
  stage.status === 'failed' || stage.status === 'running' || stage.key === 'review';

const stageMs = (stage: RunStageView) =>
  stage.startedAt && stage.finishedAt
    ? new Date(stage.finishedAt).getTime() - new Date(stage.startedAt).getTime()
    : null;

/** Every stage of the run, each expandable to its readable output and its agent sessions. */
export function StageList({ detail }: { detail: RunDetail }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <ol className="m-0 list-none divide-y divide-divider overflow-hidden rounded-lg border border-border bg-surface p-0">
      {detail.stages.map((stage) => {
        const isOpen = open[stage.key] ?? openByDefault(stage);
        const Icon = STEP_ICON[stage.status];
        const ms = stageMs(stage);
        const agentModels = [...new Set(stage.sessions.map((s) => s.model))].join(', ');
        return (
          <li key={stage.key} data-stage={stage.key} data-status={stage.status}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen((o) => ({ ...o, [stage.key]: !isOpen }))}
              className="flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 text-left hover:bg-inset"
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  'size-4 shrink-0',
                  STEP_TONE[stage.status],
                  stage.status === 'running' && 'motion-safe:animate-spin',
                )}
              />
              <span className="w-32 font-medium">{stageName(stage.key)}</span>
              <span className="text-xs text-text-3">
                {agentModels
                  ? copy.runs.detail.stageAgent(agentModels)
                  : copy.runs.detail.stageCode}
              </span>
              {stage.reused && (
                <span className="rounded bg-inset px-1.5 py-0.5 text-xs text-text-2">
                  {copy.runs.detail.reused}
                </span>
              )}
              <span className="flex-1" />
              <span className="text-sm text-text-3 tabular-nums">
                {stage.status === 'off'
                  ? copy.runs.step.off(detail.run.level.number)
                  : ms === null
                    ? '—'
                    : duration(ms)}
              </span>
              <span className="w-16 text-right text-sm tabular-nums">
                {stage.costUsd > 0 ? money(stage.costUsd) : '—'}
              </span>
              {isOpen ? (
                <ChevronUp aria-hidden="true" className="size-4 text-text-3" />
              ) : (
                <ChevronDown aria-hidden="true" className="size-4 text-text-3" />
              )}
            </button>
            {isOpen && (
              <div className="flex flex-col gap-3 px-4 pb-4 pl-11">
                <StageBody stage={stage} detail={detail} />
                {stage.sessions.map((session) => (
                  <SessionSummary key={session.id} session={session} />
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StageBody({ stage, detail }: { stage: RunStageView; detail: RunDetail }) {
  const d = copy.runs.detail;
  switch (stage.status) {
    case 'off':
      return <p className="text-sm text-text-3">{d.stageOff(detail.run.level.number)}</p>;
    case 'queued':
      return <p className="text-sm text-text-3">{d.stageQueued(detail.run.status === 'failed')}</p>;
    case 'running':
      return <p className="text-sm text-text-2">{d.stageRunning}</p>;
    case 'failed':
      return (
        <p className="text-sm font-medium text-bad">
          {d.stageFailed(reasonText(stage.errorCode ?? 'stage_error'))}
        </p>
      );
    case 'done': {
      const Output = STAGE_OUTPUTS[stage.key] ?? GenericOutput;
      return (
        <>
          {stage.reused && <p className="text-sm text-text-3">{d.stageReused}</p>}
          <Output output={stage.output} stage={stage} run={detail} />
        </>
      );
    }
  }
}

/** One agent session: role, model, turns, cost, and what it read and did. */
export function SessionSummary({ session }: { session: RunSessionView }) {
  const s = copy.runs.detail.session;
  const facts = [
    session.model,
    session.turns === null ? null : s.turns(session.turns),
    s.filesRead(session.filesRead.length),
    s.actions(session.actions.length),
    s.status(session.status),
  ].filter(Boolean);
  return (
    <section
      aria-label={s.title(session.role)}
      data-session={session.id}
      className="rounded-md border border-divider bg-surface-2 px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{s.title(session.role)}</span>
        <span className="font-semibold tabular-nums">{money(session.costUsd)}</span>
      </div>
      <p className="text-xs text-text-3">{facts.join(' · ')}</p>
      {!session.hasTranscript && <p className="mt-1 text-xs text-text-3">{s.noTranscript}</p>}
      {session.filesRead.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-text-2">{s.filesHeading}</summary>
          <ul className="m-0 mt-1 list-none p-0 font-mono text-xs">
            {session.filesRead.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </details>
      )}
      {session.actions.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-text-2">{s.actionsHeading}</summary>
          <ul className="m-0 mt-1 list-none p-0 text-xs">
            {session.actions.map((action, i) => (
              <li key={i}>
                <span className="text-text-3">{action.tool}</span>{' '}
                <span className="font-mono">{action.target}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
