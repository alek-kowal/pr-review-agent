import { useQuery } from '@tanstack/react-query';
import { RotateCcw, Sparkles, SquarePen } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { copy } from '@/copy/index.ts';
import { ApiError } from '@/lib/api.ts';
import type { PatchDetail, PatchFileView, PatchSummaryView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { cn } from '@/lib/utils.ts';
import { EmptyTab } from '@/features/pr/EmptyTab.tsx';
import type { PrTabProps } from '@/features/pr/tabs.ts';
import { patchQuery, useEditPatchFile, useRevertPatchFile, useRevisePatch } from './queries.ts';

const t = copy.implementer.patch;
const errorOf = (error: unknown) =>
  errorText(error instanceof ApiError ? error.code : 'http_error');

type Shown = { id: number; checkVersion: number };
const shownOf = (patch: PatchSummaryView): Shown => ({
  id: patch.id,
  checkVersion: patch.checkVersion,
});

/**
 * The Patch tab (S-13-T6, `?tab=patch`): the newest patch revision with a diff per file, Edit,
 * Revert file and "Revise with this note". A new revision or a new reproduction result waits
 * behind "View new results", as findings do; the reader's own edits show at once.
 */
export function PatchTab({ repo, number, view }: PrTabProps) {
  const { patch: latest, activeRun } = view.implementer;
  const [shown, setShown] = useState<Shown | null>(latest ? shownOf(latest) : null);
  // Adjusting state while rendering, as React suggests for a changed input: the first patch shows.
  if (!shown && latest) setShown(shownOf(latest));

  if (!latest || !shown) return <EmptyTab text={activeRun ? t.running : t.empty} />;
  const newer = latest.id !== shown.id || latest.checkVersion !== shown.checkVersion;

  return (
    <div className="grid gap-4 py-4">
      {newer && <NewResultsStrip onShow={() => setShown(shownOf(latest))} />}
      {activeRun && <p className="text-sm text-text-3">{t.running}</p>}
      <PatchRevision
        key={`${shown.id}:${shown.checkVersion}`}
        repo={repo}
        number={number}
        shown={shown}
        editable={activeRun === null && !newer}
      />
    </div>
  );
}

function NewResultsStrip({ onShow }: { onShow: () => void }) {
  return (
    <div
      role="status"
      data-testid="new-results"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-line bg-brand-bg px-3 py-2 text-sm"
    >
      <Sparkles aria-hidden="true" className="size-3.5 shrink-0 text-brand-text" />
      <span className="font-medium">{t.newResults}</span>
      <button
        type="button"
        onClick={onShow}
        className="cursor-pointer font-medium text-brand-text hover:underline"
      >
        {t.viewNewResults}
      </button>
    </div>
  );
}

function PatchRevision({
  repo,
  number,
  shown,
  editable,
}: {
  repo: string;
  number: string;
  shown: Shown;
  editable: boolean;
}) {
  const { data: detail } = useQuery(patchQuery(shown.id, shown.checkVersion));
  if (!detail) return null;
  const { patch } = detail;
  const open = editable && patch.status === 'ready';
  const files = detail.files.filter((file) => file.status !== 'reverted');

  return (
    <>
      <div className="grid gap-1">
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="font-heading text-base font-semibold" data-testid="patch-summary">
            {t.summary(patch.fixed, patch.total, patch.reproductions)}
          </span>
          <span className="text-xs text-text-3">{t.revision(patch.revision)}</span>
        </p>
        {patch.checking && <p className="text-sm text-text-3">{t.checking}</p>}
        {patch.status === 'superseded' && <p className="text-sm text-text-3">{t.superseded}</p>}
        {patch.summary && <p className="text-sm text-text-2">{patch.summary}</p>}
      </div>
      <p className="text-xs text-text-3">{t.files(files.length)}</p>
      <ul className="grid gap-3">
        {files.map((file) => (
          <li key={file.path}>
            <PatchFile repo={repo} number={number} detail={detail} file={file} editable={open} />
          </li>
        ))}
      </ul>
      {open && <ReviseForm repo={repo} number={number} patchId={patch.id} />}
    </>
  );
}

function PatchFile({
  repo,
  number,
  detail,
  file,
  editable,
}: {
  repo: string;
  number: string;
  detail: PatchDetail;
  file: PatchFileView;
  editable: boolean;
}) {
  const edit = useEditPatchFile(repo, number, detail);
  const revert = useRevertPatchFile(repo, number, detail);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = edit.isPending || revert.isPending;

  const save = () => {
    if (draft === null) return;
    setError(null);
    edit.mutate(
      { file, content: draft },
      {
        onSuccess: () => {
          setDraft(null);
          toast.success(t.saved(file.path));
        },
        onError: (failure) => setError(errorOf(failure)),
      },
    );
  };

  return (
    <section
      aria-label={file.path}
      data-testid="patch-file"
      className="grid gap-2 rounded-lg border border-border bg-surface p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] break-all">{file.path}</span>
        <Badge variant="outline">{t.fileStatus[file.status] ?? file.status}</Badge>
        {file.base === null && <Badge variant="outline">{t.newFile}</Badge>}
        {file.content === null && <Badge variant="outline">{t.deletedFile}</Badge>}
        <span className="flex-1" />
        {editable && draft === null && (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || file.content === null}
              onClick={() => {
                setError(null);
                setDraft(file.content ?? '');
              }}
            >
              <SquarePen aria-hidden="true" className="size-[13px]" />
              {t.edit}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t.revertLabel(file.path)}
              disabled={busy}
              onClick={() =>
                revert.mutate(file, {
                  onSuccess: () => toast.success(t.reverted(file.path)),
                  onError: (failure) => setError(errorOf(failure)),
                })
              }
            >
              <RotateCcw aria-hidden="true" className="size-[13px]" />
              {t.revert}
            </Button>
          </>
        )}
      </div>
      {draft !== null ? (
        <div className="grid gap-2">
          <Textarea
            aria-label={t.editLabel(file.path)}
            rows={12}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="font-mono text-[12px]"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              {t.cancel}
            </Button>
            <Button size="sm" disabled={edit.isPending} onClick={save}>
              {edit.isPending ? t.saving : t.save}
            </Button>
          </div>
        </div>
      ) : (
        <Diff text={file.diff} />
      )}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </section>
  );
}

