# P-16 handoff (stopped: context full)

Plan and decisions: `context/changes/P-16-pause-budget-and-queue/` (plan.md, change.md).
Done: T1 `2709201` (settings fields, migration 0014 `run_waits`, `spentToday`), T2 `bc53b85` (core `startGate`).
Left, partial first:
1. T3 (wip commits): gates in `apps/worker/src/run/budget-gate.ts` are registered in `RUN_GATES`; drainer
   `run/drain.ts` (`run.drain` job, cron each minute, wake on start and via `queue-hooks.ts` end hooks);
   `sendPendingStageJob` in recover.ts; test deps default `NO_RUN_GATES`. `test/budget-gate.test.ts`: 4 of 5
   pass; the pause test's held round ends with review `failed stage_error` (likely a stale `FakeAgentRunner`
   step left by a `review()` call whose gate said wait: enqueue the step only after the gate passes, or
   reset steps in `beforeEach`). Remove the debug `expect(stages...).toEqual([])` there. Then run the full
   worker suite and `pnpm verify` (not run since T2).
2. T4–T7 as in plan.md: api routes with `signedBy`, 409 `already_paused`/`not_paused`, `sendDrainJob` after
   commit, GET status from `spentToday`, Insights too; chip controls, `/settings/budget`, Progress primitive;
   queued reason via `runWaitsOf` in the pr-state loader line 116, Activity and banner `resume` action;
   e2e spec in its own Playwright project run first; e2e stack sets agent slots 20.
3. Merge main, regenerate migration 0014 if the number is taken, `pnpm verify`, `pnpm test:e2e`.
