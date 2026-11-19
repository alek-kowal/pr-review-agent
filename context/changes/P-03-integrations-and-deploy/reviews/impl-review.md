<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Integrations and Deploy (P-03)

- **Plan**: context/changes/P-03-integrations-and-deploy/plan.md
- **Scope**: All phases (22 of 22 steps done)
- **Date**: 2026-11-19
- **Verdict**: NEEDS ATTENTION (all findings fixed in package P-03r)
- **Findings**: 0 critical, 10 warnings, 0 observations (open observations listed below)

Review package P-03r ran on branch `task/P-03r`. Every finding was fixed there, one commit each;
`pnpm verify` is green after the fixes (48 files, 399 tests).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — AgentRunner had no timeout and ignored a cancel during setup

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — the contract gains a required field every caller must pass
- **Dimension**: Safety & Quality
- **Location**: packages/agents/src/claude-agent-runner.ts:139
- **Detail**: A session could run without a deadline (only `maxTurns` and the cost guard stopped
  it), and the abort signal was linked only after the temporary `HOME` was created, so a cancel in
  that window let the session start anyway.
- **Fix**: `AgentRunInput.timeoutMs` (required, the stage timeout); past it the session is aborted
  with code `timeout`. The signal is linked before the first await. A cancel or timeout wins over
  the SDK's error result for our own abort.
  - Strength: The stage timeout from settings reaches the agent; no silent long sessions.
  - Tradeoff: Required field, so P-05 must pass it (it has the stage timeout anyway).
  - Confidence: HIGH — tests cover timeout, cancel during setup and cancel with an SDK error result.
  - Blind spot: None significant.
- **Decision**: FIXED (db07ee1)

### F2 — A stalled git command held the repository lock until restart

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — one option, narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/integrations/src/git-mirror.ts:204
- **Detail**: execa ran git without a timeout; a stalled clone or fetch never settled, kept the
  in-process repository lock and the heartbeat kept the worker "healthy".
- **Fix**: Every git command has a deadline (`CliGitMirror` `timeoutMs`, default 15 min), then
  SIGTERM; the lock is released on failure.
- **Decision**: FIXED (e54d782)

### F3 — A stale GitHub installation id failed every call until restart

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — one option, narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/integrations/src/github/octokit-github-gateway.ts:102
- **Detail**: repository → installation id was cached forever. After the App was reinstalled or
  the repository left the installation, every call answered a raw 401/404.
- **Fix**: On 401 or 404 with a cached id, drop the id and its token and retry once on a fresh
  lookup (nothing was written, so the retry is safe).
- **Decision**: FIXED (a35f22c)

### F4 — web had no healthcheck and no container log rotated

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — one option, narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: deploy/compose.yaml:40
- **Detail**: A stuck Caddy stayed "healthy"; the default json-file driver never rotates, so logs
  would fill the single VM's disk.
- **Fix**: web healthcheck (busybox `wget` against Caddy's file server); json-file rotation, 5
  files of 10 MB, for web, api and worker.
- **Decision**: FIXED (d300b8c, 26ecfbe)

### F5 — Secrets could reach an image or a log line

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — one option, narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .dockerignore, packages/integrations/src/logging.ts:11
- **Detail**: `.dockerignore` excluded only the root `.env`, so an app's `.env` or a `.pem` in
  the tree could be copied into an image. The log redaction missed `AWS_SECRET_ACCESS_KEY` /
  `secretAccessKey`, `DATABASE_URL` (holds the password) and `GIT_CONFIG_VALUE_<n>` (token header).
- **Fix**: Env files and `*.pem` / `*.key` excluded at any depth (and gitignored); the redaction
  covers the three secrets.
- **Decision**: FIXED (2246f3d, 1a30a23)

### F6 — Runtime code could import a test double by a relative path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — one option, narrowly scoped
- **Dimension**: Architecture
- **Location**: eslint.config.js:19
- **Detail**: The lint guard covered only `@pra/*/testing`; `./testing/github.ts` from runtime
  code would pass lint and be compiled into the image.
- **Fix**: The same restriction for relative paths into a `testing/` folder.
- **Decision**: FIXED (db646f1)

### F7 — GitMirror misread a tab path and accepted short SHAs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — one option, narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/integrations/src/git-mirror.ts:64, :227
- **Detail**: A `--numstat` path starting with a tab shifted every later file's line counts. The
  SHA check let 7–39 hex characters through, and git prefers a ref of that name over a short id.
- **Fix**: Split the numstat record only twice; accept only 40 or 64 hex characters.
- **Decision**: FIXED (187c44d, 52ae011)

### F8 — A missing S3 bucket read as "no blob"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — one option, narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/integrations/src/blob-store/s3-blob-store.ts:59
- **Detail**: `get` returned `null` for any 404, including `NoSuchBucket`, so a wrong `S3_BUCKET`
  looked like every blob was missing.
- **Fix**: `get` returns `null` only for `NoSuchKey`. `exists` keeps 404 = false (a HEAD response
  cannot tell bucket from key; see open observations).
- **Decision**: FIXED (08f015e)

### F9 — The price table under-counted Fable 5.2 and long Haiku 5.5 prompts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — one option, narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/agents/src/prices.ts:39
- **Detail**: Fable 5.2 was missing, so it fell back to the dearest known model (Opus 5.5,
  $4/$20) — half its price. Haiku 5.5 costs 5× over 100K prompt tokens; the table had only the
  short rate. The computed cost guard could therefore let a session overspend.
- **Fix**: Fable 5.2 at $8/$40; Haiku 5.5 long-prompt rate applied per request (per assistant
  message, not the session total); unknown models at $10/$50 (Fable 5.1 list price).
- **Decision**: FIXED (0657530, 5ff4176)

### F10 — Implementation drift not recorded in change.md

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — one option, narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/P-03-integrations-and-deploy/change.md
- **Detail**: Benign drift from the plan without a record: `minimumReleaseAgeExclude` for the
  agent SDK 0.3.328 platform packages (exact pin); `readDirs` and `systemPrompt` added to
  `AgentRunInput`; file names `testing/github.ts`, `testing/s3.ts`, `health/heartbeat.ts`;
  `GitHubPullRequest.state` folds `merged` into the state.
- **Fix**: Recorded under "Recorded at review (P-03r)" in P-03 `change.md`.
- **Decision**: FIXED (this report's commit)

## Checked, no change

- CSRF guard: tests cover every case in the plan.
- api, worker and web run as uid 1000; the api image answered `GET /health` 200 as uid 1000.
- No secrets on `web`; `compile-workspace.mjs` drops the `/testing` exports; no runtime import of
  test doubles.
- AgentRunner tools and env: the SDK `env` replaces the whole environment.
- `diff()` runs outside the repository lock; it is read-only, so that is fine.

## Open observations (no code change here)

- S3 `exists()` cannot tell a missing bucket from a missing key. P-05: HeadBucket once at start.
- The worker never calls `reportError`. P-05 should call it on the job error path.
- The mirror root resolves from the working directory. P-05: pass an explicit `rootDir`.
- Images are not pinned by digest; the worker has no memory limit. Revisit at deploy (F-04-T7).

## Needs Alek

- On the VM, the GitHub App key file must be readable by uid 1000 (`deploy/README.md`, 4ef1992).
