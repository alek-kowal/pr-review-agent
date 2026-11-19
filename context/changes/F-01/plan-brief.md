# Monorepo Foundations (F-01) — Plan Brief

> Full plan: `context/changes/F-01/plan.md`

## What & Why

Create the pnpm monorepo every later roadmap item builds on: the target layout from `tech-stack.md`, TypeScript, Vitest, ESLint + Prettier with package boundary rules, a Playwright smoke, CI on GitHub Actions and `AGENTS.md`. Later tasks' "done when" relies on `pnpm lint`, `pnpm typecheck`, `pnpm test` and CI from here.

## Starting Point

The repo holds only docs and a static prototype. No `package.json`, no code. Node 24 and pnpm 12.6 are installed.

## Desired End State

A clean clone passes `pnpm install && pnpm verify && pnpm test:e2e smoke.spec.ts`. The api (Fastify, Zod, OpenAPI, reason-code errors) and web (Vite, React 19, TanStack Router + Query, Tailwind + shadcn with WB tokens, top bar) apps run; the other packages exist empty.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Phases | F-01-T1..T9 = phases 1..9 | The roadmap already sized them for agents (orchestrator log, 19 Nov 02:40). |
| api scaffold | `fastify-cli generate` straight into `apps/api` | Roadmap overrides tech-stack flag 1; keeps the generator layout without a move commit. |
| `pnpm verify` | pnpm's regex script run, in parallel | Runs lint, typecheck and test at once with no extra dependency. |
| Route tree | `routeTree.gen.ts` committed, excluded from lint/format | `tsc` on a clean clone and in CI needs it before any Vite run. |
| Error shape | `{ error: { code, params } }`, codes `invalid_request`, `internal_error` | Reason codes, no prose; copy lives in the web app. |
| CI check on GitHub | Left pending | This session must not push. |

## Scope

**In scope:** workspace, five empty packages, api, web, tokens, top bar, lint/format/boundaries, Vitest, Playwright smoke, CI file, AGENTS.md.

**Out of scope:** Postgres/Drizzle/pg-boss/pino (F-02), domain rules (F-03), hosting (F-04), theme toggle, e2e in CI, deploy.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Workspace | root config, 5 empty packages, Vitest projects | pnpm 12 / Vitest projects config drift |
| 2. api scaffold | `@pra/api` from fastify-cli, tests on Vitest | generator's ESM/TS config vs base tsconfig |
| 3. Zod + OpenAPI | type provider, `/docs/json`, error handler | zod / provider version compatibility |
| 4. web scaffold | Vite + TanStack Router + Query, dev proxy | interactive generator prompts |
| 5. UI base | Tailwind v4, shadcn, WB tokens, top bar | token mapping to shadcn variables |
| 6. Lint | ESLint flat config, Prettier, boundary rules, `pnpm verify` | formatting churn across generated files |
| 7. Playwright | smoke spec | browser download |
| 8. CI | `ci.yml`, actionlint | green run needs a push (pending) |
| 9. AGENTS.md | conventions file under 100 lines | — |

**Prerequisites:** none. **Estimated effort:** 1–2 agent sessions.

## Open Risks & Assumptions

- Latest stable dependency versions at install time; if a generator's output conflicts with Node 24 / pnpm 12, the implementer adapts and records it under Decisions.

## Success Criteria (Summary)

- `pnpm verify` and the Playwright smoke pass on this machine.
- actionlint is clean; the GitHub run goes green once Alek pushes.
