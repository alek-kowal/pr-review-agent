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
- shadcn (Phase 5): `shadcn@4.23 init -b radix -p vega --no-monorepo --no-rtl -y` (Radix per tech-stack; Vega = Lucide + Inter, closest to the prototype). Without `-p` it hangs on a preset prompt even with `-y`. It added `cn` (shadcn's clsx + tailwind-merge replacement, used by `src/lib/utils.ts`), `radix-ui`, `lucide-react`, `@fontsource-variable/inter`, `tw-animate-css` and `shadcn` (for `shadcn/tailwind.css`). No components yet: `src/components/ui` appears with the first `shadcn add`.
- WB tokens are copied verbatim with prototype names into `apps/web/src/index.css`; shadcn variables are `var()` references to them (`--border` is shared, same meaning), so dark mode only redefines WB tokens. Tailwind's `dark:` variant mirrors the prototype (OS preference unless `data-theme="light"`, or `data-theme="dark"`); shadcn's `.dark` class is gone. WB colors are also Tailwind colors under prototype names (`bg-inset`, `text-brand-text`, `bg-viz-agent`); avatar, guide and shadow tokens stay plain CSS variables. `--radius` is 0.5rem.
- `apps/web/tsconfig.app.json` sets `rewriteRelativeImportExtensions: false` (Vite bundles, tsc never emits) so `@/….ts(x)` alias imports keep their extensions without TS2877. The `@/` alias lives in `tsconfig.json`, `tsconfig.app.json`, `vite.config.ts` and `vitest.config.ts`.
- Top bar says "PR Review Agent" (roadmap) where the design doc's structure still says "WB Factory". It keeps the prototype's logo and lucide nav icons; the active link is TanStack `Link`'s own `aria-current="page"` (fuzzy match, so `/prs/123` keeps Pull requests active). Labels stay visible at every width (the prototype hides them below `md`, which leaves links without names).
- `build` runs `tsc -b` before Vite, so after adding or renaming a route file, run the web dev server or `vite build` once to regenerate `routeTree.gen.ts` before `typecheck`.
- Lint (Phase 6): one root `eslint.config.js` (ESLint 10 flat config): `@eslint/js` + typescript-eslint `recommended` (not type-aware yet), react-hooks `flat.recommended` + react-refresh `vite` for `apps/web/src`. react-refresh is off in `apps/web/src/routes` (route files export `Route`; the TanStack plugin code-splits the page component). `pnpm lint` = `eslint --max-warnings 0 . && prettier --check .`; `pnpm format` writes.
- Boundary rules are `no-restricted-imports` regex patterns. Rule options do not merge across flat-config objects, so each object lists every restriction for its files. `packages/core` also bans bare Node builtins (`fs`, `path`), not only `node:*`; `apps/web` bans every `@pra/*` except `@pra/core`, type imports included.
- Prettier: `singleQuote`, `printWidth: 100` (the web code's width), other defaults, so the generator's no-semicolon api code now has semicolons. No `eslint-config-prettier`: no stylistic ESLint rules are on. Lint fixes in generator code: unused `opts`/`request`/`reply` params and the empty `SupportPluginOptions` interface removed, stale `eslint-disable no-void` comments dropped.
- Playwright (Phase 7): `@playwright/test` 1.65 at the root, Chromium only, `list` reporter locally and `github` in CI (`CI` also turns off server reuse and allows 2 retries). `webServer` runs `node_modules/.bin/vite` in `apps/web`, not `pnpm --filter @pra/web dev`: pnpm 12 starts scripts in their own process group, so Playwright's SIGKILL of pnpm left Vite on 5173 and teardown hung 60 s (a graceful SIGTERM/SIGINT stop works but prints pnpm `ELIFECYCLE` errors).
- Root `tsconfig.json` (extends the base, `noEmit`) covers the root `*.ts` configs and `e2e/`; root `typecheck` is `tsc -p tsconfig.json && pnpm -r typecheck`. `eslint.config.js` is linted but not type-checked (plain JS). `blob-report/` joins the Playwright output ignores.
