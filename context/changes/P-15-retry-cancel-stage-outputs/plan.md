# P-15 Retry, cancel and stage outputs — Implementation Plan

## Overview

A failed round is retried from its failed stage, reusing earlier stage results; a queued or
running run is cancelled and spend stops at once; a closed PR cancels its run; a restart leaves
nothing running; a 10-minute poll corrects what webhooks missed; and Checks, change type and the
large-PR warning show on the PR page and in Run detail. Tasks: S-09-T1–T7, S-03-T14, S-04-T6,
S-04-T7. Decisions: `change.md`.

## Current State Analysis

- Core already has `cancelRun`, `retryFromStage` (stages `reused`), `recoverAfterRestart`
  (`packages/core/src/run.ts:141-186`) and the banner actions `cancel` / `retry` with
  `ActiveRun.retryFrom` (`packages/core/src/pr-state.ts:179-225`).
- `AgentRunner` already takes `signal` (`packages/agents/src/runner.ts:27`); `runExecutor` creates
  one `AbortController` per stage for the timeout (`apps/worker/src/run/execute-stage.ts:293`).
  So `runner.ts` is not edited.
- Live sessions store each turn's cost (`apps/worker/src/run/live-sessions.ts`).
- Worker start fails running stages `interrupted` (`apps/worker/src/run/recover.ts`) and resends
  lost jobs every 5 minutes.
- `pra_change` NOTIFY triggers exist on `runs`, `pull_requests`, ... (migration 0006);
  `listenChanges` in `packages/db/src/live.ts`; only the api listens.
- `run.stage` queue: `exclusive`, 5 h expiry, pg-boss default retries
  (`packages/db/src/queue.ts:49`). No cron exists.
- Run detail API `GET /api/runs/:id`, `STAGE_OUTPUTS` renderer registry (task, review only),
  banner `MAIN_ACTIONS` (no cancel/retry), `IN_PROGRESS_ROW_ACTIONS` (empty).
- `pull_requests.forced_change_type` and `setForcedChangeType` exist; no route. Change type,
  `largePr`, CI and install exist only as stage outputs (`ChangeTypeOutput`, `ChecksOutput`).
- No `listOpenPullRequests`, no reconcile, no `reconciled` code.

## Desired End State

`pnpm verify` and `pnpm test:e2e` pass, including the new worker tests `retry`, `cancel`,
`close-cancels`, `durability`, `reconcile`; api tests `retry-route`, `cancel-route`,
`change-type-route`; web tests `retry-banner`, `run-detail-reused`, `cancel-button`,
`checks-output`, `large-pr`; and e2e `retry-cancel.spec.ts`, `checks-change-type.spec.ts`.

## What We're NOT Doing

- No `cancelling` run status, no new audit table, no edit of `packages/agents/src/runner.ts`.
- No implementer cancel UI (S-13 adds the `fixing` banner action through the same route).
- No review started by the reconcile poll; no CI status column; no PR event hooks from the poll.
- No multi-worker liveness (heartbeats); one worker process is assumed.

## Implementation Approach

Data first (columns), then the worker mechanism, then routes and UI, then e2e — in task order,
one commit per task.

## Critical Implementation Details

- **Cancel ordering.** `storeResultInTx` locks the run first; if `cancel_requested_at` is set (or
  the run is no longer running) it records sessions and cost only, marks the attempt `failed`
  `cancelled` and the run `cancelled`, and writes no findings or outputs. The guard is the run
  lock, so a late executor result can never write after the cancel committed.
- **Job deletion after commit.** Queued stage jobs are deleted after the cancel transaction
  commits; a job that slips through finds a cancelled run and does nothing (`not_next`).
- **Retry and the one-active-run index.** The failed run is not active, so the retry row inserts
  under `runs_one_active_per_pr`; a unique violation means another run is active → 409
  `run_active`.

## Phase 1: Retry from the failed stage (S-09-T1)

