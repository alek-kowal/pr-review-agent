# Live backend and timeline (P-10) Implementation Plan

## Overview

Work package P-10 (wave 4): S-03-T1 to T7. Postgres change notifications, an SSE stream, live
cost per agent turn with the run's current stage, the core round label / stepper / time-summary
rules, the timeline and PR state-change log with their writers, and the read APIs for Run
detail, transcript, Timeline, Activity in progress and the status chip. The web half of S-03
(T8 to T13) is P-12.

## Current State Analysis

- `packages/db`: Drizzle schema with int identity keys (`team_members` uses uuid). Tables the UI
  watches: `pull_requests`, `runs`, `stage_executions`, `agent_sessions`, `findings`,
  `decision_batches`. Migrations `0000`–`0005`, all drizzle-kit output; no triggers, no
  LISTEN/NOTIFY anywhere. `runs` has no `current_stage` and no instruction versions.
- `agent_sessions` rows are inserted only after a session ends (`storeResultInTx` in
  `apps/worker/src/run/execute-stage.ts`), with `addRunCost` adding the total to `runs.cost_usd`.
- `AgentRunner` already has `onProgress({ turns, costUsd, usage })` with running totals, priced
  per assistant message (`claude-agent-runner.ts`); the final cost is the SDK's reported total.
  `FakeAgentRunner` never calls `onProgress`.
- Worker extension points (P-05): run hooks `runCompleted | runFailed | runCancelled |
  sessionCostRecorded` (fired after commit, failures logged) and PR event hooks
  `ready | headChanged | closed | merged` (must be idempotent; the ready hook runs after the
  round decision, so the run is already queued).
- `decideFindings` (packages/db) exists but no API route calls it yet (P-08 adds the route).
- Core: `roundLabel(round)` returns `{ code: 'round_label', params }`; `chainState(runs)`,
  `stagesFor(level, roundKind)`, `prState`, `laneOf` exist.
- API: Fastify with autoload, Zod type provider, `{ error: { code, params } }`; PR routes are
  keyed `:repo/:number`. `prs.test.ts` already uses a read-only connection for reads.
- P-08 (same wave) is writing `loadPrStateInput(db, prId)` in `packages/db/src/queries/pr-state.ts`
  (hot file H7) — not available on this branch.

## Desired End State

- An insert or update on a watched table sends one `pra_change` notification
  `{ table, id, prId, runId }`; `listenChanges` survives a killed backend.
- `GET /api/live` streams `event: change` to every client from one shared subscription.
- While a session runs, `agent_sessions.cost_usd` and `runs.cost_usd` grow per turn and
  `runs.current_stage` names the running stage; at the end the session cost is the SDK total.
- Timeline entries and PR state changes are written by every existing writer; Run detail,
  transcript, Timeline, Activity and status endpoints exist; no GET route writes.

### Key Discoveries:

- Hooks after commit: `apps/worker/src/run/hooks.ts`, fired in `execute-stage.ts` `afterTransition`.
- PR event hooks: `apps/worker/src/github-events/pr-hooks.ts`, fired in `pull-request.ts:69-83`.
- After-round comment posted at `apps/worker/src/handlers/github-comment.ts:87`.
- Session blobs: `runs/<runId>/<stage>-<attempt>/session-<n>/{prompt.txt,transcript.json}`.
- Test DB per run: `@pra/db/testing` `createTestDatabase()` / `testDatabaseUrl()`.

## What We're NOT Doing

- Any web UI (P-12: T8–T13), reconcile poll (S-03-T14, P-15), pause/budget states (P-16),
  alert count (P-20), chain fields and `createRun` (P-11).
- No new state loader in the H7 file; no route for decisions (P-08).

## Implementation Approach

Task order T1 → T7 with one commit each. Triggers are hand-written SQL appended to a drizzle-kit
migration. Live cost goes through a worker-side `AgentRunner` decorator that creates the session
row at session start and updates it per `onProgress`. Timeline and state-log writers live in
`packages/db/src/queries/timeline.ts`; call sites use P-05's hooks where one exists, and
in-transaction writes in `execute-stage.ts` (run start) and `decideFindings`.

## Critical Implementation Details

- **State sequencing.** `onProgress` is synchronous; the decorator chains its DB writes on one
  promise and awaits it before finalising the session, so the final reported cost always lands
  last. Run cost moves by deltas (`final − live so far`), so `runs.cost_usd` stays the sum of its
  sessions.
- **Timeline order.** Entries sort by `(at, id)`. PR-event entries use the stored GitHub event's
  `received_at`; run end entries use `runs.finished_at`. Idempotency comes from a unique
  `(pull_request_id, source_key)`, so a retried event or hook writes nothing twice.
- **State log loader.** `recordStateChange` computes the state with core `prState` from a small
  private loader in `timeline.ts`. After P-08 merges, the loader is replaced by P-08's
  `loadPrStateInput` (one call site).

