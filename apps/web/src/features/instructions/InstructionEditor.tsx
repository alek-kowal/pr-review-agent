import { diffSummary, lineDiff } from '@pra/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { copy } from '@/copy/index.ts';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { SignedSaveDialog } from '@/features/settings/SignedSaveDialog.tsx';
import { ApiError } from '@/lib/api.ts';
import type { InstructionDetailResponse, InstructionVersionView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { DiffView } from './DiffView.tsx';
import { instructionQuery, useInstructionChange } from './queries.ts';

const t = copy.instructions;
const e = t.editor;

type Props = {
  id: number;
  /** "Try on a PR…" for the saved draft; left out, the button is not shown. */
  tryOnPr?: (detail: InstructionDetailResponse, draft: InstructionVersionView) => ReactNode;
};

/**
 * An instruction file's editor (S-22-T5): the text with a live diff against the active version, a
 * note and Save as draft (unsigned), "Activate version N…" and Rollback (signed), and the version
 * history with the runs that read each version.
 */
export function InstructionEditor({ id, tryOnPr }: Props) {
  const query = useQuery(instructionQuery(id));
  const detail = query.data;

  if (!detail) {
    return (
      <SettingsPage title={t.title} affects={t.affects}>
        {query.isError ? (
          <p role="alert" className="text-bad">
            {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
          </p>
        ) : (
          <p className="text-text-3">{t.loading}</p>
        )}
      </SettingsPage>
    );
  }
  // Mounted per file, so the form starts from what is stored.
  return <EditorForm key={detail.file.id} detail={detail} tryOnPr={tryOnPr} />;
}

function EditorForm({
  detail,
  tryOnPr,
}: {
  detail: InstructionDetailResponse;
  tryOnPr: Props['tryOnPr'];
}) {
  const { file, versions } = detail;
  const active = versions.find((v) => v.status === 'active') ?? null;
  const draft = versions.find((v) => v.status === 'draft') ?? null;
  const nextVersion = (versions[0]?.version ?? 0) + 1;
  const [content, setContent] = useState(draft?.content ?? active?.content ?? '');
  const [note, setNote] = useState(draft?.note ?? '');
  const [saved, setSaved] = useState(false);
  const [signing, setSigning] = useState<InstructionVersionView | null>(null);
  const change = useInstructionChange(file.id);
  const ids = { content: useId(), note: useId() };
  const dirty =
    content !== (draft?.content ?? active?.content ?? '') || note !== (draft?.note ?? '');

  async function saveDraft(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    try {
      await change.mutateAsync({ kind: 'draft', content, note: note.trim() || null });
      setSaved(true);
    } catch {
      // `change.error` shows it below the buttons.
    }
  }

  const scope =
    file.scope === 'repository'
      ? e.scope.repository(file.repository?.slug ?? '')
      : file.scope === 'level'
        ? e.scope.level(file.level ?? 0)
        : e.scope.global;

  return (
    <SettingsPage
      title={e.title(file.fileKey)}
      affects={t.affects}
      actions={
        <Link
          to="/settings/instructions"
          className="inline-flex items-center gap-1 text-sm text-brand-text hover:underline"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {t.back}
        </Link>
      }
    >
      <p className="-mt-2 flex flex-wrap items-center gap-2 text-sm text-text-2">
        <Badge variant="outline">{scope}</Badge>
        <span>
          {draft ? e.editingDraft(draft.version) : active ? e.editingNew(nextVersion) : e.noActive}
        </span>
      </p>

      <form onSubmit={saveDraft} className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.content}>{e.contentLabel}</Label>
            <Textarea
              id={ids.content}
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                setSaved(false);
              }}
              spellCheck={false}
              className="min-h-[420px] font-mono text-[13px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.note}>{e.noteLabel}</Label>
            <Input
              id={ids.note}
              value={note}
              placeholder={e.notePlaceholder}
              onChange={(event) => {
                setNote(event.target.value);
                setSaved(false);
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={change.isPending || !dirty}>
              {change.isPending ? e.savingDraft : e.saveDraft}
            </Button>
            {tryOnPr && draft && !dirty ? (
              tryOnPr(detail, draft)
            ) : (
              <Button type="button" variant="outline" disabled>
                {e.tryOnPr}
              </Button>
            )}
            {draft && (
              <Button
                type="button"
                variant="outline"
                disabled={dirty}
                onClick={() => setSigning(draft)}
              >
                {e.activate(draft.version)}
              </Button>
            )}
          </div>
          {saved && (
            <p role="status" className="text-sm text-text-2">
              {e.draftSaved}
            </p>
          )}
          {change.isError && !signing && (
            <p role="alert" className="text-sm text-bad">
              {errorText(change.error instanceof ApiError ? change.error.code : 'http_error')}
            </p>
          )}
        </div>
        <DiffView
          before={active?.content ?? ''}
          after={content}
          label={e.diffLabel(active?.version ?? null)}
        />
      </form>

      <VersionHistory versions={versions} onRollback={setSigning} />

      <SignedSaveDialog
        open={signing !== null}
        onOpenChange={(open) => !open && setSigning(null)}
        title={
          signing?.status === 'archived'
            ? t.activateDialog.rollbackTitle(signing.version)
            : t.activateDialog.title(signing?.version ?? 0)
        }
        description={t.activateDialog.description}
        confirmLabel={
          signing?.status === 'archived'
            ? t.activateDialog.rollbackConfirm
            : t.activateDialog.confirm
        }
        changes={signing ? activationRows(file.fileKey, active, signing) : []}
        onConfirm={async (signedBy) => {
          const next = await change.mutateAsync({
            kind: signing?.status === 'archived' ? 'rollback' : 'activate',
            versionId: signing!.id,
            activeVersion: active?.version ?? null,
            signedBy,
          });
          // The form starts over from the newly active version.
          const stored = next.versions.find((v) => v.status === 'draft' || v.status === 'active');
          setContent(stored?.content ?? '');
          setNote(stored?.status === 'draft' ? (stored.note ?? '') : '');
        }}
      />
    </SettingsPage>
  );
}

/** The before and after of an activation: the active version number and the changed lines. */
function activationRows(
  fileKey: string,
  active: InstructionVersionView | null,
  target: InstructionVersionView,
) {
  const d = t.activateDialog;
  const summary = diffSummary(lineDiff(active?.content ?? '', target.content));
  return [
    { key: 'file', label: d.file, before: fileKey, after: fileKey },
    {
      key: 'version',
      label: d.activeVersion,
      before: active ? t.version(active.version) : '',
      after: t.version(target.version),
    },
    {
      key: 'lines',
      label: d.lines,
      before: '',
      after: e.diffSummary(summary.added, summary.removed),
    },
  ];
}

function VersionHistory({
  versions,
  onRollback,
}: {
  versions: readonly InstructionVersionView[];
  onRollback: (version: InstructionVersionView) => void;
}) {
  const h = t.history;
  return (
    <section aria-labelledby="instruction-history" className="flex flex-col gap-2">
      <h2 id="instruction-history" className="font-heading text-base font-semibold">
        {h.title}
      </h2>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{h.tableLabel}</caption>
          <thead className="bg-surface-2 text-xs text-text-3">
            <tr>
              {[
                h.columns.version,
                h.columns.status,
                h.columns.note,
                h.columns.by,
                h.columns.runs,
              ].map((c) => (
                <th key={c} scope="col" className="px-3 py-2 font-semibold">
                  {c}
                </th>
              ))}
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">{h.columns.actions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id} className="border-t border-divider align-top">
                <th scope="row" className="px-3 py-2 font-mono font-medium">
                  {t.version(v.version)}
                </th>
                <td className="px-3 py-2">{h.status[v.status]}</td>
                <td className="px-3 py-2 text-text-2">{v.note ?? t.none}</td>
                <td className="px-3 py-2 text-text-2">
                  {v.signerName
                    ? h.by.signed(v.signerName)
                    : v.author === 'member' && v.authorName
                      ? h.by.signed(v.authorName)
                      : v.author === 'bot'
                        ? h.by.bot
                        : h.by.hand}
                </td>
                <td className="px-3 py-2">
                  {v.runs.length === 0 ? (
                    <span className="text-text-3">{h.noRuns}</span>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {v.runs.map((run) => (
                        <li key={run.runId}>
                          <Link
                            to="/runs/$runId"
                            params={{ runId: String(run.runId) }}
                            className="text-brand-text hover:underline"
                          >
                            {h.run(run.repositorySlug, run.prNumber, run.runId)}
                          </Link>
                        </li>
                      ))}
                      {v.runCount > v.runs.length && (
                        <li className="text-text-3">{h.moreRuns(v.runCount - v.runs.length)}</li>
                      )}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {v.status === 'archived' && (
                    <Button type="button" variant="outline" size="sm" onClick={() => onRollback(v)}>
                      {h.rollback(v.version)}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
