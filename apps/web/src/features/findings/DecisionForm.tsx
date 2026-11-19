import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Decision } from '@pra/core';
import { cn } from 'cn';
import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { copy } from '@/copy/index.ts';
import { ApiError } from '@/lib/api.ts';
import type { FindingView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { SignatureField } from '@/features/signature/SignatureField.tsx';
import { useSignature } from '@/features/signature/use-signature.ts';
import { conflictNames, useDecide } from './decisions.ts';

type Props = {
  repo: string;
  number: string;
  findings: FindingView[];
  decision: Decision;
  onDone: () => void;
  onCancel: () => void;
  className?: string;
};

/**
 * The small signed form of one decision on one or more findings. Reject needs a reason; Defer
 * takes an optional note for the follow-up task. Enter confirms (Shift+Enter adds a line).
 */
export function DecisionForm({
  repo,
  number,
  findings,
  decision,
  onDone,
  onCancel,
  className,
}: Props) {
  const signature = useSignature();
  const decide = useDecide(repo, number);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const reasonId = useId();
  const errorId = useId();
  const count = findings.length;
  const withReason = decision !== 'implement';
  const reasonMissing = decision === 'reject' && !reason.trim();

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (decide.isPending) return;
    if (reasonMissing) return setError(copy.decisions.reason.required);
    if (!signature.signedBy) return setSignatureError(copy.signature.required);
    setError(null);
    const signer = signature.members.find((m) => m.id === signature.signedBy);
    try {
      await decide.mutateAsync({
        findings,
        decision,
        reason,
        signedBy: signature.signedBy,
        signerName: signer?.name ?? '',
      });
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : 'http_error';
      return setError(
        failure instanceof ApiError && code === 'decision_conflict'
          ? copy.decisions.conflict(conflictNames(failure))
          : errorText(code),
      );
    }
    signature.remember();
    onDone();
  };

  const enterConfirms = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <form
      aria-label={copy.decisions.formTitle(decision, count)}
      data-decision-form={decision}
      onSubmit={(e) => void submit(e)}
      className={cn('grid gap-3 rounded-lg border border-border bg-inset p-3', className)}
    >
      <div className="text-sm font-medium">{copy.decisions.formTitle(decision, count)}</div>
      {withReason && (
        <div className="grid gap-1.5">
          <label htmlFor={reasonId} className="text-sm font-medium">
            {decision === 'reject' ? copy.decisions.reason.reject : copy.decisions.reason.defer}
          </label>
          <Textarea
            id={reasonId}
            rows={2}
            autoFocus
            value={reason}
            placeholder={
              decision === 'reject' ? copy.decisions.reason.rejectPlaceholder : undefined
            }
            aria-invalid={error !== null && reasonMissing}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            onKeyDown={enterConfirms}
            className="min-h-14 bg-surface"
          />
          <p className="text-xs text-text-3">
            {decision === 'reject' && `${copy.decisions.reason.rejectHint} `}
            {copy.decisions.enterHint}
          </p>
        </div>
      )}
      <SignatureField
        signature={{
          ...signature,
          setSignedBy: (id) => {
            signature.setSignedBy(id);
            setSignatureError(null);
          },
        }}
        error={signatureError}
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {copy.decisions.cancel}
        </Button>
        <Button type="submit" size="sm" autoFocus={!withReason} disabled={decide.isPending}>
          {decide.isPending ? copy.decisions.saving : copy.decisions.submit(decision, count)}
        </Button>
      </div>
    </form>
  );
}
