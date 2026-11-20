// Stage names, and why a stage failed or is off by reason code. Every code in core
// `STAGE_ERROR_CODES` has an entry (copy-coverage.test.ts). A sentence reads after
// "failed at <stage>:"; an entry with params names what they hold (the missing files).
import { REQUIRED_INSTRUCTION_FILES, isInstructionStage } from '@pra/core';

export type ReasonParams = Record<string, unknown>;
export type ReasonCopy = string | ((p: ReasonParams) => string);

export const stageNames: Record<string, string> = {
  checks: 'Checks',
  task: 'Task',
  change_type: 'Change type',
  review: 'Review',
  verify: 'Verify',
  fix_diff: 'Fix diff',
  check_fixes: 'Check fixes',
  reproductions: 'Reproductions',
  worktree: 'Worktree',
  implement: 'Implement',
  analyse: 'Analyse',
};

/** "a", "a and b", "a, b and c". */
export const andList = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** Where missing instruction files are added. */
export const INSTRUCTIONS_PLACE = 'Settings → Instructions';

/** `params.missing` when the worker stored it, else every required file of the stage. */
function missingFiles(p: ReasonParams, stage: string): string[] {
  if (Array.isArray(p.missing) && p.missing.length) return p.missing.map(String);
  return isInstructionStage(stage) ? [...REQUIRED_INSTRUCTION_FILES[stage]] : [];
}

const filesMissing = (files: readonly string[]): string =>
  files.length === 1 ? `${files[0]} is missing` : `${andList(files)} are missing`;

/** "Verify: prompt-verifier.md and verify-rules.md are missing" (a gap Settings warns about). */
export const instructionGapText = (stage: string, missing: readonly string[]): string =>
  `${stageNames[stage] ?? stage}: ${filesMissing(missing)}`;

/** "instruction files for Verify: prompt-verifier.md is missing; add it in Settings → ...". */
const instructionsMissing = (stage: string) => (p: ReasonParams) => {
  const files = missingFiles(p, stage);
  const name = stageNames[stage] ?? stage;
  if (!files.length)
    return `instruction files for ${name} are missing; add them in ${INSTRUCTIONS_PLACE}`;
  return `instruction files for ${name}: ${filesMissing(files)}; add ${files.length === 1 ? 'it' : 'them'} in ${INSTRUCTIONS_PLACE}`;
};

export const reasons: Record<string, ReasonCopy> = {
  // The run machine and the stage handler.
  interrupted: 'the app restarted while it ran',
  interrupted_by_restart: 'the app restarted while it ran',
  cancelled: 'it was cancelled',
  stage_not_available: 'this stage is not available yet',
  stage_timeout: 'the stage ran out of time',
  stage_error: 'an unexpected error stopped it',
  model_invalid: 'a model name in Settings → Models or Review levels is not valid',
  // Instruction files: checked before the run's first stage (no agent ran), then by each stage.
  instructions_missing: (p) => instructionsMissing(String(p.stage ?? ''))(p),
  verifier_instructions_missing: instructionsMissing('verify'),
  implementer_instructions_missing: instructionsMissing('implement'),
  analyst_instructions_missing: instructionsMissing('analyse'),
  // Agent sessions.
  model_access_not_configured: 'model access is not configured',
  role_not_supported: 'the agent cannot run this role',
  cost_limit_reached: 'the agent session reached its cost limit',
  max_turns_reached: 'the agent session used all its turns',
  output_invalid: "the agent's answer was not valid",
  agent_failed: 'the agent session failed',
  usage_limit_reached: 'the Claude usage limit was reached',
  timeout: 'the agent session ran out of time',
  review_output_invalid: "the reviewer's answer was not valid",
  verifier_output_invalid: "the verifier's answer was not valid",
  judge_output_invalid: "the judge's answer was not valid",
  fix_check_output_invalid: "the fix check's answer was not valid",
  analyst_output_invalid: 'the analyst answered in a shape it may not use',
  // Implementer runs and off reasons.
  fork_read_only: 'off for forks',
  implement_below_level: 'needs a higher level',
  no_implement_decisions: 'no finding is decided Implement',
  implementer_request_missing: 'the implementer run has no findings to fix',
  implement_output_missing: 'the Implement stage left no result',
  // Integrations.
  github_error: 'GitHub did not answer as expected',
  github_not_configured: 'GitHub is not configured',
  github_app_not_installed: 'the GitHub App is not installed on this repository',
  github_read_only: 'read-only: the GitHub App is not connected',
  github_rate_limited: 'GitHub’s rate limit is used up',
  clickup_not_configured: 'ClickUp is not configured',
  clickup_auth_failed: 'ClickUp refused the API key',
  clickup_error: 'ClickUp did not answer as expected',
  sandbox_not_configured: 'the sandbox (Docker) is not configured',
  sandbox_cancelled: 'the sandbox run was stopped',
  sandbox_failed: 'the sandbox could not run',
  openrouter_auth_failed: 'OpenRouter refused the API key',
  openrouter_no_credits: 'OpenRouter has no credit left',
  openrouter_timeout: 'OpenRouter did not answer in time',
  openrouter_rate_limited: 'OpenRouter’s rate limit is used up',
  openrouter_unavailable: 'OpenRouter is unavailable',
  openrouter_error: 'OpenRouter did not answer as expected',
};

/** Whether a failure is fixed in Settings → Instructions (the error views link there). */
export const isInstructionsReason = (code: string): boolean =>
  code === 'instructions_missing' || code.endsWith('_instructions_missing');
