import { useState, type ReactNode } from 'react';
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
import { copy } from '@/copy/index.ts';
import { SignatureField } from '@/features/signature/SignatureField.tsx';
import { useSignature } from '@/features/signature/use-signature.ts';
import { ApiError } from '@/lib/api.ts';
import { errorText } from '@/lib/reasons.ts';
import type { SettingsChangeRow } from './use-settings-form.ts';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: ReactNode;
  /** The before/after rows; a row's empty side reads as "—". */
  changes: readonly SettingsChangeRow[];
  /** Saves with the signer's member id; a rejected promise shows its error and keeps the dialog. */
  onConfirm: (signedBy: string) => Promise<unknown>;
  confirmLabel?: string;
};

/**
 * Confirms a Settings save: the before/after table and the signature. Confirm is refused until a
 * Team member signs; after a successful save the signer is remembered for the next form.
 */
export function SignedSaveDialog({ open, onOpenChange, ...form }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-xl">
        {/* Mounted per open, so each opening starts from the last signer and no old error. */}
        <SignedSaveForm {...form} onDone={() => onOpenChange(false)} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SignedSaveForm({
  title = copy.settings.saveDialog.title,
  description = copy.settings.saveDialog.description,
  changes,
  onConfirm,
  confirmLabel = copy.settings.saveDialog.confirm,
  onDone,
}: Omit<Props, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const signature = useSignature();
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const t = copy.settings.saveDialog;

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!signature.signedBy) {
      setSignatureError(copy.signature.required);
      return;
    }
    setSignatureError(null);
    setSaveError(null);
    setSaving(true);
    try {
      await onConfirm(signature.signedBy);
      signature.remember();
      onDone();
    } catch (error) {
      setSaveError(errorText(error instanceof ApiError ? error.code : 'http_error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={confirm} className="grid gap-4">
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      {changes.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs text-text-3">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t.setting}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t.before}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t.after}
                </th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={change.key} className="border-t border-divider">
                  <th scope="row" className="px-3 py-2 font-medium">
                    {change.label}
                  </th>
                  <td className="px-3 py-2 text-text-3">{change.before || t.none}</td>
                  <td className="px-3 py-2">{change.after || t.none}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SignatureField signature={signature} error={signatureError} />
      {saveError && (
        <p role="alert" className="text-sm text-bad">
          {saveError}
        </p>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel type="button">{t.cancel}</AlertDialogCancel>
        <Button type="submit" disabled={saving}>
          {saving ? t.saving : confirmLabel}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
