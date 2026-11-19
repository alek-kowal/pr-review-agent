# P-16 handoff (stopped: usage limit)

Plan and decisions: `context/changes/P-16-pause-budget-and-queue/` (plan.md, change.md).

## Done

- T1 `2709201`: app settings `pausedBy`, `pausedAt`, `timeZone`; migration 0014 (`run_waits`,
  settings row, notify triggers on run_waits and app_settings); `spentToday`. Test passes.
- T2 `bc53b85`: core `startGate`, `slots_busy` reason, `paused` names `by`. Tests pass.
- T3 partial (WIP commit, not verified): `JOBS.runDrain` + `sendDrainJob` (queue.ts), queue
  queries in `packages/db/src/queries/status.ts` (lock, slot holders, waiting runs, admit, set/clear
  wait, `runWaitsOf`), gates in `apps/worker/src/run/budget-gate.ts`, `NO_RUN_GATES` in gates.ts.
  The gates are NOT registered yet (lists empty) so existing tests stay as they were.

## Left

1. T3: `apps/worker/src/run/drain.ts` (admit oldest waiting runs, refresh reasons, clear session
   waits, then send the stage job: first pending stage for queued, `nextStage` for running; extract
   that from `resendLostJobs` in recover.ts); a `wakeQueue` hook in `RUN_HOOKS` runCompleted,
   runFailed, runCancelled; worker.ts: `queue.work(JOBS.runDrain, ...)`, `queue.schedule(JOBS.runDrain,
   '* * * * *')`, one drain at start; register the gates in `RUN_GATES`; `createTestWorkerDeps`
   defaults `extensions: { runGates: NO_RUN_GATES, ...rest.extensions }`; drop the `void` lines in
   gates.ts; `apps/worker/test/budget-gate.test.ts` (own database, executeStage with a blocking
   FakeAgentRunner step) per the task's Done when.
2. T4–T7 as in plan.md (api routes with `signedBy`, 409 `already_paused` / `not_paused`, status
   GET, insights uses `spentToday`; chip controls, `/settings/budget`, Progress primitive; queued
   reasons in the pr-state loader line 116, Activity and banner `resume` action; e2e spec in its own
   Playwright project run first, stack sets agent slots 20).
3. Merge main, regenerate migration 0014 if the number is taken, `pnpm verify`, `pnpm test:e2e`.
