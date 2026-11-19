---
change_id: P-11
title: Manual start, chains and sensitive files (S-07-T1–T7, S-11-T1–T4)
status: planned
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-11 from `context/foundation/work-packages.md`, wave 5. Plan: yes, see `plan.md`.
One commit per task, in the listed order. Planning ran without questions (orchestrator rule:
decide and record).

## Decisions

- **Run creation lives in `@pra/db`** (`packages/db/src/runs/`): `createRun` and `startRound` are
  used by the worker (ready webhook, fix pushes) and the API (manual start), which cannot import
  the worker. `apps/worker/src/run/start-round.ts` stays as a thin wrapper. P-17, P-18 and P-21
  call `createRun` from `@pra/db`.
- **Routes follow the existing keying** `/api/prs/:repo/:number/...`, not `/api/prs/:id/...`.
- **Chains get a table** `round_chains` with `expected_head_sha` (set by S-14's push through
  `setChainExpectedHead`). The fix SHA of an `own_fix` round is its head SHA (FR-016 makes them
  equal), so no extra column. Trigger names stay core's `ready_for_review | manual | own_fix`.
- **PR level** is `pull_requests.level` (null: repository default). Manual start uses the level
  picked in the form; the ready event and fix pushes use the PR level.
- **Commits since** are stored per run (`commits_since`, `commits_since_head`), measured with
  `compareCommits` after a push and when a round ends on a moved head; a failed compare falls back
  to the commit-count difference.
- **Findings shown on the PR** come from the latest completed full round (round 1 of its chain);
  fix checks add Resolved / Not resolved. The reviewed SHA is the latest completed round's head.
- **Sensitive files match `sensitivePatterns`** (pattern plus reason, PRD FR-002 / FR-046), not
  `changeTypeRules.oneWayPaths`; the task's "one-way paths" means these sensitive patterns.
- **Fix check `reproductions` stage** reruns nothing until scripts exist for the checked findings;
  it records that in its output instead of failing `stage_not_available`.

### S-07-T2 (pushes)

- The fix push start sits in the `pull_request` handler (the event's outcome is `round_started`);
  measuring commits since is a `headChanged` PR event hook plus a `runCompleted` hook.
- Starting a fix check clears the chain's `expected_head_sha` in the run's transaction, so a
  retried event or a second push on the same commit never starts round 3 by itself.
- The fix PR Review Agent pushed and did not check (chain used its 3 rounds) is not counted as
  "new commits": the PR shows Automatic rounds used, as the task's "Done when" asks.
- When the head equals the reviewed SHA there are 0 commits since, whatever the commit counts say.
- The loader takes findings and questions from the latest completed full round (round 1 of its
  chain), so a fix check, which writes no findings, keeps them on the PR (moved here from T4).
