import { Link } from '@tanstack/react-router';
import { Pause, Play } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { copy } from '@/copy/index.ts';
import { dateTime, money } from '@/copy/format.ts';
import type { StatusChipSectionProps } from '@/features/shell/status-chip-slots.ts';
import { SignatureField } from '@/features/signature/SignatureField.tsx';
import { useSignature } from '@/features/signature/use-signature.ts';
import { ApiError } from '@/lib/api.ts';
import { errorText } from '@/lib/reasons.ts';
import { parseBudget } from './parse.ts';
import { useStatusChange, type StatusChange } from './queries.ts';

const t = copy.status;

/**
 * The status chip's controls (S-10-T5, spec: prototype `shell.js` `StatusChip`): pause with a
 * reason, resume, and the daily budget, each signed in this form.
 */
export function StatusControls({ status, close }: StatusChipSectionProps) {
  const id = useId();
  const signature = useSignature();
  const change = useStatusChange();
  const [reason, setReason] = useState('');
  const [budget, setBudget] = useState(
    status.dailyBudgetUsd === null ? '' : String(status.dailyBudgetUsd),
  );
  const [error, setError] = useState<string | null>(null);
  const paused = status.state === 'paused';
  const signerName = () =>
    signature.members.find((member) => member.id === signature.signedBy)?.name ?? '';

  const newBudget = parseBudget(budget);
  const budgetWhy =
    newBudget === null
      ? t.budget.invalid
      : newBudget === status.dailyBudgetUsd
        ? t.budget.unchanged
        : null;

  async function submit(changeOf: (signedBy: string) => StatusChange, done: () => void) {
    if (!signature.signedBy) {
      setError(copy.signature.required);
      return;
    }
    setError(null);
    try {
      await change.mutateAsync(changeOf(signature.signedBy));
      signature.remember();
      done();
    } catch (failure) {
      setError(errorText(failure instanceof ApiError ? failure.code : 'http_error'));
    }
  }

  const pause = () => {
    if (!reason.trim()) {
      setError(t.pause.reasonRequired);
      return;
    }
    void submit(
      (signedBy) => ({ kind: 'pause', reason: reason.trim(), signedBy }),
      () => {
        toast(t.pause.done, { description: t.pause.doneDetail(signerName()) });
        setReason('');
      },
    );
  };

  const resume = () =>
    submit(
      (signedBy) => ({ kind: 'resume', signedBy }),
      () => toast.success(t.paused.done, { description: t.paused.doneDetail(signerName()) }),
    );

  const saveBudget = () => {
    if (budgetWhy || newBudget === null) {
      setError(budgetWhy);
      return;
    }
    void submit(
      (signedBy) => ({
        kind: 'budget',
        dailyBudgetUsd: newBudget,
        before: status.dailyBudgetUsd,
        signedBy,
      }),
      () =>
        toast(t.budget.done(money(newBudget)), { description: t.budget.doneDetail(signerName()) }),
    );
  };

  return (
    <div className="flex flex-col gap-3 border-t border-divider pt-3">
      {paused ? (
        <div>
          <span className="font-medium">{t.paused.by(status.pausedBy?.name ?? null)}</span>
          {status.pausedAt && (
            <time dateTime={status.pausedAt} className="ml-1.5 text-xs text-text-3">
              {dateTime(status.pausedAt)}
            </time>
          )}
          {status.pausedReason && <p className="mt-0.5 text-text-2">{status.pausedReason}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-reason`}>{t.pause.label}</Label>
          <Input
            id={`${id}-reason`}
            placeholder={t.pause.placeholder}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') pause();
            }}
          />
          <p className="text-xs text-text-3">{t.pause.hint}</p>
        </div>
      )}
      {status.state === 'budget_reached' && <p className="text-bad">{t.budgetUsedUp}</p>}
      <div>
        <SignatureField signature={signature} />
        <p className="mt-1 text-xs text-text-3">{t.signNote}</p>
      </div>
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={`${id}-budget`} className="text-xs font-normal text-text-2">
            {t.budget.label}
          </Label>
          <Input
            id={`${id}-budget`}
            inputMode="decimal"
            className="h-7 w-[72px] tabular-nums"
            value={budget}
            onChange={(event) => {
              setBudget(event.target.value);
              setError(null);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={change.isPending}
            onClick={saveBudget}
          >
            {t.budget.save}
          </Button>
        </div>
        {paused ? (
          <Button type="button" disabled={change.isPending} onClick={() => void resume()}>
            <Play aria-hidden="true" />
            {t.paused.resume}
          </Button>
        ) : (
          <Button type="button" disabled={change.isPending} onClick={pause}>
            <Pause aria-hidden="true" />
            {t.pause.button}
          </Button>
        )}
      </div>
      <Link to="/settings/budget" onClick={close} className="text-xs text-brand-text">
        {t.settingsLink}
      </Link>
    </div>
  );
}