/** The API's unified diff, one line per row: added green, removed red, hunk headers quiet. */
function Diff({ text }: { text: string }) {
  if (!text) return <p className="text-sm text-text-3">{t.noChanges}</p>;
  const lines = text.replace(/\n$/, '').split('\n');
  return (
    <pre
      data-testid="patch-diff"
      className="max-h-[480px] overflow-auto rounded-md border border-border bg-inset p-2 font-mono text-[12px] leading-5"
    >
      {lines.map((line, index) => (
        <div
          key={index}
          className={cn(
            'px-2 whitespace-pre',
            line.startsWith('@@') && 'text-text-3',
            line.startsWith('+') && !line.startsWith('+++') && 'bg-ok-bg text-ok',
            line.startsWith('-') && !line.startsWith('---') && 'bg-bad-bg text-bad',
          )}
        >
          {line}
        </div>
      ))}
    </pre>
  );
}

function ReviseForm({ repo, number, patchId }: { repo: string; number: string; patchId: number }) {
  const revise = useRevisePatch(repo, number, patchId);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const errorId = useId();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!note.trim()) return setError(errorText('note_required'));
    setError(null);
    revise.mutate(note.trim(), {
      onSuccess: () => {
        setNote('');
        toast.success(t.revise.started);
      },
      onError: (failure) => setError(errorOf(failure)),
    });
  };

  return (
    <form
      onSubmit={submit}
      aria-label={t.revise.label}
      className="grid gap-2 rounded-lg border border-border bg-inset p-3"
    >
      <Label htmlFor={noteId}>{t.revise.noteLabel}</Label>
      <Textarea
        id={noteId}
        rows={3}
        value={note}
        placeholder={t.revise.placeholder}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setNote(event.target.value);
          setError(null);
        }}
        className="bg-surface"
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={revise.isPending}>
          {revise.isPending ? t.revise.sending : t.revise.submit}
        </Button>
      </div>
    </form>
  );
}
