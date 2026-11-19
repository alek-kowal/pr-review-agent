<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Round 1 engine (P-05)

- **Plan**: context/changes/P-05-round-1-engine/plan.md
- **Scope**: all 6 phases (`git diff a65a490^1 a65a490`)
- **Date**: 2026-11-19
- **Reviewer**: package P-05r (decisions in `context/changes/P-05r-review/change.md`)
- **Verdict**: REJECTED as merged (one critical finding); every code finding is fixed in P-05r
- **Findings**: 1 critical, 5 warnings, 4 observations
- **After the fixes**: `pnpm verify` green (578 tests), `pnpm test:e2e` 4 of 4 passed

Focus, as asked: what can hurt in production. That covers the review pipeline (job
idempotency and retries, state transitions, crash or restart mid-round, agent slots, cost per
PR), the review triggers, and test doubles.

## Verdicts

| Dimension | Verdict | Note |
|-----------|---------|------|
| Plan Adherence | PASS | All six phases match. Small drift with no effect: `startRound` takes `level`, not `config`. |
| Scope Discipline | PASS | The extra files (`run/cleanup.ts`, `run/jobs.ts`, `stages/paths.ts`, split `stages/review/`) are documented in `change.md`. |
| Safety & Quality | FAIL | F1 critical; F2–F5 warnings. All fixed. |
| Architecture | PASS | Package boundaries hold. Doubles are reachable only through `@pra/*/testing` (lint `no-restricted-imports`). There is no env-switched fake mode. |
| Pattern Consistency | PASS | |
| Success Criteria | WARNING | Automated criteria pass. Under parallel load, `run-round.test.ts` timed out (fixed in 31378c6). Manual 6.3 (CI e2e after merge) is still open. |

## Checked and OK

- **Triggers**:
  - Only `opened` (not a draft) and `ready_for_review` start a round (`core/rounds.ts:27`).
  - `synchronize` gives `push_never_starts`, and that check runs before the draft check.
  - `reopened`, `edited` and `labeled` give `event_ignored`. `closed` gives `pr_closed`. Forks get no review.
  - The only path that creates runs is `startRound`, called from the `pull_request` handler. No API route starts a run.
  - In P-05 every chain is round 1. The 3-round cap belongs to later chain logic (P-11).
- **Webhook route**:
  - The signature is checked first (401). An unconfigured gateway gets 503 `github_not_configured`.
  - The delivery id is checked with `assertBlobKey`, so it cannot escape the blob folder.
  - The 25 MiB limit applies to the raw parser, and errors use the `{ error: { code, params } }` shape.
  - A redelivery with the same `X-GitHub-Delivery` gives one row and one job.
- **State machine**:
  - Every transition goes through core (`startRun`, `startStage`, `completeStage`, `failStage`, `recoverAfterRestart`) with the run row locked `FOR UPDATE`.
  - With the `exclusive` policy, `run.stage` allows one queued or active job per `<runId>:<stage>`.
  - The stage timeout (max 240 min plus a 30 s grace) stays below the 5 h job expiry, so a live review is never run twice.
- **Agent sessions**: each session is capped at 10 USD and 100 turns, enforced by the runner. The real runner refuses to start when its signal is already aborted.

## Findings

### F1 — A failure after a stage started left the run running for good

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: apps/worker/src/run/execute-stage.ts:95-111, :148
- **Detail**:
  - **Trigger:** the stage attempt is committed as `running`, and then something throws: the blob store is down, Postgres refuses a value (for example `\u0000` in LLM text), or the next stage's send fails.
  - **What happened next:** pg-boss retried the job (2 times, no delay). The retry found the stage `running`, so it returned `not_next` and the job completed.
  - **Result:** the run and the stage stayed `running` until the worker restarted. `runs_one_active_per_pr` blocked every new round on that PR, the session's cost (up to 10 USD) was not recorded, and the worktree stayed on disk.
