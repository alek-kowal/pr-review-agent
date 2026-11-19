# Round 1 engine (P-05) Implementation Plan

## Overview

Wire webhook → round 1 → findings → one GitHub sentence, end to end with doubles. Six tasks in
this order, one commit each: S-01-T5 (webhook ingest), T6 (`github.event` handler and round 1),
T9 (review stage), T10 (`run.stage` handler and the run state machine), T11 (after-round
comment), T15 (Playwright test of round 1 and the CI e2e job). The package also creates the
P-05 extension points listed in `work-packages.md`.

## Current State Analysis

- Tables exist (P-04): `repositories`, `pull_requests`, `github_events`, `app_settings`,
  `instruction_versions`, `runs`, `stage_executions`, `agent_sessions`, `findings`, `questions`,
  `github_actions`, with typed queries (`recordGithubEvent`, `upsertPullRequest` returning
  `{ created, changed }`, `insertRun`, `isUniqueViolation`, `activeInstructions`, ...).
- `JOBS` in `packages/db/src/queue.ts` has only `smoke`; `migrateQueue` creates every queue in it.
- Core has `roundStartForEvent`, `chainState`, `planRun`/`startRun`/`startStage`/`completeStage`/
  `failStage`/`recoverAfterRestart`, `resolveLevel`/`freezeLevel`/`stagesFor`, `limitsFor`/
  `enforce`, `matchSensitiveFiles`, `modelFor`.
- Integrations (P-03): `GitHubGateway` (+ `FakeGitHubGateway`, `signWebhook`, fixtures),
  `GitMirror` (`CliGitMirror` with `remoteUrl` for local repos), `BlobStore` (local and S3),
  `AgentRunner` (`ClaudeAgentRunner`, `FakeAgentRunner`).
- api: `AppDeps = { db, queue }`; the CSRF guard already exempts `/webhooks/github`.
- worker: `startWorker({ db, queue, logger })` subscribes only `smoke`.
- web (P-04): PR list, PR page, Findings tab and the failed-round line with copy for
  `model_access_not_configured`, `stage_not_available`, `stage_timeout`, `interrupted`,
  `review_output_invalid`. Vite proxies `/api` to a fixed `localhost:3000`.
- P (reference, `~/Projects/wb-factory`): `reviewSchema` (severities `blocker | should | nit`,
  summary, risk, findings with optional `fix`, `gatedNotes`, questions with 2–3 options,
  `notChecked` ≤ 5); reviewer runs with cwd = run dir (brief.md, diff.patch) and read dirs
  repo + knowledge; prompt placeholders `{{knowledgeDir}}`, `{{repoDir}}`, `{{runDir}}` with a
  built-in fallback when the file is missing, empty or lacks a required placeholder; no turn or
  per-session cost cap (30 min timeout only).

## Desired End State

`pnpm test:e2e first-round.spec.ts` passes: a signed `ready_for_review` delivery creates round
1, the review stage runs `FakeAgentRunner` in a real worktree of a local git repository, the PR
page shows the findings grouped by severity with "Unchecked (level 1)", exactly one
`github_actions` row holds "Ready for team member review (round 1)", and a PR whose runner fails
shows the failed-round line and has no `github_actions` row. `pnpm verify` is green.

### Key Discoveries

- `upsertPullRequest` already skips unchanged snapshots (P `sync.test.ts` 33).
- `roundView` derives `off` stages from `stagesFor`; rows for `off` stages are optional.
- pg-boss 12: `send` inserts with `ON CONFLICT DO NOTHING`, so a deterministic job `id` dedupes
  for as long as the job row lives; queue policy `exclusive` + `singletonKey` allows one queued
  or active job per key; the default `expireInSeconds` is 15 min (shorter than a stage).
- `FakeGitHubGateway.postIssueComment` needs the repository in `installations`.
- Test files share one database per `pnpm test` run, so a test that runs a pg-boss worker would
  take other files' jobs.

## What We're NOT Doing

- No Checks, Task, Change type or Verify executors (P-09); those stages fail visibly with
  `stage_not_available` when a level turns them on.
