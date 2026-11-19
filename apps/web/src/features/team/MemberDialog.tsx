import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { copy } from '@/copy/index.ts';
import { SignatureField } from '@/features/signature/SignatureField.tsx';
import { useSignature } from '@/features/signature/use-signature.ts';
import { ApiError } from '@/lib/api.ts';
import type { TeamMember } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { fieldsOf, useTeamChange, type TeamMemberFields } from './mutations.ts';

type Props = {
  /** The member to edit; null adds a person. */
  member: TeamMember | null;
  /** Team has nobody yet: the new person signs as themselves. */
  firstMember: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Add or Edit a Team member, with the fields and the signature (FR-076). */
export function MemberDialog({ open, onOpenChange, ...form }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={copy.team.close}>
        {/* Mounted per opening, so the fields start from the member each time. */}
        <MemberForm {...form} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

const EMPTY: TeamMemberFields = { name: '', githubLogin: '', clickupUserId: null };

function MemberForm({
  member,
  firstMember,
  onDone,
}: Omit<Props, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const t = copy.team;
  const signature = useSignature();
  const change = useTeamChange();
  const [fields, setFields] = useState<TeamMemberFields>(member ? fieldsOf(member) : EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const signs = member !== null || !firstMember;

  const set = (key: keyof TeamMemberFields) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setFields((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSignatureError(null);
    const values: TeamMemberFields = {
      name: fields.name.trim(),
      githubLogin: fields.githubLogin.trim().replace(/^@/, ''),
      clickupUserId: fields.clickupUserId?.trim() || null,
    };
    if (!values.name || !values.githubLogin) return setError(t.required);
    if (signs && !signature.signedBy) return setSignatureError(copy.signature.required);

    try {
      if (member) {
        await change.mutateAsync({
          kind: 'edit',
          member,
          fields: values,
          signedBy: signature.signedBy!,
        });
      } else {
        await change.mutateAsync({
          kind: 'add',
          fields: values,
          signedBy: signs ? signature.signedBy : null,
        });
      }
    } catch (failure) {
      return setError(errorText(failure instanceof ApiError ? failure.code : 'http_error'));
    }
    if (signs) signature.remember();
    onDone();
  }

  const ids = { name: 'team-name', login: 'team-login', clickup: 'team-clickup' };
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{member ? t.editDialog.title(member.name) : t.addDialog.title}</DialogTitle>
        <DialogDescription>
          {member ? t.editDialog.description : t.addDialog.description}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.name}>{t.fields.name}</Label>
        <Input id={ids.name} value={fields.name} onChange={set('name')} autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.login}>{t.fields.githubLogin}</Label>
        <Input
          id={ids.login}
          value={fields.githubLogin}
          onChange={set('githubLogin')}
          aria-describedby={`${ids.login}-hint`}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
        <p id={`${ids.login}-hint`} className="text-xs text-text-3">
          {t.fields.githubLoginHint}
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.clickup}>{t.fields.clickupUser}</Label>
        <Input
          id={ids.clickup}
          value={fields.clickupUserId ?? ''}
          onChange={set('clickupUserId')}
          aria-describedby={`${ids.clickup}-hint`}
          autoComplete="off"
        />
        <p id={`${ids.clickup}-hint`} className="text-xs text-text-3">
          {t.fields.clickupUserHint}
        </p>
      </div>
      {signs ? (
        <SignatureField signature={signature} error={signatureError} />
      ) : (
        <p className="text-sm text-text-2">{t.firstMember}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t.cancel}
        </Button>
        <Button type="submit" disabled={change.isPending}>
          {change.isPending ? t.saving : member ? t.editDialog.confirm : t.addDialog.confirm}
        </Button>
      </DialogFooter>
    </form>
  );
}
