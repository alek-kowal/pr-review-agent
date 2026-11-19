import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api.ts';
import type { TeamMember, TeamMemberResponse } from '@/lib/api-types.ts';
import { teamKeys } from './queries.ts';

export type TeamMemberFields = Omit<TeamMember, 'id'>;

/** What the form shows of a member: the `before` of a signed edit or removal. */
export const fieldsOf = ({ name, githubLogin, clickupUserId }: TeamMember): TeamMemberFields => ({
  name,
  githubLogin,
  clickupUserId,
});

type Change =
  | { kind: 'add'; fields: TeamMemberFields; signedBy: string | null }
  | { kind: 'edit'; member: TeamMember; fields: TeamMemberFields; signedBy: string }
  | { kind: 'remove'; member: TeamMember; signedBy: string };

const memberPath = (id: string) => `/api/team/${encodeURIComponent(id)}`;

/** Add, edit or remove a Team member, signed; every Team query refetches after it. */
export function useTeamChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (change: Change) => {
      switch (change.kind) {
        case 'add':
          return apiRequest<TeamMemberResponse>('/api/team', {
            method: 'POST',
            body: { ...change.fields, signedBy: change.signedBy ?? undefined },
          });
        case 'edit':
          return apiRequest<TeamMemberResponse>(memberPath(change.member.id), {
            method: 'PATCH',
            body: { ...change.fields, signedBy: change.signedBy, before: fieldsOf(change.member) },
          });
        case 'remove':
          return apiRequest<null>(memberPath(change.member.id), {
            method: 'DELETE',
            body: { signedBy: change.signedBy, before: fieldsOf(change.member) },
          });
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: teamKeys.all }),
  });
}
