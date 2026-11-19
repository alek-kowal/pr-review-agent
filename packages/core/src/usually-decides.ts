// S-08-T5: who usually decides a PR's findings (FR-041). Anyone may decide; the UI names the
// author, and a decision by someone else names both.

/** A Team member as far as this rule needs; removed members never match. */
export type TeamMemberRef = {
  id: string;
  name: string;
  githubLogin: string;
  removedAt?: Date | null;
};

/** The PR author: their Team member when one has the login, else only the login. */
export type UsualDecider = { login: string; memberId: string | null; name: string | null };

/**
 * The author's Team member by GitHub login (case-insensitive, active members only), else the
 * author's login.
 */
export function usuallyDecidedBy(
  pr: { authorLogin: string },
  team: readonly TeamMemberRef[],
): UsualDecider {
  const login = pr.authorLogin.toLowerCase();
  const member = team.find((m) => !m.removedAt && m.githubLogin.toLowerCase() === login);
  return { login: pr.authorLogin, memberId: member?.id ?? null, name: member?.name ?? null };
}

/**
 * The names a decision label shows: the signer, and the author unless they signed it themselves
 * ("Rejected by Tomek (author: Kasia)" vs "Rejected by Kasia (author)"). The author is named by
 * their member name, else their login.
 */
export function decisionLabelNames(
  signer: { id: string; name: string },
  author: UsualDecider,
): { signer: string; author: string | null } {
  return {
    signer: signer.name,
    author: author.memberId === signer.id ? null : (author.name ?? author.login),
  };
}
