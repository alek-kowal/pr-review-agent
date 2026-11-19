import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
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
import { copy } from '@/copy/index.ts';
import type { MainActionProps } from '@/features/pr/slots.ts';
import { findingsQuery } from '@/features/pr/queries.ts';
import { SignatureField } from '@/features/signature/SignatureField.tsx';
import { useSignature } from '@/features/signature/use-signature.ts';
import { ApiError } from '@/lib/api.ts';
import type { PrView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { useImplement } from './implement.ts';
import { RaiseLevelButton } from './RaiseLevelButton.tsx';

const t = copy.implementer;
const errorOf = (error: unknown) =>
  errorText(error instanceof ApiError ? error.code : 'http_error');

/**
 * The banner's `implement_with_agent` action on Waiting for the fix (S-13-T5): a Dialog with the
 * findings and the signature. Below level 4 it is off with the reason, and "Raise this PR to
 * level 4" sets the PR's own level (unsigned).
 */
export function ImplementAction({ repo, number, view, action }: MainActionProps) {
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const block = action.disabled;

  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {block?.code === 'implement_below_level' && (
          <RaiseLevelButton repo={repo} number={number} />
        )}
        <Button
          size="sm"
          disabled={block !== null}
          aria-describedby={block ? reasonId : undefined}
          onClick={() => setOpen(true)}
        >
          <Bot aria-hidden="true" className="size-[13px]" />
          {copy.nextStep.actions.implement_with_agent}
        </Button>
      </div>
      {block && (
        <p id={reasonId} className="text-xs text-text-3">
          {t.blockText(block)}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          {/* Mounted per open, so each opening starts from the last signer and no old error. */}
          <ImplementForm repo={repo} number={number} view={view} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ImplementForm({
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
  const implement = useImplement(repo, number);
  const signature = useSignature();
  const findings = useQuery(findingsQuery(repo, number)).data?.findings ?? [];
  const [error, setError] = useState<string | null>(null);
  const { gate } = view.implementer;
  const chosen = findings.filter((finding) => gate.findingIds.includes(finding.id));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const signedBy = signature.signedBy;
    if (!signedBy) return setError(copy.signature.required);
    setError(null);
    implement.mutate(signedBy, {
      onSuccess: (result) => {
        signature.remember();
        const signer = signature.members.find((m) => m.id === signedBy)?.name ?? '';
        toast.success(t.started(result.findingIds.length), {
          description: copy.decisions.toast.signed(signer),
        });
        onDone();
      },
      onError: (failure) => setError(errorOf(failure)),
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4" aria-label={t.dialog.title}>
      <DialogHeader>
        <DialogTitle>{t.dialog.title}</DialogTitle>
        <DialogDescription>{t.dialog.description(gate.findingIds.length)}</DialogDescription>
      </DialogHeader>
      {gate.reason && <p className="text-sm text-text-2">{t.blockText(gate.reason)}</p>}
      {chosen.length > 0 && (
        <div className="grid gap-1.5">
          <p className="text-sm font-medium">{t.dialog.findings}</p>
          <ul className="grid gap-1 text-sm">
            {chosen.map((finding) => (
              <li key={finding.id}>{t.dialog.finding(finding.ordinal, finding.title)}</li>
            ))}
          </ul>
        </div>
      )}
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
        <Button type="submit" disabled={implement.isPending || !gate.allowed}>
          <Bot aria-hidden="true" className="size-[13px]" />
          {implement.isPending ? t.dialog.starting : t.dialog.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}
