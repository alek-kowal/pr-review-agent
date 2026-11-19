# P-10 handoff

Plan, brief and decisions: `context/changes/P-10-live-backend-and-timeline/` (read `plan.md`, `plan-brief.md`, `change.md`).

- Done: S-03-T1 (`c3999a8`, trigger migration 0006 + `listenChanges`), S-03-T2 (`b463c45`, `GET /api/live`). `pnpm verify` was green after each.
- Partial, finish first: S-03-T3 (`27f72a5`, wip). Code is written but not yet tested: migration `0007_run_current_stage`, `updateAgentSession` / `endRunningSessions` in `run-engine.ts`, `apps/worker/src/run/live-sessions.ts` (an `AgentRunner` decorator that creates the session row at start and adds cost per `onProgress`), wiring in `execute-stage.ts` (live runner passed to the executor, `current_stage` set when a stage starts and nulled at the end, live rows only get their blob keys in `storeResultInTx`), `recover.ts`, and `progress` steps in `FakeAgentRunner`.
- T3 next steps: run `pnpm --filter @pra/worker test live-cost.test.ts run-round.test.ts`, fix what fails, run `pnpm verify`, add the T3 decisions to `change.md`, and commit `feat(S-03): ... (T3)`. To clean up the wip commit, amend it or follow it with a feature commit. Do not rebase.
- Left: T4 (core `roundLabel(run, chain)` overload, `stepperModel`, `timeSummary`), T5 (`timeline_entries` and `pr_state_changes` with triggers, `source_key` uniqueness, writers and call sites), T6 (runs and transcript API, `summarizeTranscript` in `@pra/agents`), T7 (timeline, in-progress and status endpoints, plus a reads-never-write test on its own database). The design for each is in `plan.md` and in the plan-brief decisions table.
- Notes:
  - P-08 is building `loadPrStateInput` in parallel. The T5 state log uses a private loader that should be swapped for P-08's after merge.
  - There is no decision API route on this branch, so the decision timeline entry is tested in `packages/db`.
  - The trigger migration is hand-written SQL. If it is renumbered, recreate it with `drizzle-kit generate --custom`.