- Schema (`packages/db/src/schema/runs.ts`): `runs.retry_of` (FK runs, nullable),
  `stage_executions.reused_from_stage_id` (FK stage_executions, nullable); also the cancel
  columns for Phase 3 (`cancel_requested_at`, `cancelled_by`, `cancelled_by_member_id`,
  `cancel_reason`) so one migration is generated now.
- `packages/db/src/queries/retry.ts`: `retryRun(deps: {db, queue, logger?}, runId, startedBy)` →
  `{retried: true, run, fromStage} | {retried: false, reason}`. In one transaction: lock the failed
  run, core `retryFromStage(runStateOf…)` (core helper moved or re-derived in db), insert the new
  run (same chain, `round_no`, frozen `level`, `head_sha`, `commits_count_at_start`, `kind`,
  `trigger`, `retry_of`), copy each succeeded stage as a `reused` row with its output and
  `reused_from_stage_id`, copy Review's findings and questions and the run's `not_checked`, copy
  Check fixes' fix checks; then send the job of the first pending stage.
- `run.stage` jobs `retryLimit: 0`; `sendStageJob` takes an optional `expireInSeconds`, set from
  the run's `stageTimeoutMinutes` plus 10 minutes by the worker and by `createRun`.
- Worker `runStateOf` already maps `reused` rows. Test `apps/worker/test/retry.test.ts`.

## Phase 2: Retry route, banner and reused marks (S-09-T2)

- `POST /api/runs/:id/retry` (unsigned, `X-PRA-Request`), 409 `run_not_failed` unless failed,
  409 `run_active` when the PR is held; timeline `run_retried` "Retry from Review started by
  hand"; returns `{run: {id}}`.
- PR view: `ActiveRun.retryFrom` from the active run's `retry_of` (first non-reused pending stage);
  `failedRound.timeoutMinutes` from the run's level when the code is `stage_timeout`.
- Web: `retry` in `MAIN_ACTIONS` ("Retry from <stage>"), failure text from the banner reason;
  Run detail stages carry `reusedFromStageId` → "reused from the failed round"; a retry run shows
  a link to the failed run and its cost. Tests `retry-route`, `retry-banner`, `run-detail-reused`.

## Phase 3: Cancel that stops spend at once (S-09-T3)

- `packages/db/src/queries/cancel.ts`: `requestRunCancel(db, runId, {actor, reason})` (lock; 409
  `run_finished` unless queued/running; idempotent) and `deleteQueuedStageJobs(queue, runId)`.
- Worker `apps/worker/src/run/cancel.ts`: `RunCancellation` (register/abort per run, in
  `WorkerDeps`), `finishCancel(deps, runId)` (lock; with no running attempt apply `cancelRun`,
  set `cancelled`, delete jobs, `afterTransition`), the `pra_change` listener started by
  `startWorker` (`runs` changes), and backstops (stage start, resend loop, reconnect, start).
- `executeStage`: registers the controller, races the executor against cancel + grace, stores
  through the cancel guard. Timeline `run_cancelled` uses the run's `cancelled_by` actor and
  `cancel_reason`. Test `apps/worker/test/cancel.test.ts`.

## Phase 4: Cancel controls (S-09-T4)

- `POST /api/runs/:id/cancel` (unsigned) → 202 `{status: 'cancelling'}`; 409 `run_finished`.
- Web: `cancel` in `MAIN_ACTIONS`, Cancel in `IN_PROGRESS_ROW_ACTIONS`; copy "Cancelled by hand ·
  $1.12 spent". Tests `cancel-route`, `cancel-button`.

## Phase 5: Cancel when the PR closes (S-09-T5)

- PR event hook `cancelOnClosed` on `closed` and `merged`: `requestRunCancel` with actor bot,
  reason `pr_closed` for the PR's active blocking run; timeline "Run cancelled: PR closed"; no
  GitHub comment. Test `close-cancels.test.ts`.

## Phase 6: Nothing stuck after a restart (S-09-T6)

