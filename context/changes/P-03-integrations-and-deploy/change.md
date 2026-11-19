---
change_id: P-03
title: Integrations and deploy (S-01-T4, S-01-T7, S-01-T8, F-04-T1 to F-04-T5)
status: implemented
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-03 from `context/foundation/work-packages.md`, wave 2: `GitHubGateway`, `GitMirror`
and `AgentRunner` with their test doubles (S-01-T4, T7, T8), then Docker images, the single-VM
Compose file, the S3 BlobStore, the CSRF guard, and Sentry with OpenTelemetry (F-04-T1 to T5).
Plan: yes, see `plan.md` (brief in `plan-brief.md`). One commit per task, in that order.

The planning step ran without questions (orchestrator rule: decide and record). Each decision
below was made while planning or implementing.

## Decisions

Planning decisions are in `plan.md` "Key decisions" (not-configured error, GitHub token cache,
GitMirror shape, AgentRunner contract and error codes, image build, deploy env, S3 tests, CSRF,
observability). Implementation-time decisions, per task:

### S-01-T4 GitHubGateway (f06677e)

- msw 3 renamed `onUnhandledRequest` to `onUnhandledFrame`; the github tests use the new name.
- `FakeGitHubGateway`, `signWebhook` and the fixtures live only in `@pra/integrations/testing`.

### S-01-T7 GitMirror (7066feb)

- Every `GitMirror` method takes `fullName` first, because one worker serves many repositories.

### S-01-T8 AgentRunner

- `new ClaudeAgentRunner({ apiKey, query?, now? })` is the seam (`query` replaced in tests);
  `createClaudeAgentRunner(env)` reads `ANTHROPIC_API_KEY`.
- Extra error code `role_not_supported`: a role with no `ROLE_TOOLS` entry fails before a session
  starts (P-06 adds the verifier and implementer entries).
- Two cost guards: our own (sum of streamed usage, deduplicated per assistant message id, times the
  price table; aborts with `costSource: 'computed'`) and the SDK's `maxBudgetUsd`
  (`error_max_budget_usd` maps to `cost_limit_reached` with the reported cost).
- Each session gets a fresh temporary `HOME`, removed afterwards, and `persistSession: false`, so
  nothing from the machine's `~/.claude` reaches the agent and nothing is left behind.
- The output schema goes to the SDK as `z.toJSONSchema` without `$schema`; the answer is parsed
  back with the same Zod schema.
- `FakeAgentRunner` is exported only from the test-only `@pra/agents/testing` subpath.

### F-04-T1 Dockerfiles

- `pnpm deploy --filter @pra/<app> --prod` without `--legacy`: pnpm 12 deploys from the shared
  lockfile (`--legacy` re-resolves and fails offline). The deploy step needs the registry: it
  re-checks the lockfile against the supply-chain policy, so `--offline` is not used there.
- `deploy/compile-workspace.mjs` compiles each `packages/*` package with `tsc --noCheck` (types
  are checked by `pnpm verify` and the app build) and drops the `./testing*` exports, so test
  doubles never ship. The apps build first, against the TypeScript sources.
- Code in `/app` is owned by root and the process runs as `node` (uid 1000). The api image sets
  `HOST=0.0.0.0`, `PORT=3000`. The worker image adds `git` and `ca-certificates`.
- Web: Caddy on `:8080` as uid 1000, `admin off`, `auto_https off` (TLS sits in front, F-04-T7).
  It forwards `/api/*`, `/webhooks/*`, `/health` unchanged (like the Vite dev proxy), compresses
  only the static files and marks `/assets/*` immutable.
- No BuildKit cache mounts: the `pnpm fetch` layer is cached by Docker until the lockfile changes.

### F-04-T2 Deploy Compose

- The GitHub App key is a Compose secret (`file: ${GITHUB_APP_PRIVATE_KEY_FILE:-/dev/null}`),
  mounted read-only at `/run/secrets/github_app_key`; compose sets `GITHUB_APP_PRIVATE_KEY_PATH`.
  `/dev/null` (empty key) means "not configured", so the stack starts without a key.
- `env_file` `${PRA_ENV_FILE:-app.env}` is required: `compose config` and `up` fail fast without
  it. `deploy/app.env` is gitignored; `deploy/local.env` holds only throwaway local values.
- `migrate` (profile `tools`) runs the api image with `node node_modules/@pra/db/dist/cli/migrate.js`
  (no pnpm in the images). The worker restarts until the first migration has run.
