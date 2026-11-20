import { reportError } from '@pra/integrations/observability';
import fp from 'fastify-plugin';
import type { FastifyError, FastifyReply } from 'fastify';
import { z } from 'zod/v4';

/** Reason codes the API returns. Clients map them to copy; the API sends no prose. */
export const ApiErrorCode = {
  InvalidRequest: 'invalid_request',
  InternalError: 'internal_error',
  RepositoryNotFound: 'repository_not_found',
  /** Connecting a repository the GitHub App cannot reach. */
  RepositoryNotReachable: 'repository_not_reachable',
  /** Connecting a repository that is already connected. */
  RepositoryAlreadyConnected: 'repository_already_connected',
  PrNotFound: 'pr_not_found',
  /** A state-changing request without `X-PRA-Request: 1` and a same-host `Origin` (csrf.ts). */
  CsrfRejected: 'csrf_rejected',
  /** `POST /webhooks/github` without a valid `X-Hub-Signature-256`. */
  WebhookSignatureInvalid: 'webhook_signature_invalid',
  /** The GitHub App env vars are missing (`params.missing` names them). */
  GithubNotConfigured: 'github_not_configured',
  /** Without the GitHub App the app reads GitHub only: merge and push are refused (P-28). */
  GithubReadOnly: 'github_read_only',
  /** GitHub's rate limit is used up until `params.resetAt` (P-28). */
  GithubRateLimited: 'github_rate_limited',
  /** Poll now in App mode: webhooks bring the events, the poller is off (P-28). */
  GithubPollOff: 'github_poll_off',
  /** A signed action without `signedBy`. */
  SignatureRequired: 'signature_required',
  /** `signedBy` is not an active Team member. */
  SignerUnknown: 'signer_unknown',
  /** A settings save whose `before` is no longer current: someone saved in between. */
  SettingsStale: 'settings_stale',
  TeamMemberNotFound: 'team_member_not_found',
  RunNotFound: 'run_not_found',
  /** Retry of a run that did not fail (S-09-T2). */
  RunNotFailed: 'run_not_failed',
  /** Retry of a trial run, which is started again instead (S-22-T6). */
  RunNotRetryable: 'run_not_retryable',
  /** Cancel of a run that already ended (S-09-T4). */
  RunFinished: 'run_finished',
  /** The session does not exist or belongs to another run. */
  SessionNotFound: 'session_not_found',
  /** The session has no stored transcript (yet, or it was removed). */
  TranscriptNotFound: 'transcript_not_found',
  /** Another active Team member has this GitHub login. */
  GithubLoginTaken: 'github_login_taken',
  /** Reject without a reason. */
  ReasonRequired: 'reason_required',
  /** A finding moved since the signer saw it; `params.conflicts` names the current decisions. */
  DecisionConflict: 'decision_conflict',
  /** A finding id that is not one of the PR's findings (`params.missing`). */
  FindingNotFound: 'finding_not_found',
  DecisionBatchNotFound: 'decision_batch_not_found',
  /** Undo after one of the batch's findings changed (`params.findingIds`). */
  DecisionChangedSince: 'decision_changed_since',
  DecisionAlreadyUndone: 'decision_already_undone',
  /** A start while a run of the PR is queued or running (`params.kind`, `params.status`). */
  RunActive: 'run_active',
  /** A start on a merged or closed PR. */
  PrClosed: 'pr_closed',
  /** Send back without a comment. */
  CommentRequired: 'comment_required',
  /** The PR's sensitive files changed since the person saw them (`params.version`). */
  SensitiveStale: 'sensitive_stale',
  /** Approve or send back when every sensitive file is already approved, or there is none. */
  SensitiveNothingPending: 'sensitive_nothing_pending',
  /** What was typed is neither a ClickUp task id nor a task link. */
  TaskRefInvalid: 'task_ref_invalid',
  /** ClickUp has no task with this id. */
  TaskNotFound: 'task_not_found',
  /** The repository has no ClickUp settings, or the server has no `CLICKUP_API_KEY`. */
  ClickupNotConfigured: 'clickup_not_configured',
  ClickupAuthFailed: 'clickup_auth_failed',
  /** ClickUp did not answer as expected. */
  ClickupError: 'clickup_error',
  InstructionFileNotFound: 'instruction_file_not_found',
  /** A version id that is not one of the file's versions. */
  InstructionVersionNotFound: 'instruction_version_not_found',
  /** Activate a version that is not the draft, or roll back to one that is not archived. */
  InstructionVersionStatus: 'instruction_version_status',
  /** A repository or level copy of this file is already there (`params.fileId`). */
  InstructionCopyExists: 'instruction_copy_exists',
  /** A copy of a file that has no active version to start from. */
  InstructionNoActive: 'instruction_no_active',
  /** New file: the key is not a usable file key (`params.problem`, a core reason code). */
  InstructionFileKey: 'instruction_file_key',
  /** New file: a file with this key is already at that scope (`params.fileId`). */
  InstructionFileExists: 'instruction_file_exists',
  /** New file: the key exists at another scope with the other kind (`params.kind`). */
  InstructionKindConflict: 'instruction_kind_conflict',
  /** Stage files (STAGEFILES): no file with this key at the scope (`params.fileKey`). */
  StageFileUnknown: 'stage_file_unknown',
  /** Stage files: the file's kind does not fit the slot (`params.fileKey`, `params.kind`). */
  StageFileKind: 'stage_file_kind',
  /** Stage files: a slot the stage does not declare, or built in where it has none. */
  StageFileSlot: 'stage_file_slot',
  /** A trial of a version that is not a draft (`params.status`). */
  TrialNeedsDraft: 'trial_needs_draft',
  TrialNotFound: 'trial_not_found',
  /** A question is not one of this PR's (S-08-T1). */
  QuestionNotFound: 'question_not_found',
  /** An answer names neither an option nor an own text, or both, or an option out of range. */
  AnswerInvalid: 'answer_invalid',
  /** Someone answered a question since the page loaded; `params.conflicts` names them. */
  AnswerConflict: 'answer_conflict',
  /** The review is not one of this PR's (S-08-T10). */
  ReviewNotFound: 'review_not_found',
  /** Notify author needs a ClickUp task linked to the PR. */
  NoLinkedTask: 'no_linked_task',
  /** The PR author has no ClickUp user in Team, so there is nobody to mention. */
  AuthorHasNoClickupUser: 'author_has_no_clickup_user',
  /** `POST /api/status/pause` while PR Review Agent is already paused. */
  AlreadyPaused: 'already_paused',
  /** `POST /api/status/resume` while PR Review Agent is running. */
  NotPaused: 'not_paused',
  /** The typed PR number is not this PR's number. */
  MergeNumberMismatch: 'merge_number_mismatch',
  /** The PR's head is not the reviewed commit (`params.reviewedSha`, `params.headSha`). */
  HeadMoved: 'head_moved',
  /** A checklist row fails on fresh GitHub state (`params.items`: the failing rows). */
  MergeNotReady: 'merge_not_ready',
  /** GitHub refused the merge (`params.status`, `params.message` verbatim). */
  MergeRefused: 'merge_refused',
  /** GitHub did not answer as expected (`params.status` when it answered). */
  GithubError: 'github_error',
  /** Implement with agent below level 4 (`params.level`, `params.need`). */
  ImplementBelowLevel: 'implement_below_level',
  /** A fork PR stays read-only: no implementer, no push. */
  ForkReadOnly: 'fork_read_only',
  /** Implement with agent with no open finding decided Implement. */
  NoImplementDecisions: 'no_implement_decisions',
  /** `withAgent` on a decision other than Implement. */
  WithAgentNeedsImplement: 'with_agent_needs_implement',
  /** No patch with this id. */
  PatchNotFound: 'patch_not_found',
  /** The file is not part of this patch. */
  PatchFileNotFound: 'patch_file_not_found',
  /** The patch changed since the page loaded (`params.revision`: the current one). */
  PatchStale: 'patch_stale',
  /** Revise needs a note. */
  NoteRequired: 'note_required',
  /** Push: the typed number is not the PR's number (`params.number`). */
  PrNumberMismatch: 'pr_number_mismatch',
  /** Push of a patch that is pushed, superseded or discarded (`params.status`). */
  PatchNotReady: 'patch_not_ready',
  /** Push of a patch whose files are all reverted. */
  PatchEmpty: 'patch_empty',
  LessonCandidateNotFound: 'lesson_candidate_not_found',
  /** Edit, reject or accept a candidate that is already decided (`params.status`). */
  CandidateNotOpen: 'candidate_not_open',
  /** Accept below the PR minimum (`params.have`, `params.need`): "1 of 2 PRs: waits for one more". */
  NeedsMorePrs: 'needs_more_prs',
  /** Run the analyst on a PR that is still open. */
  PrOpen: 'pr_open',
  AlertNotFound: 'alert_not_found',
  /** Dismissing an alert that was already cleared or dismissed. */
  AlertNotActive: 'alert_not_active',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    params: Record<string, unknown>;
  };
};

