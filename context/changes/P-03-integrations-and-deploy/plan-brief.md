# Integrations and Deploy (P-03) — Plan Brief

> Full plan: `context/changes/P-03-integrations-and-deploy/plan.md`

## What & Why

Round 1 (P-05) needs three integrations behind interfaces: GitHub (App tokens, webhooks, PRs,
comments), a git mirror with a worktree per run, and an agent runner for the reviewer. The pilot
also needs images, a deploy Compose file, S3 storage, a CSRF guard and error/trace reporting.

## Starting Point

P-01 left `BlobStore` (local adapter + contract suite), pino logging, `/health`, pg-boss and the
api composition root. `packages/agents` is empty. Workspace packages ship TypeScript sources.

## Desired End State

Each integration has an adapter, a "not configured" path that never touches the network, and a
double in `@pra/*/testing`. The api, worker and web images build and run; `deploy/compose.yaml`
rehearses the deploy locally; state-changing calls need the CSRF header; Sentry and OTel start
only when configured.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| GitMirror signatures | `fullName` first in every method | One worker serves many repositories. |
| Token cache | Own cache per installation until 60 s before expiry | Deterministic and testable with msw. |
| Agent output | Zod schema in, JSON schema to the SDK, Zod parse back | One schema, typed output, `output_invalid` code. |
| Images | Compile workspace packages to JS inside the build, then `pnpm deploy` | Node will not strip types under `node_modules`. |
| Deploy env | `PRA_ENV_FILE` (default `app.env`), committed `local.env` for rehearsal | Prod can never pick up local values. |
| MinIO in tests | Ephemeral port, discovered; skip locally when down, required in CI | Orchestrator: no fixed ports besides Postgres. |
| pino `trace_id` | pino `mixin` from `@opentelemetry/api` | Works in Vitest, where module patching does not. |

## Scope

**In scope:** S-01-T4, S-01-T7, S-01-T8, F-04-T1..T5.

**Out of scope:** webhook route, worker handlers, review stage, other agent roles, web changes,
real accounts and hosting (Needs Alek).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. GitHubGateway | Adapter, fake, signer, fixtures | Octokit auth caching interplay |
| 2. GitMirror | Mirror, worktree, merge-base diff | git locks under concurrency |
| 3. AgentRunner | SDK reviewer adapter, fake | SDK option names drift |
| 4. Dockerfiles | api, worker, web images | `pnpm deploy` + TS sources |
| 5. Deploy Compose | Single-VM compose, local rehearsal | Env file selection |
| 6. S3 BlobStore | Adapter, `createBlobStore`, MinIO | Port discovery |
| 7. CSRF guard | Header + Origin check | Existing POST tests |
| 8. Sentry + OTel | `instrument.ts`, trace ids in logs | ESM instrumentation hooks |

**Prerequisites:** P-01 and P-02 merged (done). Docker running locally.
**Estimated effort:** one session, 8 commits.

## Open Risks & Assumptions

- Agent prices come from the claude-api skill at implementation time.
- Fork PR heads need `refs/pull/*`; a mirror clone fetches them.

## Success Criteria (Summary)

- Every task's "Done when" passes; `pnpm verify` green after each commit.
