# PR Review Agent

pnpm monorepo (Node 24, pnpm 12, TypeScript). Product docs: `context/foundation/` (PRD, roadmap,
tech stack); design notes in `docs/`; the static UI prototype in `prototype/`.

## Layout

- `apps/web` (`@pra/web`): Vite + React 19 SPA, TanStack Router and Query, Tailwind, shadcn/ui.
- `apps/api` (`@pra/api`): Fastify API with Zod schemas and an OpenAPI document.
- `apps/worker` (`@pra/worker`): pg-boss jobs, one per run stage.
- `packages/core` (`@pra/core`): pure domain rules, reason codes, the run state machine.
- `packages/db` (`@pra/db`): Drizzle schema, migrations, queries.
- `packages/integrations` (`@pra/integrations`): `GitHubGateway`, `ClickUpGateway`, `BlobStore`,
  `GitMirror`, `Sandbox`.
- `packages/agents` (`@pra/agents`): `AgentRunner` and the reviewer, verifier, implementer, judge
  and analyst adapters.
- `e2e/`: Playwright specs; `e2e/support/` holds the test stack and its doubles.

## Commands

- `pnpm install`: one root `pnpm-lock.yaml`; shared dev versions live in the `catalog:` in
  `pnpm-workspace.yaml`.
- `pnpm lint`: ESLint plus `prettier --check`. `pnpm format` fixes formatting.
- `pnpm typecheck`, `pnpm test` (Vitest over all packages), `pnpm test:e2e` (Playwright, Chromium).
- `pnpm verify`: lint, typecheck and test in parallel. Run it before you commit.
- `pnpm --filter @pra/web dev` (http://localhost:5173), `pnpm --filter @pra/api dev` (port 3000).
- `docker compose up -d db`: one Postgres 17 shared by every worktree. `pnpm test` needs it up;
  each run creates and drops its own database (`@pra/db/testing` global setup).
- `pnpm db:migrate` applies Drizzle migrations and installs pg-boss and its queues (`JOBS`);
  `pnpm db:generate` writes a migration after a schema change.
- `pnpm db:seed-repo <seed.json> [--instructions <dir>]` upserts a repository (e.g.
  `packages/db/seeds/workflowbuilder.json`) and imports its instruction files as version 1.
- `pnpm instructions:import --from <dir> [--map <file>]` creates version 1 of each instruction
  file from a copy of the old knowledge folder (map: `packages/db/seeds/instructions-import.json`).
  Safe to run again; it never writes to `<dir>`.
- `pnpm --filter @pra/worker dev`; api and worker read the root `.env`.

## Code rules

- Relative imports keep their `.ts`/`.tsx` extension.
- Package boundaries are lint errors: `packages/core` imports no Node APIs, `pg`, `drizzle-orm`,
  `@pra/db`, `@pra/integrations` or `@pra/agents`; `apps/web` imports no `@pra/*` package except
  `@pra/core`.
- No runtime fake mode. Test doubles live only in `@pra/*/testing` and in tests; import
  `@pra/*/testing` only from `*.test.ts(x)`, `test/` and `e2e/`.
- Every integration sits behind its interface in `@pra/integrations`. Other code depends on the
  interface, never on an SDK or HTTP client directly.
- Migrations run only through `pnpm db:migrate`, never on app or worker start.
- Logs go through `@pra/integrations/logging` (pino, secrets redacted); no `console.log` in apps.
- No per-repository code paths. A new repository needs settings only, no code change.

## Web

- Routes are TanStack Router file routes in `apps/web/src/routes`. `routeTree.gen.ts` is generated
  and committed: after adding or renaming a route, run the dev server or `vite build` once.
- shadcn primitives go only in `apps/web/src/components/ui`. Feature components go in
  `apps/web/src/features/<feature>/`.
- All UI copy is English and lives only in `apps/web/src/copy`. Components never inline strings.

## API and domain

- Core returns reason codes `{ code, params }`, never prose. The web maps codes to copy.
- API errors have the shape `{ error: { code, params } }`.
- State-changing API calls send the header `X-PRA-Request: 1` and pass an `Origin` check.
- Signed actions take a Team member picked in the action's own form. Unsigned actions are recorded
  as "by hand".
- Every signed settings write goes through `applySignedSettingsChange`
  (`apps/api/src/settings/signed-change.ts`) with a `SettingsStore` for its area. It checks the
  signer (400 `signature_required` / `signer_unknown`), returns 409 `settings_stale` when the
  client's `before` is no longer stored, and writes the change and one `settings_changes` row in
  one transaction. The bot logs its own changes with `insertSettingsChange` (actor `bot`).
  `settings_changes` is the only audit log; add no other audit table.

## Environment

- Env var names only in `.env.example`; values only in the gitignored `.env`. Never commit a value.
- API keys are named `*_API_KEY` (for example `ANTHROPIC_API_KEY`, `CLICKUP_API_KEY`).
