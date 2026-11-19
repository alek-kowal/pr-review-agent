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
