# Roadmap tasks: PR Review Agent

> Companion to [`roadmap.md`](roadmap.md). One section per roadmap item, in roadmap order; each item links back here from its **Tasks** field.
> Every task is sized for one fresh agent session under 30% context: read what it needs, plan, implement, test.
> 231 tasks across 27 items; 20 are marked **Needs Alek**.

## How to use

- Pick the next item from `roadmap.md` (dependency order), run `/10x-plan <change-id>`, and use this section's tasks as the starting breakdown. `/10x-plan` may split further.
- Tasks with the same **Depends on** can run in parallel in separate agent runs.
- **Needs Alek** tasks are real wiring that needs Alek's accounts or decisions. Code tasks never depend on them; only real-smoke tasks do. Each lists exact **Steps for Alek**.
- Integrations sit behind interfaces with test doubles **in tests only**. There is no runtime fake mode: without a credential the app shows a clear "not configured" state.

## Shared conventions

- Workspace scope `@pra/*`: `apps/web` (Vite + React 19 SPA), `apps/api` (Fastify), `apps/worker` (pg-boss), `packages/core` (pure domain, reason codes, run state machine), `packages/db` (Drizzle schema, migrations, queries), `packages/integrations` (`GitHubGateway`, `ClickUpGateway`, `BlobStore`, `GitMirror`, `Sandbox`), `packages/agents` (`AgentRunner` + reviewer, verifier, implementer, judge, analyst adapters).
- Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm db:migrate`, `docker compose up -d db`.
- Env var names (values never in the repo; local dev uses a gitignored `.env`): `DATABASE_URL`, `ANTHROPIC_API_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_WEBHOOK_SECRET`, `CLICKUP_API_KEY`, `BLOB_DIR`, `S3_BUCKET`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `APP_BASE_URL`, `SANDBOX_DOCKER_HOST`.
- State-changing API calls send the header `X-PRA-Request: 1` and pass an `Origin` check (tech-stack.md flag 7). PR page route: `/pr/$repo/$number`.
- A run is a row; each stage is a pg-boss job keyed by `(runId, stage)`. Live updates: SSE fed by Postgres LISTEN/NOTIFY (from S-03).
- Signed actions pick a Team member in the action's own form (FR-087); unsigned actions record "by hand".
- Assumptions made while writing tasks (override in `/10x-plan` if wrong): the analyst defaults to `claude-sonnet-5-5` (tech-stack.md names no analyst model); WB instruction files v1 are imported at repository scope because they are WB-specific; forcing a change type (FR-030) has an unsigned API route only, since the prototype has no screen for it.

## Needs Alek (index)

| Task | What |
| --- | --- |
| F-04-T6 | Choose the host, managed Postgres, bucket and secret store |
| F-04-T7 | Set up the shared access gate |
| F-04-T8 | Create the Sentry project |
| F-04-T9 | First deploy and smoke from inside the gate |
| F-04-T10 | Point the GitHub App webhook at the hosted app |
| S-01-T16 | Create and install the GitHub App on WB |
| S-01-T17 | Provide the Anthropic API key |
| S-01-T18 | Run the real smoke on one WB PR |
| S-01-T19 | Poll WB until the GitHub App exists (optional `GITHUB_TOKEN`) |
| S-02-T11 | Sign the first decision on a real WB PR |
| S-04-T8 | Real Checks and judge on a WB PR |
| S-04-T9 | Re-verify sandbox isolation on the Linux host |
| S-05-T5 | Real verified round on a WB PR |
| S-06-T9 | Real ClickUp key, WB IDs and smoke |
| S-12-T6 | WB branch protection, merge permission and a real merge |
| S-13-T8 | Implementer smoke on a real PR |
| S-14-T6 | Real push smoke |
| S-18-T9 | Real ClickUp alert smoke |
| S-20-T9 | Connect a real second repository |
| S-23-T8 | Analyst smoke on a real closed PR |

## Task count per item

| Item | Tasks |
| --- | --- |
| F-01 | 9 |
| F-02 | 6 |
| F-03 | 14 |
| F-04 | 10 |
| S-01 | 18 |
| S-02 | 11 |
| S-03 | 14 |
| S-04 | 9 |
| S-05 | 5 |
| S-06 | 7 |
| S-07 | 7 |
| S-08 | 11 |
| S-09 | 7 |
| S-10 | 7 |
| S-11 | 4 |
| S-12 | 6 |
| S-13 | 8 |
| S-14 | 6 |
| S-15 | 4 |
| S-16 | 4 |
| S-17 | 9 |
| S-18 | 8 |
| S-19 | 9 |
| S-20 | 9 |
| S-21 | 9 |
| S-22 | 11 |
| S-23 | 8 |

---

## F-01: monorepo-foundations

A pnpm monorepo in the target layout from the first commit, with TypeScript, lint and format, Vitest, a Playwright skeleton, CI and AGENTS.md. Roadmap: [F-01](roadmap.md#f-01-monorepo-foundations)
**Slice check:** on a clean clone, `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e smoke.spec.ts` all exit 0, and the `ci` workflow run for the pushed branch is green in GitHub Actions.

### F-01-T1: Create the pnpm workspace and empty packages
- **Goal:** Lay out the workspace directly in the target shape (no root app moved later; this overrides tech-stack.md flag 1). Root `package.json` with `packageManager: pnpm@<version from pnpm -v>`, `engines.node >=24`, and the scripts `lint`, `typecheck`, `test`, `test:e2e` (`db:migrate` arrives in F-02). Also `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `tsconfig.base.json` (strict, ESM, NodeNext) and `.node-version` (24). `.gitignore` adds `.env`, `.data/`, `dist/`, `test-results/` and `playwright-report/`. `.env.example` lists every shared env var name with an empty value. Create empty TS packages `@pra/core`, `@pra/db`, `@pra/integrations`, `@pra/agents` and the app `@pra/worker`, each with `package.json`, `tsconfig.json` and `src/index.ts`. Add a root Vitest config with `test.projects` over `apps/*` and `packages/*`, plus one trivial test in `packages/core` (Vitest replaces node:test, flag 4).
- **Touches:** repo root, `packages/{core,db,integrations,agents}`, `apps/worker`
- **Depends on:** —
- **Done when:** `pnpm install` and `pnpm typecheck` exit 0; `pnpm -r ls --depth -1` lists the five `@pra/*` packages; `pnpm test` runs the core test under Vitest and it passes; `.env.example` holds names only.

### F-01-T2: Scaffold apps/api with the official Fastify generator
- **Goal:** Run `fastify-cli generate apps/api --lang=ts --esm`, keep the generator's layout (`src/app.ts`, `src/plugins/`, `src/routes/`), rename it to `@pra/api`, delete `package-lock.json` (flag 3) and extend `tsconfig.base.json`. Replace the generated `node:test` tests with Vitest equivalents that use `app.inject` (flag 4).
- **Touches:** `apps/api`
- **Depends on:** F-01-T1
- **Done when:** `pnpm --filter @pra/api test` passes the ported root-route and example-plugin tests under Vitest; `grep -r "node:test" apps/api` finds nothing; with `pnpm --filter @pra/api dev` running, `curl -i localhost:3000/` returns 200.

### F-01-T3: Add Zod schemas, OpenAPI and the error shape to the api
- **Goal:** Make `fastify-type-provider-zod` the type provider, generate OpenAPI from route schemas with `@fastify/swagger` at `GET /docs/json`, and add one error handler. It returns `{ error: { code, params } }` (the reason-code shape, no prose) for validation errors and unexpected errors.
- **Touches:** `apps/api/src/plugins`
- **Depends on:** F-01-T2
- **Done when:** `pnpm --filter @pra/api test` passes `openapi.test.ts` (the document lists a sample Zod route) and `errors.test.ts` (an invalid body returns 400 `{ error: { code: "invalid_request" } }`).

### F-01-T4: Scaffold apps/web with Vite, TanStack Router and TanStack Query
- **Goal:** Run `pnpm create vite apps/web --template react-ts` (React 19) and rename it to `@pra/web`. Add file-based TanStack Router routes through `@tanstack/router-plugin/vite` in `apps/web/src/routes/` (`__root.tsx`; `index.tsx` redirecting to `/prs`; `prs.tsx` as a placeholder). Add a TanStack Query provider and a Vite dev proxy that sends `/api`, `/webhooks` and `/health` to `localhost:3000`, so dev runs on one origin. Add Vitest with Testing Library (jsdom) and one test.
- **Touches:** `apps/web`
- **Depends on:** F-01-T1
- **Parallel with:** F-01-T2
- **Done when:** `pnpm --filter @pra/web test` and `pnpm --filter @pra/web build` pass; with `pnpm --filter @pra/web dev` running, `/` redirects to `/prs`.

### F-01-T5: Add Tailwind, shadcn/ui, the WB tokens and the top bar
- **Goal:** Add Tailwind v4 (`@tailwindcss/vite`) and run `shadcn init` with components only in `apps/web/src/components/ui`. Copy the WB design tokens (light and dark) from `prototype/styles.css` into CSS variables mapped to the shadcn theme variables. Build the top bar from `docs/03-design-decisions.md` "Approved structure": "PR Review Agent", then Pull requests · Activity · Insights · Settings, and no account menu. Search and the status chip come later. Add placeholder routes `/activity`, `/insights` and `/settings`.
- **Touches:** `apps/web`
- **Depends on:** F-01-T4
- **Done when:** `pnpm --filter @pra/web test` passes `TopBar.test.tsx` (four nav links, the active one marked, no account menu); `pnpm --filter @pra/web build` passes; both themes' tokens are defined in the global stylesheet (the theme toggle is S-17).

### F-01-T6: Set up ESLint and Prettier with package boundary rules
- **Goal:** Add a root flat ESLint config (typescript-eslint, plus react-hooks and react-refresh for `apps/web`) and Prettier with a `.prettierignore` covering `prototype/`, `docs/`, the generated route tree and migrations. `no-restricted-imports` rules:
  - `packages/core` imports no `node:*`, `pg`, `drizzle-orm`, `@pra/db`, `@pra/integrations` or `@pra/agents`.
  - `@pra/*/testing` is imported only from `**/*.test.ts(x)`, `**/test/**` and `e2e/**`.
  - `apps/web` imports no server package except `@pra/core`.

  `pnpm lint` runs ESLint and `prettier --check`.
- **Touches:** root config; all packages (formatting only)
- **Depends on:** F-01-T2, F-01-T3, F-01-T5
- **Done when:** `pnpm lint` exits 0, and `echo "import fs from 'node:fs'" | pnpm exec eslint --stdin --stdin-filename packages/core/src/x.ts` exits non-zero with `no-restricted-imports`.

### F-01-T7: Add the Playwright skeleton with one smoke spec
- **Goal:** Add a root `playwright.config.ts` (`testDir: e2e`, Chromium only, `webServer` starting the web dev server; S-01 adds the api and worker test stack). Add `e2e/smoke.spec.ts` (open `/`, land on `/prs`, see the top bar), an empty `e2e/support/` for the test stack with doubles, and the root script `test:e2e`.
- **Touches:** repo root, `e2e/`
- **Depends on:** F-01-T5
- **Done when:** `pnpm test:e2e smoke.spec.ts` passes locally.

### F-01-T8: Add the CI workflow for lint, typecheck and tests
- **Goal:** Add `.github/workflows/ci.yml`, triggered on push and pull_request: pnpm setup from `packageManager`, Node 24 with the pnpm cache, then `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck` and `pnpm test`. No deploy job (manual-promotion). Postgres joins in F-02 and the e2e job in S-01.
- **Touches:** `.github/workflows/ci.yml`
- **Depends on:** F-01-T6
- **Done when:** `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest` reports nothing; after the branch is pushed, `gh run list --workflow ci.yml --limit 1` shows `success`.

### F-01-T9: Write AGENTS.md with the project conventions
- **Goal:** Write a short `AGENTS.md`, plus a `CLAUDE.md` that contains only `@AGENTS.md`. It covers:
  - the layout and what each `@pra/*` package owns;
  - the shared commands;
  - TanStack Router file routes in `apps/web/src/routes`, and shadcn primitives only in `apps/web/src/components/ui`, with feature components in `apps/web/src/features/<feature>/`;
  - core returns reason codes `{ code, params }`, and English copy lives only in `apps/web/src/copy`;
  - no runtime fake mode: doubles live only in `@pra/*/testing` and in tests;
  - every integration sits behind its interface;
  - migrations run only through `pnpm db:migrate`, never on start;
  - env var naming: `*_API_KEY`, names only in `.env.example`, values in the gitignored `.env`;
  - all UI copy is English;
  - no per-repository code paths (NFR Repository-agnostic);
  - signed actions take a Team member picked in the action's own form.
- **Touches:** `AGENTS.md`, `CLAUDE.md`
- **Depends on:** F-01-T1 to F-01-T8
- **Done when:** `AGENTS.md` is under 100 lines and passes `prettier --check`; the task report states its size in lines and approximate tokens, because it loads into every agent session in this repo.

## F-02: local-data-and-jobs

