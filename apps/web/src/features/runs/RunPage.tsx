import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { copy } from '@/copy/index.ts';
import { duration, money } from '@/copy/format.ts';
import { useMemberNames } from '@/features/team/use-member-names.ts';
import { ApiError } from '@/lib/api.ts';
import type { RunDetail } from '@/lib/api-types.ts';
import { actorName } from '@/lib/next-step.ts';
import { errorText, reasonText, stageName } from '@/lib/reasons.ts';
import { runDetailQuery } from './queries.ts';
import { runTitle } from './run-title.ts';
import { StageList } from './StageList.tsx';
import { RUN_TABS, type RunTab } from './tabs.ts';
import { TranscriptTab } from './TranscriptTab.tsx';

function totalCost(detail: RunDetail): string {
  const { status } = detail.run;
  if (status === 'queued' || status === 'running') {
    return copy.runs.detail.cost.running(detail.totalCostUsd);
  }
  if (status === 'failed') return copy.runs.detail.cost.failed(detail.totalCostUsd);
  return copy.runs.detail.cost.done(detail.totalCostUsd);
}

/**
 * Run detail (spec: prototype `pages.js` `RunPage`): what one run did, stage by stage, what each
 * agent session cost and read, and the full transcript. Live updates refresh it while it runs.
 */
export function RunPage({
  runId,
  tab,
  onTabChange,
}: {
  runId: string;
  tab: RunTab;
  onTabChange: (tab: RunTab) => void;
}) {
  const id = Number(runId);
  const query = useQuery({ ...runDetailQuery(id), enabled: Number.isInteger(id) && id > 0 });
  const names = useMemberNames();

  if (!Number.isInteger(id) || id <= 0 || query.isError) {
    const code = query.error instanceof ApiError ? query.error.code : 'run_not_found';
    return (
      <section className="flex flex-col gap-2">
        <h1 className="font-heading text-xl font-semibold">
          {code === 'run_not_found' ? copy.runs.detail.notFound : errorText(code)}
        </h1>
        <Link to="/activity" className="text-brand-text">
          {copy.runs.detail.backToActivity}
        </Link>
      </section>
    );
  }
  if (query.isPending) return <p className="text-text-3">{copy.runs.detail.loading}</p>;

  const detail = query.data;
  const { run, pullRequest } = detail;
  const startedBy = detail.label
    ? copy.runs
        .roundLabel(detail.label.params, (actor) => actorName(actor, names))
        .split(' · ')
        .slice(1)
        .join(' · ')
    : copy.runs.detail.startedBy(actorName(run.startedBy, names));
  const spentMs =
    run.startedAt && run.finishedAt
      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
      : null;
  const meta = [
    copy.runs.detail.status[run.status] ?? run.status,
    startedBy,
    copy.runs.detail.level(run.level.number),
    spentMs === null ? null : duration(spentMs),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-[13px] text-text-3">
          <Link
            to="/pr/$repo/$number"
            params={{ repo: pullRequest.repository.slug, number: String(pullRequest.number) }}
            className="text-brand-text"
          >
            {copy.pr.number(pullRequest.number)} {pullRequest.title}
          </Link>
        </p>
        <h1 className="font-heading text-xl font-semibold">
          {copy.runs.detail.title(runTitle(detail), pullRequest.number)}
        </h1>
        <p data-testid="run-meta" className="text-[13px] text-text-3">
          {meta.join(' · ')} ·{' '}
          <span data-testid="run-cost" className="font-medium text-text tabular-nums">
            {totalCost(detail)}
          </span>
        </p>
        {run.error && (
          <p role="alert" className="text-sm text-bad">
            {copy.runs.detail.failedAt(stageName(run.error.stage), reasonText(run.error.code))}
          </p>
        )}
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Tabs value={tab} onValueChange={(next) => onTabChange(next as RunTab)} className="min-w-0">
          <TabsList variant="line" aria-label={copy.runs.detail.tabsLabel}>
            {RUN_TABS.map((key) => (
              <TabsTrigger key={key} value={key}>
                {copy.runs.detail.tabs[key]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="stages" className="pt-3">
            <StageList detail={detail} />
          </TabsContent>
          <TabsContent value="transcript" className="pt-3">
            <TranscriptTab detail={detail} />
          </TabsContent>
        </Tabs>
        <aside className="flex flex-col gap-3">
          <SideCard
            title={copy.runs.detail.costPerSession}
            hint={copy.runs.detail.costPerSessionHint}
          >
            <SessionCosts detail={detail} />
          </SideCard>
          <SideCard
            title={copy.runs.detail.instructionVersions}
            hint={copy.runs.detail.instructionVersionsHint}
          >
            {run.instructionVersions.length === 0 ? (
              <p className="px-3.5 py-2 text-sm text-text-3">
                {copy.runs.detail.noInstructionVersions}
              </p>
            ) : (
              <ul className="m-0 list-none divide-y divide-divider p-0">
                {run.instructionVersions.map((v) => (
                  <li key={v.id} className="flex justify-between gap-2 px-3.5 py-2 text-sm">
                    <span className="font-mono text-[13px]">{v.fileKey}</span>
                    <span className="text-xs text-text-3">
                      {copy.runs.detail.instructionVersion(v.scope, v.version)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SideCard>
          {run.notChecked.length > 0 && (
            <SideCard title={copy.runs.detail.notChecked}>
              <ul className="m-0 list-disc px-3.5 py-2 pl-8 text-sm">
                {run.notChecked.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </SideCard>
          )}
        </aside>
      </div>
    </div>
  );
}

function SideCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-divider px-3.5 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-text-3">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function SessionCosts({ detail }: { detail: RunDetail }) {
  const sessions = detail.stages.flatMap((stage) =>
    stage.sessions.map((session) => ({ stage: stage.key, session })),
  );
  if (sessions.length === 0) {
    return <p className="px-3.5 py-2 text-sm text-text-3">{copy.runs.detail.noSessions}</p>;
  }
  return (
    <ul
      aria-label={copy.runs.detail.costPerSession}
      className="m-0 list-none divide-y divide-divider p-0"
    >
      {sessions.map(({ stage, session }) => (
        <li key={session.id} className="flex justify-between gap-2 px-3.5 py-2 text-sm">
          <span className="truncate">
            {stageName(stage)} · {copy.runs.detail.session.title(session.role)}
          </span>
          <span className="text-text-2 tabular-nums">{money(session.costUsd)}</span>
        </li>
      ))}
    </ul>
  );
}
