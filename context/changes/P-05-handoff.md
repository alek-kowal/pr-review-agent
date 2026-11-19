# P-05 handoff

- Done: T5 9ce8a01, T6 549f17d, T9 c1c9b57, T10 8aa39b5, T11 305f3cd (`pnpm verify` green after each; decisions in `P-05-round-1-engine/change.md`).
- Partial: S-01-T15 (590647b, wip). Written: `e2e/support/{env,stack}.ts`, `e2e/first-round.spec.ts`, `playwright.config.ts` (two webServers, api port = web port + 7000), `vite.config.ts` (`API_PROXY_TARGET`), root devDeps (`@pra/{agents,db,integrations}`, `pg`, `@types/pg`), `ci.yml` job `e2e`.
- `pnpm test:e2e` passed locally (3/3) and the stack dropped its database; after that only the `ci.yml` job was appended (not yet run through lint/prettier).
- T15 left: run `pnpm verify` (prettier on `ci.yml`, root `tsc -p tsconfig.json` over e2e), rerun `pnpm test:e2e`, tick plan 6.1/6.2, add T15 decisions to change.md (below), final commit `feat(S-01): end-to-end round 1 (T15)` deleting this file, set change.md `status: done`.
- T15 decisions to record: stack imports api/worker by relative path (apps have no `exports`); reviewer scripted per PR number (>= 400 answers invalid output → `review_output_invalid`); retries use PR number + `testInfo.retry`; spec signs the fixture with `node:crypto` and reads `github_actions` with `pg`; spec polls `/prs` until the PR appears (list does not poll); CI job has no artifact upload.
- No own Drizzle migration in P-05 (queues come from `QUEUE_SETTINGS` via `pnpm db:migrate`); nothing to regenerate after merging main's 0003–0005.
- Know: `test/support.ts` `createTestWorkerDeps()` is async (starts the queue, supervise/schedule off); tests running a real worker use `createTestDatabase()`.