- **Fix**:
  - When the result cannot be stored, the stage fails `stage_error` and keeps its sessions and cost.
  - A job that finds its own stage still `running` fails it `interrupted`, the same way a restart does (`run/interrupt.ts`, shared with recovery).
  - A repeated job for a finished stage sends the next stage's job again.
- **Decision**: FIXED — 84e489c

### F2 — A retried `github.event` job could start a second round 1

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: apps/worker/src/handlers/github-event.ts:37, apps/worker/src/github-events/pull-request.ts:58-83
- **Detail**:
  - The event was marked processed only after the PR hooks ran.
  - pg-boss ran the event again in any of these cases: a hook threw, the final update failed, or the worker was SIGKILLed in between (the 15 min expiry).
  - If the first round had already ended by then, the retry started another round 1. That means a second paid review and a second comment on a public PR.
- **Fix**:
  - `round_started` is written in the same transaction that inserts the run (`startRound` `inTransaction`, `setGithubEventOutcome`).
  - A retry of that event still runs the hooks, but it starts nothing.
  - A new test covers two deliveries at once.
- **Decision**: FIXED — 3f2ca71

### F3 — A late or out-of-order delivery started a round no "ready" asked for

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (trigger rule)
- **Location**: apps/worker/src/github-events/pull-request.ts:40-55
- **Detail**:
  - A stale payload was decided on the stored PR, but with the stale event's own action.
  - **Case 1:** a late `opened` for a PR that was opened as a draft gave `round_started` once the stored PR was ready.
  - **Case 2:** a late `opened` or `ready_for_review` started a second round 1 after the round it had already caused.
  - **How it happens in practice:** an admin uses "redeliver failed deliveries" after the api was down.
- **Fix**:
  - A stale payload that was a draft gives `draft`.
  - A stale payload older than a round of the PR gives `event_stale` (new query `roundCreatedSince`).
  - A ready delivery that arrives after a later push still starts round 1.
- **Decision**: FIXED — afa81b2

