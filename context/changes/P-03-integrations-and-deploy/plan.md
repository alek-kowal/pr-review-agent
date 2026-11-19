# Integrations and Deploy (P-03) Implementation Plan

## Overview

Build the three integrations round 1 needs (`GitHubGateway`, `GitMirror`, `AgentRunner`), each
with its test doubles, and the pilot hosting pieces (Docker images, deploy Compose, S3 BlobStore,
CSRF guard, Sentry and OpenTelemetry). Tasks S-01-T4, S-01-T7, S-01-T8, F-04-T1..T5 from
`context/foundation/roadmap-tasks.md` are phases 1..8, one to one, one commit each.

## Current State Analysis

- `packages/integrations` holds `BlobStore` + `LocalBlobStore` + the contract suite
  (`src/testing/blob-store-contract.ts`) and pino logging (`src/logging.ts`). No GitHub, git or
  S3 code. `packages/agents` is an empty `src/index.ts`, no test script.
- Workspace packages export TypeScript sources (`"exports": { ".": "./src/index.ts" }`); Node 24
  runs them with type stripping (`erasableSyntaxOnly`, `.ts` import extensions). `apps/api` builds
  to `dist/` with `tsc -p tsconfig.build.json`; `apps/worker` has no build.
- api composition root: `src/main.ts` builds `AppDeps` (`db`, `queue`); `src/server.ts`
  `serverOptions(env)`; plugins and routes are autoloaded from `src/plugins` and `src/routes`.
  The error handler (`src/plugins/errors.ts`) owns `ApiErrorCode`. `test/plugins/errors.test.ts`
  POSTs to `/example`, so the CSRF guard must update those tests.
- `docker-compose.yml` (project `pra`) runs one shared Postgres on 5432; CI runs a `postgres:17`
  service. `.env.example` already lists every env name this package reads.
- The old project P (`~/Projects/wb-factory`) runs agents through the `claude` CLI with
  `--tools Read,Grep,Glob`, `--permission-mode dontAsk`, `--setting-sources ''`,
  `--strict-mcp-config`; it has no SDK, no price table, no GitHub App, no mirror or worktrees.
  Its push passes the token as `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=http.extraheader`,
  `GIT_CONFIG_VALUE_0=Authorization: Basic base64(x-access-token:<token>)`, `GIT_TERMINAL_PROMPT=0`.

## Desired End State

- `pnpm --filter @pra/integrations test github`, `... test git-mirror`, `... test s3-blob-store`
  (with MinIO up), `pnpm --filter @pra/agents test`, `pnpm --filter @pra/api test csrf` and
  `pnpm --filter @pra/api test instrument` / `pnpm --filter @pra/worker test instrument` pass.
- `docker build -f apps/{api,worker,web}/Dockerfile .` succeed; the api image serves `/health`
  and runs as a non-root user; `deploy/compose.yaml` rehearses the deploy on a laptop.
- `pnpm verify` is green; CI also runs MinIO.

### Key Discoveries

- Node refuses to strip types under `node_modules`; `pnpm deploy` copies workspace packages into
  `node_modules/.pnpm`, so the images must run compiled JS for workspace packages (Phase 4).
- Vitest loads modules through its own runner, so OpenTelemetry's module patching does not run in
  tests; pino gets `trace_id` from a pino `mixin` reading `@opentelemetry/api` instead (Phase 8).
- Orchestrator rule: no fixed host ports except the shared Postgres, so MinIO publishes an
  ephemeral port that tests discover (Phase 6).

## What We're NOT Doing

- No webhook route, no worker handler, no review stage (P-05: S-01-T5, T6, T9).
- No verifier, implementer, judge or analyst adapters (P-06); `AgentRunner` supports the reviewer
  role now and is shaped so P-06 adds roles by one table entry.