- Worker health: `WORKER_HEARTBEAT_FILE` (set only by compose) is written every 10 s; the
  healthcheck (`dist/health/healthcheck.js`) fails when it is older than 30 s. api health:
  `fetch('/health')` from inside the container (no curl in the slim image).
- MinIO: the `minio/minio` and `quay.io/minio` images are no longer pullable, so the local profile
  uses `cgr.dev/chainguard/minio` and `cgr.dev/chainguard/minio-client` (bucket `pra`, created by
  `minio-init` with `restart: on-failure` until MinIO answers). These images only have `latest`.
- Local services are `depends_on` with `required: false`, so on the VM (no `local` profile) api
  and worker start against the external database alone. Only `web` publishes a port, on
  `127.0.0.1:${PRA_WEB_PORT:-8080}`.

### F-04-T3 S3 BlobStore

- MinIO is `cgr.dev/chainguard/minio` here too (profile `s3` in `docker-compose.yml`, host port
  ephemeral, data on tmpfs). Tests find it through `S3_TEST_ENDPOINT` (CI) or
  `docker port pra-minio-1 9000`, create bucket `pra-test` if needed, and skip with a message
  when MinIO is not running. Helpers are in `@pra/integrations/testing` (`s3TestEndpoint`,
  `s3TestClient`).
- CI starts MinIO in a step with `docker run` (service containers cannot pass `server /data`).
- `createBlobStore(env)` is exported but not yet wired into api and worker deps: nothing stores
  blobs before P-05 (webhook payloads, S-01-T5), and the api composition root is edited by P-04 in
  this wave. P-05 calls `createBlobStore()` where it builds its deps.
- S3 credentials come only from the AWS default chain (it reads `process.env`, not the `env`
  argument); `S3_ENDPOINT` turns on path-style URLs for MinIO and other S3-compatible stores.

### F-04-T4 CSRF guard

- An `onRequest` hook (autoloaded `plugins/csrf.ts`), so a rejected request is never routed or
  body-parsed. Only the exact path `/webhooks/github` is exempt (query ignored).
- The `Origin` host is compared with `request.host` parsed under the Origin's scheme, so default
  ports compare equal; `Origin: null` and malformed values are rejected.
- `TRUST_PROXY` (comma-separated IPs/CIDRs or proxy-addr names) feeds Fastify `trustProxy`;
  unset means no proxy is trusted. The deploy leaves it unset: Caddy forwards the original
  `Host`, so the check works without trusting `X-Forwarded-Host`.
- `apps/web` is untouched: P-04's `api.ts` sends `X-PRA-Request: 1` (no `api.ts` exists here).
  API tests send `SAME_ORIGIN` from `test/helper.ts` on state-changing calls.

### F-04-T5 Sentry and OpenTelemetry

- OpenTelemetry 3.x (`@opentelemetry/sdk-trace` 3.1, `instrumentation-*` 0.301) with our own
  `TracerProvider`, `AsyncLocalStorageContextManager` and W3C propagator instead of `NodeSDK`:
  `NodeSDK` creates an OTLP exporter from env defaults even without an endpoint. No span processor
  without `OTEL_EXPORTER_OTLP_ENDPOINT`, so spans exist (for `trace_id` in logs) but never leave.
- Instrumentations: http, pg and `@fastify/otel` (`registerOnInitialization`, no app change). The
  ESM loader hook (`@opentelemetry/instrumentation/hook.mjs`) is registered by
  `startObservability`; `pg` is imported from ESM (drizzle) and is not patched without it.
- Sentry 11 reports errors only: `enableOpenTelemetrySetup: false` (no competing provider) and
  `enableRuntimeChannelInjection: false` (one loader hook, ours). `SENTRY_ENVIRONMENT` (default
  `NODE_ENV`) and `SENTRY_RELEASE` are new env names. The api error handler reports 500s with
  `reportError` (a no-op without a client).
- pino gets `trace_id` and `span_id` from a `mixin` reading `@opentelemetry/api`, so it works the
  same in tests (where Vitest's module runner skips the patching).
- `instrument.ts` in api and worker is loaded with `node --import` in `dev`, `start` and the
  Dockerfile `CMD`. Its tests re-import it with a mocked `startObservability` that injects the
  stub transport (`stubSentryTransport`, `DUMMY_SENTRY_DSN` in `@pra/integrations/testing`).
- Spans are not flushed on shutdown yet (the apps call `process.exit` after stopping); add an
  `observability.shutdown()` in the stop paths when traces matter (P-10 or later).
- Checked by hand: the api with a local OTLP stub exported `GET /health`, Fastify and `pg.query`
  spans; the api and worker images start with `--import ./dist/instrument.js`.