- `recoverAfterRestart` takes the code; worker start uses `interrupted_by_restart`, cancels runs
  with a cancel request. Test `durability.test.ts` runs `apps/worker/test/durability-worker.ts`
  as a child process (SIGKILL, restart).

## Phase 7: End-to-end retry and cancel (S-09-T7)

- `e2e/retry-cancel.spec.ts`: failing Review → Retry from Review (reused marks); cancel from the
  PR page and from Activity on held runs; close webhook cancels. Stack doubles gain a "fail once"
  reviewer range if needed.

## Phase 8: Reconcile poll (S-03-T14)

- `GitHubGateway.listOpenPullRequests(fullName)` (interface, Octokit adapter paging
  `GET /repos/{o}/{r}/pulls?state=open`, unconfigured adapter, fake).
- `JOBS.reconcile` + worker `apps/worker/src/handlers/reconcile.ts` (`reconcileRepositories`),
  scheduled `*/10 * * * *` at worker start. Test `reconcile.test.ts`.

## Phase 9: Checks, change type and large PR on the PR page (S-04-T6)

- PR view section `checks` (change type, how it was set: rules / judge raised / forced, CI counts,
  install result, `largePr`, `largePrLines`) from the latest completed round's outputs.
- `PUT /api/prs/:repo/:number/change-type` `{changeType}` (unsigned) → `setForcedChangeType` +
  timeline `change_type_forced` by hand.
- Web: Checks and Change type renderers in `STAGE_OUTPUTS`; PR panel with grey change type text
  and the large-PR warning. Tests `change-type-route`, `checks-output`, `large-pr`.

## Phase 10: End-to-end Checks and change type (S-04-T7)

- `e2e/checks-change-type.spec.ts` on the level-two repository: stepper order, Run detail CI
  counts and install, PR page change type, oversized fixture shows the warning.

## Testing Strategy

Worker tests call `executeStage`/handlers directly on their own database (as `live-cost.test.ts`);
the durability test uses a child process. API tests use `apps/api/test/helper.ts`; web tests
`renderInRouter` + `stubFetch`; e2e uses `e2e/support/stack.ts` doubles.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Retry from the failed stage

- [x] 1.1 `pnpm --filter @pra/worker test retry.test.ts` passes — ceb14cb

### Phase 2: Retry route, banner and reused marks

- [x] 2.1 (b32f4e0) `pnpm --filter @pra/api test retry-route.test.ts` and `pnpm --filter @pra/web test retry-banner.test.tsx run-detail-reused.test.tsx` pass

### Phase 3: Cancel that stops spend at once

- [x] 3.1 `pnpm --filter @pra/worker test cancel.test.ts` passes — 771b3b5

### Phase 4: Cancel controls

- [x] 4.1 `pnpm --filter @pra/api test cancel-route.test.ts` and `pnpm --filter @pra/web test cancel-button.test.tsx` pass

### Phase 5: Cancel when the PR closes

- [ ] 5.1 `pnpm --filter @pra/worker test close-cancels.test.ts` passes

### Phase 6: Nothing stuck after a restart

- [ ] 6.1 `pnpm --filter @pra/worker test durability.test.ts` passes

### Phase 7: End-to-end retry and cancel

- [ ] 7.1 `pnpm test:e2e retry-cancel.spec.ts` passes

### Phase 8: Reconcile poll

- [ ] 8.1 `pnpm --filter @pra/worker test reconcile.test.ts` passes

### Phase 9: Checks, change type and large PR

- [ ] 9.1 `pnpm --filter @pra/api test change-type-route.test.ts` and `pnpm --filter @pra/web test checks-output.test.tsx large-pr.test.tsx` pass

### Phase 10: End-to-end Checks and change type

- [ ] 10.1 `pnpm test:e2e checks-change-type.spec.ts` passes
- [ ] 10.2 `git merge main`, then `pnpm verify` and `pnpm test:e2e` pass