- No edits in `apps/web` (P-04's `api.ts` sends `X-PRA-Request: 1`).
- No real accounts, keys, host or Sentry project (F-04-T6..T10 are Needs Alek).
- No e2e spec (no UI change).

## Key decisions

| Area | Decision |
| --- | --- |
| Not configured | `IntegrationNotConfiguredError` (`code`, `params.missing` = env names) in `@pra/integrations`; a gateway factory returns an unconfigured gateway that throws it on every call without network. |
| GitHub gateway | `createGitHubGateway(env)`; missing var or unreadable/empty key file = not configured. Own token cache per installation, reused until 60 s before `expires_at`. REST through `@octokit/app` (`App`, installation Octokit with our cached token). |
| GitMirror shape | Every method takes `fullName` first (`addWorktree(fullName, runId, sha)`, `diff(fullName, base, head)`, `removeWorktree(fullName, runId)`), because one worker serves many repositories. Layout `<root>/mirrors/<owner>/<repo>.git`, `<root>/worktrees/<runId>`. Per-repository in-process lock. `exec` is injectable (spy in tests). |
| AgentRunner | Zod output schema in, JSON schema to the SDK (`outputFormat`), parsed back with Zod. Errors as `{ code, params }`: `model_access_not_configured`, `cost_limit_reached`, `max_turns_reached`, `output_invalid`, `agent_failed`, `cancelled`. Prices from the claude-api skill; unknown model is priced as the most expensive known one. |
| Images | Build stage compiles every `@pra/*` workspace package to `dist/` and rewrites its exports there (script `deploy/compile-workspace.mjs`, image-only), then `pnpm deploy --prod --legacy`. Fallback if deploy cannot be made to work: prune to prod deps in the workspace layout and run it. Web image: Caddy serving the SPA, proxying `/api`, `/webhooks`, `/health` with `flush_interval -1`. |
| Deploy env | `env_file: ${PRA_ENV_FILE:-app.env}` (required) for api, worker, migrate; committed `deploy/local.env` (non-secret local values) for the `local` profile. Key file via a bind mount of `${GITHUB_APP_PRIVATE_KEY_FILE:-/dev/null}`. Web port `127.0.0.1:${PRA_WEB_PORT:-8080}`. Worker health = heartbeat file. |
| S3 tests | MinIO in `docker-compose.yml` profile `s3`, ephemeral host port, bucket `pra-test`. Tests use `S3_TEST_ENDPOINT` (CI) or discover `docker port pra-minio-1 9000`; locally they skip with a message when MinIO is down. |
| CSRF | `onRequest` hook in an autoloaded plugin; `TRUST_PROXY` env (proxy-addr list) feeds Fastify `trustProxy`, default off. |
| Observability | Shared `startObservability({ service, env, sentryTransport? })` in `@pra/integrations/observability`; app `instrument.ts` files call it. `@fastify/otel`, http and pg instrumentations; OTLP exporter only with `OTEL_EXPORTER_OTLP_ENDPOINT`; Sentry with `skipOpenTelemetrySetup` and our context manager. |

## Phase 1: GitHubGateway, Octokit adapter and doubles (S-01-T4)

### Changes Required

#### 1. Gateway, error and adapter

**File**: `packages/integrations/src/errors.ts`, `src/github/{github-gateway,octokit-github-gateway,index}.ts`

**Intent**: Define the interface and the App-based adapter; select it from env.

**Contract**: `GitHubGateway { verifyWebhook(rawBody: string | Uint8Array, signature: string | undefined): Promise<boolean>; getRepoInstallationId(fullName): Promise<number | null>; getInstallationToken(installationId): Promise<{ token, expiresAt: Date }>; getPullRequest(fullName, number): Promise<GitHubPullRequest>; postIssueComment(fullName, number, body): Promise<{ id: number }> }`. `GitHubPullRequest` is the snapshot S-01-T6 needs (number, title, body, author, head/base sha+ref+repo full name, draft, state, merged, commits, created/updated). `createGitHubGateway(env, options?)` reads `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_WEBHOOK_SECRET`. Exported from `@pra/integrations`.

#### 2. Test doubles and fixtures

**File**: `packages/integrations/src/testing/{fake-github-gateway,sign-webhook,github-fixtures}.ts`, `src/testing/fixtures/github/*.json`

**Intent**: `FakeGitHubGateway` (records calls, holds PRs and installation ids, verifies with a real HMAC against its secret), `signWebhook(body, secret)` (`sha256=<hex>`), trimmed WB-like fixtures: `pull_request.opened.json` (ready), `pull_request.opened-draft.json`, `pull_request.ready_for_review.json`, `pull_request.synchronize.json`, `pull_request.closed.json`, `pull_request.opened-fork.json`, `ping.json`, plus `githubFixture(name)` returning `{ event, body }`.

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/integrations test github` passes with msw: token cached until it expires (one token request for two calls, a new one after expiry), `postIssueComment` sends the exact body, a bad signature fails, missing env gives `github_not_configured` with no request.
- `pnpm verify` passes.

## Phase 2: GitMirror (S-01-T7)

### Changes Required

**File**: `packages/integrations/src/git-mirror.ts` (+ test)

**Intent**: Bare mirror and a detached worktree per run through the git CLI via `execa`.

**Contract**: `GitMirror { ensureMirror(fullName, token); fetch(fullName, token); addWorktree(fullName, runId, sha): Promise<string>; diff(fullName, baseSha, headSha): Promise<{ patch, files: ChangedFile[] }>; removeWorktree(fullName, runId) }`, `ChangedFile = { path, status, additions, deletions }`. `new CliGitMirror({ rootDir, remoteUrl?, exec? })`; default remote `https://github.com/<fullName>.git`. Token only in `GIT_CONFIG_*` env with `GIT_TERMINAL_PROMPT=0`. `addWorktree` is idempotent (replaces an existing worktree for the run). Diff is `base...head` (merge base).

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/integrations test git-mirror` passes against a temp local bare repository: worktree at the sha, diff lists changed files, worktree removed, no token in any `exec` argument.
- `pnpm verify` passes.

## Phase 3: AgentRunner and the reviewer adapter (S-01-T8)

### Changes Required

**File**: `packages/agents/src/{runner,claude-agent-runner,prices,index}.ts`, `src/testing/{fake-agent-runner,index}.ts`, `package.json` (`./testing` export, `test` script, deps `@anthropic-ai/claude-agent-sdk`, `zod`, `@pra/core`)

**Intent**: The runner contract and one SDK adapter with read-only reviewer tools, minimal env, cost guard and cancel; a scripted fake.

**Contract**: `AgentRunner.run<T>({ role, model, cwd, prompt, outputSchema: ZodType<T>, maxTurns, maxCostUsd, signal?, onProgress? }): Promise<AgentRunResult<T>>`, result `{ status: 'completed' | 'failed' | 'cancelled', output: T | null, error: { code, params } | null, usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }, costUsd, costSource: 'reported' | 'computed', turns, durationMs, transcript: unknown[] }`. `createClaudeAgentRunner({ apiKey, query? })` — `query` is the test seam. SDK options: `tools` and `allowedTools` = role tools (reviewer: Read, Grep, Glob), `permissionMode: 'dontAsk'`, `settingSources: []`, `mcpServers: {}`, `strictMcpConfig`, `env: { ANTHROPIC_API_KEY, PATH: <node dir>:/usr/bin:/bin, HOME: <temp dir> }`, `maxTurns`, `abortController` (linked to `signal` and the cost guard). Usage dedup by assistant message id.

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/agents test` passes with a fake `query`: tools exactly Read, Grep, Glob; env has no `GITHUB_*`, `CLICKUP_*`, `DATABASE_URL`; cost guard aborts with computed cost; reported cost taken from the result; missing key gives `model_access_not_configured` without calling `query`; cancel gives `cancelled`; invalid structured output gives `output_invalid`.
- `pnpm verify` passes.

