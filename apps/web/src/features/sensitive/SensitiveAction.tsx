import { Check, Undo2 } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { copy } from '@/copy/index.ts';
import type { MainActionProps } from '@/features/pr/slots.ts';
import { SignatureField } from '@/features/signature/SignatureField.tsx';
import { useSignature } from '@/features/signature/use-signature.ts';
import { ApiError } from '@/lib/api.ts';
import type { PrView } from '@/lib/api-types.ts';
import { authorName } from '@/lib/next-step.ts';
import { errorText } from '@/lib/reasons.ts';
import { useApproveSensitive, useSendBackSensitive } from './sensitive.ts';

const t = copy.sensitive;
const errorOf = (error: unknown) =>
  errorText(error instanceof ApiError ? error.code : 'http_error');

/**
 * The banner's `approve_sensitive` action (spec: `prototype/js/pr.js`, flow B step 6): Approve
 * changes is not signed and is recorded "by hand"; Send back… opens a signed form with a comment.
 */
export function SensitiveAction({ repo, number, view, action }: MainActionProps) {
  const approve = useApproveSensitive(repo, number);
  const [sending, setSending] = useState(false);
  const disabled = action.disabled !== null;

  return (
    <>
      <Button
        size="sm"
        title={t.approveHint}
        disabled={disabled || approve.isPending}
        onClick={() =>
          approve.mutate(view.sensitive.version, {
            onSuccess: () => toast.success(t.approved, { description: t.approvedHint }),
            onError: (error) => toast.error(errorOf(error)),
          })
        }
      >
        <Check aria-hidden="true" className="size-[13px]" />
        {t.approve}
      </Button>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => setSending(true)}>
        <Undo2 aria-hidden="true" className="size-[13px]" />
        {t.sendBack}
      </Button>
      <Dialog open={sending} onOpenChange={setSending}>
        <DialogContent className="sm:max-w-lg">
          {/* Mounted per open, so each opening starts from the last signer and no old error. */}
          <SendBackForm repo={repo} number={number} view={view} onDone={() => setSending(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function SendBackForm({
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
  const sendBack = useSendBackSensitive(repo, number);
  const signature = useSignature();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const commentId = useId();
  const author = authorName(view.author);
  const open = view.sensitive.files.filter((file) => file.status !== 'approved');

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return setError(t.dialog.commentRequired(author));
    const signedBy = signature.signedBy;
    if (!signedBy) return setError(copy.signature.required);
    setError(null);
    sendBack.mutate(
      { version: view.sensitive.version, comment: comment.trim(), signedBy },
      {
        onSuccess: () => {
          signature.remember();
          const signer = signature.members.find((m) => m.id === signedBy)?.name ?? '';
          toast.success(t.dialog.sent(author), { description: t.dialog.sentHint(signer) });
          onDone();
        },
        onError: (failure) => setError(errorOf(failure)),
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t.dialog.title}</DialogTitle>
        <DialogDescription>{t.dialog.description(author)}</DialogDescription>
      </DialogHeader>
      <ul className="grid gap-1 font-mono text-[13px] break-all">
        {open.map((file) => (
          <li key={file.path}>{file.path}</li>
        ))}
      </ul>
      <div className="grid gap-1.5">
        <Label htmlFor={commentId}>{t.dialog.commentLabel}</Label>
        <Textarea
          id={commentId}
          rows={3}
          value={comment}
          placeholder={t.dialog.commentPlaceholder}
          onChange={(event) => {
            setComment(event.target.value);
            setError(null);
          }}
        />
      </div>
      <SignatureField signature={signature} />
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t.dialog.cancel}
        </Button>
        <Button type="submit" disabled={sendBack.isPending}>
          <Undo2 aria-hidden="true" className="size-[13px]" />
          {t.dialog.confirm(author)}
        </Button>
      </DialogFooter>
    </form>
  );
}