- No cancel, retry, pause, budget or slot logic (P-15, P-16): only their hook and gate slots.
- No `createRun` generalisation, chains after round 1 or manual start (P-11).
- No SSE or timeline (P-10); the web keeps polling.
- No real GitHub or Anthropic calls; real wiring is S-01-T16 to T18 (Needs Alek).

## Implementation Approach

Ports and registries live in the worker; each extension point is a registry in its own file,
collected into `Extensions` with `DEFAULT_EXTENSIONS`, and `WorkerDeps.extensions` lets tests
replace them. Every job handler is idempotent and keyed: `github.event` by event row (skips a
processed event), `run.stage` by `(runId, stage)` (no-op unless the stage is the run's next
pending one), `github.comment` by run (at most one comment per run).

## Critical Implementation Details

- **Job ordering:** a job is sent only after the transaction that makes it valid has committed.
  A lost send (crash between commit and send) is repaired at worker start: queued runs and
  running runs with no running stage get their next `run.stage` job again (deduped by key).
- **Queue expiry:** `run.stage` gets `expireInSeconds` above the longest stage timeout (240 min
  max in `LevelSettingsPatchSchema`), or pg-boss would expire and retry a live review.
- **Blobs before rows:** prompt and transcript blobs are written before the stage transaction,
  so no row ever points at a missing blob.
- **Test isolation:** worker tests that run pg-boss (`run-round`, the smoke test) use their own
  database (`createTestDatabase()`); handler tests call handlers directly and read `pgboss.job`
  filtered by their own ids. The e2e stack creates its own database too.

## Phase 1: Webhook ingest route (S-01-T5)

- `packages/db/src/queue.ts`: add `githubEvent: 'github.event'`, `runStage: 'run.stage'`,
  `githubComment: 'github.comment'` with payloads `{ eventId }`, `{ runId, stage }`,
  `{ runId }`; per-queue options (`run.stage`: policy `exclusive`, `expireInSeconds` 5 h;
  `github.comment`: `exclusive`) used by `migrateQueue`; `stableJobId(key)` (UUID from a hash).
- `apps/api/src/app.ts` / `main.ts`: `AppDeps` gains `github: GitHubGateway` and
  `blobStore: BlobStore`, built with `createGitHubGateway()` and `createBlobStore()`.
- `apps/api/src/routes/webhooks/index.ts`: `POST /webhooks/github`, raw-body JSON parser scoped to
  the route plugin, body limit 25 MiB. Order: verify (503 `github_not_configured` when the
  gateway is not configured, 401 `webhook_signature_invalid`), require `X-GitHub-Delivery`
  (blob-key safe) and `X-GitHub-Event` (400 `invalid_request`), parse JSON (400), put
  `github-events/<deliveryId>.json`, `recordGithubEvent`, send `github.event` with
  `id: stableJobId('github.event:<deliveryId>')`, answer 202 `{ eventId }`.
- `apps/api/test/helper.ts`: default `FakeGitHubGateway` and a temp `LocalBlobStore`.

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/api test webhook.test.ts`: signed fixture → 202, blob, row, one job; bad
  signature → 401, no row; redelivery → 202, one row, one job; unconfigured gateway → 503.
- `pnpm verify`

## Phase 2: `github.event` handler and round 1 (S-01-T6)

- `apps/worker/src/deps.ts`: `WorkerDeps = { db, queue, logger, blobStore, github, gitMirror,
  agentRunner, dataDir, extensions? }`.
- `apps/worker/src/handlers/github-event.ts`: loads the event (skips one already processed),
  dispatches by `event` through `GITHUB_EVENT_HANDLERS` (`src/github-events/index.ts`),
  records the outcome code (`event_ignored` for unknown types).
- `apps/worker/src/github-events/pull-request.ts`: payload from BlobStore; repository by full
  name (`repository_not_connected`); store the installation id; upsert the snapshot unless the
  stored one is newer (out-of-order delivery); `roundStartForEvent` with the repository's
  default level and the PR's active blocking run; on start `startRound`; then the PR event
  hooks (`src/github-events/pr-hooks.ts`: `ready`, `headChanged`, `closed`, `merged`).
- `apps/worker/src/run/start-round.ts`: `startRound(deps, { pullRequest, config, trigger,
  startedBy, roundNumber })` freezes `resolveLevel(defaultLevel)`, inserts the queued run with a
  new chain id (unique violation on `runs_one_active_per_pr` → `run_active`), sends `run.stage`
  for the first stage that is not off (`singletonKey <runId>:<stage>`).
- Outcomes: `round_started`, or the core reason code (`draft`, `fork`, `push_never_starts`,
  `pr_closed`, `event_ignored`, `run_active`).

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/worker test github-event.test.ts`: ready (not fork) → one queued run, one
  stage job; draft → `draft`, no run; fork → `fork`; synchronize updates `head_sha`, starts
  nothing; same event twice → one run; unchanged PR left alone, dates refresh, closed then
  reopened leaves and returns (P `sync.test.ts` 33, 60, 70).
