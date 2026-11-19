// Copy for Settings → Models and the models a run used (S-21).

/** Agent role names by role key (core `AGENT_ROLES`). */
export const roleNames: Record<string, string> = {
  reviewer: 'Reviewer',
  verifier: 'Verifier',
  implementer: 'Implementer',
  judge: 'Judge',
  analyst: 'Analyst',
};

export const models = {
  roles: roleNames,
};
