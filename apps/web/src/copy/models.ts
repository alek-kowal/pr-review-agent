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
  title: 'Models',
  affects:
    'which model each agent role uses in every new round, unless a review level sets its own.',
  loading: 'Loading models…',
  /** What each role does, under its name. */
  does: {
    reviewer: 'Reads the PR and writes findings and questions.',
    verifier: 'Checks each finding and runs its reproduction.',
    implementer: 'Fixes findings marked Implement.',
    judge: 'Sets the change type when rules are not enough.',
    analyst: 'Proposes lessons after a PR closes.',
  } as Record<string, string>,
  columns: { role: 'Role', model: 'Model', overrides: 'Per-level overrides' },
  overridesHint:
    'A review level can set its own model for a role. It wins at that level and above, until a higher level sets another.',
  modelLabel: (role: string) => `${roleNames[role] ?? role} model`,
  customLabel: (role: string) => `${roleNames[role] ?? role} model name`,
  defaultOption: (model: string) => `${model} (default)`,
  other: 'Other model…',
  customPlaceholder: 'claude-…',
  /** The judge's typed name may also be an OpenRouter model. */
  customPlaceholderOpenRouter: 'claude-… or openrouter/vendor/model',
  /** An OpenRouter model in the Select. */
  openRouterOption: (model: string) => `${model} (OpenRouter)`,
  invalid:
    'Not a valid model name. Start with a letter or digit, then use letters, digits and . _ : @ [ ] - only (no spaces).',
  invalidOpenRouter:
    'Not a valid model name. Use a Claude model name, or an OpenRouter model as openrouter/vendor/model (letters, digits and . _ : @ - in each part).',
  /** Under a role set to an OpenRouter model. */
  openRouterNote:
    'Runs on OpenRouter and is billed there (real spend). If OpenRouter fails, this round uses the Claude default instead.',
  openRouterKeyMissing:
    'OpenRouter access is not configured: OPENROUTER_API_KEY is not set. Until it is, every call falls back to the Claude default.',
  invalidSummary: 'Fix the model names marked below before saving.',
  overrideNote: (level: number, model: string) => `Level ${level} uses ${model}`,
  noOverrides: 'None',
  saveTitle: 'Save models',
  saveDescription:
    'New rounds use the new model. Rounds that are running keep the model they started with.',
};
