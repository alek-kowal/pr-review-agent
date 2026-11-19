---
change_id: P-10
title: Live backend and timeline (S-03-T1–T7)
status: planned
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-10 from `context/foundation/work-packages.md`, wave 4: change notifications, SSE,
live cost per turn, core round label / stepper / time summary, the timeline and PR state log,
and the run detail, timeline, activity and status APIs. Plan: yes, see `plan.md` (brief in
`plan-brief.md`). One commit per task, in the listed order.

The planning step ran without questions (orchestrator rule: decide and record).

## Decisions

Planning decisions are in `plan-brief.md` "Key Decisions Made". Implementation-time decisions
are added per task below.

### S-03-T1 (change notifications)

- Migration `0006_live_notify.sql` is hand-written (`drizzle-kit generate --custom`): one
  plpgsql function `pra_notify_change()` reads `pull_request_id` / `run_id` from `to_jsonb(NEW)`,
  so any later table with those columns needs only a `CREATE TRIGGER` line. Sessions look up
  their run through `stage_executions`. If the migration must be renumbered at merge, recreate it
  with `--custom` and copy the SQL; drizzle-kit cannot regenerate it.
- `listenChanges(db | url, onChange, { onReconnect, onError, retryMs, maxRetryMs })` opens its
  own `pg.Client` (`application_name = 'pra-live'`), never a pool slot; it reconnects with
  backoff (100 ms doubling to 5 s) and calls `onReconnect`, since changes in the gap are lost.
- `run-round.test.ts` (P-05): the stage-timeout double now also resolves when the signal is
  already aborted. Under full-suite load the worktree setup outlasted the 180 ms timeout, the
  double waited the 30 s grace, and the worker's next jobs timed out.

### S-03-T2 (SSE)

- `GET /api/live` lives in `routes/api/live/index.ts`; the hub (`src/live/hub.ts`) and its one
  `listenChanges` subscription in the `live` plugin. The subscription starts with the first
  client and closes with the app; the route writes `: connected` only after LISTEN is active.
- Messages: `event: change` with `{ table, id, prId, runId }`, `event: resync` after the listener
  reconnects (changes in the gap are lost), `: heartbeat` every 15 s while a client is connected.
- `AppDeps.live?: LiveHub` (default: a new hub) so tests can count clients; the app plugin is
  encapsulated, so its decorations are not visible on the test's root instance.
- A `preClose` hook ends open streams; otherwise `app.close()` would wait for them.
- The route is hidden from the OpenAPI document (an event stream, not JSON).

### S-03-T3 (live cost and current stage)

- `liveSessions(deps, { runId, stageExecutionId })` (`apps/worker/src/run/live-sessions.ts`)
  wraps `deps.agentRunner` for the stage executor only; executors stay unchanged. It inserts a
  `running` session row at session start, writes cost, tokens and turns per `onProgress` on one
  promise chain (turn order), and ends with the SDK's reported total. Each write updates the
  session and adds the delta to `runs.cost_usd` in one transaction, so the run cost stays the sum
  of its sessions. A failed write is logged and its delta is retried with the next write.
- `storeResultInTx` only sets the blob keys of sessions the live runner created (found by result
  object identity) and inserts the rest (sessions an executor returns without running them
  through the runner), adding only their cost.
- A session that throws keeps the cost of the turns it reported and gets status `failed`.
  After a restart, `recoverRuns` marks still-`running` sessions with the recovery error code.
- `runs.current_stage` (migration `0007`): set when a stage starts; after a stage succeeds it
  names the next stage (the one queued); `null` when the run ends, also in recovery.
- `FakeAgentRunner` steps take `progress` (sent in order before the result, one macrotask
  apart), so existing tests keep working without it.

### S-03-T4 (core rules)

- `roundLabel(run, chain)` is an overload of the existing `roundLabel(round)`: it finds the run in
  `chainState(...).rounds` and returns the same `round_label` reason, or null for a run that is
  not a round (trial, implementer, analyst). No new reason code.
- `stepperModel(stageRows, level, roundKind)`: the steps are the run's plan (`stagesFor`, the
  same plan the worker's `runStateOf` uses); each step takes the status of its latest stored
  attempt (`pending` → queued, `succeeded`/`reused` → done) and the cost of all its attempts. A
  planned stage without a row is `queued`; a row for a stage outside the plan is not shown; a
  stage off at the level stays `off` with its `off_at_level` reason.
- `timeSummary(stateChanges, runs, now)`: ready time is the first logged state that is neither
  `draft` nor off the board. Each state's span goes to its lane; Agents worked is the
  `agents_working` lane, waiting is the other three lanes (never reviewed included), time while
  closed counts toward none. The end is the last change when it is `merged`/`closed`, else
  `now`. Cost sums runs that are completed, failed or cancelled.