Local Postgres in Docker Compose, Drizzle migrations from a command, pg-boss in the worker, pino logs, `/health`, and the BlobStore that keeps raw events and transcripts. Roadmap: [F-02](roadmap.md#f-02-local-data-and-jobs)
**Slice check:** `docker compose up -d db && pnpm db:migrate`, then start `pnpm --filter @pra/api dev` and `pnpm --filter @pra/worker dev`. `curl localhost:3000/health` returns 200 with `"db":"ok"`, the worker logs a pino JSON line saying it handled the `smoke` job, and a row appears in the `smoke` table. `pnpm test` is green in CI against a Postgres service.

### F-02-T1: Run Postgres 17 in Docker Compose
- **Goal:** Add a root `docker-compose.yml` with a `db` service (`postgres:17`, named volume, healthcheck, port 5432) and an init script that creates the databases `pra` and `pra_test`. Document the local, non-secret compose connection string for `DATABASE_URL` in `.env.example`.
- **Touches:** `docker-compose.yml`, `docker/postgres/init.sql`, `.env.example`
- **Depends on:** F-01 done
- **Done when:** after `docker compose up -d db`, `docker compose ps db` shows healthy, and `psql "$DATABASE_URL" -c 'select 1'` and `psql "${DATABASE_URL%/*}/pra_test" -c 'select 1'` both succeed.

### F-02-T2: Add Drizzle, the first migration and `pnpm db:migrate`
- **Goal:** Set up Drizzle in `packages/db`:
  - Drizzle ORM and a drizzle-kit config;
  - `src/schema/` with only a `smoke` table (id, note, created_at), its generated SQL migration in `packages/db/migrations`, and a `createDb(url)` client;
  - root scripts `db:generate` and `db:migrate`; `db:migrate` runs the migrator as a CLI;
  - a Vitest global setup that migrates `pra_test`, with the URL derived from `DATABASE_URL` by changing the database name;
  - in CI, a Postgres 17 service and `pnpm db:migrate` against `pra_test` before `pnpm test`.

  Nothing migrates on app start.
- **Touches:** `packages/db`, root `package.json`, `.github/workflows/ci.yml`
- **Depends on:** F-02-T1
- **Done when:** `pnpm db:migrate` creates `smoke` and `drizzle.__drizzle_migrations`, and a second run changes nothing; `pnpm --filter @pra/db test` passes `smoke.test.ts` (insert and read a row); `grep -rn "migrate(" apps/` finds nothing; CI is green.

### F-02-T3: Log with pino in api and worker
- **Goal:** Export `loggerOptions(service)` from `@pra/integrations/logging`: pino JSON in production, pretty in development, a `service` field, and redaction of `authorization` headers, private keys and any `*_API_KEY` or `*_SECRET` values. Fastify uses it, with request ids, and so does the worker.
- **Touches:** `packages/integrations/src/logging.ts`, `apps/api`, `apps/worker`
- **Depends on:** F-01 done
- **Done when:** `pnpm --filter @pra/integrations test` passes `logging.test.ts` (redacted fields print `[Redacted]`); with `NODE_ENV=production`, the api and worker start logs are single-line JSON with `service`.

### F-02-T4: Start pg-boss in the worker with a smoke job
- **Goal:** Add the queue and the worker's entry points:
  - `packages/db/src/queue.ts` exports `createQueue(url)` (pg-boss in schema `pgboss`, started with `migrate: false`) and the `JOBS` name constants (`smoke` now; slices add `github.event`, `run.stage`, `github.comment`).
  - `pnpm db:migrate` also installs or upgrades the pg-boss schema, so nothing migrates on start.
  - `apps/worker/src/main.ts` builds dependencies from env, and `startWorker(deps)` subscribes the handlers and stops gracefully on SIGTERM and SIGINT.
  - The `smoke` handler writes a `smoke` row.
- **Touches:** `packages/db`, `apps/worker`
- **Depends on:** F-02-T2, F-02-T3
- **Done when:** `pnpm --filter @pra/worker test` passes `smoke-job.test.ts` (send `smoke`, and a row appears within 5 s); `pnpm --filter @pra/worker dev` logs `worker started`, and Ctrl-C logs `worker stopped`.

### F-02-T5: Add `/health` and a composition root to the api
- **Goal:** The api's app plugin takes its dependencies (db and queue now; blobStore and github in S-01) through options. The production entry builds them from env, and tests pass test instances or doubles. `GET /health` runs `select 1` and returns 200 `{ status: "ok", db: "ok" }`, or 503 `{ status: "degraded", db: "down" }`. The api still starts when Postgres is down.
- **Touches:** `apps/api`
- **Depends on:** F-02-T2, F-02-T3
- **Parallel with:** F-02-T4
- **Done when:** `pnpm --filter @pra/api test` passes `health.test.ts` (200 against `pra_test`, 503 against an unreachable URL); with compose `db` up, `curl -s localhost:3000/health` returns 200.

### F-02-T6: Add the BlobStore interface and the local-volume adapter
- **Goal:** Define `BlobStore` in `packages/integrations` with `put(key, body, { contentType })`, `get(key)`, `exists(key)` and `delete(key)`. Keys look like `github-events/<deliveryId>.json` and `sessions/<sessionId>/transcript.jsonl`. Build the local adapter, which writes under `BLOB_DIR` (default `.data/blobs`) and rejects path-traversal keys. Export a reusable contract suite `blobStoreContract(make)` from `@pra/integrations/testing`, so the S3 adapter in F-04 runs the same tests. This sits here rather than in S-01 because NFR Complete logs needs storage from the first stored event.
- **Touches:** `packages/integrations`
- **Depends on:** F-01 done
- **Done when:** `pnpm --filter @pra/integrations test` passes `local-blob-store.test.ts`, which runs the contract: round-trip, overwrite, a missing key returns null, a `../` key is rejected.

## F-03: domain-core-acceptance-tests

The plain prototype's domain rules and the PR state table, as pure functions in `packages/core` with acceptance tests that assert structured reason codes. Roadmap: [F-03](roadmap.md#f-03-domain-core-acceptance-tests)
**Slice check:** `pnpm --filter @pra/core test` passes every family suite; `packages/core/PORTING.md` accounts for all 98 tests in `~/Projects/wb-factory/test` (57 ported here, 38 assigned to a named slice, 3 not ported); `pnpm lint` passes, so core imports no I/O, and `no-copy.test.ts` finds no Polish text in `packages/core/src`.

Each family task reads only its P test file lines, the matching P source file under `~/Projects/wb-factory/src`, and the matching PRD Business Logic section. P's Polish status strings become reason codes. P's tiers `composes`, `extends` and `one-way` become `uses_existing`, `changes_behaviour` and `one_way_door`.

### F-03-T1: Set up the core vocabulary, reason codes and test builders
- **Goal:** In `packages/core`:
  - The PRD vocabulary as types: `Severity` (blocking, worth_fixing, nit), `Verdict` (confirmed, refuted, not_proven, unchecked), `Decision` (implement, reject, defer), `ChangeType` (uses_existing, changes_behaviour, one_way_door), `LevelNumber` 1–6, `StageKey` (checks, task, change_type, review, verify) and `Actor` (member, bot, hand).
  - The reason type `Reason = { code, params }`, built from a `ReasonParams` interface that each family extends by declaration merging in its own `src/reasons/<family>.ts`.
  - Empty modules and empty test files for every later family (findings, verification, change-type, limits, levels, rounds, run, autofix, config, learning, pr-state, checklist), already exported from `src/index.ts`, so the parallel tasks only edit their own files.
  - `test/builders.ts` with `makeFinding`, `makePr` and `makeRound`.
  - `test/no-copy.test.ts`, which fails on Polish diacritics in `src`.
- **Touches:** `packages/core`
- **Depends on:** F-01 done
- **Done when:** `pnpm --filter @pra/core test` passes `reasons.test.ts` (an `expectTypeOf` check that a code's params are typed, and that an unknown code is a type error) and `no-copy.test.ts`; `pnpm typecheck` passes.

### F-03-T2: Port which findings need a person
- **Goal:** Add `needsDecision(finding)`, `toDecide(findings)`, `toFix(findings)` and `findingsOutcome(round)`, all with reason codes. Rules:
  - Only Blocking and Worth fixing findings that are not Refuted need a decision.
  - Nits are optional and never block, but a Nit decided Implement blocks until it is resolved.
  - Questions come first.
  - A clean round that touches sensitive files still needs a person.
  - Below level 3, every unchecked Blocking or Worth fixing finding waits for a person.

  Port P `test/review.test.ts` (lines 36, 47, 55, 62, 66) and `test/levels.test.ts` (112, 170). Source: `src/outcome.ts`; PRD "Business Logic" and US-03.
- **Touches:** `packages/core/src/findings.ts`, `src/reasons/findings.ts`, `test/findings.test.ts`
- **Depends on:** F-03-T1
- **Done when:** `pnpm --filter @pra/core test findings` passes the 7 ported tests, each asserting reason codes (for example `{ code: "nit_optional" }`), never strings.

### F-03-T3: Port the verification rules
- **Goal:** Add these pure functions:
  - `checkQuotes(check, readFile)`, with the file reader injected and whitespace-insensitive verbatim matching. A missing quote gives `not_proven` with `quote_missing`; no evidence gives `not_proven` with `no_evidence`.
  - `applyReproduction(check, exitCode)`: 0 gives confirmed `repro_reproduced`, 3 gives refuted `repro_not_reproduced`, anything else gives not_proven `repro_broken`.
  - `reproRepairAllowed(attempt)`: exactly one repair attempt.
  - `verifierInput(finding)`, which leaves out the proposed fix.
  - `findingsToVerify(rounds, currentRoundId)`: the current round only.
  - `currentFindings(rounds)`: the newest round decides.

  Port P `review.test.ts` (96, 111) and `classify.test.ts` (168, 197). Source: `src/verify.ts`; PRD "Verification and change type".
- **Touches:** `packages/core/src/verification.ts`, `src/reasons/verification.ts`, `test/verification.test.ts`
- **Depends on:** F-03-T1
- **Done when:** `pnpm --filter @pra/core test verification` passes the 4 ported tests, plus tests that `verifierInput` has no `suggestion` or `fix` key and that a second repair attempt is refused.

### F-03-T4: Port the change-type rules
- **Goal:** Add these functions:
  - `classifyChange({ files, diff, rules })`, using the RepositoryConfig rules: paths for Uses existing parts, a size threshold in changed lines, paths for One-way door, and sensitive patterns, which make it one-way.
  - `changedLines(diff)`.
  - `raiseChangeType(base, judged, forced)`: the judge may only raise the type, and a forced type wins while still reporting what the rules would have picked.
  - `needsPerson(changeType)` for One-way door.

  WB paths live only in `test/fixtures/wb-config.ts`, never in `src`. Port P `classify.test.ts` (40, 49, 58, 66, 72, 80, 86, 95, 249, 262). Source: `src/classify.ts`.
- **Touches:** `packages/core/src/change-type.ts`, `src/reasons/change-type.ts`, `test/change-type.test.ts`, `test/fixtures/wb-config.ts`
- **Depends on:** F-03-T1
- **Done when:** `pnpm --filter @pra/core test change-type` passes the 10 ported tests, which assert codes such as `{ code: "path_one_way", params: { path } }`.

### F-03-T5: Port the review limits and sensitive-file matching
- **Goal:** Add these functions:
  - `enforce(reviewOutput, limits)`: drops the severities and questions the limits disallow, cuts to `maxFindings` (never above 7) from the least severe end while keeping the reviewer's order, and counts what it dropped.
  - `limitsFor(level, changeType)`: a level narrows only the fields it sets.
  - `skipVerification(changeType, limits)`.
  - `matchSensitiveFiles(files, patterns)`: glob patterns with reasons, from RepositoryConfig.

  Port P `classify.test.ts` (136, 144, 152, 159), `review.test.ts` (72, with WB's patterns as a fixture) and `levels.test.ts` (83).
- **Touches:** `packages/core/src/limits.ts`, `src/reasons/limits.ts`, `test/limits.test.ts`
- **Depends on:** F-03-T1
- **Done when:** `pnpm --filter @pra/core test limits` passes the 6 ported tests, plus a test that `maxFindings: 9` is clamped to 7.

### F-03-T6: Port the review levels and their stages
- **Goal:** Define the built-in levels 1–6 from the PRD "Review levels" table: name, stages on or off, the features implement, autofix and learning, limits, default models per role from tech-stack.md, and a per-stage timeout (default 30 min). Add:
  - `resolveLevel(n, overrides)`: inherits from the level below and records where each value came from.
  - `freezeLevel(level)`: the snapshot stored on a run.
  - `stagesFor(level, roundKind)`: Checks → Task → Change type → Review → Verify in order, each with `off` and reason `off_at_level` where the level turns it off. Fix-check rounds get their own list, from `stepsFor` in `prototype/js/sim.js`.

  Port P `levels.test.ts` (26, 40, 50). Source: `src/levels.ts`.
- **Touches:** `packages/core/src/levels.ts`, `src/reasons/levels.ts`, `test/levels.test.ts`
- **Depends on:** F-03-T1
- **Done when:** `pnpm --filter @pra/core test levels` passes the 3 ported tests plus: level 1 runs only Review; level 2 adds Checks, Task and Change type; level 3 adds Verify; level 6 has every feature on; an override set at level 2 is inherited by level 3 with origin 2.

### F-03-T7: Port the round and chain rules
- **Goal:** Add these functions:
  - `roundStartForEvent(event, pr, activeRun)`: either start round 1, signed by the bot, or do nothing with a reason: `draft`, `fork`, `push_never_starts`, `run_active` or `pr_closed`.
  - `nextAutomaticRound(pr, chain, ownFixSha)`: when the head is exactly the commit PR Review Agent pushed, start the next round of the chain while it has fewer than 3 completed rounds, otherwise return `rounds_used`.
  - `chainState(runs)`: only completed rounds count, failed and cancelled ones do not, and every new start begins a new chain. A second round 1 is marked `new_chain`.
  - `roundLabel(run)`: data for "Round n of 3", who started it, and the fix sha it followed.

  The level is frozen per run, and a new round keeps the PR's level. Port P `sync.test.ts` (22, 42, 90; the rule changed per docs/05, so a push never starts a review) and `levels.test.ts` (127, the pure part). Sources: PRD "Rounds and chains", `docs/05-review-triggers.md`.
- **Touches:** `packages/core/src/rounds.ts`, `src/reasons/rounds.ts`, `test/rounds.test.ts`
- **Depends on:** F-03-T1
- **Done when:** `pnpm --filter @pra/core test rounds` passes the 4 ported tests, plus tests that: a draft gives no start with `draft`; a fork gives `fork`; `synchronize` gives `push_never_starts`; failed and cancelled rounds do not count; a head other than the own fix sha starts nothing.

### F-03-T8: Add the run state machine
- **Goal:** Define run statuses (queued, running, completed, failed, cancelled) and stage statuses (pending, running, succeeded, failed, off, reused). Add pure transitions:
  - `startRun`, `startStage`, `completeStage` and `failStage(errorCode)`;
  - `cancelRun`;
  - `retryFromStage`: reuses the stages that succeeded as `reused`, keeps the round number, and the failed attempt does not count;
  - `recoverAfterRestart`: running stages become failed with `interrupted`, queued runs stay queued;
  - `nextStage`.

  Illegal transitions return `{ ok: false, reason }` instead of throwing. Port P `runs.test.ts` (19, 35, the pure parts). Sources: PRD NFR Durability, FR-022, FR-024.
- **Touches:** `packages/core/src/run.ts`, `src/reasons/run.ts`, `test/run.test.ts`
- **Depends on:** F-03-T1, F-03-T6
- **Done when:** `pnpm --filter @pra/core test run` passes the 2 ported tests, plus tests for retry reuse, cancel from queued and from running, and `completeStage` on a cancelled run returning `run_not_running`.

### F-03-T9: Port the autofix conditions
- **Goal:** Add `autofixDecision(input)`, which checks:
  - the four PRD conditions: every finding that needs work is confirmed and fixed; every reproduction passes; no sensitive file is touched; at most N automatic patches per chain (default 2, the only editable condition);
  - the holds: fork, open questions, unsure verdicts, a fix that needs a decision, One-way door, paused, budget reached.

  It returns `{ enabled, go, findingIds, reasons }` with reason codes. Below level 5 it returns `enabled: false` with the same reasons; that is the shadow log. Add `pushByItself(patch)` for the push after the implementer. The patch limit is per chain, not per PR (docs/05). Port P `autofix.test.ts` (54, 67, 88, 104, 137, 196, 213, the pure parts). Source: `src/autofix.ts`.
- **Touches:** `packages/core/src/autofix.ts`, `src/reasons/autofix.ts`, `test/autofix.test.ts`
- **Depends on:** F-03-T1
- **Done when:** `pnpm --filter @pra/core test autofix` passes the 7 ported tests, which assert codes such as `{ code: "auto_patches_used", params: { used: 2, max: 2 } }`.

### F-03-T10: Port config resilience and model-name validation
- **Goal:** Add the config schemas and helpers:
  - Zod schemas:
    - `RepositoryConfigSchema`: slug, GitHub full name, default branch, default level, install command, ClickUp space, sensitive patterns with reasons, change-type rules, large-PR line threshold.
    - `AppSettingsSchema`: paused and its reason, daily budget, agent slots (default 2), models per role, and the after-round GitHub comment (default on).
    - `LevelOverridesSchema`.
  - `parseWithFallback(schema, defaults, raw)`: falls back field by field, with a `config_field_invalid` warning that names the field.
  - `validModelName`: the regex from P `src/settings.ts:33`, which blocks flag injection.
  - `modelFor(settings, level, role)`: the level override, then settings, then the default; an empty value falls back.
  - `holdReason(settings, spentToday)`: paused, or budget reached; no budget set never holds.

  Port P `classify.test.ts` (100, 104, 112, and the model-name part of 273), `levels.test.ts` (66) and `control.test.ts` (30, 37, 45, 53, 105).
- **Touches:** `packages/core/src/config.ts`, `src/reasons/config.ts`, `test/config.test.ts`
- **Depends on:** F-03-T1
- **Done when:** `pnpm --filter @pra/core test config` passes the 10 ported tests, `RepositoryConfigSchema.parse()` accepts the WB fixture, and `validModelName("--dangerously-skip-permissions")` is false.

### F-03-T11: Port the learning rules
- **Goal:** Add these functions:
  - `buildCases(prComments, authorLogin)`: leaves out the PR author's own comments.
  - `mergeCandidate(candidates, proposal)`: a duplicate adds its PR to the open candidate; a rejected candidate starts over.
  - `capProposals(proposals)`: at most 5 per closed PR (FR-084).
  - `canAccept(candidate)`: needs at least 2 PRs (`needs_more_prs` with `have` and `need`) and a person's signature.
  - `withLesson(text, candidate)`: adds an accepted lesson and keeps the rest of the text.

  Port P `admin.test.ts` (64, 79, 86). Sources: `src/learning.ts`, PRD "Learning".
- **Touches:** `packages/core/src/learning.ts`, `src/reasons/learning.ts`, `test/learning.test.ts`
- **Depends on:** F-03-T1
- **Done when:** `pnpm --filter @pra/core test learning` passes the 3 ported tests, plus tests for the cap of 5 and the 2-PR rule.

### F-03-T12: Build the PR state table
- **Goal:** Add the state table functions:
  - `prState(input)` checks the states in the PRD order, and the first match wins:
    1. merged or closed;
    2. a run is active: queued, round 1 running, fix check running, or fixing;
    3. stage failed;
    4. draft, or never reviewed;
    5. new commits since the last review;
    6. patch ready;
    7. questions waiting;
    8. findings to decide;
    9. sensitive files;
    10. waiting for the fix, or automatic rounds used;
    11. ready to merge.
  - `laneOf(state)`: one of the four lanes; merged and closed leave the board.
  - `nextStep(input)` returns `{ state, lane, tone, banner: Reason, who: Reason, mainAction }`. The banner is a code with params (counts, sha, signer, round n of 3).
  - `actionNeededOrder`: failed → questions → decide → sensitive → patch → fix → new commits → rounds used.

  The input is a plain `PrStateInput` with no DB types. Sources: `prState`, `LANES` and `nextStep` in `prototype/js/sim.js`; docs/03 "PR states, banners and board lanes"; PRD "PR states".
- **Touches:** `packages/core/src/pr-state.ts`, `src/reasons/pr-state.ts`, `test/pr-state.test.ts`
- **Depends on:** F-03-T2
- **Done when:** `pnpm --filter @pra/core test pr-state` passes one test per row of the PRD state table, asserting the state, lane, banner code and main action. It also passes precedence tests: an active run beats a failure; questions beat findings to decide; Implement findings still open after 3 completed rounds give `rounds_used`.

### F-03-T13: Port the merge checklist
- **Goal:** Add `checklist(input)`, which returns items with `ok` and a reason code:
  - the review covers the head commit; failing variants are no review yet, a round running, commits after the review, the last round failed, and a fix pushed after the review;
  - questions answered;
  - no finding left undecided;
  - nothing waiting for a fix;
  - sensitive files approved (only when the PR has sensitive files);
  - CI green: at least one check, and every check success, skipped or neutral;
  - no "changes requested" in GitHub.

  `ok` holds only when every item passes and the state is ready to merge. Port P `review.test.ts` (130). Sources: `src/readiness.ts`, `checklist` in sim.js.
- **Touches:** `packages/core/src/checklist.ts`, `src/reasons/checklist.ts`, `test/checklist.test.ts`
- **Depends on:** F-03-T2, F-03-T12
- **Done when:** `pnpm --filter @pra/core test checklist` passes the ported test, plus one failing-item test per item.

### F-03-T14: Record the porting map
- **Goal:** Write `packages/core/PORTING.md`, which lists all 98 tests in `~/Projects/wb-factory/test` and where each one goes: the core test that ports it, or the slice that will. Assigned to slices:
  - `admin` 24, 41, 52 → S-22
  - `autofix` 161 → S-15
  - `classify` 214 → S-01 reviewer brief; 239 → S-04
  - `control` 84, 130 → S-10; 176 → S-01 worker; 197 → S-09; 214, 237, 248, 263 → S-22
  - `guarded` 17 → S-14; 54 → S-12; 71 → S-06
  - `insight` 50, 72 → S-03; 128, 150 → S-22
  - `levels` 95 → S-22
  - `patch-change` (all 4) → S-13
  - `review` 79 → S-01 reviewer brief; 88 → S-06; 120 → S-13
  - `runs` 52 → S-02; 84 → S-11; 109, 133 → S-22
  - `sync` 33, 60, 70 → S-01 ingest; 52, 82 → S-02 board

  Not ported, because they test P's storage layout: `insight` 79, 105 and `runs` 63.
- **Touches:** `packages/core/PORTING.md`
- **Depends on:** F-03-T2 to F-03-T13
- **Done when:** the file has 98 rows (57 ported, 38 assigned to slices, 3 not ported), and every "ported" row names a test that appears in `pnpm --filter @pra/core test --reporter=verbose`.

## F-04: pilot-hosting-and-access-gate

api, worker and web run as Docker images on the chosen host with managed Postgres, S3 storage, injected secrets and Sentry, behind a shared access gate, with a CSRF guard on state-changing endpoints. Roadmap: [F-04](roadmap.md#f-04-pilot-hosting-and-access-gate)
**Slice check:** from a browser inside the gate, `https://<host>/prs` loads and `https://<host>/health` returns 200 with `db: ok`. From outside the gate, only `POST /webhooks/github` reaches the app, and it answers 401 when unsigned. A redelivered WB webhook lands as a `github_events` row in managed Postgres, with its raw payload in the bucket. Sentry shows the test event.

### F-04-T1: Add Dockerfiles for api, worker and web
- **Goal:** Build multi-stage images:
  - `apps/api/Dockerfile` and `apps/worker/Dockerfile`: `pnpm fetch` and install with `--frozen-lockfile`, build, then `pnpm deploy --filter @pra/<app> --prod` onto `node:24-slim`, running as a non-root user. The worker image includes `git` for GitMirror.
  - `apps/web/Dockerfile`: builds the SPA and serves it with Caddy, with SPA fallback. The same Caddy reverse-proxies `/api`, `/webhooks` and `/health` to `api`, with streaming-safe flushing so SSE works from S-03 on.
  - Add `.dockerignore`.
- **Touches:** `apps/*/Dockerfile`, `apps/web/Caddyfile`, `.dockerignore`
- **Depends on:** F-02 done
- **Done when:** `docker build -f apps/api/Dockerfile -t pra-api .` succeeds, and the same for worker and web; `docker run --rm -e DATABASE_URL=<compose db url> --network host pra-api` serves `/health` 200; `docker run --rm pra-api id -u` does not print 0.

### F-04-T2: Add the single-VM Compose file
- **Goal:** Write `deploy/compose.yaml` with these services:
  - `web`, on internal port 8080; TLS and the gate sit in front of it (F-04-T7);
  - `api` and `worker`, with `restart: unless-stopped` and healthchecks;
  - `migrate`, in profile `tools`, which runs `pnpm db:migrate` once and never on start.

  Secrets come only into `api` and `worker`, from an env file that the secret store injects. Only names appear in the repo. The GitHub App key file is mounted read-only at `GITHUB_APP_PRIVATE_KEY_PATH`. The worker gets a volume for `.data/git`. A `local` profile adds Postgres 17 and MinIO, to rehearse the deploy on a laptop.
- **Touches:** `deploy/compose.yaml`, `deploy/app.env.example` (names only)
- **Depends on:** F-04-T1
- **Done when:** `docker compose -f deploy/compose.yaml --profile local up -d` then `docker compose -f deploy/compose.yaml --profile local run --rm migrate`; after that, `curl localhost:8080/health` returns 200 through the web proxy and `curl localhost:8080/prs` returns the SPA; `docker compose -f deploy/compose.yaml config` shows no secret names on `web`.

### F-04-T3: Add the S3 BlobStore adapter
- **Goal:** Add an S3 adapter behind `BlobStore` using `@aws-sdk/client-s3`. When `S3_BUCKET` is set, the adapter uses it with `S3_ENDPOINT` and the AWS SDK's default credential chain (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`). Otherwise the local adapter on `BLOB_DIR` is used. The selection lives in one `createBlobStore(env)`, used by api and worker. Run the F-02 contract suite against MinIO, and add a MinIO service to CI.
- **Touches:** `packages/integrations`, `docker-compose.yml` (a `minio` service in profile `s3`), `.github/workflows/ci.yml`
- **Depends on:** F-02 done
- **Parallel with:** F-04-T1
- **Done when:** with `docker compose --profile s3 up -d minio`, `pnpm --filter @pra/integrations test s3-blob-store` passes the contract suite; `createBlobStore` picks S3 only when `S3_BUCKET` is set; CI is green.

### F-04-T4: Add the CSRF guard on state-changing endpoints
- **Goal:** Add a Fastify plugin in the api (tech-stack.md flag 7). For POST, PUT, PATCH and DELETE, except `/webhooks/github`, it requires the header `X-PRA-Request: 1` and an `Origin` whose host equals the request's host. `X-Forwarded-Host` is trusted only from the proxy, through `trustProxy`. Anything else gets 403 `{ error: { code: "csrf_rejected" } }`. The web client always sends the header; it is added in S-01-T13, or in `apps/web/src/lib/api.ts` here if S-01 has not landed yet.
- **Touches:** `apps/api/src/plugins/csrf.ts`
- **Depends on:** F-02 done
- **Parallel with:** F-04-T1
- **Done when:** `pnpm --filter @pra/api test csrf` passes: same origin with the header passes; a missing header, a foreign `Origin` and a missing `Origin` each get 403; GET is unaffected; `/webhooks/github` is exempt.

### F-04-T5: Initialise Sentry and OpenTelemetry, off without `SENTRY_DSN`
- **Goal:** Add `instrument.ts` to api and worker, loaded first with `node --import`:
  - The Sentry Node SDK starts only when `SENTRY_DSN` is set, with environment and release.
  - The OpenTelemetry Node SDK instruments HTTP, Fastify and pg, and exports only when the standard `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
  - pino lines carry `trace_id`.
  - A script sends one test event: `pnpm --filter @pra/api sentry:test` locally, `node dist/sentry-test.js` inside the image.
- **Touches:** `apps/api`, `apps/worker`
- **Depends on:** F-02 done
- **Parallel with:** F-04-T1
- **Done when:** `pnpm --filter @pra/api test instrument` passes: without `SENTRY_DSN`, no Sentry client and no exporter exist; with a dummy DSN and a stubbed transport, the client is initialised. The same test passes in `@pra/worker`.

### F-04-T6: Choose the host, managed Postgres, bucket and secret store (Needs Alek)
- **Goal:** Make the hosting decisions blocked on PRD OQ5 and OQ6, so the first deploy can happen.
- **Touches:** cloud accounts; the decision is recorded in `docs/08-orchestrator-log.md` by the orchestrator
- **Depends on:** —
- **Done when:** the four choices and the region are recorded; from the VM, `psql "$DATABASE_URL" -c 'select version()'` shows PostgreSQL 17, and `aws s3 ls "s3://$S3_BUCKET" --endpoint-url "$S3_ENDPOINT"` succeeds.
- **Steps for Alek:**
  1. Pick a Linux VM host where you can run rootless Docker and gVisor (any KVM VM; tech-stack.md flag 6). Suggested start: 4 vCPU, 8 GB RAM, 80 GB disk for worktrees and sandboxes. Create the VM with SSH access for yourself only.
  2. In the same region, create managed PostgreSQL 17 with daily backups. Create database `pra` and user `pra`, and allow connections from the VM only. The connection string becomes the secret `DATABASE_URL`.
  3. Create a private S3-compatible bucket in the same region, with all public access blocked. Add a lifecycle rule that deletes objects after 90 days (OQ17). Create an access key limited to this bucket. These become `S3_BUCKET`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_REGION`.
  4. Pick the secret store: the cloud's secret manager or 1Password Connect. Create entries named `DATABASE_URL`, `ANTHROPIC_API_KEY`, `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`, `CLICKUP_API_KEY`, `S3_BUCKET`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` and `SENTRY_DSN`, plus the GitHub App private key file, which is mounted at `GITHUB_APP_PRIVATE_KEY_PATH`. They are injected into `api` and `worker` only.
  5. Tell the orchestrator the host, the Postgres service, the bucket provider, the secret store and the region (no values).

### F-04-T7: Set up the shared access gate (Needs Alek)
- **Goal:** Put the hosted app behind one shared gate (PRD Access Control, OQ6), leaving GitHub webhooks able to reach the app.
- **Touches:** the gate in front of `web`
- **Depends on:** F-04-T2, F-04-T4, F-04-T6
- **Done when:** from a private browser outside the gate, `https://<host>/prs` shows the gate, not the app; `curl -i -X POST https://<host>/webhooks/github` returns 401 from the app.
- **Steps for Alek:**
  1. Pick the gate type: a shared password page, an SSO proxy (for example oauth2-proxy with the company Google Workspace, or Cloudflare Access), or a VPN (for example Tailscale).
  2. Point the domain's DNS at the VM and terminate TLS at the gate, or at a Caddy in front of `web`.
  3. Protect every path except `POST /webhooks/github`; GitHub cannot pass the gate, and the app checks the signature.
  4. If the gate is cookie-based (a password page or an SSO proxy), confirm the deployed api includes the CSRF guard (F-04-T4).
  5. Give access to the team: share the password, or add the people to the SSO or VPN group.
  6. Run the two checks in "Done when" and tell the orchestrator the gate type.

### F-04-T8: Create the Sentry project (Needs Alek)
- **Goal:** Have errors from api and worker reach Sentry.
- **Touches:** Sentry, the secret store
- **Depends on:** F-04-T5, F-04-T6
- **Done when:** after F-04-T9, running `node dist/sentry-test.js` in the api container shows up as an event in the Sentry project.
- **Steps for Alek:**
  1. In Sentry, create a project with platform Node.js named `pr-review-agent`.
  2. Copy its DSN and store it in the secret store as `SENTRY_DSN`. Do not paste it into chat or commits.
  3. Optionally, add an alert rule that emails you on new issues.

### F-04-T9: First deploy and smoke from inside the gate (Needs Alek)
- **Goal:** Get the app running on the host for the first time and check it from inside the gate.
- **Touches:** the VM
- **Depends on:** F-04-T1 to F-04-T8
- **Done when:** `https://<host>/health` returns 200 with `db: ok` through the gate; `/prs` loads; `docker compose -f deploy/compose.yaml logs worker` shows `worker started`; the Sentry test event arrived.
- **Steps for Alek:**
  1. On the VM, install Docker Engine with the compose plugin, then clone `alek-kowal/pr-review-agent` (use a read-only deploy key).
  2. Configure the secret store to write the env file and the GitHub App key file that `deploy/compose.yaml` expects, readable only by the deploy user (`chmod 600`).
  3. `docker compose -f deploy/compose.yaml build`
  4. `docker compose -f deploy/compose.yaml run --rm migrate`
  5. `docker compose -f deploy/compose.yaml up -d`
  6. From a browser inside the gate, open `https://<host>/health` and `https://<host>/prs`.
  7. Run `docker compose -f deploy/compose.yaml exec api node dist/sentry-test.js` and check Sentry.
  8. Tell the orchestrator the URL and the result.

### F-04-T10: Point the GitHub App webhook at the hosted app (Needs Alek)
- **Goal:** Have real WB events arrive on the host instead of a laptop. If the GitHub App does not exist yet, create it first with the steps in S-01-T16, using the hosted webhook URL.
- **Touches:** GitHub App settings
- **Depends on:** F-04-T9
- **Done when:** a redelivered delivery shows 202 in GitHub, a matching row appears in `github_events` in managed Postgres, and its raw payload exists in the bucket.
- **Steps for Alek:**
  1. GitHub → the organisation → Settings → Developer settings → GitHub Apps → `pr-review-agent` → Edit.
  2. Set Webhook URL to `https://<host>/webhooks/github` and keep the same webhook secret. Save.
  3. Advanced → Recent Deliveries → pick a `pull_request` delivery → Redeliver.
  4. Check that the response is 202, then from the VM run `psql "$DATABASE_URL" -c "select event, action, blob_key from github_events order by received_at desc limit 1"` and check that the blob key exists in the bucket.
  5. Stop the local smee client; local development then needs its own smee channel URL again.

## S-01: first-review-round

Round 1 starts by itself when a WB PR becomes ready for review, its findings show on the PR page, the bot posts the one sentence, and the full session and its real cost are kept. Roadmap: [S-01](roadmap.md#s-01-first-review-round)
**Slice check:** `pnpm test:e2e first-round.spec.ts` passes: a signed `ready_for_review` fixture leads to findings on the PR page and exactly one `github_actions` row with the body "Ready for team member review (round 1)". Then S-01-T18 shows the same on one real WB PR, with the session transcript and its real cost stored.

S-01 runs Review only. WB is seeded at level 1 until the Checks, Change type and Verify executors exist (S-04, S-05). A level that turns on a stage with no executor fails that stage visibly with `stage_not_available`. This is never faked.

### S-01-T1: Add the repository, pull request and event tables
- **Goal:** Add to `packages/db`, with a migration and typed queries:
  - `repositories`: id, unique slug, unique `github_full_name`, nullable `installation_id`, `config` jsonb validated by core `RepositoryConfigSchema`, timestamps;
  - `pull_requests`: repository_id, number (unique per repository), title, body, author_login, head_sha, base_sha, head_ref, base_ref, is_draft, is_fork, state (open, closed or merged), commits_count, opened_at, updated_at;
  - `github_events`: unique delivery_id, event, action, repository_full_name, pr_number, blob_key, received_at, processed_at, outcome code;
  - `app_settings`: one row, jsonb validated by `AppSettingsSchema`;
  - `instruction_versions`: scope (global or repository), repository_id, file_key, version, status (active, draft or archived), content, created_at. This is the minimum S-22 builds on.
- **Touches:** `packages/db`
- **Depends on:** F-02 done, F-03 done
- **Done when:** `pnpm db:migrate` applies cleanly; `pnpm --filter @pra/db test repositories.test.ts` passes: upserting a PR snapshot twice leaves one row, and a second insert with the same delivery id is a no-op.

### S-01-T2: Add the run, stage, session and finding tables
- **Goal:** Add to `packages/db`, with a migration and typed queries:
  - `runs`: pull_request_id, kind, round_no, chain_id, frozen level jsonb, head_sha, commits_count_at_start, status, started_by (bot, hand or a member id), trigger reason code, created_at, started_at, finished_at, cost_usd, and not_checked text[]. A partial unique index allows one active (queued or running) run per PR.
  - `stage_executions`: run_id, stage, attempt, status, started_at, finished_at, output jsonb, error_code, error_detail; unique on run, stage and attempt.
  - `agent_sessions`: stage_execution_id, role, model, input, output, cache-read and cache-write tokens, cost_usd, cost_source (reported or computed), turns, duration_ms, status, prompt_blob_key, transcript_blob_key.
  - `findings`: run_id, pull_request_id, ordinal, severity, title, file, line, scenario, suggestion, verdict (default `unchecked`), evidence jsonb, version int (default 0).
  - `questions`: run_id, text, options jsonb, recommended.
  - `github_actions`: pull_request_id, run_id, kind, body, result, github_id, created_at.
- **Touches:** `packages/db`
- **Depends on:** S-01-T1
- **Done when:** `pnpm db:migrate` applies; `pnpm --filter @pra/db test runs.test.ts` passes: it writes a run with stages, a session and findings, and reads them back; inserting a second active run for the same PR fails on the unique index.

### S-01-T3: Add the repository seed command with WB's config and instructions v1
- **Goal:** Add `pnpm db:seed-repo <file> [--instructions <dir>]`, which upserts a repository from a JSON seed and the `app_settings` defaults row, idempotently. Add `packages/db/seeds/workflowbuilder.json` with WB's values from `repos[WB]` in `prototype/js/data.js`: full name `synergycodes/workflowbuilder`, default branch, install command, ClickUp space, sensitive patterns with reasons, change-type rules. The exception is `defaultLevel: 1`, which is raised once S-04 and S-05 land. `--instructions ~/Projects/wb-factory/knowledge` imports the instruction files as version 1 (OQ15): reviewer prompt and rules globally; `lessons.md` and `feature-map/` scoped to the repository. No WB value appears in code.
- **Touches:** `packages/db/src/seed`, `packages/db/seeds/workflowbuilder.json`, root `package.json`
- **Depends on:** S-01-T1
- **Done when:** running the command twice leaves one `workflowbuilder` row whose config passes `RepositoryConfigSchema`; `instruction_versions` holds the imported files at version 1, status active; `pnpm --filter @pra/db test seed.test.ts` passes.

### S-01-T4: Add the GitHubGateway interface, the Octokit adapter and test doubles
- **Goal:** Define `GitHubGateway` in `packages/integrations`: `verifyWebhook(rawBody, signature)`, `getRepoInstallationId(fullName)`, `getInstallationToken(installationId)`, `getPullRequest(fullName, number)` and `postIssueComment(fullName, number, body)`. The adapter uses `@octokit/app` and `@octokit/webhooks` with `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH` and `GITHUB_WEBHOOK_SECRET`. If any is missing, every call throws `IntegrationNotConfigured` with code `github_not_configured` and never touches the network. `@pra/integrations/testing` exports:
  - `FakeGitHubGateway`, which records calls;
  - `signWebhook(body, secret)`;
  - trimmed webhook fixtures under `testing/fixtures/github/`: `pull_request` opened (draft and ready), ready_for_review, synchronize, closed, a fork variant, and `ping`.
- **Touches:** `packages/integrations`
- **Depends on:** F-02 done
- **Done when:** `pnpm --filter @pra/integrations test github` passes, with HTTP mocked by msw: the installation token is cached until it expires; `postIssueComment` sends the exact body; a bad signature fails verification; missing env gives `github_not_configured`.

### S-01-T5: Add the webhook ingest route
- **Goal:** Add `POST /webhooks/github` in the api. It verifies the signature through the gateway on the raw body, then writes the payload unchanged to BlobStore at `github-events/<deliveryId>.json` and inserts a `github_events` row. Both are idempotent on the `X-GitHub-Delivery` id. Then it enqueues `JOBS.githubEvent` (`github.event`) with the row id and answers 202. A bad signature gets 401 and nothing is stored. A missing secret gets 503 `github_not_configured`. Wire the gateway and BlobStore through the composition root.
- **Touches:** `apps/api/src/routes/webhooks`, the api composition root
- **Depends on:** S-01-T1, S-01-T4
- **Done when:** `pnpm --filter @pra/api test webhook.test.ts` passes: a signed fixture gives 202 plus the blob, the row and one queued job; a bad signature gives 401 and no row; a redelivery gives 202 with still one row and one job.

### S-01-T6: Process GitHub events in the worker and create round 1
- **Goal:** Add the worker's `github.event` handler for `pull_request` events (opened, ready_for_review, converted_to_draft, synchronize, edited, closed, reopened):
  - store the installation id on the repository;
  - upsert the PR snapshot: head sha, `commits_count`, draft, and fork (head repository differs from base);
  - ignore repositories that are not connected, with outcome `repository_not_connected`;
  - decide with core `roundStartForEvent` and `chainState`;
  - when a round starts, create a queued run with the level frozen from the repository default, `started_by` bot and a new chain, then enqueue `run.stage` for its first stage that is not off, with singletonKey `<runId>:<stage>`;
  - record the outcome code on the event row.

  Covers P `sync.test.ts` 33, 60 and 70: an unchanged PR is left alone, GitHub dates refresh, and a closed then reopened PR leaves and returns.
- **Touches:** `apps/worker/src/handlers/github-event.ts`
- **Depends on:** S-01-T1, S-01-T2, S-01-T4
- **Done when:** `pnpm --filter @pra/worker test github-event.test.ts` passes on `pra_test`: `ready_for_review` (not a fork) gives one queued run and one stage job; opened as a draft gives no run with outcome `draft`; a fork gives `fork`; `synchronize` updates `head_sha` and starts nothing; the same event twice gives one run.

### S-01-T7: Add GitMirror (bare mirror and a worktree per run)
- **Goal:** Add `GitMirror` in `packages/integrations`, running the git CLI through `execa`: `ensureMirror(fullName, token)`, `fetch(fullName, token)`, `addWorktree(runId, sha)` returning a path, `diff(baseSha, headSha)` (merge-base diff) and `removeWorktree(runId)`. Its root directory is passed in by the worker (default `.data/git`). The token goes in the environment (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0=http.extraHeader`), never in argv, as in P's "token in env, not argv" rule.
- **Touches:** `packages/integrations/src/git-mirror.ts`
- **Depends on:** F-01 done
- **Done when:** `pnpm --filter @pra/integrations test git-mirror` passes against a local bare repository fixture created in a temp dir, with no network: the worktree is at the requested sha, the diff lists the changed files, the worktree is removed, and a spy on `execa` shows no token in any argument.

### S-01-T8: Add the AgentRunner interface and the Claude Agent SDK reviewer adapter
- **Goal:** Define `AgentRunner` in `packages/agents`: `run({ role, model, cwd, prompt, outputSchema, maxTurns, maxCostUsd, signal, onProgress })` returns `{ status, output, usage, costUsd, costSource, turns, durationMs, transcript }`. The reviewer adapter calls `@anthropic-ai/claude-agent-sdk` `query()` with:
  - the model from the frozen level (default `claude-opus-5-5`);
  - allowed tools Read, Grep and Glob only, with cwd set to the worktree;
  - `settingSources: []` and no MCP servers;
  - an `env` holding only `ANTHROPIC_API_KEY` plus a minimal PATH and a temp HOME;
  - `maxTurns`, and a cost guard that aborts when the streamed cost passes `maxCostUsd`;
  - an abort signal for cancel.

  The adapter keeps every SDK message as the transcript. Cost comes from the result message; if the session stopped before a result, it is computed from streamed usage with a per-model price table, marked `computed` (NFR Cost truth). Without `ANTHROPIC_API_KEY`, `run` returns `failed` with `model_access_not_configured` and starts no session. `@pra/agents/testing` exports `FakeAgentRunner`, with scripted outputs, failures and costs.
- **Touches:** `packages/agents`
- **Depends on:** F-03 done
- **Done when:** `pnpm --filter @pra/agents test` passes with the SDK's `query` replaced by a fake seam: the allowed tools are exactly Read, Grep and Glob; the env holds no `GITHUB_*`, `CLICKUP_*` or `DATABASE_URL`; the cost guard aborts and records computed cost; reported cost is taken from the result; a missing key gives `model_access_not_configured` without calling `query`.

### S-01-T9: Build the review stage
- **Goal:** Add the review stage, `apps/worker/src/stages/review.ts`:
  1. Fetch the mirror and add a worktree at the PR head.
  2. Write `brief.md` and `diff.patch` into the session directory. The brief holds the PR title, body, changed files, sensitive files matched with core `matchSensitiveFiles`, and the level's limits.
  3. Materialise the active instruction versions (global and repository) into a read-only temp directory, and render the reviewer prompt's `{{knowledgeDir}}` and `{{repoDir}}`.
  4. Run the `AgentRunner` reviewer with the reviewer output schema, ported from `reviewSchema` in P `src/review.ts`: findings with severity, title, file, line, scenario and suggestion; questions with 2–3 options and one recommended; and what was not checked.
  5. Map P's severities to core `Severity`, then apply core `enforce` with `limitsFor(level)`. FR-031: at most the level's limit, never more than 7.

  It returns the findings, questions, not-checked list, dropped counts and session record. Covers P `classify.test.ts` 214 and `review.test.ts` 79 (what the brief contains).
- **Touches:** `apps/worker/src/stages`
- **Depends on:** S-01-T2, S-01-T3, S-01-T7, S-01-T8
- **Done when:** `pnpm --filter @pra/worker test review-stage.test.ts` passes with `FakeAgentRunner` and a local git fixture: 9 scripted findings are cut to the level's limit, most severe first; malformed output fails with `review_output_invalid`; the rendered prompt and brief contain no env values.

### S-01-T10: Wire the run state machine into the worker
- **Goal:** Add the `run.stage` handler, keyed by `(runId, stage)`. It drives core `startStage`, `completeStage` and `failStage` with a registry of stage executors (only `review` exists now). For each stage:
  - write the stage output, the `agent_sessions` row, the prompt and transcript blobs, the findings and questions, and the run cost in one transaction;
  - then enqueue the next stage, or complete the run.

  It also handles:
  - a stage with no executor fails with `stage_not_available`;
  - the per-stage timeout from the frozen level aborts the session and fails with `stage_timeout`;
  - a failed session's cost is still recorded;
  - the worktree is removed when the run ends;
  - on boot, core `recoverAfterRestart` marks stages left running as failed `interrupted` (NFR Durability);
  - at start the worker logs `model access configured` or `model access not configured`, never the value.

  Ports P `control.test.ts` 176: a run whose work throws fails, and the next run still starts.
- **Touches:** `apps/worker`
- **Depends on:** S-01-T6, S-01-T9
- **Done when:** `pnpm --filter @pra/worker test run-round.test.ts` passes:
  - a queued level-1 run completes, with Checks, Task, Change type and Verify `off`, Review succeeded, and findings and questions rows; one `agent_sessions` row carries the cost and an existing transcript blob;
  - a failing runner fails the run with the stage error code and the session cost recorded, and the next queued run still completes;
  - with the real adapter and no key, the run fails with `model_access_not_configured`;
  - after a simulated restart, a running stage becomes failed `interrupted`.

### S-01-T11: Post the one GitHub sentence after a completed round
- **Goal:** When a run completes, and only when it completes, and `app_settings` has the after-round comment on, enqueue `github.comment` with singletonKey `<runId>`. The job posts exactly `Ready for team member review (round N)` through `GitHubGateway.postIssueComment` and records a `github_actions` row with the body, the result and GitHub's comment id (FR-027). Failed and cancelled rounds post nothing. The on/off switch UI is FR-077 (S-20); this task only honours the setting.
- **Touches:** `apps/worker/src/handlers/github-comment.ts`
- **Depends on:** S-01-T4, S-01-T10
- **Done when:** `pnpm --filter @pra/worker test github-comment.test.ts` passes with `FakeGitHubGateway`: the exact string for round 1; nothing for a failed run; nothing when switched off; one comment when the job runs twice; the body contains no URL and no finding text (NFR Privacy toward public PRs).

### S-01-T12: Add the api read endpoints for PRs and findings
- **Goal:** Add Zod-typed endpoints:
  - `GET /api/repositories`: slug and name.
  - `GET /api/prs?repo=<slug>`: open PRs, drafts included, from connected repositories, each with repository slug, number, title, author login and the latest round's status (FR-004).
  - `GET /api/prs/:repo/:number`: the PR and its latest round: number, status, level, started by, timestamps, cost, and each stage's status including `off`.
  - `GET /api/prs/:repo/:number/findings`: the latest completed round's findings with severity, file, line, verdict `unchecked` with the level, evidence, scenario and suggestion, plus its questions and the not-checked list.

  Reads never write.
- **Touches:** `apps/api/src/routes/prs`
- **Depends on:** S-01-T1, S-01-T2
- **Done when:** `pnpm --filter @pra/api test prs.test.ts` passes: shapes match the schemas and appear in `/docs/json`; `?repo=` filters; an unknown PR gives 404 `pr_not_found`; table row counts are unchanged after every GET.

### S-01-T13: Add the web PR list and the PR page with its tab shell
- **Goal:** Add the client and the first two pages:
  - `apps/web/src/lib/api.ts`: a fetch wrapper that always sends `X-PRA-Request: 1` (the CSRF guard from F-04) and turns errors into reason codes.
  - `/prs`: a minimal list for now (S-02 replaces it with the board) showing `repo#number`, title, author and round status. A repository filter Select appears when more than one repository exists, with `?repo=` in the URL.
  - `/pr/$repo/$number`: a header (title plus one grey line) and Tabs Findings, Questions, Patch and Timeline, with `?tab=` in the URL (FR-058). Questions, Patch and Timeline show plain empty states.

  Pages refetch every 5 s while a round is active; SSE arrives in S-03. Copy lives in `apps/web/src/copy`.
- **Touches:** `apps/web/src/routes`, `apps/web/src/features/prs`, `apps/web/src/lib`, `apps/web/src/copy`
- **Depends on:** S-01-T12
- **Done when:** `pnpm --filter @pra/web test` passes `PrList.test.tsx` (`repo#number` shown, the filter writes `?repo=`) and `PrTabs.test.tsx` (switching tabs updates `?tab=`, and a deep link opens the right tab).

### S-01-T14: Build the Findings tab
- **Goal:** Group findings by severity (Blocking, Worth fixing, Nit). Each finding shows file and line, the verdict as grey text ("Unchecked (level 1)"), evidence quotes, the reproduction result when there is one, the scenario and the suggestion. Badges appear only for decisions and fix results (none yet). The findings filter appears only from 7 findings up (FR-036). Below the list, a "Not checked" section. When the latest round failed, the tab shows the round line with the copy for its error code, for example "Round 1 failed at Review: model access is not configured".
- **Touches:** `apps/web/src/features/findings`, `apps/web/src/copy`
- **Depends on:** S-01-T13
- **Done when:** `pnpm --filter @pra/web test Findings.test.tsx` passes: severity groups in order; file and line, scenario and suggestion shown; no filter at 6 findings and a filter at 7; the failed-round copy for `model_access_not_configured`.

### S-01-T15: Add the end-to-end test of round 1 with doubles
- **Goal:** Add `e2e/support/stack.ts`, which starts api and worker in one process with test dependencies: `FakeGitHubGateway`, `FakeAgentRunner` scripted per PR number, the local BlobStore in a temp dir, GitMirror on a local fixture repository, the `pra_test` database, and a seeded test repository. Playwright's `webServer` runs it next to the web dev server. `e2e/first-round.spec.ts`:
  - posts a signed `ready_for_review` fixture, opens the PR from `/prs`, and sees the scripted findings grouped by severity with file and line and "Unchecked (level 1)";
  - reads `github_actions` with `pg` and finds exactly one row with the body `Ready for team member review (round 1)`;
  - checks that a second PR whose runner fails shows the failed-round line and has no `github_actions` row.

  Add an `e2e` job with Postgres to `ci.yml`.
- **Touches:** `e2e/`, `playwright.config.ts`, `.github/workflows/ci.yml`
- **Depends on:** S-01-T5, S-01-T11, S-01-T14
- **Done when:** `pnpm test:e2e first-round.spec.ts` passes locally and in CI.

### S-01-T16: Create and install the GitHub App on WB (Needs Alek)
- **Goal:** Create the GitHub App `pr-review-agent`, install it on WB only, and deliver its webhooks to the local api.
- **Touches:** GitHub organisation settings, local `.env`
- **Depends on:** S-01-T5 (for the delivery check)
- **Done when:** in the App's Advanced → Recent Deliveries, a redelivered delivery returns 202; `psql "$DATABASE_URL" -c "select event, action from github_events order by received_at desc limit 1"` shows it; `.env` has `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH` and `GITHUB_WEBHOOK_SECRET` set.
- **Steps for Alek:**
  1. GitHub → the organisation that owns Workflow Builder → Settings → Developer settings → GitHub Apps → New GitHub App. This needs organisation owner rights.
  2. GitHub App name: `pr-review-agent`; it is visible on public PRs. Homepage URL: `https://github.com/alek-kowal/pr-review-agent`. Leave "Request user authorization (OAuth) during installation" unchecked and the callback URL empty.
  3. Webhook: keep Active checked. For Webhook URL, open https://smee.io, click "Start a new channel" and paste the channel URL. Anyone with that URL can read the payloads (PR titles, branches), so keep it private, or use `cloudflared tunnel --url http://localhost:3000` and its URL instead.
  4. Webhook secret: run `openssl rand -hex 32`, paste the result into the App form and into `.env` as `GITHUB_WEBHOOK_SECRET`.
  5. Repository permissions:
     - Contents: Read and write. Writing is first used by merge in S-12 and push in S-14; choose Read-only now if you prefer and raise it then.
     - Pull requests: Read and write, for the round comment.
     - Checks: Read-only.
     - Commit statuses: Read-only.
     - Metadata: Read-only (mandatory).
     - No organisation or account permissions.
  6. Subscribe to events: Pull request, Pull request review, Check suite, Check run, Status.
  7. "Where can this GitHub App be installed?": Only on this account. Click Create GitHub App.
  8. Copy the App ID into `.env` as `GITHUB_APP_ID`. Under Private keys, click "Generate a private key". Move the downloaded `.pem` outside the repo (for example `~/.config/pr-review-agent/github-app.pem`), run `chmod 600` on it, and set `GITHUB_APP_PRIVATE_KEY_PATH` in `.env` to that path.
  9. Install App → the organisation → Only select repositories → Workflow Builder. Check that its full name matches `githubFullName` in `packages/db/seeds/workflowbuilder.json`, and tell the orchestrator if it does not.
  10. With the api running, start `pnpm dlx smee-client --url <channel URL> --target http://localhost:3000/webhooks/github`, then redeliver the `ping` delivery from Advanced → Recent Deliveries and run the check in "Done when".
  11. If S-01-T19 ran first: restart api and worker after step 8. Polling stops by itself (Settings → Integrations shows the App again); `GITHUB_TOKEN` may stay or go.

### S-01-T17: Provide the Anthropic API key (Needs Alek)
- **Goal:** Give the worker model access, settling PRD OQ4 for local runs.
- **Touches:** Claude Console, local `.env`
- **Depends on:** S-01-T10 (for the start log line)
- **Done when:** after a restart, the worker's start log says `model access configured`; the Console lists the key in workspace `pr-review-agent`.
- **Steps for Alek:**
  1. Decide the billing owner. This is pay-per-token on an organisation Claude Console account, not a Claude subscription. The reviewer `claude-opus-5-5` costs $4 per million input tokens and $20 per million output tokens; each round's real cost shows on the PR page.
  2. Claude Console → Settings → Workspaces → Create workspace `pr-review-agent`.
  3. In that workspace, set a monthly spend limit for the pilot.
  4. API keys → Create key → workspace `pr-review-agent`, name `pr-review-agent-local`.
  5. Put it in `.env` as `ANTHROPIC_API_KEY`. `.env` is gitignored; never paste the key into chat or commits. For the hosted app, store it in the secret store from F-04-T6.
  6. Restart `pnpm --filter @pra/worker dev` and check the start log.

### S-01-T18: Run the real smoke on one WB PR (Needs Alek)
- **Goal:** Watch round 1 run end to end on a real WB PR with the real reviewer.
- **Touches:** a WB pull request; the local app
- **Depends on:** S-01-T15, S-01-T16, S-01-T17
- **Done when:** for one real WB PR: round 1 completes; findings show on the PR page; GitHub shows exactly one comment by `pr-review-agent` reading "Ready for team member review (round 1)"; `select role, model, cost_usd, cost_source, transcript_blob_key from agent_sessions order by id desc limit 1` shows the session, and its transcript file exists under `BLOB_DIR`.
- **Steps for Alek:**
  1. `docker compose up -d db && pnpm db:migrate`
  2. `pnpm db:seed-repo packages/db/seeds/workflowbuilder.json --instructions ~/Projects/wb-factory/knowledge` (skip if already seeded).
  3. Start the api, worker and web dev servers and the smee client from S-01-T16.
  4. On WB, open a small draft PR, or pick an existing one, and click "Ready for review".
  5. Open `http://localhost:5173/prs`, open the PR and wait for round 1 to finish (the page refreshes every 5 s).
  6. Check the Findings tab, the GitHub comment and the `agent_sessions` row, as listed in "Done when".
  7. Tell the orchestrator the round's cost and anything that looked wrong.

### S-01-T19: Poll WB until the GitHub App exists (Needs Alek)
- **Goal:** Review real WB PRs before S-01-T16, without org owner rights: the worker polls GitHub read-only (P-28).
- **Touches:** local `.env` (or `/etc/pra/pra.env` on the host); Settings in the app
- **Depends on:** S-01-T17
- **Done when:** Settings → Integrations → GitHub polling shows a last poll without an error and WB with "baseline"; the next WB PR marked ready for review starts round 1 within one poll interval; no comment, merge or push reaches GitHub.
- **Steps for Alek:**
  1. Leave `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH` and `GITHUB_WEBHOOK_SECRET` empty.
  2. Optional, recommended: GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token; Repository access "Public repositories (read-only)"; no other permissions. Put it in `.env` as `GITHUB_TOKEN`. Without it GitHub allows 60 requests an hour; set the poll interval to 15 minutes or more then.
  3. Restart the api and worker. Settings → Repositories: type the WB `owner/name`, check the prefilled default branch, Connect and sign (skip if `pnpm db:seed-repo` already added it).
  4. Settings → Integrations → GitHub polling: set the schedule (interval, window, days, time zone), sign, then press Poll now once. The first poll imports WB's open PRs and reviews none of them.
  5. Mark a WB PR ready for review, or push to one with a finished round, and watch the board.
- **Switch-over to the App:** after S-01-T16 set all three App values and restart api and worker. Polling stops by itself and webhooks take over; merge, push and the after-round comment turn on. A partly set App keeps polling, and Integrations names the missing values.

## S-02: board-and-signed-decision

The board shows each PR in its lane with a Next step banner, Team members are managed in Settings, and one signature decides one or many findings, so the lane and banner update (north star). Roadmap: [S-02](roadmap.md#s-02-board-and-signed-decision-north-star)
**Slice check:** `pnpm test:e2e board.spec.ts decide.spec.ts` passes, and S-02-T11 records the first signed decision on a finding from a real WB round, seen on the board and on the PR page.

### S-02-T1: Add the team, decision and audit tables
- **Goal:** Add to `packages/db`, with a migration and queries:
  - `team_members`: id, name, github_login (unique among active members), clickup_user_id, created_at, removed_at for soft removal.
  - `decision_batches`: id, pull_request_id, decision, reason, signed_by, created_at, undone_at.
  - `finding_decisions`: finding_id, batch_id. The current decision is the latest batch that has not been undone.
  - `audit_events`: at, actor, area, action, target, before jsonb, after jsonb (NFR Accountability; the UI comes in S-21).
  - `decideFindings(tx, { findingIds, expectedVersions, … })`: bumps `findings.version` and returns conflicts when a version moved (NFR Concurrent edits).
- **Touches:** `packages/db`
- **Depends on:** S-01 done
- **Done when:** `pnpm --filter @pra/db test decisions.test.ts` passes: two concurrent `decideFindings` calls with the same expected version leave exactly one applied, and the other returns the finding with the winning signer; undo restores the previous decision.

### S-02-T2: Serve the board and the PR view from the core state table
- **Goal:** Add `loadPrStateInput(db, prId)`, which builds core `PrStateInput`:
  - merged or closed;
  - the active run: kind, and whether it is queued;
  - the last run's failure, with its stage;
  - the reviewed sha, and draft;
  - commits since the review: `pull_requests.commits_count` minus the reviewed run's `commits_count_at_start`;
  - open questions (answers arrive in S-08, so every question counts);
  - findings with their current decisions;
  - the number of completed rounds in the chain;
  - no sensitive files or patch yet; they arrive in S-11 and S-13.

  The PR author maps to a Team member by GitHub login. Endpoints:
  - `GET /api/board` returns four lanes of cards: title, `repo#number`, author, age, and the next step as a code with params. Action needed is sorted by core `actionNeededOrder`, newest first inside each group. Drafts are listed separately inside Not reviewed. `mergedOrClosed` holds the last 7 days.
  - `GET /api/prs/:repo/:number` gains `nextStep` and `checklist`.

  Ports P `runs.test.ts` 52 (the newest run of each kind per PR) and `sync.test.ts` 52 (most recently opened first).
- **Touches:** `packages/db/src/queries/pr-state.ts`, `apps/api/src/routes/board`, `apps/api/src/routes/prs`
- **Depends on:** S-02-T1
- **Done when:** `pnpm --filter @pra/api test board.test.ts` passes:
  - a PR with 3 undecided Blocking findings is in lane `action` with banner `{ code: "decide_findings", params: { count: 3 } }`;
  - a draft is in lane `not`;
  - a running round is in lane `work`;
  - with every finding rejected, the PR is in lane `ready`;
  - a merged PR appears only in `mergedOrClosed`.

### S-02-T3: Add the Team api, signed and audited
- **Goal:** Add `GET /api/team`, `POST /api/team`, `PATCH /api/team/:id` and `DELETE /api/team/:id` (soft removal). Every change needs `signedBy`, an active member. While the team is empty, the first member signs as themselves. Every change writes an `audit_events` row with before and after. A removed member's past signatures keep their name.
- **Touches:** `apps/api/src/routes/team`
- **Depends on:** S-02-T1
- **Parallel with:** S-02-T2
- **Done when:** `pnpm --filter @pra/api test team.test.ts` passes: add, edit and remove each write an audit row with before and after; no signature gives 400 `signature_required`; a signer not in Team gives 400 `signer_unknown`; a duplicate active GitHub login gives 409 `github_login_taken`.

### S-02-T4: Add the decisions api, with Undo and the concurrency check
- **Goal:** Add the decision endpoints:
  - `POST /api/prs/:repo/:number/decisions` takes `{ findingIds, decision, reason?, signedBy, expectedVersions }` (FR-040):
    - Reject needs a reason (`reason_required`). Nits may be decided (OQ11).
    - One `decision_batches` row is written in one transaction.
    - A stale version gives 409 `decision_conflict`, with the current decision and its signer.
    - It returns the refreshed PR view: nextStep, checklist and findings.
  - `POST /api/decision-batches/:id/undo` is allowed only while none of the batch's findings changed since; otherwise 409.

  Defer only records the decision; the ClickUp follow-up is S-06. A decision by someone other than the author keeps both names for "Rejected by Tomek (author: Kasia)".
- **Touches:** `apps/api/src/routes/decisions`
- **Depends on:** S-02-T2, S-02-T3
- **Done when:** `pnpm --filter @pra/api test decisions.test.ts` passes:
  - a bulk Implement of 2 findings with one signer decides both, and nextStep becomes `findings_to_implement` with `count: 2`;
  - Reject without a reason gives 400 `reason_required`;
  - stale `expectedVersions` give 409 `decision_conflict` naming the other signer;
  - undo restores the earlier view.

### S-02-T5: Build the signature field that remembers the last signer
- **Goal:** Add `apps/web/src/features/signature/SignatureField.tsx`, a shadcn Combobox (Popover with Command) listing active Team members from `GET /api/team`. It is prefilled with the last signer from `localStorage` key `pra.lastSigner` while that member is still in Team, and it saves the chosen member on submit through `useLastSigner` (FR-087). Wrap every storage access in try/catch. With an empty Team it shows "Add yourself in Settings → Team" with a link.
- **Touches:** `apps/web/src/features/signature`
- **Depends on:** S-02-T3
- **Done when:** `pnpm --filter @pra/web test SignatureField.test.tsx` passes: it prefills from storage, ignores a removed member, updates storage on submit, works by keyboard alone, and survives storage that throws.

### S-02-T6: Turn `/prs` into the board with four lanes
- **Goal:** Replace the S-01 list with the board, following docs/03 "Simplification pass":
  - four lanes from `GET /api/board`; Action needed is twice as wide, with an amber header and a count;
  - cards are three lines: title; `#number · author · age`; next step;
  - the repository shows only when there is more than one;
  - drafts are one-line rows under "N drafts" in Not reviewed;
  - empty-lane texts come from `LANES` in sim.js;
  - a collapsed "Merged or closed in the last 7 days" list;
  - English copy for every next-step code in `apps/web/src/copy/nextStep.ts`.

  The board refetches every 10 s and on window focus. Ports P `sync.test.ts` 82: a title with markup renders as text.
- **Touches:** `apps/web/src/routes/prs.tsx`, `apps/web/src/features/board`, `apps/web/src/copy`
- **Depends on:** S-02-T2
- **Done when:** `pnpm --filter @pra/web test Board.test.tsx` passes against a fixture board response: each PR is in its lane; the Action needed count is right; drafts show as rows; a title containing `<script>` renders as text.

### S-02-T7: Add the Next step banner and the checklist to the PR page
- **Goal:** Place a shadcn Alert between the header and the tabs (FR-057): colour by state, the title from `nextStep.banner`, a "usually …" line, and one main action. For `decide_findings` the action focuses the first undecided finding; actions from later slices are not rendered yet. Below it, the merge checklist shows failing rows only, with "Show all N"; when everything is green it is one line. The banner refetches while a round runs.
- **Touches:** `apps/web/src/features/pr`, `apps/web/src/copy`
- **Depends on:** S-02-T2
- **Parallel with:** S-02-T6
- **Done when:** `pnpm --filter @pra/web test NextStepBanner.test.tsx` passes for the fixtures decide, to implement, running, failed and ready: the copy, the tone class and whether a main action is shown.

### S-02-T8: Build the Team page in Settings
- **Goal:** Build `/settings/team` (FR-076) inside a minimal Settings layout whose navigation has only Team for now. A table shows name, GitHub login and ClickUp user. Add, Edit and Remove each open a Dialog or AlertDialog with the fields and the SignatureField. On save, the team queries are invalidated, and api error codes show as copy.
- **Touches:** `apps/web/src/routes/settings.team.tsx`, `apps/web/src/features/team`
- **Depends on:** S-02-T3, S-02-T5
- **Done when:** `pnpm --filter @pra/web test TeamPage.test.tsx` passes: Add posts the fields with `signedBy`; Remove asks for confirmation and a signature; `signer_unknown` shows its copy.

### S-02-T9: Decide findings on the Findings tab
- **Goal:** Let people decide on the Findings tab:
  - select one or more findings with a Checkbox, which opens a sticky bulk bar: Implement…, Reject…, Defer to ClickUp;
  - single-finding actions open the small inline form with the SignatureField prefilled, where Enter confirms;
  - Reject needs a reason;
  - each finding to decide shows "Usually decided by: Kasia (author)", and Nits show "Optional";
  - a decided finding shows a decision badge and "Rejected by Tomek (author: Kasia)";
  - after success, a Sonner toast offers Undo;
  - `decision_conflict` shows who decided and refetches;
  - success invalidates the PR view and the board, so the lane, banner and checklist update in place.
- **Touches:** `apps/web/src/features/findings`, `apps/web/src/copy`
- **Depends on:** S-02-T4, S-02-T5, S-02-T7
- **Done when:** `pnpm --filter @pra/web test FindingDecisions.test.tsx` passes: a bulk Implement sends one request with both ids and one signer; Reject cannot be submitted without a reason; Undo calls the undo endpoint; a conflict shows the other signer's name.

### S-02-T10: Add the end-to-end tests of the board and signed decisions
- **Goal:** Using the S-01 test stack, script the reviewer double with 2 Blocking findings, 1 Worth fixing and 1 Nit.
  - `e2e/board.spec.ts`: after the ready fixture, the PR is in Action needed with "Decide 3 findings"; a draft fixture lands in Not reviewed.
  - `e2e/decide.spec.ts`:
    1. Add Kasia (the author's login) and Tomek on the Team page.
    2. Select 2 findings → Implement → sign as Kasia. The banner reads "2 findings to implement".
    3. Reject the third with a reason, signed as Tomek. It shows "Rejected by Tomek (author: Kasia)".
    4. Undo works.
    5. After a reload, the signature is prefilled with the last signer.
    6. Two browser contexts decide the same finding, and the second sees the conflict message.
    7. On a second PR where every finding is rejected, the PR moves to Ready to merge.
- **Touches:** `e2e/`
- **Depends on:** S-02-T6, S-02-T8, S-02-T9
- **Done when:** `pnpm test:e2e board.spec.ts decide.spec.ts` passes locally and in CI.

### S-02-T11: Sign the first decision on a real WB PR (Needs Alek)
- **Goal:** Reach the north star: a team member signs a decision on a finding from a real WB review, seen on the board and on the PR page.
- **Touches:** the local app, a WB PR reviewed in S-01-T18
- **Depends on:** S-02-T10, S-01-T18
- **Done when:** a `decision_batches` row signed by you exists for a finding from a real WB round; the PR's banner and lane changed accordingly on the board and the PR page; the GitHub PR got no new comment from the decision (NFR Privacy).
- **Steps for Alek:**
  1. Start the stack as in S-01-T18, steps 1–3.
  2. Open `http://localhost:5173/settings/team`. Add yourself (name, GitHub login, ClickUp user), signing as yourself, then add the WB PR's author.
  3. Open `/prs`. Find the WB PR from S-01-T18, or mark another WB PR ready and wait for round 1, in Action needed with "Decide N findings".
  4. Open it, select one or more findings, choose Implement, Reject (with a reason) or Defer, and sign with your name.
  5. Check that the banner changed, go back to `/prs`, and check the lane.
  6. Run `psql "$DATABASE_URL" -c "select decision, signed_by, created_at from decision_batches order by created_at desc limit 1"`, and check that the GitHub PR has no new comment.
  7. Tell the orchestrator the north star is reached, plus anything that confused you.

## S-03: live-round-progress

A running round updates without reload (stage, cost so far) on the PR page and in Activity, with the status chip, stage stepper, round labels, Run detail and the PR Timeline. Roadmap: [S-03](roadmap.md#s-03-live-round-progress)
**Slice check:** `pnpm test:e2e live-progress.spec.ts` passes: a signed `pull_request.ready_for_review` webhook posted to the api puts the PR card in Agents working in under 10 s with no reload, the PR page and Activity show the current stage and a rising cost while the round runs, and afterwards Run detail and the Timeline tab show the run with its final cost.

### S-03-T1: Emit change notifications from Postgres
- **Goal:** Add a migration with an `AFTER INSERT OR UPDATE` trigger on the tables the UI watches (prs, runs, stages, agent_sessions, findings, decisions) that calls `pg_notify('pra_change', …)` with a small JSON payload `{table, id, prId, runId}`, plus a `listenChanges(onChange)` helper in packages/db that holds one dedicated connection and resubscribes after it drops.
- **Touches:** packages/db (migration, `src/live.ts`)
- **Depends on:** S-02 done
- **Done when:** `pnpm --filter @pra/db test notify.test.ts` passes: updating a stage row delivers exactly one payload with its `prId` and `runId` to a listener within 1 s, and the listener receives events again after its backend is killed with `pg_terminate_backend`.

### S-03-T2: Stream changes to browsers over SSE
- **Goal:** Add `GET /api/live` to apps/api: one shared `listenChanges` subscription fanned out to every connected client as `event: change` SSE messages, a heartbeat comment every 15 s, and cleanup on disconnect. Connecting writes nothing.
- **Touches:** apps/api (`src/routes/live.ts`)
- **Depends on:** S-03-T1
- **Done when:** `pnpm --filter @pra/api test live.test.ts` passes: two connected clients each receive a run update within 1 s; after both disconnect the fan-out holds 0 clients; a heartbeat is sent (fake timers).

### S-03-T3: Record the current stage and cost so far while a session runs
- **Goal:** Make `AgentRunner` report token usage after every turn, and have the worker add that turn's real cost (usage × the model's price table) to the session's `cost_usd` and keep `runs.current_stage` current; when the session ends, its cost is set to the SDK's reported total. Live cost is always spent money, never an estimate (NFR Cost truth).
- **Touches:** packages/agents (runner turn callback), apps/worker (stage runner)
- **Depends on:** S-01 done
- **Done when:** `pnpm --filter @pra/worker test live-cost.test.ts` passes: with an `AgentRunner` double that emits 3 turns, `agent_sessions.cost_usd` grows after each turn and ends equal to the double's reported total, and `runs.current_stage` names the running stage while it runs.

### S-03-T4: Round label, stepper and time-summary rules in core
- **Goal:** Add pure functions to packages/core: `roundLabel(run, chain)` returning structured parts for "Round 2 of 3 · started by pr-review-agent after fix abc123", "Round 1 of 3 · started by hand" and a second round 1 marked "new chain" (FR-025); `stepperModel(stageRows, level)` listing the run's stages with done/running/failed/queued and per-stage cost, plus the stages this level switches off (FR-033, FR-061); `timeSummary(stateChanges, runs, now)` giving ready-for-review time, ready → merge (or open for), agents worked, waiting for people and merge, and total cost of finished runs (FR-060, `docs/06-metrics.md` metric 2).
- **Touches:** packages/core
- **Depends on:** S-01 done
- **Done when:** `pnpm --filter @pra/core test round-label.test.ts stepper.test.ts time-summary.test.ts` passes, covering: ready, hand and fix-check starts; a second round 1 marked new chain; at level 1 Checks, Task, Change type and Verify are listed as off; stages come only from the run's stage rows (a stage the worker did not plan is not shown); the summary splits time by lane from state changes and sums only finished runs' cost.

### S-03-T5: Timeline entries and PR state-change log
- **Goal:** Add `timeline_entries` (pr, at, actor kind member/bot/hand, member id, kind, params, run id, cost) and `pr_state_changes` (pr, state, lane, reason code, head SHA, at) with writer helpers `recordTimelineEntry` and `recordStateChange` in packages/db, add both tables to the T1 trigger, and call the helpers from every existing writer: webhook ingest (ready for review, push, close, merge), round start/finish/failure, GitHub comment posted, and signed decisions. Later slices write their entries through the same helpers.
- **Touches:** packages/db, call sites in apps/worker and apps/api
- **Depends on:** S-03-T1
- **Done when:** `pnpm --filter @pra/worker test timeline.test.ts` passes: a ready event plus a completed round (doubles) leave, in order, "PR marked ready for review", "Round 1 of 3 started" (bot), `GitHub comment posted: "Ready for team member review (round 1)"` (bot) and "Round 1 finished" with its cost, and `pr_state_changes` holds never reviewed → round 1 running → the round's result state; `pnpm --filter @pra/api test timeline-writers.test.ts` shows a signed decision writes an entry with the signer's name.

### S-03-T6: Run detail and transcript endpoints
- **Goal:** Add Zod-typed `GET /api/runs/:id` (PR, round label parts, status, level, instruction versions recorded on the run, each stage with readable output and cost, each agent session with model, cost, files read and actions taken, failure reason and cost up to the failure) and `GET /api/runs/:id/sessions/:sessionId/transcript` (full session log from BlobStore).
- **Touches:** apps/api
- **Depends on:** S-03-T4
- **Done when:** `pnpm --filter @pra/api test runs.test.ts` passes against a seeded failed run: the response lists succeeded and failed stages, sessions with cost and files read, and a total equal to the sum of session costs up to the failure; the transcript route streams the stored log.

### S-03-T7: Timeline, in-progress and status endpoints, and reads that never write
- **Goal:** Add `GET /api/prs/:id/timeline` (summary from `timeSummary` plus entries with actor and each finished run's final cost), `GET /api/activity/in-progress` (running and queued runs with current stage and cost so far) and `GET /api/status` (state and today's spend), plus a test that no GET route changes data (NFR Reads never write).
- **Touches:** apps/api
- **Depends on:** S-03-T4, S-03-T5
- **Done when:** `pnpm --filter @pra/api test timeline.test.ts activity.test.ts reads-never-write.test.ts` passes; the last one calls every registered GET route (read from Fastify's route list) against seeded data and asserts a checksum of every table is unchanged.

### S-03-T8: Live updates and status chip in the web shell
- **Goal:** Add a `useLiveUpdates()` hook that opens `/api/live` once per tab (EventSource, reconnect with backoff) and invalidates TanStack Query keys by table (board, PR summary, runs, activity, status), replacing S-01/S-02 polling; holding findings behind "View new results" comes in S-08. Add the status chip to the top bar of every page showing "Running" and today's spend (spec: `prototype/js/shell.js` `StatusChip`); paused and budget states with their controls come in S-10, the alert count in S-18.
- **Touches:** apps/web (app shell, `src/live/`)
- **Depends on:** S-03-T2, S-03-T7
- **Done when:** `pnpm --filter @pra/web test live.test.tsx status-chip.test.tsx` passes: a mocked change event for a run invalidates exactly the run, PR summary, board and activity queries; the chip renders on the board, PR, Activity and Settings routes.

### S-03-T9: Live stepper, round line and cost on the PR page
- **Goal:** On the PR page show the full stage stepper while a run is active or after a failure (current stage, stages off at this level, cost so far always visible), otherwise one expandable round line such as "Round 1 of 3 · started by hand · finished 14:02 · $1.84" whose Stages control reopens the stepper. Spec: `prototype/js/ui.js` `Stepper`, `prototype/js/pr.js` `RoundLine`, `docs/03-design-decisions.md` §Simplification pass.
- **Touches:** apps/web (PR page)
- **Depends on:** S-03-T4, S-03-T8
- **Done when:** `pnpm --filter @pra/web test stepper.test.tsx round-line.test.tsx` passes for running, failed, finished and level-1 fixtures, and a change event updates the running stage and cost without remounting the page.

### S-03-T10: Run detail page
- **Goal:** Add route `/runs/$runId?tab=stages|transcript`: header with PR, round label, status, total cost and instruction versions; every stage expandable to its readable output; every agent session with its cost, files read and actions; the Transcript tab renders the full session log; a failed run shows its cost up to the failure. Link it from the PR round line and stepper and from Activity rows. Spec: `prototype/js/pages.js` `RunPage`.
- **Touches:** apps/web (`routes/runs.$runId.tsx`)
- **Depends on:** S-03-T6
- **Done when:** `pnpm --filter @pra/web test run-detail.test.tsx` passes against a failed-run fixture (cost up to failure shown, sessions listed with cost and files read, transcript tab renders tool calls).

### S-03-T11: PR Timeline tab
- **Goal:** Fill the Timeline tab: the summary line (ready for review, ready → merge or open for, agents worked, waiting for people and merge, total cost) and then every entry with who acted (a name, pr-review-agent, or "by hand") and each finished run's final cost linking to Run detail. Spec: `prototype/js/findings.js` `TimelineTab`, `prototype/js/metrics.js` time summary.
- **Touches:** apps/web
- **Depends on:** S-03-T7
- **Done when:** `pnpm --filter @pra/web test timeline-tab.test.tsx` passes: member, bot and hand entries show the right actor text; summary values match the API fixture.

### S-03-T12: Activity page with live in-progress runs
- **Goal:** Add route `/activity` with one In progress table (PR, run, current stage, started, cost so far) for running and queued runs, updated live, each row linking to Run detail, with an empty state. Alerts and Finished today come in S-18; Cancel comes in S-09. Spec: `prototype/js/pages.js` `ActivityPage`.
- **Touches:** apps/web
- **Depends on:** S-03-T8
- **Done when:** `pnpm --filter @pra/web test activity.test.tsx` passes: a change event updates a row's stage and cost without remounting the table.

### S-03-T13: End-to-end live progress check
- **Goal:** Playwright spec on the S-01/S-02 harness with test doubles (webhook signed with the test `GITHUB_WEBHOOK_SECRET`, an `AgentRunner` double that waits between stages) covering webhook → board, live stage and cost on the PR page and Activity, the stepper folding into the round line, Run detail and the Timeline tab.
- **Touches:** Playwright spec `live-progress.spec.ts` (next to the S-02 board spec)
- **Depends on:** S-03-T3, S-03-T9, S-03-T10, S-03-T11, S-03-T12
- **Done when:** `pnpm test:e2e live-progress.spec.ts` passes, including an assertion that the card is in Agents working less than 10 s after the webhook POST without a page reload (OQ18).

### S-03-T14: Reconcile poll and import of already-open PRs
- **Goal:** A pg-boss cron job every 10 minutes (OQ18) lists open PRs per connected repository through `GitHubGateway` and corrects what webhooks missed: new PRs, head SHAs, draft/ready, closed and merged state, CI status. Its first run after a repository is connected imports every already-open PR without starting any review (core rule: an empty board does not auto-review everything; a push never starts a review). Each correction is recorded with reason code `reconciled` and publishes the same change notification as a webhook (S-03-T1).
- **Touches:** apps/worker (cron job), packages/integrations (`GitHubGateway.listOpenPullRequests`), packages/db (idempotent upserts)
- **Depends on:** S-03-T1
- **Done when:** `pnpm --filter @pra/worker test reconcile.test.ts` passes with a `GitHubGateway` double: 3 open PRs unknown to the DB are imported with zero runs created; a PR closed while webhooks were down is marked closed and its active run cancelled per FR-023 rules; a second poll with no changes writes nothing.

## S-04: round-checks-and-change-type

A round runs Checks (CI status and install in an isolated sandbox) and sets the change type from path and size rules plus the judge before the review. Roadmap: [S-04](roadmap.md#s-04-round-checks-and-change-type)
**Slice check:** `pnpm test:e2e checks-change-type.spec.ts` passes: a level-2 round shows Checks → Task → Change type → Review in the stepper, Run detail shows CI counts, the install result and the change type with its reason, and an oversized PR shows the large-PR warning.

### S-04-T1: Sandbox interface and rootless Docker adapter
- **Goal:** Add `Sandbox` to packages/integrations: `run({image, command, mounts, workdir, limits: {cpus, memoryMb, pids, timeoutMs}, signal})` → `{exitCode, outputTail, timedOut, durationMs}`, with a Docker adapter that starts a throwaway container labelled `pra.sandbox=1` on the daemon at `SANDBOX_DOCKER_HOST` (rootless socket; unset = local Docker) with `--network none`, `--read-only`, tmpfs `/tmp`, a non-root user, `--cap-drop ALL`, `no-new-privileges`, mounts read-only unless marked writable, an empty environment except an explicit allow-list, gVisor (`runsc`) when the daemon has it, and kill on timeout or abort. It is called by the worker and never runs inside an agent's container; with no reachable Docker it throws `sandbox_not_configured`.
- **Touches:** packages/integrations (`src/sandbox/`)
- **Depends on:** S-01 done
- **Done when:** `pnpm --filter @pra/integrations test sandbox.docker.test.ts` passes where Docker is available (CI's Ubuntu runner; skipped with a printed reason otherwise): a script's `fetch('https://example.com')` fails; writing to a read-only mount fails; a busy loop is killed at the time limit with `timedOut: true`; aborting the signal leaves no container (`docker ps -a --filter label=pra.sandbox` is empty); the container sees no variable outside the allow-list (no `ANTHROPIC_API_KEY`, no GitHub token).

### S-04-T2: Install a PR's dependencies inside the sandbox
- **Goal:** Add `installDependencies(worktree, repoConfig)`: a fetch step runs RepositoryConfig `fetchCommand` (WB: `pnpm fetch --frozen-lockfile --ignore-scripts`) in a sandbox container that may reach the package registry but runs no PR code and gets no credentials, then the install step runs `installCommand` (WB: `pnpm install --offline --frozen-lockfile`) under `--network none` with only the run's throwaway worktree writable (never the bare mirror). Add both fields to RepositoryConfig and the WB seed.
- **Touches:** packages/integrations (sandbox), packages/db (RepositoryConfig fields, WB seed)
- **Depends on:** S-04-T1
- **Done when:** `pnpm --filter @pra/integrations test install.test.ts` passes on a fixture repo with one dependency and a `postinstall` that tries `fetch` and records the outcome: install succeeds offline, `node_modules` exists in the worktree, and the postinstall recorded a failed network call; the WB seed sets both commands.

### S-04-T3: Checks stage with CI status from GitHub
- **Goal:** Add `GitHubGateway.getCiStatus(repo, sha)` (check runs plus combined commit status → passed/failed/pending counts) and a Checks stage in the run state machine, on at level ≥2 and first in the round: it stores CI counts and the install result (exit code and log tail as stage output, full log in BlobStore). A failed install is a Checks result, not a stage failure; an unreachable sandbox or a GitHub error fails the stage with a reason code.
- **Touches:** packages/integrations (GitHubGateway), apps/worker
- **Depends on:** S-04-T2
- **Done when:** `pnpm --filter @pra/integrations test github.ci.test.ts` (HTTP double maps check runs and statuses) and `pnpm --filter @pra/worker test checks-stage.test.ts` pass: level 2 runs Checks before Task and stores counts and install result; level 1 plans no Checks stage; a `Sandbox` double throwing `sandbox_not_configured` fails the stage with that reason.

### S-04-T4: Judge adapter
- **Goal:** Add the `judge` role adapter to packages/agents using the Anthropic TS SDK with structured output (JSON schema: change type and reason), default model `claude-haiku-5-5`, instructions from version 1 of `prompt-classifier.md` and `classify-rules.md` (copied from `~/Projects/wb-factory/knowledge` as S-01 did for the reviewer), session logged with its tokens and real cost; without `ANTHROPIC_API_KEY` it fails with `model_access_not_configured`.
- **Touches:** packages/agents
- **Depends on:** S-01 done
- **Done when:** `pnpm --filter @pra/agents test judge.test.ts` passes with an SDK client double: valid output is parsed; malformed output raises a typed error; the session log carries tokens and cost; a missing key yields `model_access_not_configured`.

### S-04-T5: Change type stage, tier limits and large-PR flag
- **Goal:** Add the Change type stage (level ≥2, after Task): core `classify` from RepositoryConfig rules (composes / behaviour / one-way paths, size threshold) and changed lines sets the floor; the judge runs only when the floor can still be raised and core `raise` applies it (never lower); a type forced by a person (`prs.forced_change_type`) wins and skips the judge; core `enforce` applies the tier's limits to the Review output and records what was dropped; `large_pr` is set when changed lines exceed RepositoryConfig `largePrLines` (OQ14). Seed WB's rules from `~/Projects/wb-factory/knowledge/review-profiles.json` and a WB line threshold.
- **Touches:** apps/worker, packages/db (column, RepositoryConfig fields, WB seed)
- **Depends on:** S-04-T3, S-04-T4
- **Done when:** `pnpm --filter @pra/worker test change-type-stage.test.ts` passes with a judge double: a one-way path gives One-way door with no judge call; the judge raising Uses existing parts → Changes behaviour is applied; a lower judge answer is ignored; a forced type wins and the judge is not called; findings over the tier limit are dropped after Review with the count stored; `large_pr` is set above the threshold only.

### S-04-T6: Show Checks, change type and the large-PR warning
- **Goal:** Expose change type (with whether the judge raised it or a person forced it), CI counts, install result and `large_pr` on the PR summary, add unsigned `PUT /api/prs/:id/change-type` to force a type (FR-030), render the Checks and Change type outputs in the stepper and Run detail, and show the change type as plain grey text plus, for a large PR, a warning that suggests splitting it.
- **Touches:** apps/api, apps/web
- **Depends on:** S-04-T5, S-03 done (stepper and Run detail)
- **Done when:** `pnpm --filter @pra/api test change-type-route.test.ts` (a forced type is stored and recorded "by hand" on the timeline) and `pnpm --filter @pra/web test checks-output.test.tsx large-pr.test.tsx` pass.

### S-04-T7: End-to-end Checks and change type
- **Goal:** Playwright spec with GitHub, `Sandbox` and judge doubles: a level-2 round shows Checks → Task → Change type → Review in order, Run detail shows CI counts and install result, the PR page shows the change type, and an oversized fixture shows the large-PR warning.
- **Touches:** Playwright spec `checks-change-type.spec.ts`
- **Depends on:** S-04-T6
- **Done when:** `pnpm test:e2e checks-change-type.spec.ts` passes.

### S-04-T8: Real Checks and judge on a WB PR (Needs Alek)
- **Goal:** Prove the real sandbox, the real CI read and the real judge on one WB PR.
- **Touches:** local environment, GitHub App settings
- **Depends on:** S-04-T7
- **Done when:** Run detail of a real WB round at level 2 shows CI counts equal to GitHub's Checks tab, install exit 0, a change type with a judge session and its cost, and `docker ps -a --filter label=pra.sandbox` prints no container.
- **Steps for Alek:**
  1. Start Docker Desktop. On a Linux host instead, use rootless Docker (as in F-04) and set `SANDBOX_DOCKER_HOST` in `.env` to its socket; on macOS leave it unset.
  2. Open the GitHub App `pr-review-agent` settings (where it was created in S-01: Settings → Developer settings → GitHub Apps → `pr-review-agent` → Permissions & events). Under Repository permissions set "Checks: Read-only" and "Commit statuses: Read-only". Save.
  3. As the org owner, open Organization → Settings → GitHub Apps → `pr-review-agent` and accept the new permissions request.
  4. Check `.env` still has `ANTHROPIC_API_KEY` (from S-01).
  5. Run `docker compose up -d db`, `pnpm db:migrate`, the WB seed command, then start api, worker and web as in the S-01 smoke task.
  6. Start a round at level 2 or higher on an open WB PR: if S-07 is done, use Start review ▾ → level 2 → Start review; otherwise mark a draft PR "Ready for review" in GitHub, which uses WB's default level from the seed (it must be 2 or higher).
  7. When the round finishes, open the PR page → round line → Run detail. Compare the Checks stage's CI counts with the PR's Checks tab in GitHub, and confirm install exit 0 and a Change type stage with a judge session and a cost.
  8. Run `docker ps -a --filter label=pra.sandbox` and confirm it lists nothing.
  9. Note for the record: on macOS this proves `--network none` only; isolation on the Linux host is re-verified in F-04.

### S-04-T9: Re-verify sandbox isolation on the Linux host (Needs Alek)
- **Goal:** Prove NFR Isolation where it can be proven, since macOS proves only `--network none` (tech-stack.md flag 6).
- **Touches:** the VM
- **Depends on:** S-04-T8, F-04 done (hosted Linux host)
- **Done when:** the Sandbox isolation tests added in S-04 pass on the VM under rootless Docker with the `runsc` runtime, and `docker info` (rootless) lists `runsc`.
- **Steps for Alek:**
  1. On the VM, as a dedicated user, install rootless Docker: `dockerd-rootless-setuptool.sh install`.
  2. Install gVisor (`runsc`), register it as a runtime in that daemon's `daemon.json`, and restart the rootless daemon.
  3. Point the worker at the rootless Docker socket, as S-04's Sandbox setup describes, and restart the worker.
  4. Run S-04's isolation test command on the VM. It checks: no network, no env secrets, a read-only repo mount, and CPU, memory and time limits.
  5. Send the test output to the orchestrator.

## S-05: verified-findings

At level 3 and above each finding gets a verdict (Confirmed, Refuted, Not proven) with checked quotes and a sandboxed reproduction result. Roadmap: [S-05](roadmap.md#s-05-verified-findings)
**Slice check:** `pnpm test:e2e verified-findings.spec.ts` passes: a level-3 round shows each finding with its verdict, verbatim quotes and repro exit code, and a level-2 round shows "Unchecked (level 2)" on every finding.

### S-05-T1: Verifier adapter
- **Goal:** Add the `verifier` role adapter (Claude Agent SDK, default `claude-sonnet-5-5`) with read-only tools in the run's worktree (Read, Grep, Glob; no shell, no edits, no MCP, no settings sources); its input is the finding's title, file, line and scenario plus the diff and task, never the reviewer's suggestion or any patch; its output schema is verdict, reason, evidence quotes `{file, quote}` and an optional `.mjs` reproduction that exits 0 when the bug shows and 3 when it does not, with a `repair(script, output)` call for the one repair attempt. Instructions are version 1 of `prompt-verifier.md` and `verify-rules.md`.
- **Touches:** packages/agents
- **Depends on:** S-01 done
- **Done when:** `pnpm --filter @pra/agents test verifier.test.ts` passes: the prompt built for a finding with a suggestion contains none of the suggestion text; the allowed tool list is exactly Read, Grep, Glob; malformed output raises a typed error; the session is logged with its cost.

### S-05-T2: Verify stage with quote check and sandboxed reproduction
- **Goal:** Add the Verify stage (level ≥3, current round only): run the verifier per finding, keep only quotes found word for word in the file at the reviewed SHA (core quote check; none left → Not proven), run the reproduction in `Sandbox` (`--network none`, worktree and script mounted read-only, 5-minute limit) and apply core rules: exit 0 → Confirmed, 3 → Refuted, anything else → one `repair` and rerun, still anything else → Not proven; the script result beats the verifier's verdict. Store verdict, kept quotes, script, exit code and output tail (full output in BlobStore).
- **Touches:** apps/worker
- **Depends on:** S-05-T1, S-04 done
- **Done when:** `pnpm --filter @pra/worker test verify-stage.test.ts` passes with verifier and `Sandbox` doubles: exit 0 gives Confirmed even when the verifier said Refuted; exit 3 gives Refuted; exit 1 then a repaired exit 0 gives Confirmed after exactly 2 sandbox runs; exit 1 twice gives Not proven; a quote absent from the file is dropped; earlier rounds' findings are untouched; a level-2 run plans no Verify stage.

### S-05-T3: Show verdicts and evidence on findings
- **Goal:** Return verdict, quotes (file, line, text), reproduction (exit code, output tail, repaired or not) and, below level 3, `unchecked: N` from the findings API, map verdicts into the core state input so Refuted findings leave "to decide", and show them on the Findings tab: verdict as plain text, quotes as code, reproduction under technical details, "Unchecked (level N)" below level 3. Spec: `prototype/js/findings.js` `VerdictBadge`, `Finding`.
- **Touches:** apps/api, apps/web
- **Depends on:** S-05-T2
- **Done when:** `pnpm --filter @pra/api test findings-verdicts.test.ts` (a Refuted Blocking finding is not counted in "Decide N findings") and `pnpm --filter @pra/web test finding-evidence.test.tsx` (Confirmed with repro exit 0, Not proven without quotes, "Unchecked (level 2)") pass.

### S-05-T4: End-to-end verified findings
- **Goal:** Playwright spec with verifier and `Sandbox` doubles covering a level-3 round (one finding each Confirmed, Refuted, Not proven with evidence) and a level-2 round (Unchecked).
- **Touches:** Playwright spec `verified-findings.spec.ts`
- **Depends on:** S-05-T3
- **Done when:** `pnpm test:e2e verified-findings.spec.ts` passes.

### S-05-T5: Real verified round on a WB PR (Needs Alek)
- **Goal:** Prove the real verifier and real reproductions on one WB PR and record what a level-3 round costs.
- **Touches:** local environment
- **Depends on:** S-05-T4, S-04 done (set WB to level 3 with the S-01 seed command; the level picker arrives in S-07)
- **Done when:** a real WB round at level 3 shows a verdict on every finding, at least one quote that exists verbatim in the file on GitHub at the reviewed SHA, a Verify stage with per-session costs in Run detail, and no leftover `pra.sandbox` container.
- **Steps for Alek:**
  1. Make sure S-04-T8 worked (Docker running, install exit 0 on WB).
  2. Start api, worker and web as in the S-01 smoke task.
  3. Open an open WB PR in the app → Start review ▾ → Review level 3 → Start review.
  4. When the round finishes, open the Findings tab and check every finding shows Confirmed, Refuted or Not proven.
  5. For one Confirmed finding, open the quoted file on GitHub at the reviewed SHA (shown on the round line) and confirm the quote is there word for word.
  6. Open Run detail → Verify stage and note the total Verify cost; send it to the orchestrator for the log.
  7. Run `docker ps -a --filter label=pra.sandbox` and confirm it lists nothing.

## S-06: clickup-task-context

The PR is linked to its ClickUp task (ID in branch or title, search as fallback), the reviewer gets the task as context, the author can be notified with a ClickUp comment, and deferred findings get follow-up tasks. Roadmap: [S-06](roadmap.md#s-06-clickup-task-context)
**Slice check:** `pnpm test:e2e clickup-link.spec.ts` passes with a `ClickUpGateway` double: a PR whose branch carries a task ID shows the linked task and Run detail's Task stage shows its text, a finding deferred to ClickUp shows its follow-up task, and a PR without a task can be linked by hand.

### S-06-T1: ClickUpGateway interface and adapter
- **Goal:** Add `ClickUpGateway` to packages/integrations with `getTask(id)` (custom or default IDs), `findTaskMentioningPr(prUrl)` (search fallback as in `~/Projects/wb-factory/src/clickup.ts` `findTaskUrl`), `createComment(taskId, text, mentionUserId)` and `createTask(listId, {name, description, parentId?})`, plus an HTTP adapter reading `CLICKUP_API_KEY`. Without the key, or for a repository without ClickUp settings, every call returns `clickup_not_configured`.
- **Touches:** packages/integrations (`src/clickup/`)
- **Depends on:** S-01 done
- **Done when:** `pnpm --filter @pra/integrations test clickup.test.ts` passes against an HTTP double: each method sends the expected request and maps the response; a 401 maps to `clickup_auth_failed`; a missing key returns `clickup_not_configured` without any request.

### S-06-T2: Task ID matching and repository ClickUp settings
- **Goal:** Add `findTaskId(branch, title, pattern)` to packages/core (pattern from RepositoryConfig, e.g. `WB-\d+` or `CU-[a-z0-9]+`), add RepositoryConfig `clickup` (workspace ID, follow-up list ID, task ID pattern; absent = ClickUp off for that repo), a `pr_task_links` table (pr, task ID, URL, name, how: branch/title/search/hand, by), and flags `--clickup-workspace`, `--clickup-list`, `--clickup-task-pattern` on the WB seed command.
- **Touches:** packages/core, packages/db
- **Depends on:** S-01 done
- **Done when:** `pnpm --filter @pra/core test task-id.test.ts` passes (branch wins over title, case-insensitive, no false match inside other words) and running the WB seed with the three flags stores them in RepositoryConfig (asserted in `pnpm --filter @pra/db test seed-clickup.test.ts`).

### S-06-T3: Task stage links the PR and gives the task to the reviewer
- **Goal:** In the Task stage, link the PR by task ID from branch or title, else by search for a task mentioning the PR URL (OQ8), store the link, and pass the task's name, description and status to the reviewer as context (FR-029). A repository without ClickUp records "ClickUp not configured for this repository" and continues; no task found records "No ClickUp task linked" and continues; a ClickUp API error fails the stage so Retry is offered.
- **Touches:** apps/worker, packages/agents (reviewer input)
- **Depends on:** S-06-T1, S-06-T2
- **Done when:** `pnpm --filter @pra/worker test task-stage.test.ts` passes with a gateway double: an ID in the branch links without a search call; no ID links by search; the reviewer double receives the task description; a repo without ClickUp settings and a PR with no task both complete the round; a 500 from ClickUp fails the Task stage with `clickup_error`.

### S-06-T4: Link a task by hand and show the task on the PR page
- **Goal:** Add unsigned `PUT /api/prs/:id/task-link {taskIdOrUrl}` (validated with `getTask`, recorded "by hand" on the timeline, used by the next round) and show on the PR page the linked task (name and ID, opening ClickUp), or "No ClickUp task linked" with "Link a ClickUp task" (Dialog with one input), or "ClickUp not configured for this repository".
- **Touches:** apps/api, apps/web
- **Depends on:** S-06-T1, S-06-T2
- **Done when:** `pnpm --filter @pra/api test task-link.test.ts` (unknown task → 422 with the reason; valid task stored with how = hand) and `pnpm --filter @pra/web test task-link.test.tsx` (three states render; the dialog submits) pass.

### S-06-T5: Follow-up task for each finding deferred to ClickUp
- **Goal:** When a Defer to ClickUp decision is saved (S-02), enqueue a pg-boss job keyed by decision ID that creates a follow-up task (in the linked task's list, else the repo's follow-up list) named after the finding, with file:line, scenario, suggestion and the GitHub PR link; store the task ID and URL on the decision and show "Deferred to ClickUp · <task>" on the finding. If ClickUp is off or the job fails, the finding shows why; an Undo before the job runs creates nothing (FR-042).
- **Touches:** apps/worker, apps/api (decision fields), apps/web (finding line)
- **Depends on:** S-06-T1, S-02 done
- **Done when:** `pnpm --filter @pra/worker test follow-up.test.ts` passes: one deferred finding → one `createTask` call; running the job twice still creates one task; an undone decision creates none; ClickUp off stores `clickup_not_configured` on the decision.

### S-06-T8: End-to-end task link, context and follow-up
- **Goal:** Playwright spec with a `ClickUpGateway` double: a PR whose branch has a task ID shows the task and Run detail's Task stage shows its text; a PR with no ID and no search hit shows "No ClickUp task linked" and links one by hand; a deferred finding shows its follow-up task.
- **Touches:** Playwright spec `clickup-link.spec.ts`
- **Depends on:** S-06-T3, S-06-T4, S-06-T5
- **Done when:** `pnpm test:e2e clickup-link.spec.ts` passes.

### S-06-T9: Real ClickUp key, WB IDs and smoke (Needs Alek)
- **Goal:** Connect the real ClickUp workspace for WB and prove link, context, follow-up and author notice once.
- **Touches:** `.env`, WB RepositoryConfig, ClickUp
- **Depends on:** S-06-T8
- **Done when:** a real WB PR shows its linked ClickUp task, Run detail's Task stage contains the task's description, a finding deferred to ClickUp has a follow-up task in the chosen list, and a Notify author comment on the task mentions the author and names the signer.
- **Steps for Alek:**
  1. Choose the ClickUp account that will own the key; comments and follow-up tasks appear under its name, so a shared service account is best. Log in to ClickUp as that account.
  2. Avatar (bottom left) → Settings → Apps → API Token → Generate, then copy the token.
  3. Add `CLICKUP_API_KEY` with that value to the gitignored `.env`. Never commit it.
  4. Workspace ID: open ClickUp in the browser; it is the first number in the URL (`app.clickup.com/<workspace ID>/…`).
  5. Follow-up list ID: open the list where follow-up tasks should go → the list's "…" menu → Copy link; the number after `/li/` is the list ID.
  6. Task ID format: check Workspace Settings → ClickApps → Custom Task IDs. Write down the format the team puts in branch names or PR titles (for example `WB-123`, or `CU-` plus the default ID) as a regular expression.
  7. Run the WB seed command (S-01) with `--clickup-workspace <workspace ID> --clickup-list <list ID> --clickup-task-pattern '<pattern>'`.
  8. In the app, Settings → Team: set the ClickUp user for every team member, including PR authors.
  9. Restart api and worker.
  10. Start a round on a WB PR whose branch or title has a task ID (mark a draft ready for review in GitHub, or Start review). Check the PR page shows the task and Run detail → Task stage shows its description.
  11. Defer one finding to ClickUp (signed) and check the follow-up task appears in the list from step 5.
  12. Give a signed review, click Notify author, and check the comment on the task mentions the author and names you. Delete the test follow-up task and comment afterwards if they are noise.

## S-07: manual-start-and-chains

Anyone can start a review by hand at a chosen level; later rounds start by themselves only on the exact expected head; new commits are counted; a chain stops after 3 rounds; a push during a running round changes nothing. Roadmap: [S-07](roadmap.md#s-07-manual-start-and-chains)
**Slice check:** `pnpm test:e2e chains.spec.ts` passes: Start review at level 3 starts a new chain "by hand"; an author push starts nothing and shows "2 new commits since last review" without Ready to merge; a push whose head equals the expected fix SHA starts round 2 as a fix check ending in "2 of 2 fixes resolved"; after 3 completed rounds the PR shows "Automatic rounds used (3 of 3)"; a push during a running round leaves it running and labels its result "Reviewed abc123 · 2 new commits since".

### S-07-T1: Chains and one round-start service
- **Goal:** Add chain fields (chain ID, round number in chain, trigger ready/hand/fix, fix SHA, reviewed SHA, level frozen at start, expected head SHA on the chain) and one `startRound({prId, trigger, level})` service in the worker that the ready webhook (refactored from S-01), manual start and fix pushes all use. A ready event or a manual start begins a new chain at round 1; counting completed rounds and the 3-round limit come from core; write timeline entries through `recordTimelineEntry` when S-03-T5 has landed (otherwise S-03-T5 adds this call site).
- **Touches:** packages/db (migration), apps/worker
- **Depends on:** S-02 done
- **Done when:** `pnpm --filter @pra/worker test chains.test.ts` passes: ready → chain round 1, trigger ready, level = repo default; the PR switched back to draft and ready again → a new chain; a failed or cancelled round does not raise the completed count; changing the PR's level mid-run does not change the running run's level.

### S-07-T2: Pushes count new commits and only a fix push starts the next round
- **Goal:** On `pull_request.synchronize`, update the head and compute commits since the last review with a new `GitHubGateway.compareCommits(base, head)`; if the head equals the chain's expected head SHA (set by the implementer push in S-14) and fewer than 3 rounds completed, start the next round as a fix check (trigger fix, fix SHA), otherwise start nothing (FR-016, FR-017, FR-018). A push during a running round never cancels it, and the finished round records the commits since its reviewed SHA (FR-020).
- **Touches:** apps/worker, packages/integrations (GitHubGateway)
- **Depends on:** S-07-T1
- **Done when:** `pnpm --filter @pra/worker test pushes.test.ts` passes: an author push starts no run and stores 2 commits since; head equal to the expected SHA starts round 2 of the same chain with trigger fix; a push on top of the agent's commit starts nothing; after 3 completed rounds a matching push starts nothing and core state is `rounds_used`; a push during a running round leaves it running and its result stores 2 commits since.

### S-07-T3: Rounds 2 and 3 check only the fixes
- **Goal:** Give the reviewer adapter a fix-check mode: input is the diff since the previous round's reviewed SHA plus the findings decided Implement; output is Resolved or Not resolved per finding with a short reason, and no new full review (FR-019). Round 1 of a new chain still does a full review and also reports Resolved / Not resolved for earlier Implement findings (US-05). Store the fix status per finding and round.
- **Touches:** packages/agents (reviewer prompt and schema), apps/worker (stage selection)
- **Depends on:** S-07-T1
- **Done when:** `pnpm --filter @pra/worker test fix-check.test.ts` passes with an `AgentRunner` double: round 2 calls the reviewer in fix-check mode with only the Implement findings and the diff since the previous round, writes no new findings and stores fix statuses; a new-chain round 1 after Implement decisions stores both new findings and fix statuses.

### S-07-T4: Manual start, PR level and head-aware PR summary
- **Goal:** Add unsigned `POST /api/prs/:id/start-review {level}` (timeline "Review started by hand"; 409 `run_active` with the reason while a run is queued or running), unsigned `PUT /api/prs/:id/level` (applies to the next round, FR-059), and PR summary fields: reviewed SHA, head, commits since, completed rounds in the chain, each finding's source SHA and commits behind (FR-045), fix status counts ("2 of 2 fixes resolved"). The state "new commits since last review" outranks open findings and removes Ready to merge (core).
- **Touches:** apps/api
- **Depends on:** S-07-T2, S-07-T3
- **Done when:** `pnpm --filter @pra/api test start-review.test.ts` passes: a start on a draft and on a ready-to-merge PR each create a new chain round 1 by hand; a second start while running returns 409 `run_active`; a level change leaves the running run unchanged; after a 2-commit push the summary has state `new_commits`, commits since 2 and findings marked from the reviewed SHA, 2 commits behind.

### S-07-T5: Start review control and head-moved banners
- **Goal:** Add "Start review ▾" to the header of every open PR (Popover with a level Select marking the repo default, Start review, hint "New chain, round 1 on abc123. Not signed.", disabled with the reason while a run is active), the banners "N new commits since last review (abc123)" and "Automatic rounds used (3 of 3)" with Start review, and the result label "Reviewed abc123 · 2 new commits since". Spec: `prototype/js/pr.js` `StartReview`.
- **Touches:** apps/web
- **Depends on:** S-07-T4
- **Done when:** `pnpm --filter @pra/web test start-review.test.tsx` passes: the popover posts the chosen level; the disabled state shows the reason; both banners render from fixtures with Start review as the main action.

### S-07-T6: Findings from earlier commits and fix results
- **Goal:** On the Findings tab show "from abc123 · N commits behind" when the head moved, keeping those findings usable for opinions and decisions, and show Resolved / Not resolved on Implement findings with the "2 of 2 fixes resolved" summary after a fix-check or new-chain round. Spec: `prototype/js/findings.js` `Finding` (`behind`).
- **Touches:** apps/web
- **Depends on:** S-07-T4
- **Done when:** `pnpm --filter @pra/web test stale-findings.test.tsx fix-status.test.tsx` passes.

### S-07-T7: End-to-end chains
- **Goal:** Playwright spec with webhook and `AgentRunner` doubles covering manual start, author push, a fix push on the expected head (seeded on the chain), the 3-round stop and a push during a running round.
- **Touches:** Playwright spec `chains.spec.ts`
- **Depends on:** S-07-T5, S-07-T6
- **Done when:** `pnpm test:e2e chains.spec.ts` passes.

## S-08: questions-and-signed-reviews

People answer the reviewer's questions, give signed opinions and signed reviews, see who usually decides, keep opinions across rounds, and keep reading current findings when a round finishes. Roadmap: [S-08](roadmap.md#s-08-questions-and-signed-reviews)
**Slice check:** `pnpm test:e2e questions-reviews.spec.ts notify-author.spec.ts` passes: Tomek saves 2 answers with one signature, marks 3 findings and saves "Tomek's review: 2 worth implementing, 1 not worth it"; each finding shows "Usually decided by: Kasia (author)"; the next round's reviewer double receives the answers, matching findings carry Tomek's opinions "from round 1", and the new findings appear only after "View new results".

### S-08-T1: Answers with one signature
- **Goal:** Store questions and their 2–3 options (one recommended) as rows if S-01 kept them only in the run output, add `answers` (question, option or own text, signer, saved at), and add `POST /api/prs/:id/answers {answers[], signerId}` that saves all answers in one transaction under one signature with a timeline entry (FR-034). Saving over an answer someone else saved since the page loaded returns 409 naming them (NFR Concurrent edits).
- **Touches:** packages/db, apps/api
- **Depends on:** S-07 done
- **Done when:** `pnpm --filter @pra/api test answers.test.ts` passes: two answers saved with one signer in one transaction; an own-text answer is accepted; a missing signer returns 400; a save over a newer answer returns 409 with the earlier signer; the PR state leaves `questions_waiting`.

### S-08-T2: Questions tab
- **Goal:** Fill the Questions tab: a RadioGroup per question with the recommended option marked and an "Own answer" Textarea, the signature picker, and "Save N answers"; answered questions show the answer and who gave it. Spec: `prototype/js/findings.js` `QuestionsTab`.
- **Touches:** apps/web
- **Depends on:** S-08-T1
- **Done when:** `pnpm --filter @pra/web test questions-tab.test.tsx` passes: save is enabled only when every question has an answer and a signer; a 409 shows who answered first.

### S-08-T3: Earlier answers reach every later round
- **Goal:** Pass every earlier answer on the PR (question, chosen option or own text, who) to the reviewer of every later round, in fix checks and in new chains (FR-035).
- **Touches:** apps/worker, packages/agents (reviewer input)
- **Depends on:** S-08-T1
- **Done when:** `pnpm --filter @pra/worker test answers-context.test.ts` passes: the round-2 and new-chain round-1 reviewer doubles receive the round-1 answers; a PR without answers adds nothing.

### S-08-T4: Signed opinions and signed reviews
- **Goal:** Add `opinions` (finding, signer, worth / not worth, comment, review, from round) and `reviews` (PR, signer, counts, at), and `POST /api/prs/:id/reviews {opinions[], signerId}` that saves one or many opinions as one signed review summarised "Tomek's review: 2 worth implementing, 1 not worth it" (FR-037, FR-038). A signer's newer opinion on a finding replaces only their own; other people's opinions stay; nits may get opinions.
- **Touches:** packages/db, apps/api
- **Depends on:** S-07 done
- **Done when:** `pnpm --filter @pra/api test reviews.test.ts` passes: 3 opinions → one review with counts 2/1; two people's opinions on one finding are both listed with names; two concurrent saves by different signers both persist.

### S-08-T5: Who usually decides
- **Goal:** Add `usuallyDecidedBy(pr, team)` to packages/core (the author's Team member by GitHub login, else the author's login) and return it for every finding to decide; store the author on each decision so a decision by someone else reads "Rejected by Tomek (author: Kasia)" (FR-041).
- **Touches:** packages/core, apps/api
- **Depends on:** S-07 done
- **Done when:** `pnpm --filter @pra/core test usually-decides.test.ts` and `pnpm --filter @pra/api test decision-label.test.ts` pass (signer ≠ author gives both names; signer = author gives one).

### S-08-T6: Opinions and review tray on the Findings tab
- **Goal:** Add Worth implementing / Not worth it with an optional comment on every finding, the review tray "Your review: 3 opinions" with Save review… (Dialog with signature), opinions listed under each finding with names, comments and "from round N", the "Usually decided by: Kasia (author)" line, and decision labels with both names. Spec: `prototype/README.md` flow B, `prototype/js/findings.js` `Finding`, `FindingsTab`.
- **Touches:** apps/web
- **Depends on:** S-08-T4, S-08-T5
- **Done when:** `pnpm --filter @pra/web test opinions.test.tsx review-tray.test.tsx` passes.

### S-08-T7: Carry opinions to the matching finding in the next round
- **Goal:** Add `matchFinding(previous, next)` to packages/core (same file and same content by normalised title and scenario, line number ignored) and, when a round completes, copy each opinion to the matching new finding marked "from round N" (FR-043).
- **Touches:** packages/core, apps/worker
- **Depends on:** S-08-T4
- **Done when:** `pnpm --filter @pra/core test finding-match.test.ts` (moved lines still match; same content in another file does not; reworded beyond the threshold does not) and `pnpm --filter @pra/worker test carry-opinions.test.ts` (opinions copied with from round 1, originals untouched, rerunning creates no duplicates) pass.

### S-08-T8: View new results
- **Goal:** Pin the findings list to the round the reader is looking at: when a newer round finishes (SSE or refetch), the banner, checklist and stepper update at once, a strip "New results from round 2 · View new results" appears, and the findings switch only on click, keeping selection and open dialogs (FR-044, NFR Live view).
- **Touches:** apps/web
- **Depends on:** S-07 done
- **Done when:** `pnpm --filter @pra/web test view-new-results.test.tsx` passes: after a new-round event the banner text changes, the findings list does not, and clicking the strip shows the new findings.

### S-08-T9: End-to-end questions and signed reviews
- **Goal:** Playwright spec with `AgentRunner` doubles following `prototype/README.md` flow B steps 1–2, then a second round that carries opinions over and holds new results behind "View new results".
- **Touches:** Playwright spec `questions-reviews.spec.ts`
- **Depends on:** S-08-T2, S-08-T3, S-08-T6, S-08-T7, S-08-T8
- **Done when:** `pnpm test:e2e questions-reviews.spec.ts` passes.

### S-08-T10: Notify author API
- **Goal:** Add `GET /api/prs/:id/notify-author/preview?reviewId=` returning the exact comment text (core `notifyText`, e.g. "@Kasia: Tomek marked 2 findings as worth implementing and 1 finding as not worth it in PR #272") and `POST /api/prs/:id/notify-author {reviewId}` that posts it on the linked task, mentioning the author's ClickUp user from Team and naming the review's signer, once per review, with a timeline entry "Notified Kasia in ClickUp (WB-123)" (FR-039). No linked task → 409 `no_linked_task`; author without a ClickUp user in Team → 409 `author_has_no_clickup_user`.
- **Touches:** packages/core (`notifyText`), apps/api
- **Depends on:** S-08-T4, S-06 done
- **Done when:** `pnpm --filter @pra/api test notify-author.test.ts` passes: preview text equals the posted text; a second POST for the same review makes no second call; both 409 reasons are returned without calling the gateway.

### S-08-T11: Notify author card
- **Goal:** After a signed review, show a card under the banner that previews the exact ClickUp comment with Notify author and Not now (hides the card); if the PR has no linked task, the card shows the reason and "Link a ClickUp task" (opens the S-06 link dialog) (OQ12). Spec: `prototype/js/pr.js` `NotifyCards`.
- **Touches:** apps/web, Playwright spec `notify-author.spec.ts`
- **Depends on:** S-08-T6, S-08-T10
- **Done when:** `pnpm test:e2e notify-author.spec.ts` passes with a `ClickUpGateway` double: a signed review shows the card with the exact text, Notify author makes one `createComment` call and the card disappears; an unlinked PR shows the reason and "Link a ClickUp task".

## S-09: retry-and-cancel

A failed round is retried from the failed stage reusing earlier results; a queued or running round or implementer can be cancelled and spend stops at once; closing a PR cancels its run; a restart leaves nothing stuck. Roadmap: [S-09](roadmap.md#s-09-retry-and-cancel)
**Slice check:** `pnpm test:e2e retry-cancel.spec.ts` and `pnpm --filter @pra/worker test durability.test.ts` pass: Retry from Review reruns Review with earlier stages marked "reused from the failed round" under the same round number; Cancel on the PR page and in Activity stops the running double at once and records partial cost; a close webhook cancels the active run; a worker killed mid-stage and restarted leaves no run "running".

### S-09-T1: Retry from the failed stage
- **Goal:** Add `retryRun(runId)`: a new attempt row for the same round (same chain, round number, level and reviewed SHA) linked by `retry_of`, with succeeded stages copied and marked `reused_from_stage_id`, and jobs enqueued for the failed stage and the ones after it (FR-024). The failed attempt never counts toward the chain and keeps its cost; stage jobs have pg-boss `retryLimit: 0`, so nothing retries by itself.
- **Touches:** apps/worker, packages/db (columns)
- **Depends on:** S-03 done
- **Done when:** `pnpm --filter @pra/worker test retry.test.ts` passes: with Review failed, retry makes no `AgentRunner` or `Sandbox` calls for the earlier stages, reruns Review and the stages after it, keeps the round number, and the completed count rises by one only when the retry completes; the failed attempt's cost is unchanged.

### S-09-T2: Retry button and reused-stage marks
- **Goal:** Add unsigned `POST /api/runs/:id/retry` (409 unless the run failed; timeline "Retry from Review started by hand"), make "Retry from <stage>" the Stage failed banner's main action with the failure text ("Review stage timed out after 30 min. This round is not counted"), and in Run detail mark reused stages "reused from the failed round" and show the failed run's cost up to the failure.
- **Touches:** apps/api, apps/web
- **Depends on:** S-09-T1
- **Done when:** `pnpm --filter @pra/api test retry-route.test.ts` and `pnpm --filter @pra/web test retry-banner.test.tsx run-detail-reused.test.tsx` pass.

### S-09-T3: Cancel that stops spend at once
- **Goal:** Keep an AbortController per active run in the worker; the api sets a run to `cancelling` and the worker hears it on the S-03 change channel, aborts in-flight `AgentRunner` sessions and `Sandbox` containers through the signal, cancels the run's pending pg-boss jobs, and marks the run `cancelled` once in-flight sessions have saved their partial cost (FR-022, NFR Cancel really stops, NFR Cost truth). Every result write goes through a guard that refuses writes for cancelled runs; a queued run is cancelled without starting anything; cancelled rounds do not count. The mechanism is per run, not per kind, so S-13's implementer runs use it unchanged.
- **Touches:** apps/worker, packages/agents (AbortSignal through `AgentRunner` if missing)
- **Depends on:** S-03 done
- **Done when:** `pnpm --filter @pra/worker test cancel.test.ts` passes: with a streaming `AgentRunner` double, cancelling during turn 2 aborts it within 1 s; the session keeps the cost of turns 1–2 (more than 0, less than a full run); nothing is written after cancel even when the double resolves late; the run's remaining stage jobs are gone from pg-boss; a cancelled queued run never calls `AgentRunner`.

### S-09-T4: Cancel controls
- **Goal:** Add unsigned `POST /api/runs/:id/cancel` (timeline "Cancelled by hand · $1.12 spent"), make Cancel the banner's main action while a round is queued or running (and while fixing, once S-13 exists), and add Cancel to the Activity In progress rows.
- **Touches:** apps/api, apps/web
- **Depends on:** S-09-T3
- **Done when:** `pnpm --filter @pra/api test cancel-route.test.ts` (409 for a finished run) and `pnpm --filter @pra/web test cancel-button.test.tsx` pass.

### S-09-T5: Cancel when the PR closes
- **Goal:** On `pull_request.closed` (merged or not), cancel the PR's active or queued run as pr-review-agent with the timeline entry "Run cancelled: PR closed" and no GitHub comment (FR-023).
- **Touches:** apps/worker (webhook handling)
- **Depends on:** S-09-T3
- **Done when:** `pnpm --filter @pra/worker test close-cancels.test.ts` passes: a close during Review aborts the double and the run ends `cancelled` with actor bot; a close with no active run does nothing.

### S-09-T6: Nothing stuck after a restart
- **Goal:** On worker start, sweep stages marked running that have no live pg-boss job and mark them failed with `interrupted_by_restart` (Retry is offered), leave queued rounds queued, and set pg-boss job expiry to each stage's timeout as a backstop (NFR Durability).
- **Touches:** apps/worker
- **Depends on:** S-09-T1
- **Done when:** `pnpm --filter @pra/worker test durability.test.ts` passes: it starts the worker as a child process with a test bootstrap whose `AgentRunner` double blocks in Review, kills it with SIGKILL, restarts it, and within 10 s the stage is `failed` with `interrupted_by_restart`, no row is `running`, the session keeps its partial cost, and a round queued before the kill starts after the restart.

### S-09-T7: End-to-end retry and cancel
- **Goal:** Playwright spec with doubles: a Review stage failure → Retry from Review with reused stages marked; cancel from the PR page and from Activity; a close webhook cancels the active run.
- **Touches:** Playwright spec `retry-cancel.spec.ts`
- **Depends on:** S-09-T2, S-09-T4, S-09-T5
- **Done when:** `pnpm test:e2e retry-cancel.spec.ts` passes.

## S-10: pause-budget-and-queue

Pause with a reason and resume, set the daily budget and agent slots (default 2), and see rounds wait as Queued with the reason; no session starts over budget. Roadmap: [S-10](roadmap.md#s-10-pause-budget-and-queue)
**Slice check:** `pnpm test:e2e pause-budget.spec.ts` passes: Tomek pauses with "release freeze" (signed), a ready webhook shows "Queued: paused by Tomek (release freeze)", Resume (signed) starts the round by itself; with spend at the budget the next round shows "Queued: daily budget reached ($50 of $50)" and the `AgentRunner` double records no call; both changes appear as audit entries with before and after values.

### S-10-T1: Status, budget and audit data
- **Goal:** Add an `agent_status` single row (paused, paused by, reason, paused at, daily budget, agent slots default 2, time zone default Europe/Warsaw), an `audit_entries` table (at, signer, area, action, before, after; S-21 adds the Audit log page), and a `spentToday()` query summing session costs since local midnight (OQ9).
- **Touches:** packages/db
- **Depends on:** S-03 done
- **Done when:** `pnpm --filter @pra/db test status.test.ts` passes: the migration creates one status row with slots 2; `spentToday()` counts only sessions after local midnight in the configured zone (fixture across midnight).

### S-10-T2: Start gate in core
- **Goal:** Add `startGate({status, spentToday, activeRuns, kind: 'round' | 'session'})` to packages/core returning start or queued with a reason code: `paused` (new rounds only; running rounds finish), `budget_reached` (new rounds and every session), `slots_busy` with the busy PRs; params feed "Queued: paused by Tomek (release freeze)", "Queued: daily budget reached ($50 of $50)" and "both agent slots are busy (#270, #277)" (FR-021).
- **Touches:** packages/core
- **Depends on:** S-03 done
- **Done when:** `pnpm --filter @pra/core test start-gate.test.ts` passes for every reason and for a session inside a running round while paused (allowed).

### S-10-T3: Enforce the gate in the worker
- **Goal:** Before a round starts and before every agent session, take a Postgres advisory transaction lock, read status, spend and active runs, and either start (claiming a slot) or set the run `queued` with the reason; a drainer (woken by status-change notifications, a 1-minute pg-boss cron and local midnight) starts queued rounds oldest first; a running round that hits the budget waits before its next session (NFR Budget).
- **Touches:** apps/worker
- **Depends on:** S-10-T1, S-10-T2
- **Done when:** `pnpm --filter @pra/worker test budget-gate.test.ts` passes: 5 ready events with 2 slots → 2 running, 3 queued `slots_busy`, and finishing one starts the oldest; spend ≥ budget → 0 `AgentRunner` calls and runs queued `budget_reached`; pause lets running rounds finish and queues new ones; resume starts them by itself; 10 concurrent starts never exceed the slots.

### S-10-T4: Pause, resume, budget and slots API
- **Goal:** Add `POST /api/status/pause {reason, signerId}`, `POST /api/status/resume {signerId}`, `PUT /api/status/budget {dailyBudgetUsd, signerId}` and `PUT /api/status/slots {agentSlots, signerId}`, each signed, each writing an audit entry with before and after, each waking the drainer (FR-074); extend `GET /api/status` with paused by, reason, budget and spend today.
- **Touches:** apps/api
- **Depends on:** S-10-T1
- **Done when:** `pnpm --filter @pra/api test status-routes.test.ts` passes: every route without a signer returns 400; each change writes one audit entry with correct before/after; pause twice returns 409.

### S-10-T5: Status chip controls and Budget & status settings
- **Goal:** Extend the status chip with "Paused by Tomek (release freeze)" and "Daily budget reached" states and "$12.40 of $50 today" with a Progress bar, and its Popover with Pause (reason and signature), Resume (signature) and Change budget (signature); add Settings → General → Budget & status (`/settings/budget`) with daily budget and Agent slots (default 2) behind a signed save. Spec: `prototype/js/shell.js` `StatusChip`, `prototype/js/settings.js` `SetBudget`.
- **Touches:** apps/web
- **Depends on:** S-10-T4
- **Done when:** `pnpm --filter @pra/web test status-chip-controls.test.tsx budget-settings.test.tsx` passes.

### S-10-T6: Queued with the reason everywhere
- **Goal:** Show the Queued state with its reason in the banner ("Queued: …", main action points to Resume in the status chip), on the board card in Agents working, and in Activity's In progress rows.
- **Touches:** apps/web
- **Depends on:** S-10-T3, S-10-T4
- **Done when:** `pnpm --filter @pra/web test queued-banner.test.tsx` passes for paused, budget and slots fixtures.

### S-10-T7: End-to-end pause, budget and queue
- **Goal:** Playwright spec with webhook and `AgentRunner` doubles covering pause → queued → resume → start, budget reached → queued with no agent call, and the audit entries.
- **Touches:** Playwright spec `pause-budget.spec.ts`
- **Depends on:** S-10-T5, S-10-T6
- **Done when:** `pnpm test:e2e pause-budget.spec.ts` passes.

## S-11: sensitive-files-approval

Changed files that match the repository's sensitive (one-way) paths need a human OK: approve unsigned ("Approved by hand") or send back signed, and the PR's state and checklist respect it. Roadmap: [S-11](roadmap.md#s-11-sensitive-files-approval)
**Slice check:** `pnpm test:e2e sensitive-files.spec.ts` passes: a PR touching 2 sensitive files shows "Approve changes to 2 sensitive files"; Approve records "Approved by hand" and the checklist row passes; on another PR Send back (signed) shows "Sent back by Tomek: Kasia changes 2 sensitive files" and the author's next push resets the files to pending.

### S-11-T1: Sensitive files per PR
- **Goal:** Add a `sensitive_files` record per PR (paths, matched pattern, status pending/approved/sent back, by, comment, at, head SHA) filled when a round completes by matching changed files against RepositoryConfig one-way paths (core glob matcher; add it if F-03 did not port one), reset from sent back to pending on the author's next push, with newly matching files added as pending; feed it into the core state and checklist inputs.
- **Touches:** packages/core, packages/db, apps/worker
- **Depends on:** S-02 done, S-04 done
- **Done when:** `pnpm --filter @pra/worker test sensitive-files.test.ts` passes: a round on a PR touching one one-way path creates one pending file; once findings are decided the state is `sensitive_files`; after approval the checklist row passes; sent back plus a push gives pending.

### S-11-T2: Approve and send back API
- **Goal:** Add unsigned `POST /api/prs/:id/sensitive/approve` ("Approved by hand") and signed `POST /api/prs/:id/sensitive/send-back {comment, signerId}` ("Sent back by Tomek: Kasia changes 2 sensitive files"), both carrying the version the person saw and returning 409 if it changed, with timeline entries; the PR summary lists the files, their status and the checklist row "Sensitive files approved" with its reason (FR-046).
- **Touches:** apps/api
- **Depends on:** S-11-T1
- **Done when:** `pnpm --filter @pra/api test sensitive.test.ts` passes: approve without a signer works and records hand; send back without a comment or signer returns 400; a stale version returns 409.

### S-11-T3: Sensitive files on the PR page
- **Goal:** Show the banner "Approve changes to 2 sensitive files" with Approve changes (unsigned) and Send back… (Dialog with comment and signature), the list of files with the pattern each matched, and the sent-back banner text. Spec: `prototype/README.md` flow B step 6, `prototype/js/sim.js` `nextStep` case `sensitive`.
- **Touches:** apps/web
- **Depends on:** S-11-T2
- **Done when:** `pnpm --filter @pra/web test sensitive-banner.test.tsx` passes for pending, approved and sent-back fixtures.

### S-11-T4: End-to-end sensitive files
- **Goal:** Playwright spec with doubles covering approve, send back and the reset on the next push.
- **Touches:** Playwright spec `sensitive-files.spec.ts`
- **Depends on:** S-11-T3
- **Done when:** `pnpm test:e2e sensitive-files.spec.ts` passes.

## S-12: merge-from-app

The merge checklist shows failing rows only (or one green line), a green PR merges by typing its number and signing (squash pinned to the reviewed SHA, re-checked against fresh GitHub state), and Ready to merge disappears when the head moves. Roadmap: [S-12](roadmap.md#s-12-merge-from-the-app)
**Slice check:** `pnpm test:e2e merge.spec.ts` passes with a GitHub double: a green PR shows "Checklist green at abc123", Merge #N… needs the typed number and a signature, the double receives a squash merge with `sha` = reviewed SHA and a body ending in `Signed-off-in-app-by: Kasia`, the PR leaves the board; a refusal shows GitHub's reason; a push removes Ready to merge.

### S-12-T1: GitHub merge and fresh-state reads
- **Goal:** Add to `GitHubGateway`: `getPullRequestState(repo, number)` (head SHA, open/merged, mergeable state), `listChangesRequested(repo, number)` (reviewers whose latest review is CHANGES_REQUESTED), `getCiStatus` if S-04 has not added it, and `squashMerge({repo, number, sha, title, message})` returning merged with the commit SHA or refused with GitHub's status and message.
- **Touches:** packages/integrations
- **Depends on:** S-02 done
- **Done when:** `pnpm --filter @pra/integrations test github.merge.test.ts` passes against an HTTP double: the request has `merge_method: "squash"` and `sha`; a 405 with "Required status check … is expected" maps to refused with that message; a later APPROVED from the same reviewer clears their changes request.

### S-12-T2: Merge service and route
- **Goal:** Add `POST /api/prs/:id/merge {typedNumber, signerId}`: the typed number must match; fresh GitHub state is read and core's 6 readiness conditions (review covers the head, questions answered, nothing waiting for a fix, nothing undecided, CI green, no changes requested) plus sensitive files approved are re-checked (any failure → 409 with the failing rows); otherwise a squash merge pinned to the reviewed SHA goes out as `pr-review-agent` with the body ending in `Signed-off-in-app-by: <name>` (FR-055, OQ2, OQ3). GitHub's refusal returns 422 with its reason and a timeline entry; success records "Merged by Kasia"; a row lock stops a double merge.
- **Touches:** apps/api
- **Depends on:** S-12-T1
- **Done when:** `pnpm --filter @pra/api test merge.test.ts` passes: a wrong number returns 400; fresh head ≠ reviewed SHA returns 409 `head_moved` with no merge call; CI red in fresh state but green in the DB returns 409; a green PR sends `sha` = reviewed SHA and the trailer; GitHub's refusal message comes back verbatim; two concurrent merges make one gateway call.

### S-12-T3: Keep the checklist fresh and drop Ready to merge when the head moves
- **Goal:** Ingest `check_suite`, `status` and `pull_request_review` webhooks to refresh the PR's CI and changes-requested fields, and make sure a `synchronize` event updates the head at once so the state leaves Ready to merge (FR-056); the checklist shown always uses these fields.
- **Touches:** apps/api (webhook ingest), apps/worker if ingest lives there
- **Depends on:** S-12-T1
- **Done when:** `pnpm --filter @pra/api test checklist-fresh.test.ts` passes: a failing `check_suite` turns the CI row red; a CHANGES_REQUESTED review turns its row red; a ready PR receiving `synchronize` has state `new_commits`, lane Action needed, and the merge route refuses with `head_moved`.

### S-12-T4: Merge checklist and Merge dialog
- **Goal:** Add the checklist card: failing rows with reasons, passing rows behind "Show all N", all green as one line "Checklist green at abc123" (FR-054); make "Merge #272…" the Ready to merge banner's main action, opening an AlertDialog with the typed PR number, the signature, "Squash merge at abc123" and GitHub's refusal reason when there is one; the merged PR leaves the board for "Merged or closed in the last 7 days". Spec: `prototype/js/pr.js` `Checklist`, `prototype/js/dialogs.js` merge dialog.
- **Touches:** apps/web
- **Depends on:** S-12-T2
- **Done when:** `pnpm --filter @pra/web test checklist.test.tsx merge-dialog.test.tsx` passes: only failing rows show by default; Merge stays disabled until the typed number matches and a signer is picked; a 422 shows GitHub's message in the dialog.

### S-12-T5: End-to-end merge
- **Goal:** Playwright spec with a GitHub double covering the green merge, a failing row, GitHub's refusal and a push that removes Ready to merge.
- **Touches:** Playwright spec `merge.spec.ts`
- **Depends on:** S-12-T3, S-12-T4
- **Done when:** `pnpm test:e2e merge.spec.ts` passes.

### S-12-T6: WB branch protection, merge permission and a real merge (Needs Alek)
- **Goal:** Confirm how WB's branch protection treats the App, give the App merge permission, and merge one throwaway PR from the app.
- **Touches:** GitHub App settings, WB repository settings
- **Depends on:** S-12-T5
- **Done when:** a throwaway WB PR is squash-merged by `pr-review-agent` from the app, its commit message ends in `Signed-off-in-app-by: <your name>`, and (on the throwaway-base route) a refusal for a missing approval shows GitHub's reason in the Merge dialog.
- **Steps for Alek:**
  1. WB on GitHub → Settings → Branches (and Settings → Rules → Rulesets): write down the rules on `main` (required approvals, required status checks, restricted pushes, linear history) and send them to the orchestrator for OQ3.
  2. If pushes to `main` are restricted to listed people, teams or apps, add the `pr-review-agent` app to that list. Do not add it to any bypass list.
  3. WB → Settings → General → Pull Requests: make sure "Allow squash merging" is on.
  4. GitHub App `pr-review-agent` → Permissions & events → Repository permissions: "Contents: Read and write", "Pull requests: Read and write" (keep Checks and Commit statuses Read-only). Under Subscribe to events tick "Check suite", "Status" and "Pull request review". Save.
  5. As the org owner, Organization → Settings → GitHub Apps → `pr-review-agent` → accept the new permissions request.
  6. Open WB's `.github/workflows/*.yml`. If CI runs on pull requests to any branch, create a base branch `pra-merge-smoke` from `main`, a branch `pra-merge-smoke-head` with a one-line change to a docs file, and open a PR into `pra-merge-smoke`. If CI runs only for `main`, agree a tiny real PR into `main` with the team instead (for example a typo fix).
  7. Mark the PR ready for review, let round 1 finish in the app, decide any findings, approve sensitive files if listed, and wait for CI to pass.
  8. When the banner shows Ready to merge: Merge #N… → type the number → pick your name → Merge.
  9. In GitHub check the PR is squash-merged by `pr-review-agent` and the commit message ends in `Signed-off-in-app-by: <your name>`.
  10. Refusal check (throwaway-base route only): WB → Settings → Branches → Add rule for `pra-merge-smoke` with "Require a pull request before merging" and 1 required approval. Open a second throwaway PR into `pra-merge-smoke`, get it to Ready to merge without approving it in GitHub, click Merge, and confirm the dialog shows GitHub's refusal reason.
  11. Delete that temporary rule and the `pra-merge-smoke*` branches.

## S-13: implementer-patch

The implementer agent fixes findings decided as Implement at level 4 and above, and the team reviews, edits, reverts or revises its patch before anything is pushed. Roadmap: [S-13](roadmap.md#s-13-implementer-patch)
**Slice check:** `pnpm test:e2e implement-patch.spec.ts` passes: on a level 3 PR Implement with agent is disabled with the reason, "Raise this PR to level 4" (by hand) enables it, one signature decides two findings as Implement with the agent box ticked, the PR shows Fixing and then "Patch ready: 2 of 2 fixed, reproductions pass", and edit, revert and revise all work in the Patch tab.

### S-13-T1: Implementer adapter limited to its own worktree
- **Goal:** Add the `implementer` role adapter to `AgentRunner` on the Claude Agent SDK. It gets the findings decided as Implement (with evidence and reproduction scripts), the implement instructions and the PR's earlier answers. It may edit files only inside the worktree it is given. Tool allow-list: Read, Glob, Grep, Edit, Write. No Bash or other shell, no MCP, no settings sources. A permission callback denies any path that resolves outside the worktree, symlinks included. The session environment holds only `ANTHROPIC_API_KEY`. `maxTurns` and the per-session cost guard apply. It returns the finding ids it claims to have fixed and a short summary. The session (transcript, tokens, real cost) is recorded like the other roles.
- **Touches:** packages/agents (implementer adapter, tool policy, prompt builder)
- **Depends on:** S-02 done, S-05 done
- **Done when:** `pnpm --filter @pra/agents test` passes `implementer.test.ts`, which uses an SDK client double to check five things: the allowed tools include no Bash or other shell tool; an Edit to `../outside.ts` is denied, and so is an Edit to a symlink that points out of the worktree; the session env has no `GITHUB_*`, `CLICKUP_*` or `DATABASE_URL`; a missing key fails with "model access not configured"; a cancelled session records its cost up to the cancel.

### S-13-T2: Patch record and the Implement gate
- **Goal:** Add the implementer run kind to the core run state machine, with stages Implement and Reproductions. Add a patch record with these fields: PR, implementer run, base SHA (the reviewed commit), revision number, one entry per file (path, after-content blob key, status changed/edited/reverted), fixed finding ids, fixed count out of total, reproduction result per finding (pass / fail / not run), revise note, status (ready / superseded / pushed / discarded), and the actor. Add core `canImplementWithAgent(pr, findings)`, which returns allowed or one of these reason codes: `LEVEL_BELOW_4`, `NO_IMPLEMENT_DECISIONS`, `RUN_ACTIVE`, `FORK_READ_ONLY` (from `pr.isFork`, as defense in depth next to S-16). Feed the existing state table's Fixing and Patch ready states from these rows.
- **Touches:** packages/core (run kind, gate, reason codes), packages/db (schema, migration, queries)
- **Depends on:** S-02 done, S-05 done
- **Parallel with:** S-13-T1
- **Done when:** `pnpm --filter @pra/core test` passes `implement-gate.test.ts` (one case per reason code, and level 4 is allowed) and a state-table case where a running implementer run gives Fixing and a ready patch gives Patch ready. `pnpm db:migrate` applies the migration on a fresh database. `pnpm --filter @pra/db test` passes `patches.test.ts`: editing a file stores a new blob key, revert marks the file reverted, and a new revision supersedes the old one.

### S-13-T3: Implementer, revise and patch-check jobs in the worker
- **Goal:** Run Implement with agent as an implementer run through the existing run machinery: pg-boss job keyed by `(runId, stage)`, pause, budget, agent slots and Cancel. The run does four things: it creates a worktree from GitMirror at the patch base SHA, runs the implementer adapter, copies the changed files into BlobStore, then re-runs the fixed findings' reproductions on the patched tree in the Sandbox (network none, read-only mount) using the core reproduction exit-code rule. Then it stores the patch. A Revise job starts from the current patch files plus the note and writes the next revision. A patch-check job re-runs only the reproductions (no model spend) after an edit or revert. Timeline entries: "Implementer started by <signer>" and "Patch ready: N of M fixed".
- **Touches:** apps/worker (implementer, revise and patch-check handlers), packages/db queries
- **Depends on:** S-13-T1, S-13-T2
- **Done when:** `pnpm --filter @pra/worker test` passes `implementer-run.test.ts` with AgentRunner, GitMirror and Sandbox doubles:
  - a run whose double edits two files stores a patch "2 of 2 fixed" with reproductions passing;
  - the reproduction Sandbox call has network none;
  - a cancelled run writes no patch and records spend up to the cancel;
  - without `ANTHROPIC_API_KEY` the run fails with "model access not configured";
  - a job delivered again after a restart produces exactly one patch;
  - revise with a note creates revision 2 and supersedes revision 1.

### S-13-T4: Implement and patch API
- **Goal:** Extend the signed Implement decision with `withAgent: true`, so one signature records the decisions and starts the implementer (FR-047). Add `POST /api/prs/:id/implement` (signed) for findings already decided. Both return 409 with the core reason code when the gate refuses. Add patch endpoints, all unsigned and recorded "by hand":
  - `GET /api/patches/:id`: files with unified diffs against the base;
  - `PUT /api/patches/:id/files`: edit a file's content;
  - `POST /api/patches/:id/files/revert`: revert a file;
  - `POST /api/patches/:id/revise`: start a revision, note required.

  Edits carry the patch revision and the file's blob key, and a stale value returns 409 (Concurrent edits NFR). "Raise this PR to level 4" reuses the existing one-PR level change from S-07.
- **Touches:** apps/api (routes, Zod schemas, OpenAPI)
- **Depends on:** S-13-T2
- **Done when:** `pnpm --filter @pra/api test` passes `implement.routes.test.ts`:
  - decide-with-agent writes N decisions and one implementer run under one signer;
  - a level 3 PR returns 409 `LEVEL_BELOW_4`;
  - an edit stores a new blob and queues a patch-check;
  - a stale edit returns 409;
  - revise without a note returns 400;
  - every write adds a timeline event with the signer or "by hand".

### S-13-T5: Implement with agent in the decision form and the banner
- **Goal:** Add an "Implement with agent" checkbox (level 4+) to the Implement decision form and the bulk bar, covered by the same signature. On Waiting for the fix, the banner's main action "Implement with agent…" opens a Dialog with the findings and the signature. Below level 4, and on fork PRs, the control is disabled and a Tooltip gives the reason. Below level 4 the banner also offers "Raise this PR to level 4" (unsigned). Fixing shows "Implementer is fixing N findings · started by <name>" with the outline Cancel.
- **Touches:** apps/web (PR page: decision form, bulk bar, Next step banner)
- **Depends on:** S-13-T4
- **Done when:** `pnpm --filter @pra/web test` passes `implement-with-agent.test.tsx`: the checkbox is disabled with the reason text below level 4 and on a fork; one submit sends the decisions plus `withAgent` under one signer; "Raise this PR to level 4" sends an unsigned level change.

### S-13-T6: Patch tab
- **Goal:** Add the Patch tab (`?tab=patch`). It has a summary line "N of M fixed · reproductions pass | fail | not run", a file list with a diff for each file, Edit (Textarea editor and save), Revert file, and "Revise with this note". A new revision or a new reproduction result waits behind "View new results", as findings do.
- **Touches:** apps/web (PR page, Patch tab)
- **Depends on:** S-13-T4
- **Parallel with:** S-13-T5
- **Done when:** `pnpm --filter @pra/web test` passes `patch-tab.test.tsx`: it renders one diff per file; Edit sends the new content; Revert removes the file from the list; Revise needs a note; the reproduction text matches the API.

### S-13-T7: End-to-end implementer flow
- **Goal:** A Playwright test of the first half of prototype flow C, using the e2e harness's AgentRunner, GitMirror and Sandbox doubles.
- **Touches:** e2e tests (`implement-patch.spec.ts`)
- **Depends on:** S-13-T3, S-13-T5, S-13-T6
- **Done when:** `pnpm test:e2e implement-patch.spec.ts` passes:
  - a level 3 PR shows Implement with agent disabled with the reason;
  - "Raise this PR to level 4" enables it;
  - ticking two findings, then Implement… with the agent box ticked, then signing shows Fixing and then "Patch ready: 2 of 2 fixed, reproductions pass";
  - in the Patch tab, editing one file, reverting another, and revising with a note gives revision 2;
  - Cancel during Fixing leaves no patch;
  - Timeline shows the signer and the "by hand" entries.

### S-13-T8: Implementer smoke on a real PR (Needs Alek)
- **Goal:** Prove the implementer works with the real model key on a real WB PR and stays inside its worktree.
- **Touches:** none (manual check)
- **Depends on:** S-13-T7, S-01 done (including its real GitHub App and model key wiring)
- **Done when:** a real Patch ready shows a fixed count and a reproduction result, its Run detail shows the implementer session's real cost, and the transcript has no shell tool call and no path outside the worktree.
- **Steps for Alek:**
  1. Check that `.env` has `ANTHROPIC_API_KEY` (set in S-01). In the status chip, set the daily budget to a small amount, for example $10, and sign. The smoke spends real tokens on that key.
  2. Start the stack as AGENTS.md describes (`docker compose up -d db`, `pnpm db:migrate`, then api, worker and web).
  3. Pick a WB PR with at least one Confirmed finding. If there is none, push a branch `pra-smoke-implementer` with one small deliberate bug, open a PR from it, mark it ready, and wait for round 1. Use level 3 or higher so findings get verified.
  4. In the PR header, set the PR's level to 4. Decide one Confirmed finding as Implement with "Implement with agent" ticked, and sign with your name.
  5. Wait for "Patch ready". In the Patch tab, check the diff, the "N of M fixed" line and the reproduction result.
  6. Open Run detail, then the implementer session's transcript. Confirm there are no Bash or shell tool calls and that every edited path belongs to the repository.
  7. Do not push yet (S-14-T6 does that). Keep the PR open for S-14-T6.

## S-14: push-patch-and-recheck

A signed push of the patch to the PR branch as `pr-review-agent`, after the person types the PR number, followed by the automatic fix-check round. Roadmap: [S-14](roadmap.md#s-14-push-patch-and-recheck)
**Slice check:** `pnpm test:e2e push-recheck.spec.ts` passes. The person clicks Push, types the PR number and signs. The GitHub double receives one push, not forced, with a `Co-authored-by` trailer. Round 2 of 3 then starts by itself as a fix check and ends with "2 of 2 fixes resolved", and the PR moves to Ready to merge. If the head has moved, the push is refused with the reason.

### S-14-T1: Non-forced push in GitMirror and GitHubGateway
- **Goal:** Add `pushPatch({ repo, branch, baseSha, files, message, coAuthor })`. In a fresh worktree at `baseSha` it writes the patch files and commits as the App's bot identity, with the trailer `Co-authored-by: <name> <<id>+<login>@users.noreply.github.com>`. It pushes `<sha>:refs/heads/<branch>`. The installation token reaches git through the environment (a credential helper), never through argv. The push never uses `--force`, `--force-with-lease` or a `+` refspec. A non-fast-forward rejection maps to `HEAD_MOVED`. Add `GitHubGateway.getUser(login)` to look up the signer's GitHub id. The commit message is neutral ("Apply fixes from pr-review-agent review"). It never contains finding text, a decision or the app address (NFR Privacy toward public PRs).
- **Touches:** packages/integrations (GitMirror, GitHubGateway)
- **Depends on:** S-07 done, S-13 done
- **Done when:** `pnpm --filter @pra/integrations test` passes `push-patch.test.ts` against a local bare repository:
  - the pushed commit has the trailer and the bot author;
  - the captured `execa` argv never contains the token, `--force` or `+`;
  - a push after the remote branch moved returns `HEAD_MOVED` and leaves the remote unchanged;
  - the message contains no finding title and no URL.

### S-14-T2: Push rule, push job and hand-off to the fix check
- **Goal:** Add core `canPush(patch, pr, typedNumber, freshHeadSha)` with reason codes `PR_NUMBER_MISMATCH`, `PATCH_NOT_READY`, `HEAD_MOVED`, `RUN_ACTIVE` and `FORK_READ_ONLY`. Add a worker push job, keyed by patch id and idempotent. It re-reads the head from GitHub, checks `canPush` and calls `pushPatch`. It records the pushed SHA as a head change by the bot, which is what S-07's FR-016 rule reads as "the commit PR Review Agent pushed". It then marks the patch pushed and adds the timeline entry "Pushed by pr-review-agent · signed by <name>". The `synchronize` webhook for that SHA then starts round 2 of 3 through the existing chain rule.
- **Touches:** packages/core (push rule), apps/worker (push handler)
- **Depends on:** S-14-T1
- **Done when:** `pnpm --filter @pra/core test` passes `push-rule.test.ts` (one case per reason code). `pnpm --filter @pra/worker test` passes `push-job.test.ts` with a GitHubGateway double:
  - a ready patch is pushed once even when the job is delivered twice;
  - a moved head records `HEAD_MOVED` on the patch and pushes nothing;
  - a `synchronize` event with the pushed SHA starts a round labelled "Round 2 of 3 · started by pr-review-agent after fix <sha>";
  - a person's commit on top of that SHA starts nothing.

### S-14-T3: Push endpoint
- **Goal:** Add `POST /api/patches/:id/push` with `{ typedNumber, signer }` (signed). It checks `canPush` against fresh GitHub state and queues the push job. A refusal returns 409 with the reason code and, for `HEAD_MOVED`, the new head SHA.
- **Touches:** apps/api
- **Depends on:** S-14-T2
- **Done when:** `pnpm --filter @pra/api test` passes `push.routes.test.ts`:
  - a wrong number returns 409 `PR_NUMBER_MISMATCH`;
  - a moved head returns 409 `HEAD_MOVED` with the new SHA;
  - success returns 202 and queues exactly one job;
  - a missing signer returns 400.

### S-14-T4: Push dialog on Patch ready
- **Goal:** The Patch ready banner's main action "Push to <branch>…" opens an AlertDialog with the patch summary, an input that must equal the PR number, and the signature. The confirm button stays disabled until both are filled in. A refusal is explained in plain words, for example "The head moved to def456 after the patch was made. Start review to check the new commits."
- **Touches:** apps/web (PR page banner, push dialog)
- **Depends on:** S-14-T3
- **Done when:** `pnpm --filter @pra/web test` passes `push-dialog.test.tsx`: confirm stays disabled until the typed number matches; a 409 `HEAD_MOVED` shows the reason; success closes the dialog and shows a toast.

### S-14-T5: End-to-end push and fix check
- **Goal:** A Playwright test of the second half of prototype flow C, including the US-06 rule that a person's commit on top of the bot's commit starts nothing.
- **Touches:** e2e tests (`push-recheck.spec.ts`)
- **Depends on:** S-14-T4
- **Done when:** `pnpm test:e2e push-recheck.spec.ts` passes:
  - main path: from Patch ready, Push, type 265, sign. The GitHub double records one non-forced push with the signer's `Co-authored-by`. The double then sends `synchronize` with that SHA, "Round 2 of 3" runs as a fix check, marks both findings Resolved, and the PR reaches Ready to merge;
  - variant 1: the double moves the head before the click, so the push is refused with the reason and nothing is pushed;
  - variant 2: a person's commit lands on top of the bot's commit before the fix check, so no round starts and the banner shows new commits.

### S-14-T6: Real push smoke (Needs Alek)
- **Goal:** Prove a real signed push as `pr-review-agent` and the automatic fix check on a real PR.
- **Touches:** none (manual check)
- **Depends on:** S-14-T5, S-13-T8
- **Done when:** the real PR shows one new commit by `pr-review-agent[bot]` with your `Co-authored-by`, no force-push event, and the app runs "Round 2 of 3" by itself on that commit.
- **Steps for Alek:**
  1. On github.com open Settings → Developer settings → GitHub Apps → `pr-review-agent` → Permissions & events. Under Repository permissions, confirm "Contents: Read and write" and "Pull requests: Read and write". Under Subscribe to events, confirm "Pull request" and "Push". If you changed anything, click Save changes, then accept the new permissions on the installation: Settings → Applications → Installed GitHub Apps → `pr-review-agent` → Review request → Accept.
  2. In WB, open Settings → Branches (or Rules → Rulesets). Confirm that only the default branch is protected and that PR branches accept pushes from apps.
  3. In the app, open Settings → Team and confirm your GitHub login is filled in. The `Co-authored-by` line uses it.
  4. Open the Patch ready PR from S-13-T8. Click "Push to <branch>…", type the PR number, sign with your name, and confirm.
  5. On GitHub, check the PR: one new commit by `pr-review-agent[bot]`, no "force-pushed" event, a commit message with the `Co-authored-by:` line and with no finding text or app address.
  6. In the app, check that "Round 2 of 3 · started by pr-review-agent after fix <sha>" runs and marks the fixed findings Resolved or Not resolved.
  7. Check the refusal: create a new patch (Implement with agent again). Before pushing it, push any commit to the PR branch from your machine. Click Push in the app. It must refuse with "head moved", and nothing may be pushed.
  8. Close or delete the smoke PR and branch if you created them for this check.

## S-15: level5-autofix

At level 5 the bot fixes and pushes by itself when every autofix condition holds, and otherwise waits and says why. At lower levels the same check runs silently as a shadow log. Roadmap: [S-15](roadmap.md#s-15-level-5-autofix)
**Slice check:** `pnpm test:e2e autofix.spec.ts` passes:
- a level 5 PR is fixed, pushed and fix-checked with no click and ends in Ready to merge;
- a level 5 PR whose patch touches a sensitive file shows "Autofix waiting: patch touches a sensitive file", and nothing is pushed;
- a level 3 PR shows "Level 5 would have…" in its Timeline (the Trust ladder view of the shadow log is S-19-T9).

### S-15-T1: Autofix attempts and shadow records
- **Goal:** Add two tables:
  - `autofix_attempts`: PR, chain, round, patch, outcome (started / pushed / waiting), reason code, at;
  - `autofix_shadow`: PR, run or patch, PR level, decision (would start / would push / would wait), reason code, findings fixed out of total, at.

  Add queries for automatic patches in a chain and for shadow entries by PR and by repository and level. Add a core wrapper `autofixDecision(level, point, input)` that returns `{ mode: 'act' | 'shadow', allowed, reasonCode }`. It uses the core autofix start and push conditions and their reason codes from F-03. Mode is `act` only at level 5. The cap N counts automatic patches per chain (PRD Business Logic). N comes from the level 5 setting, with the core default of 2.
- **Touches:** packages/core, packages/db
- **Depends on:** S-10 done, S-14 done
- **Done when:** `pnpm --filter @pra/core test` passes `autofix-decision.test.ts`: level 5 gives `act`; levels 3 and 4 give `shadow`; each failing condition gives its reason code (for example, a sensitive file touched); a third patch in one chain with N = 2 hits the cap; a fork never acts. The migration applies, and `pnpm --filter @pra/db test` passes `autofix.test.ts`.

### S-15-T2: Autofix and shadow in the worker
- **Goal:** When a round ends at level 5, evaluate the start conditions. If they hold, the bot records the confirmed findings that need work as decided Implement, signed by `pr-review-agent`, and starts an implementer run (pause, budget and slots still apply). When that patch is ready, evaluate the push conditions: every finding that needs work is confirmed and fixed, every reproduction passes on the patched code, no sensitive file is touched, and the cap is not reached. If they hold, queue the S-14 push job with the bot as signer and no `Co-authored-by`. If any condition fails, push nothing and record the attempt with its reason, so the PR stays in Patch ready with "Autofix waiting: <reason>". At levels below 5, run the same two checks at the same two points without acting, and write shadow entries only. No implementer runs for the shadow.
- **Touches:** apps/worker (round-end and patch-ready hooks)
- **Depends on:** S-15-T1
- **Done when:** `pnpm --filter @pra/worker test` passes `autofix.test.ts` with doubles:
  - a level 5 round with 2 confirmed findings gives one bot implementer run, one push, and then the fix check starts;
  - a patch that touches a sensitive file gives zero pushes and a waiting attempt with that reason;
  - a third automatic patch in one chain is not started;
  - a level 4 round starts no implementer run and writes one shadow entry;
  - while the agent is paused, the autofix implementer run is queued with the pause reason.

### S-15-T3: Autofix and shadow on the PR page
- **Goal:** The PR payload and timeline carry autofix attempts and shadow entries:
  - the banner shows "Autofix waiting: <reason>", built from the reason code;
  - Timeline rows "Autofix started by pr-review-agent" and "Autofix pushed <sha>";
  - below level 5, Timeline rows "Level 5 would have fixed 2 of 2 and pushed" or "Level 5 would have waited: <reason>".
- **Touches:** apps/api (PR payload, timeline), apps/web (banner copy, Timeline rows)
- **Depends on:** S-15-T1
- **Parallel with:** S-15-T2
- **Done when:** `pnpm --filter @pra/web test` passes `autofix-banner.test.tsx` (each autofix reason code shows its sentence). `pnpm --filter @pra/api test` passes `timeline-autofix.test.ts` (attempt and shadow rows appear in the PR timeline in time order, with the bot as actor).

### S-15-T5: End-to-end autofix
- **Goal:** A Playwright test of the level 5 variants of prototype flow C (`#/pr/38`, `#/pr/268`) and of the shadow.
- **Touches:** e2e tests (`autofix.spec.ts`)
- **Depends on:** S-15-T2, S-15-T3
- **Done when:** `pnpm test:e2e autofix.spec.ts` passes:
  - a level 5 draft PR marked ready through the webhook double runs round 1; the bot implements and pushes with no click; the fix check runs; the PR lands in Ready to merge;
  - a level 5 PR whose patch touches a sensitive file shows "Autofix waiting: patch touches a sensitive file", and the GitHub double records zero pushes;
  - a level 3 PR gets a "Level 5 would have…" Timeline entry and no implementer run, and Insights → Trust ladder counts it.

## S-16: fork-prs-read-only

A fork PR is reviewed only when a person starts it, and that review only reads the code. The guard sits in the core run state machine. Roadmap: [S-16](roadmap.md#s-16-fork-prs-read-only)
**Slice check:** `pnpm test:e2e fork-pr.spec.ts` passes. A fork PR marked ready starts nothing and shows "Not reviewed yet". A manual review completes with install and reproductions skipped for the fork, and the Sandbox double records zero calls.

### S-16-T1: Read-only run policy for forks in core
- **Goal:** Make the fork guard part of the core run state machine. `runPolicy(pr)` gives a fork PR `autoStart: false`, `install: false`, `scripts: false`, `implement: false`, `push: false` and `autofix: false`. The stage plan built by the state machine marks the steps that execute PR code (install in Checks, reproductions in Verify) as skipped with reason code `FORK_READ_ONLY`, so no single stage carries the guard. Port any fork cases from `~/Projects/wb-factory/test/*.test.ts` that F-03 did not port.
- **Touches:** packages/core (run state machine, policy, reason codes)
- **Depends on:** S-04 done, S-07 done
- **Done when:** `pnpm --filter @pra/core test` passes `fork-policy.test.ts`: a fork run's stage plan marks install and reproduction steps skipped with `FORK_READ_ONLY`, and reading CI status stays on; `runPolicy` refuses auto-start, implement, push and autofix for forks; a non-fork PR's plan is unchanged.

### S-16-T2: Enforce the fork policy in the worker
- **Goal:** The worker builds every stage from the core plan, so a fork run never calls the Sandbox. Verify on a fork judges from quoted evidence only: a finding that would need a reproduction stays Not proven. Webhook ingest (opened, ready_for_review, synchronize) and the reconcile poll never start a round for a fork. Implementer and push handlers, where present, re-read the fork flag from fresh GitHub data and refuse with `FORK_READ_ONLY`, even when a job was queued directly.
- **Touches:** apps/worker
- **Depends on:** S-16-T1
- **Done when:** `pnpm --filter @pra/worker test` passes `fork-run.test.ts` with doubles: a manual round on a fork completes with zero Sandbox calls; a ready_for_review event on a fork queues nothing; a poll that finds a ready fork PR queues nothing.

### S-16-T3: Fork PR on the board and the PR page
- **Goal:** A fork PR sits in Not reviewed with "Not reviewed yet" and Start review. The Start review popover says "Read-only review: no install, reproductions, implementer or push". The stepper and Run detail show the skipped steps as "off for forks". The manual start endpoint accepts forks and passes the policy through.
- **Touches:** apps/web (board, PR header popover, stepper), apps/api (start endpoint, PR payload)
- **Depends on:** S-16-T1
- **Parallel with:** S-16-T2
- **Done when:** `pnpm --filter @pra/web test` passes `fork-pr.test.tsx` (the popover note and the skipped-step labels render for a fork, and nothing changes for a non-fork). `pnpm --filter @pra/api test` passes `fork.routes.test.ts` (manual start on a fork returns 202 and the run carries the read-only policy).

### S-16-T4: End-to-end fork review
- **Goal:** A Playwright test of US-17.
- **Touches:** e2e tests (`fork-pr.spec.ts`)
- **Depends on:** S-16-T2, S-16-T3
- **Done when:** `pnpm test:e2e fork-pr.spec.ts` passes:
  - a fork PR opened as ready through the webhook double shows "Not reviewed yet" and no run;
  - Start review runs a round whose Run detail shows install and reproductions "off for forks";
  - the Sandbox double records zero calls;
  - the round's findings show verdicts based on quotes only.

## S-17: board-filters-search-shortcuts

Full board cards, filters kept in the address, urgency sort, one command palette, keyboard triage, a dark theme, and checks for accessibility and layout. Roadmap: [S-17](roadmap.md#s-17-board-filters-search-and-shortcuts)
**Slice check:** `pnpm test:e2e board.spec.ts a11y-layout.spec.ts` passes: filters survive a reload, Action needed follows the urgency order, ⌘K finds a PR, triage works by keyboard alone, the theme toggles, axe finds zero WCAG AA violations in both themes, and the work starts by y≈380 at 1440×900.

### S-17-T1: Full board cards and compact forms
- **Goal:** Cards have three lines: the title; `#number · author · age`; the Next step line from the core state table. Repository, level and round show only when they differ from the default. The author name is never truncated; the round label shortens first. Ready to merge cards have two lines. Drafts are one-line rows under "N drafts" in Not reviewed. PRs merged or closed in the last 7 days sit in a collapsed list under the board. Add a `closedWithinDays` board query only if the API lacks one.
- **Touches:** apps/web (board components), apps/api (board query, only if needed)
- **Depends on:** S-02 done
- **Done when:** `pnpm --filter @pra/web test` passes `board-card.test.tsx`:
  - the default repository, level and round are hidden, and non-default ones are shown;
  - a 40-character author name renders in full on a 280 px card;
  - a Ready to merge card has two lines;
  - drafts render as rows under "3 drafts";
  - the merged/closed list starts collapsed and shows its count.

### S-17-T2: Action needed sorted by urgency
- **Goal:** Add `actionNeededRank(stateCode)` to packages/core in the FR-008 order: failed, questions, findings to decide, sensitive files, patch ready, waiting for the fix, new commits, automatic rounds used. Sort the Action needed lane by it, then by age. The lane is twice as wide, with two card columns.
- **Touches:** packages/core, apps/web (board lane)
- **Depends on:** S-02 done
- **Parallel with:** S-17-T1
- **Done when:** `pnpm --filter @pra/core test` passes `urgency.test.ts` (the full order and the age tie-break). `pnpm --filter @pra/web test` passes `board-lane.test.tsx` (rendered order for one card of each state).

### S-17-T3: Board filter query
- **Goal:** Extend the board API with these filters, validated with Zod:
  - `person`: PRs the team member authored or signed anything on. One `prsSignedBy(memberId)` query in packages/db unions every table that stores a signature: decisions, opinions, signed reviews, answers and merges, plus pushes when S-14 lands;
  - `repo`;
  - `forks=hide|only`;
  - `level`;
  - `drafts=hide`.

  The query only reads.
- **Touches:** packages/db (board query), apps/api (board route)
- **Depends on:** S-02 done
- **Parallel with:** S-17-T1, S-17-T2
- **Done when:** `pnpm --filter @pra/api test` passes `board-filters.test.ts`:
  - `person=kasia` returns her authored PRs plus a PR where she only signed an opinion, and no other PRs;
  - each of the other filters narrows the list as named;
  - filters combine;
  - invalid values return 400.

### S-17-T4: Board filters in the page address
- **Goal:** A Person Combobox is always visible (default: everyone). A Filters Popover holds Repository, Forks, Level and Hide drafts. Every filter lives in TanStack Router search params (`?person=&repo=&forks=&level=&drafts=`), so a reload or a shared link keeps it.
- **Touches:** apps/web (board route, filter components)
- **Depends on:** S-17-T3
- **Done when:** `pnpm --filter @pra/web test` passes `board-filters.test.tsx`: choosing a filter updates the search params; loading a URL with params preselects them; "Clear filters" resets them all.

### S-17-T5: Command palette
- **Goal:** One CommandDialog, opened by ⌘K, by `/` and by the top-bar search, with four groups:
  - PRs: number, title or author, from a new `GET /api/search?q=`;
  - People: from Team;
  - Settings pages;
  - Actions: from a static registry that later pages extend, for example Show keyboard shortcuts, Toggle theme, Pause, and Start review on the open PR.

  Arrow keys move and Enter runs the item.
- **Touches:** apps/web (shell, palette, action registry), apps/api (search route)
- **Depends on:** S-02 done
- **Done when:** `pnpm --filter @pra/api test` passes `search.routes.test.ts` (matches on number, title words and author). `pnpm --filter @pra/web test` passes `command-palette.test.tsx`: ⌘K and `/` open it; typing "272" lists PR #272 first; Enter navigates; Escape returns focus to the trigger.

### S-17-T6: Keyboard triage and the shortcut list
- **Goal:** On the PR Findings tab:
  - `j`/`k`: next/previous finding;
  - `o`: expand or collapse;
  - `x`: select;
  - `w`/`n`: toggle the opinion draft (Worth implementing / Not worth it);
  - `i`/`r`/`d`: open the Implement / Reject / Defer form with the signature prefilled, where Enter confirms.

  Keys are ignored while typing and while a dialog is open. Globally, `?` opens the Keyboard shortcuts Dialog, which lists these keys plus ⌘K, `/`, `g p` and `g a`. Tooltips show Kbd hints.
- **Touches:** apps/web (findings list, shell)
- **Depends on:** S-02 done, S-08 done (opinions for `w`/`n`)
- **Done when:** `pnpm --filter @pra/web test` passes `triage-keys.test.tsx`:
  - `j`/`k` moves the focused finding and scrolls it into view;
  - pressing `w` twice clears the opinion draft again;
  - `i` opens the Implement form;
  - keys typed inside a textarea do nothing;
  - `?` opens the list;
  - `g a` goes to Activity.

### S-17-T7: Light and dark theme
- **Goal:** Add dark values for the WB-themed shadcn variables, taken from `prototype/styles.css`. Add a top-bar toggle and a palette action. The default follows `prefers-color-scheme`. The choice is remembered on the device in localStorage, with every read and write wrapped in try/catch.
- **Touches:** apps/web (theme tokens, shell toggle)
- **Depends on:** S-02 done
- **Done when:** `pnpm --filter @pra/web test` passes `theme.test.tsx`: the toggle sets the `dark` class on `html` and persists it; the system preference applies when nothing is stored; every light token has a dark value.

### S-17-T8: End-to-end board, search and triage
- **Goal:** A Playwright test of the board features above together.
- **Touches:** e2e tests (`board.spec.ts`)
- **Depends on:** S-17-T1, S-17-T2, S-17-T4, S-17-T5, S-17-T6, S-17-T7
- **Done when:** `pnpm test:e2e board.spec.ts` passes:
  - Person = Kasia survives a reload as `?person=kasia` and shows only her PRs;
  - Filters → Level 3 plus Hide drafts narrows the lanes;
  - Action needed shows failed, then questions, then findings to decide, and so on;
  - ⌘K, typing "272", Enter opens PR #272;
  - on Findings, `j j i Enter` decides with the prefilled signature;
  - `?` lists the shortcuts;
  - the theme toggle switches and survives a reload.

### S-17-T9: Accessibility and layout checks
- **Goal:** Playwright checks for NFR Accessibility and NFR Layout over the route list `e2e/a11y-routes.ts`. The list holds the board, the PR page tabs, Run detail, Activity, and every other route registered so far; later slices add theirs. For each route:
  - `@axe-core/playwright` with the WCAG 2 A and AA tags, in light and dark;
  - every element reached by Tab has a visible focus (computed outline or ring is not none);
  - at 1440×900, the element marked `data-work-start` on each screen has its top at or above 400 px (the target is about 380).

  Fix the violations found.
- **Touches:** e2e tests (`a11y-layout.spec.ts`, `a11y-routes.ts`), apps/web (fixes, `data-work-start` markers)
- **Depends on:** S-17-T8
- **Done when:** `pnpm test:e2e a11y-layout.spec.ts` passes with zero axe violations in both themes, and every listed route's work start is at or above 400 px.

## S-18: activity-and-alerts

Alerts fire only when something is wrong. Each one reaches the PR's ClickUp task with a link to the app, shows across the app, and is dismissed or cleared as the PRD Alerts table says. Roadmap: [S-18](roadmap.md#s-18-activity-and-alerts)
**Slice check:** `pnpm test:e2e alerts.spec.ts` passes:
- a retry that pushes a PR's spend over $5 clears the failed-run alert and raises the cost alert on the card, the board strip, the banner, the status chip and Activity;
- the ClickUp double holds exactly one comment for the cost alert, on the PR's task, with the app link;
- Dismiss is recorded "by hand".

### S-18-T1: Alert rules in core
- **Goal:** Add pure functions `alertConditions(snapshot, config)` and `reconcileAlerts(active, conditions)` for the four alerts in PRD Business Logic → Alerts (FR-065 also covers the daily budget alert):

  | Alert | Key | Fires when | Clears when | Next step |
  |---|---|---|---|---|
  | Run failed | `failed:<pr>:<failure no>` | a stage timed out or crashed | a retry or a new review starts | "Retry from <stage>" |
  | Automatic rounds used | `rounds:<pr>:<chain>` | a chain used 3 of 3 with a fix still open | a new review starts | "Start review" |
  | Cost of one PR | `cost:<pr>` | real spend, without trials and the analyst, passes the threshold (default $5) | only by dismiss; never fires again for that PR | "Check whether the PR should be split" |
  | Daily budget | per day, 80% and 100% | spend passes the threshold (default 80%), and again at 100% | spend falls below the threshold, or at midnight | "Pause, raise the budget or wait until midnight" |

  Clearing produces no message, and nothing fires when things go well.
- **Touches:** packages/core (alerts)
- **Depends on:** S-06 done, S-09 done
- **Done when:** `pnpm --filter @pra/core test` passes `alerts.test.ts`: one test per fire and clear row of the table; the cost alert does not fire again after a dismiss; a disabled alert kind never fires; a key never fires twice.

### S-18-T2: Alert storage and config
- **Goal:** Add two tables, and queries for active, past and per-PR alerts:
  - `alerts`: kind, key (unique), PR, title, next step, ClickUp task ID, comment ID, delivery status, posted at, status (active / resolved / dismissed), ended at, ended by (bot or by hand), end note;
  - `alert_config`: run failed on/off, rounds on/off, cost on/off and maximum, budget on/off and percent, general alerts task ID. Defaults: $5 and 80%.
- **Touches:** packages/db
- **Depends on:** S-06 done, S-09 done
- **Parallel with:** S-18-T1
- **Done when:** the migration applies, and `pnpm --filter @pra/db test` passes `alerts.test.ts`: insert is idempotent per key; the active and past queries work; the defaults exist after migrate.

### S-18-T3: Alert evaluation in the worker
- **Goal:** Re-evaluate alerts at these moments:
  - after every run state change: stage failed, round completed, chain ended, retry, new start;
  - after each recorded session cost;
  - on a pg-boss cron every minute and at midnight, for the budget.

  Store fires and clears. Add a PR timeline entry for each fire. Emit NOTIFY so SSE updates the board, the status chip and Activity. Alerts never stop or delay a round.
- **Touches:** apps/worker
- **Depends on:** S-18-T1, S-18-T2
- **Done when:** `pnpm --filter @pra/worker test` passes `alert-eval.test.ts`: a timed-out stage creates one run-failed alert, and a retry resolves it; spend crossing $5 creates one cost alert while the round still runs to completion; spend at 80% and then 100% creates two budget alerts, and midnight resolves them.

### S-18-T4: ClickUp delivery of alerts
- **Goal:** For each new alert, a pg-boss delivery job (keyed by alert id, retried with backoff) posts a comment through `ClickUpGateway`. It goes to the PR's linked task, or to the general alerts task for budget alerts and for PRs without a task. The text names the problem and the next step, links to `${APP_BASE_URL}/pr/<repo>/<number>`, and is signed "pr-review-agent". `APP_BASE_URL` is a new env var, documented in `.env.example`. Without `CLICKUP_API_KEY` or a target task, the alert stays visible in the app with the delivery status "Not sent: ClickUp not configured"; nothing is faked. Clearing an alert posts nothing.
- **Touches:** apps/worker (delivery handler), `.env.example`
- **Depends on:** S-18-T3
- **Done when:** `pnpm --filter @pra/worker test` passes `alert-delivery.test.ts` with a ClickUpGateway double:
  - one comment per alert lands on the right task and holds the next step, the app link and the bot signature;
  - an alert for a PR without a task goes to the general task;
  - a clear posts nothing;
  - a missing key sets "Not sent: ClickUp not configured";
  - a job delivered twice posts once.

### S-18-T5: Alerts API
- **Goal:** Add these endpoints and payloads:
  - `GET /api/alerts?status=active|past`;
  - `POST /api/alerts/:id/dismiss`: unsigned, recorded "by hand" in the PR timeline. This is the only way the cost alert clears;
  - alert data on board cards (`alertCount`), on the PR payload (banner line) and on the status chip (active count);
  - an SSE event `alert.changed`.
- **Touches:** apps/api
- **Depends on:** S-18-T2
- **Parallel with:** S-18-T3
- **Done when:** `pnpm --filter @pra/api test` passes `alerts.routes.test.ts`: the active and past lists work; dismiss sets ended by "by hand" and adds a timeline entry; the board payload carries `alertCount` per card; the chip payload counts active alerts.

### S-18-T6: Alerts in Activity, on the board, the PR page and the status chip
- **Goal:** Show alerts everywhere FR-066 names. All of it updates live over SSE.
  - Activity: an "Active alerts" section above In progress. Run-failed alerts carry "Retry from <stage>", and the cost alert carries Dismiss. Past alerts sit behind "Show N past alerts" (Collapsible);
  - board: one bell on the card, and a strip above the board ("N active alerts", linking to Activity);
  - PR page: a secondary line inside the Next step banner, for example "Alert posted to ClickUp WB-123 · 5 min ago", with Dismiss for the cost alert;
  - status chip: the active count.
- **Touches:** apps/web (Activity, board, PR banner, status chip)
- **Depends on:** S-18-T5
- **Done when:** `pnpm --filter @pra/web test` passes `alerts-ui.test.tsx`: a failed-run row has Retry; a cost row has Dismiss; past alerts start collapsed and show their count; the card bell shows only with an active alert; the chip count matches.

### S-18-T8: End-to-end alerts
- **Goal:** A Playwright test of US-14 and the alert life cycle.
- **Touches:** e2e tests (`alerts.spec.ts`)
- **Depends on:** S-18-T4, S-18-T6
- **Done when:** `pnpm test:e2e alerts.spec.ts` passes:
  - on a failed PR, Retry from Review pushes spend over $5. The failed-run alert clears, and the cost alert shows on the card bell, the board strip, the banner line, the chip count and Activity;
  - the ClickUp double holds exactly one comment for the cost alert, on the PR's task, with the app link and "pr-review-agent", and none for the clear;
  - Dismiss moves the alert to past alerts, and Timeline shows "Dismissed by hand";
  - an alert on a PR without a task goes to the general task;

### S-18-T9: Real ClickUp alert smoke (Needs Alek)
- **Goal:** Prove that a real alert reaches the PR's ClickUp task with a working link to the app.
- **Touches:** none (manual check)
- **Depends on:** S-18-T8, S-06 done (including its real ClickUp key wiring)
- **Done when:** a real ClickUp comment, signed "pr-review-agent", appears on the PR's task with the problem, the next step and a link that opens the PR in the app, and dismissing the alert posts nothing.
- **Steps for Alek:**
  1. In ClickUp, in the WB space, create a task named "PR Review Agent alerts". Copy its task ID from the task URL.
  2. In `.env`, set `APP_BASE_URL` to the address people open the app at (for a local smoke, the web dev server address). Check that `CLICKUP_API_KEY` is set (from S-06). Restart api and worker.
  3. In the app, open Settings → Alerts. Paste the task ID as the general alerts task, set "Cost of one PR" to $0.01, click Save, and sign.
  4. Open a WB PR that has a linked ClickUp task and click Start review.
  5. Within a minute of the first recorded session cost, check the PR's ClickUp task. It should have one comment (its author is the key owner) that names the cost problem and the next step, links to `<APP_BASE_URL>/pr/...`, and ends with "pr-review-agent". Click the link; it must open the PR. The card shows the bell.
  6. In Activity, click Dismiss on the alert. Check that no new ClickUp comment appears.
  7. In Settings → Alerts, set the cost threshold back to $5, save, and sign.

## S-19: pilot-metrics-insights

Insights with the five pilot metrics and their sample sizes, real spend, quality rates and the per-repository trust ladder. No trends and no deltas. Roadmap: [S-19](roadmap.md#s-19-pilot-metrics-in-insights)
**Slice check:** `pnpm test:e2e insights.spec.ts` passes:
- Overview filtered to one repository shows "Based on 17 PRs merged" for each metric and splits ready → merge into three lanes;
- a 5-PR filter adds "too few for firm conclusions";
- Cost shows trials and the analyst separately;
- no trend or delta appears anywhere.

### S-19-T1: Lane and head-change logs for metrics 2 and 5
- **Goal:** Make sure metrics 2 and 5 have source rows. Skip any part an earlier slice already built (S-03 records PR state changes). Backfill rows from the raw GitHub events kept since S-01 (NFR Complete logs), so the metrics cover the pilot from its first PR.
  - `pr_state_changes`: PR, state code, lane, reason code, head SHA, at. Written whenever the derived PR state changes, from one hook where api and worker save PR changes;
  - `head_changes`: PR, before SHA, after SHA, pusher, by bot, is base merge, at. Written on `synchronize` events;
  - `pull_requests.ready_at` (first time), `merged_at`, `closed_at` and `merge_sha`.
- **Touches:** packages/db (schema, hook), apps/worker and apps/api (hook call sites)
- **Depends on:** S-05 done
- **Done when:** `pnpm --filter @pra/db test` passes `metric-logs.test.ts`. A scripted life cycle (ready → round → findings → decided → ready to merge → a person's commit → merged) gives the expected lane rows in order and one head change with by bot false. An "Update branch" merge commit is marked as a base merge.

### S-19-T2: Metric calculations in core
- **Goal:** Pure functions over PR histories, as defined in `docs/06-metrics.md`:
  1. Agent work per PR: the sum of stage durations across rounds, implementer runs, fix checks and retries. Queue time is excluded; failed and timed-out stages count.
  2. Ready → merge, split into Agents working (queue included), Action needed and Ready to merge, from the lane intervals.
  3. Cost per PR: every agent session at pay-per-use rates, tokens alongside. Trials and the analyst are excluded and reported separately.
  4. PRs where a chain used 3 of 3 with a fix still open, next to PRs with more than 3 rounds in total.
  5. Merged PRs that reached Ready to merge and then got a commit that is neither by the bot nor a base merge, or were merged at another SHA.

  Each function returns the value, the sample size, and `tooFew` below 10 PRs. Use medians where the prototype does.
- **Touches:** packages/core (metrics)
- **Depends on:** S-05 done
- **Parallel with:** S-19-T1
- **Done when:** `pnpm --filter @pra/core test` passes `metrics.test.ts`. There is one fixture per metric, covering these edge cases: queue excluded, failed stage counted, base merge ignored, merged at another SHA counted, trials excluded. `tooFew` is true at 9 PRs and false at 10.

### S-19-T3: Overview and Cost API
- **Goal:** Two read-only endpoints:
  - `GET /api/insights/overview?range=14|30&author=&repo=`: the five metrics with sample sizes, the lane split and the PR rows. Author means the PR author;
  - `GET /api/insights/cost?range=&repo=`: real spend by day, repository, agent role and level. Trials and the analyst come as separate totals, grouped by run kind and zero when there are none.
- **Touches:** apps/api, packages/db (metric queries)
- **Depends on:** S-19-T1, S-19-T2
- **Done when:** `pnpm --filter @pra/api test` passes `insights-overview.routes.test.ts` on a seeded fixture of 17 merged PRs in one repository and 3 in another:
  - the repository filter gives sample size 17;
  - the author filter uses the PR author;
  - cost totals equal the sum of session costs;
  - a trial run's cost appears only in the separate total;
  - a GET changes no row counts.

### S-19-T4: Quality and Trust ladder API
- **Goal:** Two read-only endpoints:
  - `GET /api/insights/quality`: per review level, the rounds, findings, Confirmed and Refuted rates (levels 1–2 are "Unchecked"), the share of decided findings marked Implement, and the average round cost. Also per instruction version recorded on runs, with one group when no version is recorded. Rates are hidden below 5 findings, the prototype's minimum-sample rule;
  - `GET /api/insights/trust?repo=`: per repository, the current default level, days at that level, and that level's decided-Implement, Confirmed and Refuted rates with the number of findings and rounds.
- **Touches:** apps/api, packages/db
- **Depends on:** S-19-T1
- **Parallel with:** S-19-T3
- **Done when:** `pnpm --filter @pra/api test` passes:
  - `insights-quality.routes.test.ts`: rates match a hand-computed fixture; a level with 4 findings returns `tooFew`; the Implement share counts decided findings only;
  - `insights-trust.routes.test.ts`: one row per repository, and the repository filter applies.

### S-19-T5: Insights shell and Overview
- **Goal:** Add Insights with the tabs Overview, Cost, Quality and Trust ladder. Filters for range (14 or 30 days), PR author and repository live in the search params. Overview shows:
  - five tiles, each with a label, a number and one line with the sample size ("Based on 17 PRs merged"), plus "too few for firm conclusions" below 10;
  - the ready → merge lane split;
  - the PR table, collapsed;
  - "Not measured yet", collapsed, listing the "Later" items from `docs/06-metrics.md`.

  There are no trends and no deltas.
- **Touches:** apps/web (Insights routes, Overview)
- **Depends on:** S-19-T3
- **Done when:** `pnpm --filter @pra/web test` passes `insights-overview.test.tsx`: the sample size line shows on every tile; the too-few text appears at 9 PRs; filters round-trip through the URL; the PR table and "Not measured yet" start collapsed.

### S-19-T6: Cost and Quality tabs
- **Goal:** Cost tab:
  - stat tiles: spent today against the budget, the range total, the average round;
  - spend by day (Recharts through the shadcn Chart);
  - spend by repository, by agent role and by review level;
  - trials and analyst as separate totals.

  Quality tab: the per-level table and the per-instruction-version table from S-19-T4, with "too few" cells below 5 findings.
- **Touches:** apps/web (Insights Cost and Quality)
- **Depends on:** S-19-T3, S-19-T4
- **Parallel with:** S-19-T5
- **Done when:** `pnpm --filter @pra/web test` passes `insights-cost-quality.test.tsx`: the chart renders from the API data; the trial and analyst totals are separate; levels 1–2 show "Unchecked"; cells below 5 findings show "too few".

### S-19-T7: Trust ladder tab
- **Goal:** One card per repository. It shows the 1–6 ladder with the current level highlighted, and the line "Level N for D days: X% of decided findings were Implement, Y% confirmed, Z% refuted. Based on F findings in R rounds." It links to "Change the level" (Settings → Repositories). The repository filter applies. S-15-T4 adds the level 5 shadow log section later.
- **Touches:** apps/web (Insights Trust ladder)
- **Depends on:** S-19-T4
- **Parallel with:** S-19-T5, S-19-T6
- **Done when:** `pnpm --filter @pra/web test` passes `trust-ladder.test.tsx`: one card per repository; the current level is highlighted; the too-few state shows when fewer than 5 findings exist.

### S-19-T8: End-to-end Insights
- **Goal:** A Playwright test of US-15 on a seeded history.
- **Touches:** e2e tests (`insights.spec.ts`, seeded fixture), `e2e/a11y-routes.ts` (add the Insights routes)
- **Depends on:** S-19-T5, S-19-T6, S-19-T7
- **Done when:** `pnpm test:e2e insights.spec.ts` passes:
  - Overview filtered to the repository with 17 merged PRs shows "Based on 17 PRs merged" on every metric and three lane values for ready → merge;
  - an author filter down to 5 PRs adds "too few for firm conclusions";
  - Cost shows trial and analyst totals apart from PR cost;
  - no text on any Insights tab matches `/[+-]\d+%|better|worse|trend/i`;
  - Trust ladder shows both repositories.

### S-19-T9: Shadow log in Insights → Trust ladder
- **Goal:** Per repository, the trust ladder endpoint adds the shadow summary for the last 14 days: "Level 5 would have fixed X of Y PRs", one row per PR ("would have fixed and pushed" or "would have waited: <reason>"), and "Not enough data yet (n of 5 PRs)" while fewer than 5 PRs at level 3+ have entries. The Trust ladder page shows it as the "Level 5 shadow log" section, with a ⓘ "Nothing was pushed".
- **Touches:** apps/api (trust ladder endpoint), apps/web (Trust ladder section)
- **Depends on:** S-19-T7, S-15 done
- **Done when:** `pnpm --filter @pra/api test` passes `insights-shadow.routes.test.ts`: the counts match the seeded shadow rows, the repository filter applies, and fewer than 5 PRs gives the not-enough-data state. `pnpm --filter @pra/web test` passes `shadow-log.test.tsx`.

## S-20: connect-repository-in-settings

Any repository the GitHub App can reach is connected and configured through Settings alone, with a signed save bar, a settings-change log and integration health. Roadmap: [S-20](roadmap.md#s-20-connect-a-repository-in-settings)
**Slice check:** `pnpm test:e2e connect-repo.spec.ts` passes. A second repository is connected and configured in Settings, and its ready PR appears on the board and is reviewed by its own rules, with no code or seed change.

### S-20-T1: Settings-change log
- **Goal:** Add the table `settings_changes`: area, entity, actor (team member, bot or by hand), signer, at, before JSON, after JSON, note. Add an api service `applySignedSettingsChange({ area, entity, before, after, signer })` that writes the change and the log row in one transaction. It returns 409 when `before` is stale, meaning someone saved in between (Concurrent edits NFR). Route every signed settings write that already exists through it (for example Team, pause and resume, daily budget, agent slots). Add the rule to AGENTS.md so later slices use it.
- **Touches:** packages/db, apps/api, AGENTS.md
- **Depends on:** S-01 done
- **Done when:** `pnpm --filter @pra/api test` passes `settings-change.test.ts`: a signed change writes one log row with before, after and the signer; an unsigned call is rejected; a stale `before` returns 409 and writes nothing; an existing Team edit now writes a log row.

### S-20-T2: Settings shell, save bar and signed confirmation
- **Goal:** Build the Settings layout:
  - a Sidebar with the approved groups, driven by a page registry so only built pages appear. General: Budget & status, Models, Team, Integrations, Alerts. Repositories. Review: Review levels, Instructions, Pipeline. Improve: Experiments, Learning. System: Audit log;
  - an "Affects:" line at the top of every page;
  - a sticky SaveBar ("N unsaved changes", Discard, Save…);
  - a SignedSaveDialog: an AlertDialog with the before/after table and the signature picker.

  Move existing settings pages such as Team into the shell. Export the registry for the command palette's Settings group.
- **Touches:** apps/web (settings layout, SaveBar, SignedSaveDialog, page registry)
- **Depends on:** S-01 done
- **Parallel with:** S-20-T1
- **Done when:** `pnpm --filter @pra/web test` passes `settings-shell.test.tsx`:
  - the sidebar lists registered pages only;
  - editing two fields shows "2 unsaved changes";
  - Discard resets them;
  - Save opens the dialog with two before/after rows and blocks confirm without a signature;
  - leaving the page with unsaved changes asks first.

### S-20-T3: Repository listing and connect API
- **Goal:** Add `GitHubGateway.listAccessibleRepositories()`, which covers every installation of the App. Add these endpoints:
  - `GET /api/settings/repositories`: connected repositories with their config, plus the App-reachable ones not yet connected;
  - `POST /api/settings/repositories`: connect, signed, with an initial RepositoryConfig;
  - `GET/PUT /api/settings/repositories/:id`: signed, through `applySignedSettingsChange`.

  All of them validate with the core RepositoryConfig schema: default level, default branch, install command, ClickUp space, sensitive files (pattern plus reason), and the change-type rules (existing-parts paths, size threshold, one-way-door paths, large-PR line threshold). Webhooks and the reconcile poll pick up a newly connected repository without a restart.
- **Touches:** packages/integrations (GitHubGateway), apps/api
- **Depends on:** S-20-T1
- **Done when:** `pnpm --filter @pra/api test` passes `repositories.routes.test.ts` with a GitHubGateway double that lists 3 repositories (WB connected, two available):
  - connecting `acme/second-repo` writes its config and one settings change;
  - an invalid glob returns 400;
  - a sensitive file without a reason returns 400;
  - connecting a repository the App cannot reach returns 404;
  - a webhook for the new repository after connecting creates its PR row.

### S-20-T4: Repository settings pages
- **Goal:** Settings → Repositories lists the connected repositories (name, default level, ClickUp on or off) and offers a "Connect a repository" Combobox of the App-reachable ones. The repository page has every RepositoryConfig field, with sensitive files and change-type rules as editable tables, the "Affects:" line, the save bar and the signed confirmation.
- **Touches:** apps/web (Settings → Repositories)
- **Depends on:** S-20-T2, S-20-T3
- **Done when:** `pnpm --filter @pra/web test` passes `repository-settings.test.tsx`: the connect picker lists only unconnected repositories; a sensitive-file row without a reason blocks the save with a message; the confirm table lists every changed field before and after.

### S-20-T5: Retire the WB seed
- **Goal:** Remove the WB config from the S-01 seed command and keep it only as a test fixture. The WB row already in the database stays, and Settings edits it like any other repository. Add `scripts/check-repo-agnostic.ts` to `pnpm lint`. It fails when `workflowbuilder` or other WB-only names appear in `apps/` or `packages/` outside test fixtures (NFR Repository-agnostic). Document "Connect a repository" in AGENTS.md.
- **Touches:** packages/db (seed), scripts, root package.json, AGENTS.md
- **Depends on:** S-20-T3
- **Done when:** `pnpm lint` passes. The script's own test `check-repo-agnostic.test.ts` shows that it fails when a WB name is added under `apps/worker/src`. The seed holds no repository-specific values.

### S-20-T6: Integrations status API
- **Goal:** `GET /api/settings/integrations` reports:
  - GitHub: whether the App is configured (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_WEBHOOK_SECRET` present), the installations, the repositories it can act on, the last webhook delivery, deliveries and signature failures in the last 24 h, and the last reconcile poll;
  - ClickUp: whether the key is present, and the last call's result.

  `POST /api/settings/integrations/clickup/test` calls ClickUpGateway (who am I) and returns ok or the error text. `PUT /api/settings/integrations` switches the after-round GitHub comment (signed). Missing credentials show "not configured", never a fake success.
- **Touches:** apps/api, packages/integrations (health calls)
- **Depends on:** S-20-T1
- **Parallel with:** S-20-T3
- **Done when:** `pnpm --filter @pra/api test` passes `integrations.routes.test.ts`:
  - without `CLICKUP_API_KEY` the ClickUp status is "not configured";
  - delivery counts match the seeded GitHub events;
  - the ClickUp test with the double's 401 returns the error text;
  - the comment switch writes a settings change.

### S-20-T7: Integrations page
- **Goal:** Settings → Integrations has three parts:
  - a GitHub card: status, installations, repositories it can act on, event delivery health (last delivery, 24 h count, failures);
  - a ClickUp card: status and Test connection;
  - a Switch for the after-round "Ready for team member review" comment, going through the save bar.
- **Touches:** apps/web (Settings → Integrations)
- **Depends on:** S-20-T2, S-20-T6
- **Done when:** `pnpm --filter @pra/web test` passes `integrations-page.test.tsx`: the not-configured states show their text; Test connection shows the result; the switch counts as one unsaved change.

### S-20-T8: End-to-end second repository
- **Goal:** A Playwright test of US-16 with the GitHubGateway double.
- **Touches:** e2e tests (`connect-repo.spec.ts`), `e2e/a11y-routes.ts` (add the Settings routes)
- **Depends on:** S-20-T4, S-20-T5, S-20-T7
- **Done when:** `pnpm test:e2e connect-repo.spec.ts` passes:
  - in Settings → Repositories, connect `acme/second-repo` with default level 2, branch `develop`, sensitive file `db/migrations/**` with a reason, and ClickUp off, then sign;
  - the double sends ready_for_review for `acme/second-repo#12`, and the board shows the card with the repository label;
  - round 1 runs at level 2, with Verify off;
  - the sensitive-file rule applies to that repository only;
  - Integrations lists both repositories and a recent delivery.

### S-20-T9: Connect a real second repository (Needs Alek)
- **Goal:** Prove that a second real repository works through Settings alone.
- **Touches:** none (manual check)
- **Depends on:** S-20-T8, S-01 done (including its real GitHub App wiring)
- **Done when:** a PR in the second repository appears on the board, runs round 1 by its own settings, and gets the "Ready for team member review (round 1)" comment. Settings → Integrations shows its deliveries.
- **Steps for Alek:**
  1. Create or pick a second repository. A private throwaway repository with a default branch and one source file is enough.
  2. On github.com open Settings → Applications → Installed GitHub Apps → `pr-review-agent` → Configure. For an organisation, use the organisation's Settings → GitHub Apps instead. Under Repository access, choose "Only select repositories", add the second repository, and click Save.
  3. In the app, open Settings → Integrations. The repository must appear under the repositories PR Review Agent can act on.
  4. Open Settings → Repositories → Connect a repository and pick it. Set default level 2, the default branch, an install command (or leave it empty), and ClickUp off. Click Save and sign.
  5. In the second repository, open a PR and mark it ready for review.
  6. Within about 10 s the board shows its card with the repository label. Round 1 runs at level 2, and GitHub shows "Ready for team member review (round 1)". Settings → Integrations shows the delivery.

## S-21: models-levels-and-audit-log

Models per agent role, the review level ladder with inherited per-level settings and a default level, and a searchable Audit log. Roadmap: [S-21](roadmap.md#s-21-models-levels-and-audit-log)
**Slice check:** `pnpm test:e2e models-levels-audit.spec.ts` passes. A signed model change reaches the next round's agent, an injected model name is rejected, a level override is inherited upward, and the Audit log finds the change with before and after.

### S-21-T1: Level and model settings in core and db
- **Goal:** In core:
  - the 1–6 ladder: name and what each level adds;
  - per-level settings inherited from the level below: reviewer brief, most findings (at most 7), most questions, review timeout, models per role, and at level 5 automatic patches per chain (default 2);
  - `resolveLevelSettings(n, overrides)`;
  - models per role (reviewer, verifier, implementer, judge, analyst), with defaults from tech-stack.md and per-level overrides. tech-stack.md names no analyst model, so the analyst defaults to `claude-sonnet-5-5`. Every name passes the core model-name validation.

  In db: the tables `level_settings` (level, own values) and `model_settings` (role, model), and a global default level for repositories without their own (the RepositoryConfig default level becomes optional).
- **Touches:** packages/core, packages/db
- **Depends on:** S-20 done
- **Done when:** `pnpm --filter @pra/core test` passes `level-settings.test.ts`:
  - level 4 inherits level 3's timeout until it has its own;
  - most findings above 7 is rejected;
  - `--model=x` and names with spaces are rejected;
  - a level 6 model override beats the role default.

  The migration applies with the defaults.

### S-21-T2: Worker snapshots the settings per run
- **Goal:** At run start, resolve the level settings and models and snapshot them onto the run row (the level is frozen for a run). Pass each role's model to `AgentRunner`, and apply the timeout, the limits and the level 5 patch cap from the snapshot. A model that fails validation fails the run with the reason before any spend. Run detail lists the models used.
- **Touches:** apps/worker, packages/agents (model parameter)
- **Depends on:** S-21-T1
- **Done when:** `pnpm --filter @pra/worker test` passes `run-settings-snapshot.test.ts`:
  - after the verifier model changes, a new run's verifier double gets the new model and a running run keeps the old one;
  - a level 3 timeout override times out the review stage at the new value;
  - a repository without its own level starts at the global default.

### S-21-T3: Models and levels API
- **Goal:** Add these endpoints:
  - `GET/PUT /api/settings/models`;
  - `GET /api/settings/levels`;
  - `GET/PUT /api/settings/levels/:n`, with own values or "inherit";
  - `PUT /api/settings/default-level`.

  Each PUT is signed through `applySignedSettingsChange`, with before and after. Validation errors name the field.
- **Touches:** apps/api
- **Depends on:** S-21-T1
- **Parallel with:** S-21-T2
- **Done when:** `pnpm --filter @pra/api test` passes `models-levels.routes.test.ts`: an invalid model returns 400 naming the role; inherit removes the own value; each PUT writes one settings change.

### S-21-T4: Models page
- **Goal:** Settings → Models shows a Table of roles. Each role has a model Select with the defaults plus validated free text, and a note on the levels that override it, for example "Level 6 uses claude-opus-5-5". The page uses the save bar and the signed confirmation.
- **Touches:** apps/web (Settings → Models)
- **Depends on:** S-21-T3
- **Done when:** `pnpm --filter @pra/web test` passes `models-page.test.tsx`: an invalid name shows the error and blocks the save; the override note lists the levels.

### S-21-T5: Review levels pages
- **Goal:** Settings → Review levels shows the 1–6 ladder with what each level adds, and the default level for repositories without their own. A level page shows:
  - each setting as inherited plain text with Override, using the ToggleGroup Inherited / Own value;
  - on level 5, the four autofix conditions as numbered rules. Only "at most N automatic patches per chain" is editable.
- **Touches:** apps/web (Settings → Review levels)
- **Depends on:** S-21-T3
- **Parallel with:** S-21-T4
- **Done when:** `pnpm --filter @pra/web test` passes `review-levels.test.tsx`: an inherited value names its source level; Override and then Inherit returns to the inherited value; only N is editable on level 5.

### S-21-T6: Audit log API
- **Goal:** Add `GET /api/audit?q=&area=&actor=&from=&to=&cursor=` over `settings_changes`. It includes changes the bot made by itself, searches the area, the actor and the before/after values, returns the newest first, and is paginated and read-only.
- **Touches:** apps/api, packages/db (audit query)
- **Depends on:** S-20 done
- **Parallel with:** S-21-T1
- **Done when:** `pnpm --filter @pra/api test` passes `audit.routes.test.ts`: searching "verifier" finds a model change; the area and actor filters work; bot rows are included; pagination is stable.

### S-21-T7: Audit log page
- **Goal:** Settings → Audit log has a search Input, Select filters for area and who, and a date range. Its Table shows when, who (a name, the bot, or by hand), the area and a summary, and each row expands to before and after. The URL keeps the filters.
- **Touches:** apps/web (Settings → Audit log)
- **Depends on:** S-21-T6
- **Done when:** `pnpm --filter @pra/web test` passes `audit-page.test.tsx`: the filters round-trip through the search params; expanding a row shows before and after.

### S-21-T8: End-to-end models, levels and audit
- **Goal:** A Playwright test of FR-075, FR-078 and FR-082 together.
- **Touches:** e2e tests (`models-levels-audit.spec.ts`), `e2e/a11y-routes.ts`
- **Depends on:** S-21-T2, S-21-T4, S-21-T5, S-21-T7
- **Done when:** `pnpm test:e2e models-levels-audit.spec.ts` passes:
  - change the verifier model (signed), and the next round's verifier double receives it;
  - `--dangerous` is rejected with a message;
  - override level 3's review timeout, and level 4 shows it as inherited;
  - set the default level to 2, and a repository without its own level starts at 2;
  - an Audit log search for "verifier" shows the change with before, after and the signer.

### S-21-T9: Settings → Alerts (signed)
- **Goal:** Add `GET/PUT /api/settings/alerts` through the signed settings-change log, with before and after. Add the Settings → Alerts page:
  - a switch and threshold for each alert kind: cost in dollars, above 0; budget at 50, 70, 80 or 90%, and at 100%;
  - the general alerts task ID, which is required;
  - a preview of the ClickUp comment.

  The page lives in the Settings shell, with the save bar and the signed confirmation.
- **Touches:** apps/api (settings route), apps/web (Settings → Alerts page)
- **Depends on:** S-18 done, S-20 done (Settings shell, save bar, settings-change log)
- **Done when:** `pnpm --filter @pra/api test` passes `settings-alerts.routes.test.ts`: an unsigned PUT returns 400; a signed PUT writes one settings change with before and after; a cost of 0 or less returns 400. `pnpm --filter @pra/web test` passes `settings-alerts.test.tsx`: the save bar counts the changes, and the confirm table shows before and after.

## S-22: instructions-and-pipeline

Versioned instruction files by scope with signed activation, trials that compare a draft on a PR without touching it, and a read-only pipeline diagram. Roadmap: [S-22](roadmap.md#s-22-instructions-and-pipeline)
**Slice check:** `pnpm test:e2e instructions.spec.ts` passes:
- flow D: edit, see the diff, save a draft, try it on a PR, compare, then activate it signed;
- the PR's state is unchanged by the trial, and the next round records the new version;
- the Pipeline drawer shows the stage's model and instructions.

### S-22-T1: Instruction versions and scope resolution
- **Goal:** Add three tables:
  - `instruction_files`: name, and scope global, repository, or level copy (with the repository or the level);
  - `instruction_versions`: file, number, content, note, status (draft / active / archived), author or signer, created at, activated at;
  - `run_instruction_versions`: run, version. It counts the runs that used a version.

  Add core `resolveInstructions(repo, level)`, which resolves in the order global → repository → level copy. A broken JSON file falls back field by field with a warning (config resilience).
- **Touches:** packages/core, packages/db
- **Depends on:** S-07 done, S-20 done
- **Done when:** `pnpm --filter @pra/core test` passes `instruction-resolve.test.ts`:
  - a repository copy beats global, and a level copy beats both;
  - one repository's copy never applies to another repository;
  - a broken `review-levels.json` field falls back with a warning.

  The migration applies, and a db test enforces one active version per file.

### S-22-T2: Import version 1 from a copy of the wb-factory knowledge folder
- **Goal:** Add `pnpm instructions:import --from <dir>`. It reads a read-only copy of `~/Projects/wb-factory/knowledge` and creates version 1 of each file. The files are in Polish and name Workflow Builder, so the default scope map puts them all at the WB repository scope. Global version 1 is the built-in prompt text used since S-01, which keeps other repositories free of WB rules. The map lives in `instructions-import.json`. `lessons.md` starts as an empty version 1, and `lessons-candidates.md` is not imported (OQ15: no lessons, runs or decisions). The import is idempotent and never writes to the source.
- **Touches:** packages/db (import script), root package.json
- **Depends on:** S-22-T1
- **Done when:** `pnpm --filter @pra/db test` passes `instructions-import.test.ts`: a fixture folder gives the expected rows and scopes; a second run adds nothing; a read-only source folder causes no error. Running the import against `cp -R ~/Projects/wb-factory/knowledge <scratch dir>` creates one active version 1 per file.

### S-22-T3: Agents read instructions from versions
- **Goal:** Replace the instruction loading used since S-01 with `resolveInstructions(repo, level)` for the reviewer, verifier, implementer and judge. Record the version ids each run used in `run_instruction_versions`; Run detail shows them (FR-063).
- **Touches:** apps/worker, packages/agents (prompt builders take the resolved text)
- **Depends on:** S-22-T1
- **Done when:** `pnpm --filter @pra/worker test` passes `run-instructions.test.ts`:
  - a WB run gets the WB copy, and another repository's run gets the global one;
  - activating version 2 changes the next run's prompt, but not a running one;
  - each run records the version ids it used.

### S-22-T4: Instructions API
- **Goal:** Add these endpoints:
  - `GET /api/instructions`: files by scope, with the active version and any draft;
  - `GET /api/instructions/:id`: versions with note, author or signer, and runs used;
  - `PUT /api/instructions/:id/draft`: unsigned, "by hand";
  - `POST /api/instructions/:id/activate` and `/rollback`: signed through `applySignedSettingsChange`, with before and after (version numbers and a diff summary);
  - `POST /api/instructions/:id/copies`: start a repository or level copy from the active version, as a draft.
- **Touches:** apps/api
- **Depends on:** S-22-T1
- **Parallel with:** S-22-T2, S-22-T3
- **Done when:** `pnpm --filter @pra/api test` passes `instructions.routes.test.ts`:
  - saving a draft writes no settings change;
  - activate writes one and archives the old active version;
  - rollback re-activates an older version;
  - an unsigned activate returns 400.

### S-22-T5: Instructions list and editor
- **Goal:** Settings → Instructions lists files grouped by scope (global, each repository, each level copy). The editor has:
  - a Textarea and a live diff against the active version;
  - a note and Save as draft;
  - "Try on a PR…", enabled once a draft exists and wired in S-22-T8;
  - "Activate version N…" and Rollback, each an AlertDialog with before, after and the signature;
  - the version history with the runs that used each version.
- **Touches:** apps/web (Settings → Instructions)
- **Depends on:** S-22-T4
- **Done when:** `pnpm --filter @pra/web test` passes `instructions-editor.test.tsx`: the diff shows added and removed lines; Save as draft sends no signature; Activate needs a signature; the history lists the runs used.

### S-22-T6: Trial runs that leave the PR untouched
- **Goal:** A trial is two runs of kind `trial` on the same commit: A uses the active versions, and B uses the draft or the lessons file plus a lesson candidate. It starts unsigned, as "Started by hand". Trial runs are left out of the PR state table, chains, GitHub comments, ClickUp notices, alerts and PR cost; their cost is reported separately. Add core `compareFindings(a, b)`, which splits findings into only in A, only in B and in both. Two findings match on file, overlapping lines and normalised title.
- **Touches:** packages/core (compare rule, state-table exclusion), apps/worker (trial run kind)
- **Depends on:** S-22-T3
- **Done when:** `pnpm --filter @pra/core test` passes `trial-compare.test.ts`. `pnpm --filter @pra/worker test` passes `trial-run.test.ts`:
  - both runs use the same commit;
  - the PR's state and board lane are unchanged after both finish;
  - the GitHub and ClickUp doubles record no calls;
  - run B's prompt contains the draft text.

### S-22-T7: Trials API
- **Goal:** Add these endpoints:
  - `POST /api/trials` with `{ pr, instructionDraft | lessonCandidate }`: unsigned;
  - `GET /api/trials`;
  - `GET /api/trials/:id`: status, cost of A and of B, the compare buckets and the instruction diff.
- **Touches:** apps/api
- **Depends on:** S-22-T6
- **Done when:** `pnpm --filter @pra/api test` passes `trials.routes.test.ts`: the start is recorded "Started by hand"; the compare buckets match the core rule; the costs come from the trial sessions only.

### S-22-T8: Try on a PR and Compare pages
- **Goal:** Add three things:
  - the "Try on a PR…" Dialog: a PR picker Combobox and Start the trial;
  - Settings → Experiments, a list of trials;
  - the Compare page: only in A, only in B, in both, cost of A and B, the instruction diff, and "Go to activate version N".
- **Touches:** apps/web (Try dialog, Experiments, Compare)
- **Depends on:** S-22-T5, S-22-T7
- **Done when:** `pnpm --filter @pra/web test` passes `trial-compare.test.tsx`: the dialog starts a trial for the picked PR; Compare renders the three buckets and both costs; the activate link opens the editor on the draft.

### S-22-T9: Pipeline descriptor API
- **Goal:** Add a read-only `GET /api/pipeline`, built from code and settings. It lists the stages Checks, Task, Change type, Review, Verify, Implement, Fix check and Analyst. Each stage has:
  - its model, from the same resolver the worker uses;
  - its tool allow-list, exported from the packages/agents role policies;
  - its prompt: the active instruction files and versions;
  - its output format: schema name and fields;
  - its timeout and attempts;
  - the level where it turns on.
- **Touches:** packages/agents (export role tool policies), apps/api
- **Depends on:** S-22-T1
- **Parallel with:** S-22-T4
- **Done when:** `pnpm --filter @pra/api test` passes `pipeline.routes.test.ts`:
  - Verify turns on at level 3, Implement at 4 and Analyst at 6;
  - Review lists only read-only tools;
  - Implement lists no shell;
  - each model matches the settings.

### S-22-T10: Pipeline diagram
- **Goal:** Settings → Pipeline shows a read-only `@xyflow/react` diagram: no dragging, connecting or deleting. There is one node per stage, labelled with the level where it turns on. A click, or Enter on a focused node, opens a Sheet with the model, tools, prompt (linking to the instruction file), output format, timeout and attempts.
- **Touches:** apps/web (Settings → Pipeline)
- **Depends on:** S-22-T9
- **Done when:** `pnpm --filter @pra/web test` passes `pipeline-page.test.tsx`: nodes are not draggable; Enter on the Review node opens the drawer with its model.

### S-22-T11: End-to-end instructions, trial and pipeline
- **Goal:** A Playwright test of prototype flow D and the Pipeline page.
- **Touches:** e2e tests (`instructions.spec.ts`), `e2e/a11y-routes.ts`
- **Depends on:** S-22-T2, S-22-T8, S-22-T10
- **Done when:** `pnpm test:e2e instructions.spec.ts` passes:
  - edit review-rules; the diff appears; add a note; Save as draft;
  - Try on a PR: both trial runs finish with doubles, and Compare shows only in A, only in B, in both, and both costs;
  - PR #272's lane and Next step are unchanged;
  - Activate version 2 (signed); the next round on #272 lists version 2 in Run detail;
  - in Pipeline, the Review node's drawer shows its model and review-rules v2.

## S-23: learning-from-closed-prs

After a level 6 PR closes, the analyst proposes at most 5 lesson candidates. A person edits, tries, rejects or accepts them, and an accepted lesson becomes a new lessons-file version. Roadmap: [S-23](roadmap.md#s-23-learning-from-closed-prs)
**Slice check:** `pnpm test:e2e learning.spec.ts` passes:
- merging a level 6 PR runs the analyst;
- a duplicate candidate rises to 2 PRs and is accepted, signed;
- the next round's prompt contains the lesson;
- a 1-PR candidate cannot be accepted;
- the PR author's comments never reach the analyst.

### S-23-T1: Lesson candidates model
- **Goal:** Add three tables:
  - `analyses`: PR, run, started by (bot or by hand), status, candidate count;
  - `lesson_candidates`: title, text, status (open / accepted / rejected), PR count, reject reason, accepted lessons version;
  - `lesson_candidate_sources`: candidate, PR, analysis.

  Add two core rules, built on the F-03 learning rules:
  - `mergeCandidates(existing, proposed)`: a proposal marked as a duplicate of an open candidate raises that candidate's PR count instead of adding a new one; at most 5 new per closed PR; the same PR never counts twice;
  - `canAcceptLesson(candidate)`: at least 2 PRs, otherwise the reason "1 of 2 PRs: waits for one more".
- **Touches:** packages/core, packages/db
- **Depends on:** S-08 done, S-22 done
- **Done when:** `pnpm --filter @pra/core test` passes `lesson-candidates.test.ts`:
  - 6 proposals keep 5;
  - a duplicate raises the PR count to 2;
  - the same PR twice stays at 1;
  - the accept gate gives the reason text.

  The migration applies.

### S-23-T2: Analyst adapter
- **Goal:** Add the `analyst` role adapter on the Anthropic TS SDK with structured output, following the judge adapter's pattern. Its input:
  - the closed PR's findings with decisions and reasons;
  - answers and signed opinions;
  - GitHub review comments, with the PR author's own comments already removed;
  - the active lessons file;
  - the open candidates (id and title).

  Its output is at most 5 candidates `{ title, lesson, evidence, duplicateOf? }`, validated with Zod. The model comes from the analyst role setting. The session and its real cost are recorded under run kind `analyst`. Without a key it fails with "model access not configured".
- **Touches:** packages/agents
- **Depends on:** S-08 done, S-22 done
- **Parallel with:** S-23-T1
- **Done when:** `pnpm --filter @pra/agents test` passes `analyst.test.ts` with an SDK double: output that breaks the schema (6 items, or a missing title) is rejected; the prompt contains the open candidates' ids; a missing key fails clearly.

### S-23-T3: Analyst job
- **Goal:** A worker job (pg-boss, keyed by PR and analysis) that runs the analyst. The bot starts it when a level 6 PR is merged or closed; a person can start it by hand (unsigned) on any closed PR. The job:
  - builds the input with the core rule that drops the PR author's own comments, matched by GitHub login;
  - runs the adapter, then `mergeCandidates`;
  - stores the candidates and the learning status ("Analyst is running", "Analyst finished: N candidates", "Analyst failed").

  Pause and budget apply. The cost goes to the analyst bucket, not to the PR.
- **Touches:** apps/worker
- **Depends on:** S-23-T1, S-23-T2
- **Done when:** `pnpm --filter @pra/worker test` passes `analyst-job.test.ts`:
  - closing a level 6 PR queues one analysis by the bot;
  - closing a level 5 PR queues none;
  - the adapter double's input has no comment by the author;
  - a duplicate raises an existing candidate's count;
  - the status changes are recorded.

### S-23-T4: Learning API and accepting a lesson
- **Goal:** Add these endpoints:
  - `GET /api/learning/candidates`;
  - `PUT /api/learning/candidates/:id`: edit the text, unsigned, "by hand";
  - `POST /api/learning/candidates/:id/reject`: signed, reason required;
  - `POST /api/learning/candidates/:id/accept`: signed, refused with the reason below 2 PRs;
  - `POST /api/prs/:id/analyst`: run the analyst by hand, unsigned.

  Accept adds the lesson to the lessons file of the candidate's repository scope as a new active version created by the bot. It logs the signed accept and the bot's version change through the settings-change log. Trying a candidate reuses `POST /api/trials`.
- **Touches:** apps/api
- **Depends on:** S-23-T1
- **Parallel with:** S-23-T2, S-23-T3
- **Done when:** `pnpm --filter @pra/api test` passes `learning.routes.test.ts`:
  - accepting a 2-PR candidate creates lessons.md version N+1 as active and writes two log rows (the signed accept and the bot's version);
  - accepting a 1-PR candidate returns 409 with "1 of 2 PRs: waits for one more";
  - reject without a reason returns 400;
  - the next resolved instructions for that repository include the lesson.

### S-23-T5: Settings → Learning page
- **Goal:** Settings → Learning shows:
  - candidates with title, text, PR count and the linked source PRs;
  - Edit inline;
  - "Try on a PR…", using the S-22 dialog;
  - "Reject…", with a reason and a signature;
  - "Accept…", with a signature. Below 2 PRs it is disabled and a Tooltip says "1 of 2 PRs: waits for one more";
  - Accepted lessons, each with its lessons-file version.
- **Touches:** apps/web (Settings → Learning)
- **Depends on:** S-23-T4
- **Done when:** `pnpm --filter @pra/web test` passes `learning-page.test.tsx`: Accept is disabled with the reason at 1 PR; Reject needs a reason and a signature; an accepted lesson shows its version.

### S-23-T6: Learning status on closed PRs
- **Goal:** On a merged or closed level 6 PR, the banner shows "Merged by <name>" and the learning status line: running, finished with N candidates and a link to Learning, or failed. Every closed PR has an unsigned "Run analyst" action in the header.
- **Touches:** apps/web (PR page), apps/api (learning status in the PR payload)
- **Depends on:** S-23-T3, S-23-T4
- **Done when:** `pnpm --filter @pra/web test` passes `learning-status.test.tsx`: each status renders; "Run analyst" sends an unsigned request.

### S-23-T7: End-to-end learning
- **Goal:** A Playwright test of prototype flow E and US-13.
- **Touches:** e2e tests (`learning.spec.ts`), `e2e/a11y-routes.ts`
- **Depends on:** S-23-T5, S-23-T6
- **Done when:** `pnpm test:e2e learning.spec.ts` passes:
  - merge level 6 PR #278 (typed number and signature); the banner shows "Learning: Analyst is running" and then "Analyst finished";
  - Learning shows the "Snapshot tables…" candidate at 2 PRs; Edit it, then Accept, signed;
  - Accepted lessons shows lessons.md version N+1, and the next round's reviewer double receives the lesson in its prompt;
  - a 1-PR candidate shows Accept disabled with "1 of 2 PRs: waits for one more";
  - the analyst double's input has no comment by the PR author.

### S-23-T8: Analyst smoke on a real closed PR (Needs Alek)
- **Goal:** Prove the analyst works with the real model key on a real closed WB PR.
- **Touches:** none (manual check)
- **Depends on:** S-23-T7, S-01 done (including its real model key wiring)
- **Done when:** a real analysis finishes with at most 5 candidates linked to the PR. Its session shows a real cost under Analyst, not under the PR, and its input has no comment by the PR author.
- **Steps for Alek:**
  1. Check that `.env` has `ANTHROPIC_API_KEY`. The run spends real tokens on that key; the cost shows in Run detail.
  2. Pick a merged WB PR whose findings were decided and that has review comments from someone other than its author.
  3. On its PR page, click "Run analyst". It is unsigned.
  4. When the banner says "Analyst finished: N candidates", open Settings → Learning. Check that there are at most 5 candidates and each links to the PR.
  5. Open the analyst session's Run detail. Check that the input has no comment written by the PR author, and note the cost. Insights → Cost lists it under Analyst, not in PR cost.
  6. Accept nothing unless you want it in the lessons file. Reject is signed and lands in the Audit log.