## Phase 1: Change notifications (S-03-T1)

- Migration `0006_live_notify`: plpgsql `pra_notify_change()` building `{table,id,prId,runId}` per
  table (stage_executions and agent_sessions look up run and PR) and `AFTER INSERT OR UPDATE FOR
  EACH ROW` triggers on the six tables.
- `packages/db/src/live.ts`: `listenChanges(db | url, onChange, { onReconnect?, onError? })` →
  `{ ready, close() }`; one dedicated `pg.Client` (`application_name = 'pra-live'`), reconnects
  with backoff and re-LISTENs.
- Test `packages/db/src/notify.test.ts`.

## Phase 2: SSE (S-03-T2)

- `apps/api/src/live/hub.ts` (fan-out, heartbeat 15 s, `size`), `routes/api/live/index.ts`
  (`GET /api/live`, hijacked reply, lazy shared subscription closed on app close).
- Test `apps/api/test/routes/live.test.ts` (two real clients over HTTP; hub heartbeat with fake
  timers; 0 clients after disconnect).

## Phase 3: Live cost and current stage (S-03-T3)

- `runs.current_stage` column; set when a stage starts, cleared when the run ends (also in
  recovery).
- `apps/worker/src/run/live-sessions.ts`: decorator over `deps.agentRunner` passed to the
  executor; inserts a `running` session row, updates cost/tokens/turns per progress, finalises
  with the reported total. `storeResultInTx` updates blob keys of live rows and inserts only
  sessions not created through the decorator. `sessionCostRecorded` still fires once per session.
- `FakeAgentRunner` steps accept `progress` (emitted in order before the result).
- Test `apps/worker/test/live-cost.test.ts`.

## Phase 4: Core rules (S-03-T4)

- `roundLabel(run, chain)` overload (returns null for a run not in the chain);
  `stepperModel(stageRows, level, roundKind)`; `timeSummary(stateChanges, runs, now)`.
- Tests `packages/core/test/{round-label,stepper,time-summary}.test.ts`.

## Phase 5: Timeline and state log (S-03-T5)

- Tables `timeline_entries`, `pr_state_changes` (schema file `timeline.ts`), triggers added,
  `recordTimelineEntry`, `recordStateChange`, `timelineOf`, `stateChangesOf`.
- Writers: PR event hooks (ready, push, closed, merged), run start (in `startStageInTx`), run
  hooks (completed, failed, cancelled), comment posted, `decideFindings` (and state on undo).
- `runs.instruction_versions` recorded at run start (for Run detail).
- Tests `apps/worker/test/timeline.test.ts`, `packages/db/src/timeline-writers.test.ts`.

## Phase 6: Run detail and transcript (S-03-T6)

- `GET /api/runs/:id`, `GET /api/runs/:id/sessions/:sessionId/transcript`; `summarizeTranscript`
  in `@pra/agents` for files read and actions.
- Test `apps/api/test/routes/runs.test.ts`.

## Phase 7: Timeline, in-progress, status, reads never write (S-03-T7)

- `GET /api/prs/:repo/:number/timeline`, `GET /api/activity/in-progress`, `GET /api/status`.
- Tests `timeline.test.ts`, `activity.test.ts`, `reads-never-write.test.ts` (own database,
  every GET from Fastify's route list, per-table checksum).

## Testing Strategy

Each task's "Done when" test, plus `pnpm verify` before every commit. No UI change, so no e2e
run is required; the existing e2e spec is rerun once at the end because the stage runner changed.

## References

- Tasks: `context/foundation/roadmap-tasks.md` S-03-T1–T7; package block P-10 in
  `context/foundation/work-packages.md`.

## Progress

### Phase 1: Change notifications

- [x] 1.1 `pnpm --filter @pra/db test notify.test.ts` passes; `pnpm verify` green

### Phase 2: SSE

- [x] 2.1 `pnpm --filter @pra/api test live.test.ts` passes; `pnpm verify` green

### Phase 3: Live cost and current stage

- [x] 3.1 `pnpm --filter @pra/worker test live-cost.test.ts` passes; `pnpm verify` green

### Phase 4: Core rules

- [x] 4.1 `pnpm --filter @pra/core test round-label.test.ts stepper.test.ts time-summary.test.ts`
  passes; `pnpm verify` green

### Phase 5: Timeline and state log

- [x] 5.1 worker `timeline.test.ts` and db `timeline-writers.test.ts` pass; `pnpm verify` green

### Phase 6: Run detail and transcript

- [x] 6.1 `pnpm --filter @pra/api test runs.test.ts` passes; `pnpm verify` green

### Phase 7: Timeline, in-progress, status, reads never write

- [ ] 7.1 api `timeline.test.ts activity.test.ts reads-never-write.test.ts` pass; `pnpm verify`
  green