### F4 — A send lost while the worker ran was never repaired

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: apps/api/src/routes/webhooks/index.ts:90-104, apps/worker/src/run/start-round.ts:68, apps/worker/src/run/recover.ts
- **Detail**:
  - **Webhook:** the route stores the event row and then sends its job. If the send fails (for example, the api's queue is still starting after a deploy), the api answers 500.
    - GitHub does not redeliver on its own, and nothing re-sent jobs for unprocessed events, so that PR never got a review.
  - **Stage jobs:** a lost `run.stage` send (after `startRound` or between stages) was repaired only at the next worker start. Until then the run waited with no job and blocked the PR.
- **Fix**: `resendLostJobs` runs at start and every 5 minutes. It sends again:
  - the next stage job of queued and running runs;
  - the job of every event stored 1 minute to 1 day ago that is still unprocessed.

  The job ids stay fixed (`githubEventJobId` is shared with the api), so nothing is duplicated. Interrupting running stages is still a start-only step.
- **Decision**: FIXED — 00359fa

### F5 — The after-round comment could be posted twice, or lost within milliseconds

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/worker/src/handlers/github-comment.ts:86-97, packages/db/src/queue.ts:44-47
- **Detail**:
  - **Double post:** the `catch` around the post also covered the update that records `posted`. If that update failed after GitHub accepted the comment, the row became `failed` and the retry posted the sentence again.
  - **Lost comment:** pg-boss retried twice with no delay, so a GitHub outage or a secondary rate limit lost the comment.
- **Fix**:
  - Only a failed post marks the row `failed`. A failed record leaves it `sending`.
  - `github.comment` retries 5 times, starting at 1 minute, with backoff.
- **Decision**: FIXED — e5b747c, f6306e2

### F6 — No spend cap per PR or per day, and one agent slot for the whole worker

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality (cost)
- **Location**: packages/core/src/rounds.ts:27, apps/worker/src/worker.ts:41, apps/worker/src/run/gates.ts
- **Detail**:
  - **Per PR:** every "ready for review" after a finished round starts a new chain with a full review (up to 10 USD). Draft → ready toggles have no cap per PR.
    - This matches the PRD: a new chain on every ready, and "no per-PR dollar cap" is a non-goal.
    - The daily budget and the slots are P-16. Until then, the `beforeRoundStart` and `beforeSession` gates are empty, so nothing limits spend per day.
  - **Slots:** `run.stage` runs with pg-boss defaults (`localConcurrency` 1, `batchSize` 1). That means one agent session at a time per worker, which is safe for cost. But one long review (up to 240 min) holds every other PR's stages.
  - `beforeSession` runs once per stage and outside the run lock. P-16's slot gate needs a reservation.
- **Fix**: not a code change in P-05r; this needs Alek (money). Options:
  - keep it until P-16, as planned;
  - or set the Anthropic console's monthly spend limit for the key now.
- **Decision**: NEEDS ALEK

### F7 — A stage timeout during git went on to build a worktree and start a session

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/worker/src/stages/review/index.ts:47-53
- **Detail**:
  - `fetch`, `addWorktree` and `diff` take no signal. After a timeout, the executor went on to build a worktree after `removeRunFiles` had cleaned up, so disk space leaked.
  - It then called the runner with an aborted signal. The real runner refuses that; the test double does not.
  - In `run-round.test.ts`, the double waited 30 s for an abort that had already happened, and every later job in the file timed out. That is why `pnpm verify` was red under parallel load.
- **Fix**:
  - `signal.throwIfAborted()` runs after fetch, after the diff, and before the session.
  - The test step now ends on an already-aborted signal and uses a 3 s timeout.
  - The worker tests get 30 s test and hook timeouts.
- **Decision**: FIXED — 3829ca3, 31378c6

### F8 — Changed queue settings never reached an existing database

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/db/src/queue.ts:101
- **Detail**: pg-boss `createQueue` is `ON CONFLICT DO NOTHING`, so the F5 retry settings (or a later expiry change) would never reach the dev `pra` database or production.
- **Fix**: `migrateQueue` also calls `updateQueue` with every setting except the policy.
- **Decision**: FIXED — 302e534

### F9 — `stage_error` had no web copy

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/web/src/copy/index.ts:127-135
- **Detail**: the failed-round line showed "error stage_error". After F1, this code is more common.
- **Fix**: the line now reads "an unexpected error stopped it".
- **Decision**: FIXED — 3dce649

### F10 — Known gaps left for P-15 and P-16

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: apps/worker/src/run/hooks.ts:44-58, apps/worker/src/run/execute-stage.ts (grace), apps/worker/src/handlers/github-comment.ts
- **Detail**: none of these were fixed, because each needs a design choice that belongs to a later package:
  - **Comment hook:** if `enqueueAfterRoundComment` fails, the failure is only logged and the round gets no comment. The resend skips finished runs, because the setting may have changed since.
  - **Files after a crash:** the worker can die after the stage commit but before `removeRunFiles`. That run's worktree and session folder then stay on the `git-data` volume.
  - **Lost cost:** the cost is lost when the executor does not return within the 30 s grace, or when the worker dies between the end of the session and the transaction. The blobs stay orphaned.
  - **GitHub timeout:** if `postIssueComment` times out after GitHub created the comment, the row is marked `failed` and the comment is posted a second time.
  - **Failed events:** an event whose job failed every retry cannot be processed again until pg-boss deletes the job row (7 days), because a manual redelivery and the resend both reuse its fixed job id.
- **Fix**: carry these into P-15 (retry and cancel) and P-16 (budget, slots, drainer). Two candidates: a cleanup sweep for files of finished runs, and a comment resend for completed rounds that still have no `github_actions` row.
- **Decision**: SKIPPED (follow-up)

## Outside P-05

- On every full run under parallel load, one P-06 test timed out: `packages/integrations/src/sandbox/sandbox.docker.test.ts` › "mounts read-only unless writable…" (5 s default). It passes when run alone. Left to P-06's owner and its review.