- `pnpm verify`

## Phase 3: Review stage (S-01-T9)

- `apps/worker/src/stages/stage.ts`: `StageExecutor { key, usesAgent, run(ctx) }`,
  `StageContext`, `StageResult` (`succeeded` with output, sessions, findings, questions,
  not-checked; or `failed` with error code and sessions), `SessionRecord` (role, model, agent
  result, prompt, extra files).
- `apps/worker/src/stages/review/schema.ts`: Zod port of P's `reviewSchema` (findings array not
  capped: code cuts, so 9 findings parse); severity map `blocker→blocking`,
  `should→worth_fixing`, `nit→nit`.
- `apps/worker/src/stages/review/brief.ts`: `buildBrief` (PR, description, sensitive paths,
  review level only when the level has a brief, change risk only with a change type, limits,
  changed files, documents of touched workspaces, provider sections) and `documentsFor` (P
  `review.test.ts` 79).
- `apps/worker/src/stages/review/prompt.ts`: materialise active instructions (repository file
  wins over a global one with the same key) read-only into `<session>/knowledge`; render the
  `prompt-reviewer.md` instruction with `{{knowledgeDir}}`, `{{repoDir}}`, `{{runDir}}`; fall
  back to the built-in prompt when it is missing, empty or lacks `{{repoDir}}`/`{{knowledgeDir}}`.
- `apps/worker/src/stages/review/context.ts`: `REVIEWER_CONTEXT_PROVIDERS` (empty; P-09 task,
  P-14 answers): each returns brief sections.
- `apps/worker/src/stages/review/index.ts`: worktree at `run.headSha`, diff, session dir
  `<dataDir>/sessions/run-<id>/review-<attempt>` with `brief.md` and `diff.patch`, runner with
  cwd = session dir and read dirs = worktree + knowledge, limits 100 turns and 10 USD; map,
  `enforce(limitsFor(level.settings, null))`; `output_invalid` → `review_output_invalid`.

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/worker test review-stage.test.ts` (FakeAgentRunner, local git fixture):
  9 findings cut to level 1's 4, most severe first; malformed output → `review_output_invalid`;
  prompt and brief contain no env values; brief sections (P `classify.test.ts` 214,
  `review.test.ts` 79); prompt fallback.
- `pnpm verify`

## Phase 4: `run.stage` handler (S-01-T10)

- `apps/worker/src/run/state.ts`: rebuild core `RunState` from the run row and its latest stage
  attempts.
- `apps/worker/src/run/execute-stage.ts` (H1): queued → `beforeRoundStart` gates → `startRun`
  (writes `off` rows for stages the level turns off); next stage must equal the job's stage;
  `beforeSession` gates for agent stages; insert the attempt (`running`); executor from the
  registry or `stage_not_available`; per-stage timeout from the frozen level (`stage_timeout`);
  a thrown error fails with its integration code or `stage_error`; blobs, then one transaction
  (stage row, sessions, findings, questions, not-checked, run cost and status); then the next
  stage job or the run hooks; worktree and session dir removed when the run ends.
- `apps/worker/src/run/hooks.ts` (`runCompleted`, `runFailed`, `runCancelled`,
  `sessionCostRecorded`), `src/run/gates.ts` (`beforeRoundStart`, `beforeSession`),
  `src/stages/index.ts` (`STAGE_EXECUTORS = { review }`), `src/extensions.ts`.
- `apps/worker/src/run/recover.ts`: at start, running stages → failed `interrupted` (core
  `recoverAfterRestart`), lost jobs re-sent.
- `worker.ts`/`main.ts`: full deps from env (`DATA_DIR`, default `.data`), subscribe the three
  queues, log `model access configured`/`not configured`.

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/worker test run-round.test.ts` (own database, real pg-boss): level-1 run
  completes (four stages `off`, Review succeeded, findings, questions, one session with cost and
  a transcript blob); failing runner fails the run with the code and records the cost, the next
  run completes; real adapter without key → `model_access_not_configured`; restart →
  `interrupted`; timeout → `stage_timeout`; thrown executor → `stage_error`.
