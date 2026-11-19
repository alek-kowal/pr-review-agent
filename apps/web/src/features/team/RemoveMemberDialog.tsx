import { useState } from 'react';
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
import type { TeamMember } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { useTeamChange } from './mutations.ts';

type Props = {
  open: boolean;
  member: TeamMember | null;
  onOpenChange: (open: boolean) => void;
};

/** Confirms removing a member from Team, signed. Removal is soft: past signatures keep the name. */
export function RemoveMemberDialog({ open, member, onOpenChange }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {member && <RemoveForm member={member} onDone={() => onOpenChange(false)} />}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RemoveForm({ member, onDone }: { member: TeamMember; onDone: () => void }) {
  const t = copy.team.removeDialog;
  const signature = useSignature();
  const change = useTeamChange();
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!signature.signedBy) return setSignatureError(copy.signature.required);
    setSignatureError(null);
    try {
      await change.mutateAsync({ kind: 'remove', member, signedBy: signature.signedBy });
    } catch (failure) {
      return setError(errorText(failure instanceof ApiError ? failure.code : 'http_error'));
    }
    signature.remember();
    onDone();
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <AlertDialogHeader>
        <AlertDialogTitle>{t.title(member.name)}</AlertDialogTitle>
        <AlertDialogDescription>{t.description(member.name)}</AlertDialogDescription>
      </AlertDialogHeader>
      <SignatureField signature={signature} error={signatureError} />
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel type="button">{copy.team.cancel}</AlertDialogCancel>
        <Button type="submit" variant="destructive" disabled={change.isPending}>
          {change.isPending ? copy.team.saving : t.confirm}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
