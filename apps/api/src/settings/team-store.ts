import {
  insertTeamMember,
  lockActiveTeamMember,
  removeTeamMember,
  updateTeamMember,
  type TeamMember,
} from '@pra/db';
import { NEW_ENTITY, type SettingsStore } from './signed-change.ts';

/** A Team member as Settings shows, signs and logs it. */
export type TeamMemberSettings = {
  name: string;
  githubLogin: string;
  clickupUserId: string | null;
};

export const teamMemberSettings = (member: TeamMember): TeamMemberSettings => ({
  name: member.name,
  githubLogin: member.githubLogin,
  clickupUserId: member.clickupUserId,
});

/** Team in Settings: one entity per member, keyed by the member's id. Removal is soft. */
export const teamStore: SettingsStore<TeamMemberSettings> = {
  area: 'team',
  async read(tx, id) {
    if (id === NEW_ENTITY) return null;
    const member = await lockActiveTeamMember(tx, id);
    return member ? teamMemberSettings(member) : null;
  },
  async write(tx, id, after) {
    if (after === null) {
      await removeTeamMember(tx, id);
      return { entity: id, value: null };
    }
    const member =
      id === NEW_ENTITY ? await insertTeamMember(tx, after) : await updateTeamMember(tx, id, after);
    if (!member) throw new Error(`team member ${id} is not active`);
    return { entity: member.id, value: teamMemberSettings(member) };
  },
};
