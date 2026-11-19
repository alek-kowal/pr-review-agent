import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
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
import type { PipelineStageView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { PipelineDiagram } from './PipelineDiagram.tsx';
import { pipelineQuery } from './queries.ts';

const t = copy.pipeline;
const labelOf = (stage: PipelineStageView) => t.stages[stage.key] ?? stage.key;

/**
 * Settings → Pipeline (S-22-T10, FR-081): the read-only diagram, a table of the stages, and a
 * Sheet with a stage's model, tools, instructions, output, timeout and attempts.
 */
export function PipelinePage() {
  const query = useQuery(pipelineQuery());
  const stages = query.data?.stages;
  const [selected, setSelected] = useState<string | null>(null);
  const pick = useCallback((key: string) => setSelected(key), []);
  const stage = stages?.find((s) => s.key === selected) ?? null;
  const c = t.columns;

  return (
    <SettingsPage title={t.title} affects={t.affects}>
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
          {stage && <StageDetails stage={stage} />}
        </SheetContent>
      </Sheet>
    </SettingsPage>
  );
}

function StageDetails({ stage }: { stage: PipelineStageView }) {
  const s = t.sheet;
  const model = stage.model;
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
          <dt className="text-text-3">{s.instructions}</dt>
          <dd>
            {stage.instructions.length === 0 ? (
              s.noInstructions
            ) : (
              <ul className="flex flex-col gap-1">
                {stage.instructions.map((file) => (
                  <li key={file.fileKey} className="font-mono text-[13px]">
                    {file.fileId !== null ? (
                      <Link
                        to="/settings/instructions/$id"
                        params={{ id: String(file.fileId) }}
                        className="text-brand-text hover:underline"
                      >
                        {s.fileVersion(file.fileKey, file.version)}
                      </Link>
                    ) : (
                      <span className="text-text-3">{s.fileVersion(file.fileKey, null)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </dd>
          <dt className="text-text-3">{s.output}</dt>
          <dd>{s.outputValue(stage.output.schema, stage.output.fields)}</dd>
          <dt className="text-text-3">{s.timeout}</dt>
          <dd>{t.timeout(stage.timeoutMinutes)}</dd>
          <dt className="text-text-3">{s.attempts}</dt>
          <dd>{t.attempts(stage.attempts, stage.repairs)}</dd>
          <dt className="text-text-3">{s.turnsOn}</dt>
          <dd>{s.level(stage.onFrom)}</dd>
        </dl>
      </div>
    </>
  );
}