/** The error shape for route schemas (OpenAPI), for example `{ 404: ApiErrorSchema }`. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum(Object.values(ApiErrorCode) as [ApiErrorCode, ...ApiErrorCode[]]),
    params: z.record(z.string(), z.unknown()),
  }),
});

export function errorBody(code: ApiErrorCode, params: Record<string, unknown> = {}): ApiErrorBody {
  return { error: { code, params } };
}

/** Sends `{ error: { code, params } }` with the given status. */
export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ApiErrorCode,
  params: Record<string, unknown> = {},
) {
  return reply.code(statusCode).send(errorBody(code, params));
}

/**
 * The one error handler. Every error leaves the API as `{ error: { code, params } }`:
 * - schema validation errors: 400 `invalid_request`, params `{ part, issues: [{ path, code }] }`;
 *   a custom check (a zod `refine`) whose message is a reason code, such as `invalid_glob`,
 *   gives that code instead of `custom`
 * - other client errors (4xx, e.g. malformed JSON): same status, `invalid_request`, no params
 * - anything else: 500 `internal_error`, no params; the error is logged and reported to Sentry
 *   (when SENTRY_DSN is set), never sent to the client
 */
const REASON_CODE = /^[a-z][a-z0-9_]*$/;
const issueCode = (keyword: string, message: string | undefined): string =>
  keyword === 'custom' && message && REASON_CODE.test(message) ? message : keyword;

export default fp(
  async (fastify) => {
    fastify.setErrorHandler<FastifyError>(async (error, request, reply) => {
      if (error.validation) {
        request.log.info({ err: error }, 'request validation failed');
        return reply.code(400).send(
          errorBody(ApiErrorCode.InvalidRequest, {
            part: error.validationContext,
            issues: error.validation.map((issue) => ({
              path: issue.instancePath,
              code: issueCode(issue.keyword, issue.message),
            })),
          }),
        );
      }

      const statusCode = error.statusCode ?? 500;
      if (statusCode >= 400 && statusCode < 500) {
        request.log.info({ err: error }, 'client error');
        return reply.code(statusCode).send(errorBody(ApiErrorCode.InvalidRequest));
      }

      request.log.error({ err: error }, 'unexpected error');
      reportError(error, { method: request.method, route: request.routeOptions.url });
      return reply.code(500).send(errorBody(ApiErrorCode.InternalError));
    });
  },
  { name: 'errors' },
);
