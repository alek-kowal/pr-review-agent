---
change_id: P-05r
title: Implementation review of P-05 (round 1 engine)
status: implemented
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-05r reviews P-05 against its plan (10x-impl-review format) and fixes what the
review finds, one commit per finding. It has no plan of its own.

- **Report:** `context/changes/P-05-round-1-engine/review.md`. Verdict: REJECTED as merged
  (F1 is critical). F1–F5 and F7–F9 are fixed, F6 needs Alek, and F10 is left as follow-ups.
- **P-05 status:** its `change.md` is now `impl_reviewed`.
- **Result:** `pnpm verify` green (578 tests) and `pnpm test:e2e` 4 of 4 passed.

## Decisions

- **Report path:** `review.md` in the P-05 folder, as the orchestrator asked. That replaces
  the skill's default `reviews/impl-review.md`.
- **No interactive triage:** the orchestrator rule is to fix every confirmed finding without
  asking. A finding counts as confirmed when a new test fails without the fix and passes with
  it, or (for F8) when the pg-boss source shows the behaviour.
- **A stage left running by a dead handler:** the worker assumes one process, as deployed, and
  pg-boss allows one queued or active `run.stage` job per run and stage. So a job that finds its
  own stage `running` is a retry, and that attempt fails `interrupted`, as at a restart.
  - Recovery at start and this retry share `run/interrupt.ts`.
  - If the result cannot be stored, the stage fails `stage_error` instead, with its sessions
    and cost. Those sessions have no blob keys (the columns are nullable).
- **Lost sends:** the P-05 decision was "repaired at worker start". It is now: at start, and
  then every 5 minutes (`resendLostJobs`, `WorkerOptions.resendIntervalMs`).
  - Only sends are repeated, because they are deduped by key. Interrupting a running stage
    stays start-only, because a running stage may be live after start.
  - Events are re-sent when they are 1 minute to 1 day old and unprocessed. The day stays
    inside pg-boss's job retention (7 days), so a fixed job id still dedupes.
  - There is no index on `github_events.processed_at`. The scan is small for one team, and a
    migration would collide with other packages editing that table.
- **Stale `pull_request` deliveries:**
  - A stale payload that was a draft gives `draft`.
  - A stale payload older than a round of the PR gives the new worker outcome `event_stale`.
  - A stale ready delivery with no round since then still starts round 1. Example: `ready`
    and a later push delivered out of order.
  - Not starting on any stale event would lose that round.
- **Event retry:** `round_started` is written in the run's insert transaction
  (`startRound({ inTransaction })`), not `processed_at`. So a retry of that event still runs
  the PR hooks, which must stay idempotent, but it does not start another round.
- **Queue settings:**
  - `migrateQueue` calls `updateQueue` with every setting except `policy`, which pg-boss
    cannot change.
  - `github.comment` retries 5 times at 60 s with backoff. `run.stage` keeps the pg-boss
    default of 2 retries, which now reach the interrupt path.
- **Worker test timeouts:** 30 s for tests and hooks in `apps/worker` only (real pg-boss, git
  and Postgres, with several worktrees testing at once). The flaky P-06 Docker sandbox test is
  left to P-06's owner.
- **Review stage abort:** the executor checks `signal.throwIfAborted()` between the git steps
  and before the session. The `GitMirror` interface (P-03) still takes no signal.

## Needs Alek

- **F6 spend:** until P-16 adds the daily budget and slots, nothing limits agent spend per day.
  Each review session is still capped at 10 USD, and a new chain starts on every "ready". If
  the real key is wired before P-16, set a monthly spend limit for it in the Anthropic console.
