# P-15 handoff

- Plan and decisions: `context/changes/P-15-retry-cancel-stage-outputs/` (plan.md, change.md). Read change.md first.
- Done: `git merge main` (e6a32cd); S-09-T1 ceb14cb, T2 b32f4e0, T3 771b3b5, T4 1812bdc, T5 a3217fb (each passed `pnpm verify`).
- Partial S-09-T6 (3a346f7): core `STAGE_ERROR.interruptedByRestart` and `recoverAfterRestart(run, code)`; `recoverRuns` uses `interrupted_by_restart`; `apps/worker/test/durability.test.ts` and `durability-worker.ts` (child process) pass.
- To finish T6: the last `pnpm verify` had 2 worker failures from this work.
  1. `apps/worker/test/run-round.test.ts:432` still expects `errorCode: 'interrupted'` after `recoverRuns`; change it to `'interrupted_by_restart'`.
  2. `apps/worker/test/cancel.test.ts` "jobs are gone": wrap `expect(await queuedJobs(run.id)).toHaveLength(0)` in `vi.waitFor` (jobs are deleted after the status commit).
  The 2 web failures in that run (insights-overview, FindingDecisions) pass when run alone; they are load timeouts.
  Then tick 6.1 in plan.md, add the T6 decision (worker start = `interrupted_by_restart`, in-process left-running = `interrupted`) to change.md, and commit `feat(S-09): nothing stuck after a restart (T6)`.
- Left: S-09-T7 (e2e `retry-cancel.spec.ts`), S-03-T14 (reconcile poll), S-04-T6, S-04-T7, as planned in plan.md.
- Not yet run: `pnpm test:e2e`. T2 changed the Stage failed banner text (it now ends ". This round is not counted"); `e2e/first-round.spec.ts:113` matches by substring, so it should still pass.
- Know: cancel = `requestRunCancel` (db) plus the worker's `finishCancel` and `listenForCancels` (`apps/worker/src/run/cancel.ts`); `WorkerDeps.cancellation` is set by `withDefaults`. Edit files only with Edit/Write.
- At the end: `git merge main`; if main has a 0014/0015 migration, delete ours (0014_retry_cancel, 0015_retry_from plus snapshots and journal entries) and run `pnpm db:generate --name retry_cancel` once. In the last commit, delete this file.
