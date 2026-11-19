---
change_id: P-01
title: Local data and jobs (F-02-T1 to F-02-T6)
status: in-progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-01 from `context/foundation/work-packages.md`: roadmap item F-02 (`local-data-and-jobs`),
tasks F-02-T1 to F-02-T6 in `context/foundation/roadmap-tasks.md#f-02-local-data-and-jobs`.
Plan: no. The tasks' "Done when" checks are the plan; one commit per task.

## Decisions

- Compose has a fixed project name (`name: pra`), so every worktree's `docker compose up -d db`
  reuses one `pra-db-1` container and one `pra_db-data` volume. Postgres runs with
  `max_connections=300` to leave room for parallel test runs.
- `.env.example` keeps names only; the local, non-secret compose URL
  (`postgres://pra:pra@localhost:5432/pra`) is documented in a comment above `DATABASE_URL`, so the
  "names only" rule from `AGENTS.md` still holds.
- `psql` is not installed on this Mac, so the T1 check ran through
  `docker compose exec -T db psql "<url>" -c 'select 1'` with the same URLs.
- Drizzle `drizzle-orm` 0.45 + `drizzle-kit` 0.31 on `pg` (node-postgres), the driver pg-boss also
  uses. `createDb(url)` returns the Drizzle client over a lazy `pg.Pool` (5 s connection timeout,
  an idle-error listener so a Postgres restart cannot crash the process); `closeDb` ends the pool.
- Migrations live in `packages/db/migrations` (`0000_smoke.sql`, named with `--name`). Root
  `db:generate` runs drizzle-kit in `@pra/db`; root `db:migrate` runs
  `node --env-file-if-exists=.env packages/db/src/cli/migrate.ts` (Node 24 runs the TS source) and
  prints how many migrations it applied, so a second run visibly changes nothing.
- pnpm 12 asked about esbuild's build script (pulled in by drizzle-kit): set to `false` in
  `allowBuilds`. esbuild ships its binary as an optional dependency, and drizzle-kit works without
  the script.
- **Test databases (orchestrator rule overrides "migrates `pra_test`")**: every Vitest project that
  touches Postgres has the global setup `@pra/db/testing/global-setup`. It connects to `pra_test`
  (DATABASE_URL with the name changed; the local compose URL when DATABASE_URL is unset), creates
  `pra_test_<base36 ms>_<8 hex>`, migrates it, hands its URL to tests through Vitest
  `provide`/`inject` (`testDatabaseUrl()` from `@pra/db/testing`) and drops it `with (force)` at
  the end. It also drops run databases older than 12 h left by crashed runs. So parallel runs from
  several worktrees share one Postgres and nothing else; `pra_test` itself holds no test data.
- CI: a `postgres:17` service with `POSTGRES_DB: pra_test`, job-level
  `DATABASE_URL=postgres://pra:pra@localhost:5432/pra_test` (throwaway CI credentials), and
  `pnpm db:migrate` before `pnpm test`, as the task asks. The CI steps were rehearsed locally with
  that URL (migrate, then `pnpm test` green); the GitHub run waits for the orchestrator's push.
- Logging (T3): `@pra/integrations/logging` exports `loggerOptions(service, env)`, `createLogger`
  and `redactSecrets`. JSON when `NODE_ENV` is `production` or `test`, pretty (pino-pretty,
  resolved to an absolute path because pnpm hides it from pino) otherwise, so `pnpm dev` needs no
  `NODE_ENV`. `LOG_LEVEL` sets the level (default `info`).
- Redaction: pino `redact` paths for authorization headers, plus a `formatters.log` walk over plain
  objects and arrays that replaces values of keys ending in `authorization`, `api_key`/`apiKey`,
  `secret`, `password`, `token` or `private_key`/`privateKey`, and any string holding a PEM private
  key. Class instances (errors, requests) are left to pino's serializers. Empty secret values stay
  visible, so a missing key shows in logs. Pino skips formatters for `logger.child()` bindings, so
  child bindings carry ids only.
- The api no longer starts through `fastify start`: `src/server.ts` has `serverOptions(env)` and
  `buildServer()`, and `src/main.ts` is the entry (`dev` = `node --watch --env-file-if-exists`,
  `start` = `node dist/main.js`), because the composition root (T5) builds dependencies from env
  before Fastify starts. Request ids: a caller's `X-Request-Id` is kept, otherwise a UUID.
- The worker's entry is `apps/worker/src/main.ts` (the empty `src/index.ts` is gone).
- pg-boss 12 (`PgBoss` named export) in `@pra/db/src/queue.ts`: `createQueue(url)` forces
  `schema: 'pgboss'` and `migrate: false`, so `start()` throws "pg-boss is not installed" on a
  database `pnpm db:migrate` has not touched (tested). `JOBS` holds the names, `JobPayloads` the
  data per name, `sendJob` sends with that type, `QueueJob<N>` is what a handler gets.
- `migrateDatabase` = Drizzle migrations, then `migrateQueue`: a short-lived pg-boss with
  `migrate: true` (no supervision, schedule or instance row) installs or upgrades the schema and
  **creates every queue in `JOBS`** (pg-boss 12 needs a queue before `send`/`work`). So a new job
  name needs `pnpm db:migrate`, like a new table; nothing creates queues on start.
- `@pra/db` re-exports the common Drizzle operators (`eq`, `and`, `sql`, ...) so apps use the same
  drizzle-orm instance as the schema and need no own drizzle-orm or pg-boss dependency.
- Worker: `startWorker(deps, options)` in `apps/worker/src/worker.ts` (deps: db, queue, logger)
  starts the queue, subscribes handlers from `src/handlers/` and returns `stop()` (graceful
  `queue.stop`, then logs `worker stopped`). `main.ts` builds deps from env, exits with a fatal log
  when DATABASE_URL is missing or the queue is not installed, and on SIGINT/SIGTERM stops the
  worker and closes the pool. The test passes `pollingIntervalSeconds: 0.5`; production keeps
  pg-boss's 2 s.
- Ctrl-C was checked in a real pseudo-terminal (`pnpm --filter @pra/worker dev`, then `^C`): it
  logs `worker stopping` and `worker stopped` and leaves no process. A plain `kill -INT` on the pnpm
  process does not reach Node, because pnpm 12 runs scripts in their own process group.
