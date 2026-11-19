---
change_id: F-01
title: Monorepo foundations (pnpm workspace, api, web, lint, tests, CI, AGENTS.md)
status: implementing
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Roadmap item F-01 (`monorepo-foundations`): `context/foundation/roadmap.md#f-01-monorepo-foundations`, tasks F-01-T1..T9 in `context/foundation/roadmap-tasks.md#f-01-monorepo-foundations`.

## Decisions

- Change folder is `context/changes/F-01/` (roadmap item ID), not the roadmap's change ID `monorepo-foundations`, because the session brief names this path. `/10x-new` kebab-case check was overridden for the same reason.
- Plan self-approved (unattended session). Questions from `/10x-plan` answered from the roadmap, tech-stack and orchestrator log instead of asking.
- F-01 has no "Needs Alek" tasks. The F-01-T8 check "CI run green on GitHub" stays pending because this session must not push.
- `pnpm verify` runs `lint`, `typecheck` and `test` in parallel through pnpm's regex script runner (no extra dependency).
- `apps/web/src/routeTree.gen.ts` is committed and excluded from ESLint/Prettier, so `tsc` works on a clean clone and in CI.
- API error codes: `invalid_request` (validation, 400) and `internal_error` (unexpected, 500), shape `{ error: { code, params } }`.
- TypeScript pinned to `~6.0.3`, not 7.x: typescript-eslint 8.73 (Phase 6) peers `typescript <6.1.0`, and TS 7 has no classic compiler API. `@types/node` follows the runtime major (`^24`).
- Shared dev versions live in the pnpm `catalog:` (`pnpm-workspace.yaml`). pnpm 12's default minimum release age is kept: `vitest` resolves to 5.1.0 because 5.1.1 was under a day old; no `minimumReleaseAgeExclude` entries.
- Root `lint` is a stub (exit 0) until Phase 6; root `test:e2e` is a stub that exits 1 until Phase 7.
- Relative imports use `.ts` extensions workspace-wide (`allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `erasableSyntaxOnly` moved from the Fastify template into `tsconfig.base.json`), so Node 24 runs sources natively (`fastify start src/app.ts`) and `tsc` rewrites them on build.
- `apps/api`: generator layout kept; its nested `.gitignore` (its `profile*` rule would hide future files) and `test/tsconfig.json` (TS 6 deprecates `baseUrl`) were removed. `tsconfig.json` covers `src` + `test` for `typecheck`; `tsconfig.build.json` emits `src` to `dist`. c8, ts-node, concurrently and fastify-tsconfig dropped. Tests keep `fastify-cli/helper.js` and close the app with Vitest's `onTestFinished`.
- API (Phase 3): `fastify-type-provider-zod` 7 + `zod` 4.6 imported as `zod/v4` (the provider README's import), `@fastify/swagger` 9 emitting OpenAPI 3.1.0. `GET /docs/json` is a small hidden route returning `fastify.swagger()`; no `@fastify/swagger-ui`. Plugins: `src/plugins/{zod,openapi,errors}.ts`; sample Zod route `POST /example` (listed as `/example/` in the document).
- Error handler: validation → 400 `invalid_request` with params `{ part, issues: [{ path, code }] }`; other 4xx (e.g. malformed JSON) keep their status with `invalid_request` and empty params; everything else → 500 `internal_error`, logged, never echoed. Codes live in `ApiErrorCode` in `src/plugins/errors.ts` until reason codes move to `@pra/core`.
- `apps/web` (Phase 4): `create-vite` 9.3.4 `react-ts` with `--eslint --no-interactive --no-immediate`. Its nested `eslint.config.js`, ESLint deps and `lint` script were removed (Phase 6 owns one root flat config with react-hooks/react-refresh), as were its `.gitignore`, README and demo assets; the favicon is the prototype's logo.
- `apps/web` tsconfig keeps the template's project references (`tsconfig.app.json` for `src`, `tsconfig.node.json` for the Vite/Vitest configs), both extending `tsconfig.base.json` with bundler resolution and DOM libs for the app. Every project is `noEmit`, so `typecheck` is `tsc -b`.
- TanStack Router plugin runs with `addExtensions: true`, so `routeTree.gen.ts` imports `./routes/*.tsx` like the rest of the workspace's relative imports. `src/router.ts` exports `createAppRouter({ queryClient, history? })` (QueryClient in router context) so tests render the real route tree on a memory history.
- `apps/web/vitest.config.ts` (jsdom + React plugin, no router plugin: tests use the committed route tree). Vitest globals stay off, so `src/test/setup.ts` registers Testing Library's `cleanup` and stubs jsdom's missing `window.scrollTo`.
- Web dev server: port 5173 with `strictPort`. Phase 4's `/` → `/prs` check: headless Chrome on the running dev server rendered the `/prs` page for `/`; the `/api`, `/webhooks`, `/health` proxy was checked against the running api (Fastify 404 JSON through 5173).
