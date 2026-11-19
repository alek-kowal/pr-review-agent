# P-05 handoff

- Done: plan (`context/changes/P-05-round-1-engine/plan.md`, brief, change.md) 50650e6; S-01-T5 webhook route 9ce8a01 (`pnpm verify` green there).
- Partial: S-01-T6 (5c1b584, wip). Written: `apps/worker/src/{deps,extensions}.ts`, `github-events/{index,pull-request,pr-hooks}.ts`, `handlers/github-event.ts`, `run/{jobs,start-round}.ts`, `packages/db/src/queries/run-engine.ts`; worker `main.ts`/`worker.ts` take full deps (`DATA_DIR` added to `.env.example`). Not run yet: typecheck, lint, tests.
- T6 left: `apps/worker/test/support.ts` (doubles, temp dirs, store a fixture payload with a unique repo full name as blob + event row) and `test/github-event.test.ts` (Done-when list plus P sync 33/60/70); fix `src/smoke-job.test.ts`: it must pass the new deps and use its own DB (`createTestDatabase()`), or its worker takes other files' `github.event` jobs.
- Then T9, T10, T11, T15 as in the plan (phases 3–6); record decisions in change.md per task.
- Know: routes load via autoload's native `import()`, so `instanceof` on `@pra/*` errors fails in api tests; match by `code`.
- Know: tests that run a pg-boss worker need their own database; handler tests call handlers directly and count `pgboss.job` rows by their own ids.
- Know: new queues (`github.event`, `run.stage` exclusive + 5 h expiry, `github.comment` exclusive) need `pnpm db:migrate` on the dev db.
- Know: reviewer cwd = session dir (brief.md, diff.patch), read dirs = worktree + knowledge; prompt `prompt-reviewer.md` with built-in fallback (P `src/prompt.ts`); P severities blocker/should/nit.
