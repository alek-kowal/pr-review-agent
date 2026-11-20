// Every code a run stage can fail with (INSTR). The worker's `StageError` takes only these, the
// web has copy for each (apps/web `copy-coverage.test.ts`), and a thrown error with any other code
// fails its stage as `stage_error` (the code kept in its params), so a raw code never reaches
// the UI. A new code goes here, then into the web copy.
import { STAGE_ERROR } from './run.ts';

export const STAGE_ERROR_CODES = [
  // The run machine and the stage handler.
  STAGE_ERROR.interrupted,
  STAGE_ERROR.interruptedByRestart,
  STAGE_ERROR.cancelled,
  'stage_not_available',
  'stage_timeout',
  'stage_error',
  'model_invalid',
  // Instruction files: the check before a run's first stage, then each stage's own.
  'instructions_missing',
  'verifier_instructions_missing',
  'implementer_instructions_missing',
  'analyst_instructions_missing',
  // Agent sessions (`@pra/agents` `AGENT_ERROR_CODES`) and the stages' answer checks.
  'model_access_not_configured',
  'role_not_supported',
  'cost_limit_reached',
  'max_turns_reached',
  'output_invalid',
  'agent_failed',
  'usage_limit_reached',
  'timeout',
  'review_output_invalid',
  'verifier_output_invalid',
  'judge_output_invalid',
  'fix_check_output_invalid',
  'analyst_output_invalid',
  // Implementer runs.
  'fork_read_only',
  'implementer_request_missing',
  'implement_output_missing',
  // Integrations (`@pra/integrations` error codes).
  'github_error',
  'github_not_configured',
  'github_app_not_installed',
  'github_read_only',
  'github_rate_limited',
  'clickup_not_configured',
  'clickup_auth_failed',
  'clickup_error',
  'sandbox_not_configured',
  'sandbox_cancelled',
  'sandbox_failed',
  'openrouter_auth_failed',
  'openrouter_no_credits',
  'openrouter_timeout',
  'openrouter_rate_limited',
  'openrouter_unavailable',
  'openrouter_error',
] as const;
export type StageErrorCode = (typeof STAGE_ERROR_CODES)[number];

export const isStageErrorCode = (code: string): code is StageErrorCode =>
  (STAGE_ERROR_CODES as readonly string[]).includes(code);
