import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { copy } from '@/copy/index.ts';
import { SeverityMark } from '@/features/findings/SeverityMark.tsx';
import { DiffView } from '@/features/instructions/DiffView.tsx';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { ApiError } from '@/lib/api.ts';
import type { TrialDetailResponse, TrialFindingView, TrialRunSide } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { trialQuery } from './queries.ts';

const t = copy.trials.compare;
type Trial = TrialDetailResponse['trial'];

/**
 * A trial's Compare page (S-22-T8, FR-080): only in A, only in B, in both, the cost of each run,
 * the instruction diff and "Go to activate version N" on the draft's editor.
 */
export function ComparePage({ id }: { id: number }) {
  const query = useQuery(trialQuery(id));
  const trial = query.data?.trial;
  const back = (
    <Link
      to="/settings/experiments"
      className="inline-flex items-center gap-1 text-sm font-medium text-brand-text hover:underline"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {t.back}
    </Link>
  );

  return (
    <SettingsPage title={t.title(id)} affects={copy.trials.experiments.affects} actions={back}>
      {!trial ? (
        query.isError ? (
          <p role="alert" data-work-start className="text-bad">
            {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
          </p>
        ) : (
          <p className="text-text-3">{t.loading}</p>
        )
      ) : (
        <TrialCompare trial={trial} />
      )}
    </SettingsPage>
  );
}

function TrialCompare({ trial }: { trial: Trial }) {
  const { compare, diff, draft } = trial;
  return (
    <>
      <p className="text-sm text-text-2">
        {t.subtitle(trial.pr.repo, trial.pr.number, trial.pr.title, trial.headSha)}
        {' · '}
        {copy.trials.status[trial.status] ?? trial.status}
      </p>
      {trial.status === 'running' && (
        <p role="status" className="text-sm text-text-2">
          {t.running}
        </p>
      )}

      <div data-work-start className="grid gap-3 sm:grid-cols-2">
        <CostCard side={t.sides.a} run={trial.runs.a} />
        <CostCard side={t.sides.b} run={trial.runs.b} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Bucket name={t.buckets.onlyA} findings={compare.onlyA} />
        <Bucket name={t.buckets.onlyB} findings={compare.onlyB} />
        <Bucket name={t.buckets.both} findings={compare.both.map((pair) => pair.a)} />
      </div>

      <DiffView
        before={diff.before?.content ?? ''}
        after={diff.after.content}
        label={t.diffLabel(diff.fileKey, diff.before?.version ?? null, diff.after.version)}
      />

      <p className="text-sm">
        {draft.status === 'draft' ? (
          <Link
            to="/settings/instructions/$id"
            params={{ id: String(draft.fileId) }}
            className="font-medium text-brand-text hover:underline"
          >
            {t.activate(draft.version)}
          </Link>
        ) : (
          <span className="text-text-2">{t.noLongerDraft(draft.version, draft.status)}</span>
        )}
      </p>
    </>
  );
}

function CostCard({ side, run }: { side: string; run: TrialRunSide | null }) {
  return (
    <section
      aria-label={t.costLabel(side)}
      className="rounded-lg border border-border bg-surface p-3"
    >
      <h2 className="text-sm font-semibold">{side}</h2>
      <p className="mt-1 text-sm">
        <span className="text-text-3">{t.cost}</span>{' '}
        <span className="font-mono">{t.money(run?.costUsd ?? 0)}</span>
        {run && (
          <>
            {' · '}
            {copy.trials.status[run.status] ?? run.status}
          </>
        )}
      </p>
      {run && (
        <Link
          to="/runs/$runId"
          params={{ runId: String(run.id) }}
          className="mt-1 inline-block text-sm text-brand-text hover:underline"
        >
          {t.runLink}
        </Link>
      )}
    </section>
  );
}

function Bucket({ name, findings }: { name: string; findings: readonly TrialFindingView[] }) {
  return (
    <section aria-label={name} className="rounded-lg border border-border bg-surface p-3">
      <h2 className="text-sm font-semibold">
        {name} <span className="font-normal text-text-3">{findings.length}</span>
      </h2>
      {findings.length === 0 ? (
        <p className="mt-2 text-sm text-text-3">{t.none}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {findings.map((finding) => (
            <li key={finding.id} className="flex items-start gap-2 text-sm">
              <SeverityMark severity={finding.severity} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block">{finding.title}</span>
                <span className="block truncate font-mono text-xs text-text-3">
                  {t.finding(finding.file, finding.line)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
