import { useQuery } from '@tanstack/react-query';
import { GitBranchPlus } from 'lucide-react';
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
import type { MainActionProps } from '@/features/pr/slots.ts';
import { ReadOnlyNote } from '@/features/shell/ReadOnlyNote.tsx';
import { useGitHubReadOnly } from '@/features/shell/status-query.ts';
import { SignatureField } from '@/features/signature/SignatureField.tsx';
import { useSignature } from '@/features/signature/use-signature.ts';
import { ApiError } from '@/lib/api.ts';
import type { PatchSummaryView, PrView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { patchQuery, usePushPatch } from './queries.ts';

const t = copy.push;
const tp = copy.implementer.patch;

/** A refused push in plain words: the moved head names the new commit. */
function refusalOf(error: unknown): string {
  if (!(error instanceof ApiError)) return errorText('http_error');
  const { code, params } = error;
  if (code === 'head_moved') return t.headMoved(String(params.headSha ?? ''));
  if (code === 'pr_number_mismatch') return t.numberMismatch(Number(params.number));
  return errorText(code);
}

/**
 * The Patch ready banner's main action: "Push to <branch>…" opens a signed AlertDialog with the
 * patch summary that asks for the PR number before the push is queued.
 */
export function PushAction({ repo, number, view, action }: MainActionProps) {
  const [open, setOpen] = useState(false);
  const readOnly = useGitHubReadOnly();
  const noteId = useId();
  const patch = view.implementer.patch;
  if (!patch) return null;
  const branch = view.pullRequest.headRef;

  return (
    <>
      <Button
        size="sm"
        disabled={action.disabled !== null || readOnly}
        aria-describedby={readOnly ? noteId : undefined}
        onClick={() => setOpen(true)}
      >
        <GitBranchPlus aria-hidden="true" className="size-[13px]" />
        {t.open(branch)}
      </Button>
      {readOnly && <ReadOnlyNote id={noteId} detail={copy.status.githubReadOnly.push} />}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="sm:max-w-lg">
          {/* Mounted per open, so each opening starts empty, from the last signer. */}
          {open && (
            <PushForm
              repo={repo}
              number={number}
              view={view}
              patch={patch}
              onDone={() => setOpen(false)}
            />
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PushForm({
  repo,
  number,
  view,
  patch,
  onDone,
}: {
  repo: string;
  number: string;
  view: PrView;
  patch: PatchSummaryView;
  onDone: () => void;
}) {
  const push = usePushPatch(repo, number, patch.id);
  const detail = useQuery(patchQuery(patch.id, patch.checkVersion));
  const signature = useSignature();
  const [typed, setTyped] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const numberId = useId();
  const prNumber = view.pullRequest.number;
  const branch = view.pullRequest.headRef;
  const files = detail.data?.files.filter((file) => file.status !== 'reverted').length;

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
    setRefusal(null);
    push.mutate(
      { typedNumber: prNumber, signedBy },
      {
        onSuccess: () => {
          signature.remember();
          toast.success(t.queued(branch), { description: t.queuedHint });
          onDone();
        },
        onError: (error) => setRefusal(refusalOf(error)),
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <AlertDialogHeader>
        <AlertDialogTitle>{t.title(branch)}</AlertDialogTitle>
        <AlertDialogDescription>{t.description(patch.baseSha)}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="grid gap-1 text-sm" data-testid="push-summary">
        <p className="font-medium">
          {tp.summary(patch.fixed, patch.total, patch.reproductions)}
          {files !== undefined && ` · ${tp.files(files)}`}
        </p>
        {patch.summary && <p className="text-text-2">{patch.summary}</p>}
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
      {refusal && (
        <p role="alert" className="text-sm text-bad" data-testid="push-error">
          {refusal}
        </p>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel type="button">{t.cancel}</AlertDialogCancel>
        <Button type="submit" disabled={why !== null || push.isPending} title={why ?? undefined}>
          <GitBranchPlus aria-hidden="true" className="size-[13px]" />
          {push.isPending ? t.pushing : t.confirm(branch)}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
