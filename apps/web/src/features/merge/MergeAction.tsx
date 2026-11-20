import { CircleCheck, GitMerge } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { copy } from '@/copy/index.ts';
import { ChecklistRow } from '@/features/pr/Checklist.tsx';
import type { MainActionProps } from '@/features/pr/slots.ts';
import { ReadOnlyNote } from '@/features/shell/ReadOnlyNote.tsx';
import { useGitHubReadOnly } from '@/features/shell/status-query.ts';
import { SignatureField } from '@/features/signature/SignatureField.tsx';
import { useSignature } from '@/features/signature/use-signature.ts';
import { ApiError } from '@/lib/api.ts';
import type { MergeFailingRow, PrView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { useMergePr } from './merge.ts';

const t = copy.merge;

type Failure = { text: string; rows: MergeFailingRow[] };

/** What the dialog shows for a failed merge: GitHub's refusal verbatim, the rows that failed. */
function failureOf(error: unknown): Failure {
  if (!(error instanceof ApiError)) return { text: errorText('http_error'), rows: [] };
  const { code, params } = error;
  if (code === 'merge_not_ready') {
    const rows = Array.isArray(params.items) ? (params.items as MergeFailingRow[]) : [];
    return { text: t.notReady, rows };
  }
  if (code === 'merge_refused') return { text: t.refused(String(params.message ?? '')), rows: [] };
  if (code === 'head_moved') return { text: t.headMoved(String(params.headSha ?? '')), rows: [] };
  return { text: errorText(code), rows: [] };
}

/**
 * The Ready to merge banner's main action (spec: `prototype/js/dialogs.js` merge dialog): opens
 * a signed AlertDialog that asks for the PR number before the squash merge.
 */
export function MergeAction({ repo, number, view, action }: MainActionProps) {
  const [open, setOpen] = useState(false);
  const prNumber = view.pullRequest.number;
  const readOnly = useGitHubReadOnly();
  const noteId = useId();

  return (
    <>
      <Button
        size="sm"
        disabled={action.disabled !== null || readOnly}
        aria-describedby={readOnly ? noteId : undefined}
        onClick={() => setOpen(true)}
      >
        <GitMerge aria-hidden="true" className="size-[13px]" />
        {t.open(prNumber)}
      </Button>
      {readOnly && <ReadOnlyNote id={noteId} detail={copy.status.githubReadOnly.merge} />}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="sm:max-w-lg">
          {/* Mounted per open, so each opening starts empty, from the last signer. */}
          {open && (
            <MergeForm repo={repo} number={number} view={view} onDone={() => setOpen(false)} />
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MergeForm({
  repo,
  number,
  view,
  onDone,
}: {
  repo: string;
  number: string;
  view: PrView;
  onDone: () => void;
}) {
  const merge = useMergePr(repo, number);
  const signature = useSignature();
  const [typed, setTyped] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const numberId = useId();
  const { pullRequest, checklist } = view;
  const prNumber = pullRequest.number;
  const sha = view.head.reviewedSha ?? pullRequest.headSha;

  const why =
    typed !== String(prNumber)
      ? t.typeToConfirm(prNumber)
      : !signature.signedBy
        ? t.pickSigner
        : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const signedBy = signature.signedBy;
    if (why || !signedBy) return;
    setFailure(null);
    merge.mutate(
      { typedNumber: prNumber, signedBy },
      {
        onSuccess: (merged) => {
          signature.remember();
          toast.success(t.merged(prNumber, merged.by.name), {
            description: t.mergedHint(merged.sha),
          });
          onDone();
        },
        onError: (error) => setFailure(failureOf(error)),
      },
    );
  }

  const failing = checklist.items.filter((item) => !item.ok);
  return (
    <form onSubmit={submit} className="grid gap-4">
      <AlertDialogHeader>
        <AlertDialogTitle>{t.title(prNumber)}</AlertDialogTitle>
        <AlertDialogDescription>{t.description(sha, pullRequest.baseRef)}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="grid gap-1 text-sm" data-testid="merge-checklist">
        {checklist.ok ? (
          <p className="flex items-center gap-2 font-medium">
            <CircleCheck aria-hidden="true" className="size-[15px] text-ok" />
            {t.checklistGreen(checklist.items.length)}
          </p>
        ) : (
          <>
            <p className="font-medium">{t.checklistFailing}</p>
            <ul className="-mx-3.5">
              {failing.map((item) => (
                <ChecklistRow key={item.item} item={item} />
              ))}
            </ul>
          </>
        )}
        <p className="text-xs text-text-3">{t.freshCheck}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={numberId}>{t.typeNumber(prNumber)}</Label>
          <Input
            id={numberId}
            inputMode="numeric"
            autoComplete="off"
            placeholder={String(prNumber)}
            value={typed}
            className="tabular-nums"
            onChange={(event) => setTyped(event.target.value.replace(/[^0-9]/g, ''))}
          />
        </div>
        <SignatureField signature={signature} hint={t.signatureHint} />
      </div>
      {failure && (
        <div role="alert" className="grid gap-1 text-sm text-bad" data-testid="merge-error">
          <p>{failure.text}</p>
          {failure.rows.length > 0 && (
            <ul className="-mx-3.5 text-text">
              {failure.rows.map((row) => (
                <ChecklistRow key={row.item} item={{ ...row, ok: false }} />
              ))}
            </ul>
          )}
        </div>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel type="button">{t.cancel}</AlertDialogCancel>
        <Button type="submit" disabled={why !== null || merge.isPending} title={why ?? undefined}>
          <GitMerge aria-hidden="true" className="size-[13px]" />
          {merge.isPending ? t.merging : t.confirm(prNumber)}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