- `pnpm verify`

## Phase 5: After-round comment (S-01-T11)

- `runCompleted` hook `enqueueAfterRoundComment`: kind `round` and `afterRoundGithubComment` on
  → `github.comment` with `singletonKey <runId>`.
- `apps/worker/src/handlers/github-comment.ts`: run must be a completed round; locks the run
  row, claims one `github_actions` row (`kind comment`, result `sending`) unless one is `sending`
  or `posted`, posts `Ready for team member review (round N)`, sets `posted` + GitHub id or
  `failed` (and rethrows so pg-boss retries; a retry re-claims a `failed` row).

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/worker test github-comment.test.ts`: exact string; nothing for a failed
  run; nothing when off; one comment when the job runs twice; no URL and no finding text.
- `pnpm verify`

## Phase 6: End-to-end round 1 (S-01-T15)

- `@pra/integrations/testing`: `createGitFixture()` (temp repo, base on `main`, feature commit,
  isolated git env), reused by worker tests and e2e.
- `e2e/support/stack.ts`: own database, seeded test repository and global instructions, api
  (`FakeGitHubGateway`, temp `LocalBlobStore`) and worker (`CliGitMirror` on the fixture, a
  runner scripted per PR number) in one process on the api port; writes a state file (api URL,
  database URL, secret, repository, shas) that the spec reads.
- `apps/web/vite.config.ts`: proxy target from `API_PROXY_TARGET` (default
  `http://localhost:3000`).
- `playwright.config.ts`: api port derived from the web port; `webServer` = [stack, vite].
- `e2e/first-round.spec.ts`; `ci.yml`: `e2e` job with Postgres.

### Success Criteria

#### Automated Verification

- `pnpm test:e2e` (both specs) passes locally.
- `pnpm verify`

#### Manual Verification

- CI `e2e` job passes after the orchestrator merges (cannot run from here: no push).

## Testing Strategy

Unit-level: brief, prompt, schema mapping. Integration: handlers on the shared test database,
`run-round` on its own database with a real worker. E2E: one process stack with doubles.

## References

- Tasks: `context/foundation/roadmap-tasks.md` S-01-T5, T6, T9, T10, T11, T15
- Extension points: `context/foundation/work-packages.md` "Extension points"
- P: `~/Projects/wb-factory/src/review.ts:32-88`, `src/brief.ts`, `src/prompt.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Webhook ingest route (S-01-T5)

#### Automated

- [x] 1.1 webhook.test.ts passes — 9ce8a01
- [x] 1.2 pnpm verify — 9ce8a01

### Phase 2: `github.event` handler and round 1 (S-01-T6)

#### Automated

- [x] 2.1 github-event.test.ts passes
- [x] 2.2 pnpm verify

### Phase 3: Review stage (S-01-T9)

#### Automated

- [x] 3.1 review-stage.test.ts passes
- [x] 3.2 pnpm verify

### Phase 4: `run.stage` handler (S-01-T10)

#### Automated

- [x] 4.1 run-round.test.ts passes
- [x] 4.2 pnpm verify

### Phase 5: After-round comment (S-01-T11)

#### Automated

- [x] 5.1 github-comment.test.ts passes
- [x] 5.2 pnpm verify

### Phase 6: End-to-end round 1 (S-01-T15)

#### Automated

- [x] 6.1 pnpm test:e2e passes locally
- [x] 6.2 pnpm verify

#### Manual

- [ ] 6.3 CI e2e job passes after merge
