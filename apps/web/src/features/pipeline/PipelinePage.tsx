import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet.tsx';
import { copy } from '@/copy/index.ts';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { ApiError } from '@/lib/api.ts';
import type { PipelineResponse, PipelineStageView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { PipelineDiagram } from './PipelineDiagram.tsx';
import { pipelineQuery } from './queries.ts';
import { StageFilesForm } from './StageFilesForm.tsx';

const t = copy.pipeline;
const labelOf = (stage: PipelineStageView) => t.stages[stage.key] ?? stage.key;
/** The scope picker's value for Global (a slug never starts with `@`). */
const GLOBAL = '@global';

/**
 * Settings → Pipeline (S-22-T10, FR-081): the read-only diagram, a table of the stages, and a
 * Sheet with a stage's model, tools, output, timeout and attempts. The stage files (STAGEFILES)
 * are picked in the Sheet at the scope chosen above the diagram, kept in `?repository=`.
 */
export function PipelinePage() {
  const search = useSearch({ from: '/settings/pipeline' });
  const navigate = useNavigate({ from: '/settings/pipeline' });
  const repository = search.repository ?? null;
  const query = useQuery({ ...pipelineQuery(repository), placeholderData: keepPreviousData });
  const data = query.data;
  const stages = data?.stages;
  const [selected, setSelected] = useState<string | null>(null);
  const pick = useCallback((key: string) => setSelected(key), []);
  const stage = stages?.find((s) => s.key === selected) ?? null;
  const c = t.columns;

  return (
    <SettingsPage title={t.title} affects={t.affects}>
      {data && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span id="pipeline-scope" className="text-text-2">
            {t.scope.label}
          </span>
          <Select
            value={data.scope.repository?.slug ?? GLOBAL}
            onValueChange={(next) =>
              void navigate({
                search: { repository: next === GLOBAL ? undefined : next },
                replace: true,
              })
            }
          >
            <SelectTrigger aria-labelledby="pipeline-scope" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GLOBAL}>{t.scope.global}</SelectItem>
              {data.repositories.map((r) => (
                <SelectItem key={r.id} value={r.slug}>
                  {r.slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-text-3">{t.scope.hint}</span>
        </div>
      )}
      {!stages ? (
        query.isError ? (
          <p role="alert" data-work-start className="text-bad">
            {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
          </p>
        ) : (
          <p className="text-text-3">{t.loading}</p>
        )
      ) : (
        <>
          <section data-work-start className="rounded-lg border border-border bg-surface p-3">
            <PipelineDiagram stages={stages} selected={selected} onPick={pick} />
            <p className="mt-1 text-xs text-text-3">{t.hint}</p>
          </section>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t.tableLabel}</caption>
              <thead className="bg-surface-2 text-xs text-text-3">
                <tr>
                  {[c.stage, c.runsAs, c.model, c.from, c.timeout, c.attempts].map((name) => (
                    <th key={name} scope="col" className="px-3 py-2 font-semibold">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stages.map((s) => (
                  <tr key={s.key} className="border-t border-divider">
                    <th scope="row" className="px-3 py-2 font-medium">
                      {labelOf(s)}
                    </th>
                    <td className="px-3 py-2">{s.role ? t.runsAs.agent : t.runsAs.code}</td>
                    <td className="px-3 py-2 font-mono text-[13px]">{s.model?.model ?? '—'}</td>
                    <td className="px-3 py-2">{s.onFrom}</td>
                    <td className="px-3 py-2">{t.timeout(s.timeoutMinutes)}</td>
                    <td className="px-3 py-2">{t.attempts(s.attempts, s.repairs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Sheet open={stage !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent closeLabel={t.sheet.close} className="overflow-y-auto">
          {stage && data && <StageDetails stage={stage} data={data} />}
        </SheetContent>
      </Sheet>
    </SettingsPage>
  );
}

function StageDetails({ stage, data }: { stage: PipelineStageView; data: PipelineResponse }) {
  const s = t.sheet;
  const model = stage.model;
  const repository = data.scope.repository?.slug ?? null;
  return (
    <>
      <SheetHeader>
        <SheetTitle>{labelOf(stage)}</SheetTitle>
        <SheetDescription>
          {s.subtitle(stage.role ? t.runsAs.agent : t.runsAs.code, stage.onFrom)}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4 pb-4 text-sm">
        <p>{t.what[stage.key]}</p>
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-3">
          <dt className="text-text-3">{s.model}</dt>
          <dd>
            {model ? (
              <>
                <span className="font-mono">{model.model}</span>{' '}
                <span className="text-text-3">
                  · {t.role(stage.role ?? '')} ·{' '}
                  {model.source === 'level'
                    ? t.modelSource.level(model.level)
                    : t.modelSource[model.source]}
                </span>
              </>
            ) : (
              t.noModel
            )}
          </dd>
          <dt className="text-text-3">{s.tools}</dt>
          <dd className="font-mono text-[13px]">
            {stage.tools.length ? stage.tools.join(', ') : s.noTools}
          </dd>
          {stage.integrations.length > 0 && (
            <>
              <dt className="text-text-3">{s.integrations}</dt>
              <dd className="font-mono text-[13px]">{stage.integrations.join(', ')}</dd>
            </>
          )}
          {!stage.files && (
            <>
              <dt className="text-text-3">{s.instructions}</dt>
              <dd>{s.noInstructions}</dd>
            </>
          )}
          <dt className="text-text-3">{s.output}</dt>
          <dd>{s.outputValue(stage.output.schema, stage.output.fields)}</dd>
          <dt className="text-text-3">{s.timeout}</dt>
          <dd>{t.timeout(stage.timeoutMinutes)}</dd>
          <dt className="text-text-3">{s.attempts}</dt>
          <dd>{t.attempts(stage.attempts, stage.repairs)}</dd>
          <dt className="text-text-3">{s.turnsOn}</dt>
          <dd>{s.level(stage.onFrom)}</dd>
        </dl>
        {stage.files && (
          // Mounted per stage and scope, so the form starts from what is stored there.
          <StageFilesForm
            key={`${stage.key}:${repository ?? ''}`}
            stageKey={stage.key}
            stageLabel={labelOf(stage)}
            files={stage.files}
            options={data.options}
            repository={repository}
          />
        )}
      </div>
    </>
  );
}