## Phase 4: Dockerfiles (F-04-T1)

### Changes Required

**File**: `apps/{api,worker,web}/Dockerfile`, `apps/web/Caddyfile`, `.dockerignore`, `deploy/compile-workspace.mjs`, `apps/worker/{package.json,tsconfig.build.json}`

**Intent**: Multi-stage images; api and worker on `node:24-slim` as user `node`, worker with `git`; web on Caddy.

**Contract**: build stage `pnpm fetch` → `pnpm install --offline --frozen-lockfile` → compile workspace packages + app → `pnpm deploy --filter @pra/<app> --prod --legacy /out`. Worker gets `build`/`start` scripts. Caddy listens on `:8080`, `/api/*`, `/webhooks/*`, `/health` → `{$API_UPSTREAM:api:3000}` with `flush_interval -1`; everything else `try_files {path} /index.html`.

### Success Criteria

#### Automated Verification

- `docker build -f apps/api/Dockerfile -t pra-api .` (and worker, web) succeed.
- `docker run --rm -e DATABASE_URL=… pra-api` serves `/health` 200 (run on a free port); `docker run --rm pra-api id -u` is not 0.
- `pnpm verify` passes.

## Phase 5: Deploy Compose (F-04-T2)

**File**: `deploy/compose.yaml`, `deploy/app.env.example`, `deploy/local.env`, `deploy/README.md`, worker heartbeat (`apps/worker/src/heartbeat.ts`)

**Intent**: `web`, `api`, `worker` (restart, healthchecks), `migrate` (profile `tools`), `postgres` + `minio` + `minio-init` (profile `local`). Secrets only on api, worker and migrate.

### Success Criteria

#### Automated Verification

- `docker compose -f deploy/compose.yaml config` shows no env file or secret names on `web`.
- Local rehearsal (`PRA_ENV_FILE=local.env`, own project name and port): `up -d`, `run --rm migrate`, `curl /health` 200 through the web proxy and `curl /prs` returns the SPA.
- `pnpm verify` passes.

## Phase 6: S3 BlobStore (F-04-T3)

**File**: `packages/integrations/src/blob-store/{s3-blob-store,create-blob-store}.ts` (+ tests), `src/testing/s3-test-endpoint.ts`, `docker-compose.yml` (`minio`, profile `s3`), `.github/workflows/ci.yml` (MinIO service)

