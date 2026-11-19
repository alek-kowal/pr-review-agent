import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import { CircleAlert, CornerDownRight, MessageSquare, Wrench, type LucideIcon } from 'lucide-react';
import { copy } from '@/copy/index.ts';
import { money } from '@/copy/format.ts';
import type { RunDetail, RunSessionView } from '@/lib/api-types.ts';
import { stageName } from '@/lib/reasons.ts';
import { transcriptQuery } from './queries.ts';
import { transcriptRows, type TranscriptRow } from './transcript.ts';

const ROW_ICON: Record<TranscriptRow['kind'], LucideIcon> = {
  text: MessageSquare,
  tool: Wrench,
  result: CornerDownRight,
  error: CircleAlert,
};

/** Every agent session of the run with its full log: what it said, called and got back. */
export function TranscriptTab({ detail }: { detail: RunDetail }) {
  const sessions = detail.stages.flatMap((stage) =>
    stage.sessions.map((session) => ({ stage: stage.key, session })),
  );
  if (sessions.length === 0) {
    return <p className="text-sm text-text-3">{copy.runs.detail.noSessions}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {sessions.map(({ stage, session }) => (
        <SessionTranscript key={session.id} runId={detail.run.id} stage={stage} session={session} />
      ))}
    </div>
  );
}

function SessionTranscript({
  runId,
  stage,
  session,
}: {
  runId: number;
  stage: string;
  session: RunSessionView;
}) {
  const t = copy.runs.detail.transcript;
  const s = copy.runs.detail.session;
  const query = useQuery({ ...transcriptQuery(runId, session.id), enabled: session.hasTranscript });
  const rows = query.data === undefined ? [] : transcriptRows(query.data);
  const title = `${stageName(stage)} · ${s.title(session.role)}`;

  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-3.5 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="font-mono text-xs text-text-3">{session.model}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-text-2 tabular-nums">
          {session.turns !== null && <span>{s.turns(session.turns)}</span>}
          <span>{s.filesRead(session.filesRead.length)}</span>
          <span className="font-semibold text-text">{money(session.costUsd)}</span>
        </div>
      </div>
      {!session.hasTranscript ? (
        <p className="px-3.5 py-2 text-sm text-text-3">{t.empty}</p>
      ) : query.isPending ? (
        <p className="px-3.5 py-2 text-sm text-text-3">{t.loading}</p>
      ) : query.isError ? (
        <p className="px-3.5 py-2 text-sm text-bad">{t.unreadable}</p>
      ) : (
        <ol className="m-0 list-none divide-y divide-divider p-0">
          {rows.map((row, i) => {
            const Icon = ROW_ICON[row.kind];
            return (
              <li
                key={i}
                data-kind={row.kind}
                className="flex items-start gap-2.5 px-3.5 py-2 text-sm"
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0',
                    row.kind === 'error' ? 'text-bad' : 'text-text-3',
                  )}
                />
                <span className="w-14 shrink-0 pt-0.5 text-xs text-text-3">
                  {row.tool ?? t.kinds[row.kind]}
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 break-words whitespace-pre-wrap',
                    row.kind === 'tool' && 'font-mono text-[13px]',
                    row.kind === 'error' && 'text-bad',
                  )}
                >
                  {row.text}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
