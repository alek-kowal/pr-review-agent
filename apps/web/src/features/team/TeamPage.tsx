import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { ApiError } from '@/lib/api.ts';
import type { TeamMember } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { MemberDialog } from './MemberDialog.tsx';
import { teamQuery } from './queries.ts';
import { RemoveMemberDialog } from './RemoveMemberDialog.tsx';

/** A dialog keeps its member while it closes, so its text does not change during the animation. */
type DialogState = { open: boolean; member: TeamMember | null };
const CLOSED: DialogState = { open: false, member: null };

/** Settings → Team (FR-076): the people who sign, each change signed in its own dialog. */
export function TeamPage() {
  const t = copy.team;
  const team = useQuery(teamQuery());
  const [editing, setEditing] = useState<DialogState>(CLOSED);
  const [removing, setRemoving] = useState<DialogState>(CLOSED);
  const close = (state: DialogState) => ({ ...state, open: false });
  const members = team.data?.members ?? [];

  return (
    <SettingsPage
      title={t.title}
      affects={t.affects}
      actions={
        <Button
          type="button"
          onClick={() => setEditing({ open: true, member: null })}
          disabled={!team.data}
        >
          <Plus aria-hidden="true" />
          {t.add}
        </Button>
      }
    >
      {team.isPending ? (
        <p className="text-text-3">{t.loading}</p>
      ) : team.isError ? (
        <p role="alert" className="text-bad">
          {errorText(team.error instanceof ApiError ? team.error.code : 'http_error')}
        </p>
      ) : members.length === 0 ? (
        <p className="text-text-3">{t.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t.tableLabel}</caption>
            <thead className="bg-surface-2 text-xs text-text-3">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t.columns.name}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t.columns.githubLogin}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t.columns.clickupUser}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  <span className="sr-only">{t.columns.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-t border-divider">
                  <th scope="row" className="px-3 py-2 font-medium">
                    {member.name}
                  </th>
                  <td className="px-3 py-2 font-mono text-[13px]">{t.login(member.githubLogin)}</td>
                  <td className="px-3 py-2 text-text-2">{member.clickupUserId ?? t.none}</td>
                  <td className="px-3 py-1.5">
                    <span className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t.edit(member.name)}
                        onClick={() => setEditing({ open: true, member })}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t.remove(member.name)}
                        onClick={() => setRemoving({ open: true, member })}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MemberDialog
        open={editing.open}
        onOpenChange={(open) => !open && setEditing(close)}
        member={editing.member}
        firstMember={members.length === 0}
      />
      <RemoveMemberDialog
        open={removing.open}
        member={removing.member}
        onOpenChange={(open) => !open && setRemoving(close)}
      />
    </SettingsPage>
  );
}