**Intent**: `S3BlobStore` on `@aws-sdk/client-s3`; `createBlobStore(env)` picks S3 only when `S3_BUCKET` is set.

### Success Criteria

#### Automated Verification

- With `docker compose --profile s3 up -d minio`, `pnpm --filter @pra/integrations test s3-blob-store` passes the contract suite.
- `createBlobStore` test: S3 only with `S3_BUCKET`.
- `pnpm verify` passes; CI file has the MinIO service.

## Phase 7: CSRF guard (F-04-T4)

**File**: `apps/api/src/plugins/csrf.ts`, `src/plugins/errors.ts` (`csrf_rejected`), `src/server.ts` (`trustProxy`), `test/plugins/csrf.test.ts`, existing POST tests send the headers

**Intent**: POST/PUT/PATCH/DELETE except `/webhooks/github` need `X-PRA-Request: 1` and an `Origin` whose host equals `request.host`; else 403 `{ error: { code: 'csrf_rejected', params: {} } }`.

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/api test csrf`: same origin with header passes; missing header, foreign Origin, missing Origin → 403; GET unaffected; webhook exempt; untrusted `X-Forwarded-Host` ignored.
- `pnpm verify` passes.

## Phase 8: Sentry and OpenTelemetry (F-04-T5)

**File**: `packages/integrations/src/observability.ts` (+ test), `src/logging.ts` (trace mixin), `apps/{api,worker}/src/instrument.ts` (+ tests), `apps/api/src/sentry-test.ts`, scripts and Dockerfile `CMD` with `--import`

**Intent**: Start OTel always (exporter only with `OTEL_EXPORTER_OTLP_ENDPOINT`), Sentry only with `SENTRY_DSN`; pino lines carry `trace_id`; a test-event script.

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/api test instrument` and `pnpm --filter @pra/worker test instrument`: no DSN → no Sentry client, no exporter; dummy DSN + stubbed transport → client initialised and the event reaches the stub.
- A logging test: a line written inside an active span has `trace_id`.
- `pnpm verify` passes.

#### Manual Verification

- api with a local OTLP stub receives spans for an HTTP request (http, fastify, pg).

## Testing Strategy

Unit and contract tests per adapter, with doubles only in `@pra/*/testing`. HTTP is mocked with
msw; git runs against temp local repositories; the SDK is replaced by a fake `query`. Docker and
Compose checks are run by hand once per phase, on free ports and own project names.

## References

- Tasks: `context/foundation/roadmap-tasks.md` (S-01-T4, T7, T8; F-04-T1..T5)
- Package block: `context/foundation/work-packages.md` (P-03)
- BlobStore contract: `packages/integrations/src/testing/blob-store-contract.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: GitHubGateway, Octokit adapter and doubles

#### Automated

- [x] 1.1 `pnpm --filter @pra/integrations test github` passes — f06677e
- [x] 1.2 `pnpm verify` passes — f06677e

### Phase 2: GitMirror

#### Automated

- [x] 2.1 `pnpm --filter @pra/integrations test git-mirror` passes — 7066feb
- [x] 2.2 `pnpm verify` passes — 7066feb

### Phase 3: AgentRunner and the reviewer adapter

#### Automated

- [x] 3.1 `pnpm --filter @pra/agents test` passes — 12f4825
- [x] 3.2 `pnpm verify` passes — 12f4825

### Phase 4: Dockerfiles

#### Automated

- [x] 4.1 api, worker and web images build
- [x] 4.2 api image serves `/health` 200 and runs as non-root
- [x] 4.3 `pnpm verify` passes

### Phase 5: Deploy Compose

#### Automated

- [ ] 5.1 `compose config` shows no secrets on `web`
- [ ] 5.2 local rehearsal: `/health` 200 and `/prs` SPA through the proxy
- [ ] 5.3 `pnpm verify` passes

### Phase 6: S3 BlobStore

#### Automated

- [ ] 6.1 `pnpm --filter @pra/integrations test s3-blob-store` passes against MinIO
- [ ] 6.2 `createBlobStore` picks S3 only with `S3_BUCKET`
- [ ] 6.3 `pnpm verify` passes

### Phase 7: CSRF guard

#### Automated

- [ ] 7.1 `pnpm --filter @pra/api test csrf` passes
- [ ] 7.2 `pnpm verify` passes

### Phase 8: Sentry and OpenTelemetry

#### Automated

- [ ] 8.1 `instrument` tests pass in api and worker
- [ ] 8.2 pino lines carry `trace_id` inside a span
- [ ] 8.3 `pnpm verify` passes

#### Manual

- [ ] 8.4 spans reach a local OTLP stub
