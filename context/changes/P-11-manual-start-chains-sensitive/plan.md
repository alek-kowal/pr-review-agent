# Manual start, chains and sensitive files (P-11) Implementation Plan

## Overview

Work package P-11 (wave 5): S-07-T1 to T7 and S-11-T1 to T4. One round-start service for the
ready webhook, manual starts and fix pushes; pushes that count new commits and start a fix check
only on the chain's expected head; rounds 2 and 3 that check only the fixes; manual start and PR
level in the API and the PR header; findings from earlier commits; and sensitive files with
approve (unsigned) and send back (signed).

## Current State Analysis

- `runs` already has `chain_id`, `round_no`, `trigger`, frozen `level`, `head_sha` (the reviewed
  SHA), `commits_count_at_start`, `started_by`. `trigger` values are core's
  `ready_for_review | manual | own_fix`; the fix SHA of an `own_fix` round is its head SHA.
- `apps/worker/src/run/start-round.ts` creates a queued round and sends its first stage job; only
  the `pull_request` handler calls it (round 1 from `roundStartForEvent`).
- Core already has `chainState`, `nextAutomaticRound`, `MAX_CHAIN_ROUNDS`, the `new_commits`,
  `sensitive_files` and `rounds_used` states, `SensitiveFiles`, `Finding.resolved`,
  `matchSensitiveFiles` (`limits.ts:150`) and the checklist row `sensitive_files_approved`.
- A fix check round plans `checks, fix_diff, check_fixes, reproductions` (`levels.ts:176`); only
  `checks` has an executor, so a round 2 would fail `stage_not_available`.
- The state loader (`packages/db/src/queries/pr-state.ts`) takes findings from the latest
  completed round, sets `resolved: null` and `sensitive: null`, and counts commits since review as
  `commitsCount - commitsCountAtStart`.
- `GitHubGateway` has no `compareCommits`. PR routes are keyed `:repo/:number`.
- Web slots exist: `MAIN_ACTIONS`, `BANNER_LINES`, `PR_PANELS`, `PR_HEADER_ACTIONS`,
  `FINDING_LINE_SLOTS`; banner copy for `new_commits`, `rounds_used` and sensitive states exists.
- e2e stack: one process, `ScriptedReviewer` keyed by PR number, git fixture with one feature
  commit, WB seeded at level 1 with no sensitive patterns.

## Desired End State

`pnpm test:e2e chains.spec.ts sensitive-files.spec.ts` pass with the slice checks of S-07 and
S-11; every task's "Done when" test passes; `pnpm verify` is green.

### Key Discoveries:

- Gates already run in the stage handler (`execute-stage.ts:88`), so a queued run created by
  `startRound` passes P-05's `beforeRoundStart` gates without extra code.
- Run lifecycle hooks (`run/hooks.ts`) and PR event hooks (`github-events/pr-hooks.ts`) are the
  call sites for "after a round" and "after a push".
- `recordRunStarted` already writes the `run_started` timeline entry with the trigger and actor.

## What We're NOT Doing

- The implementer push that sets the chain's expected head (S-14, P-22); tests seed it.
- Retry, cancel (P-15), pause and budget (P-16), level settings (P-23).
- Rerunning reproductions in the fix check (the `reproductions` stage records "nothing to rerun"
  unless Verify stored scripts for the checked findings; real reruns arrive with S-13/S-14).

## Implementation Approach

Task order with one commit each. Run creation moves into `@pra/db` (`packages/db/src/runs/`) so
the API's manual start and the worker share it: `createRun({ pr, kind, level, plan, ... })`
inserts a run in a transaction; `startRound({ prId, trigger, level, startedBy })` decides chain
and round number, calls `createRun` and sends the first stage job. The worker's `start-round.ts`
becomes a thin wrapper. New tables live in `packages/db/src/schema/chains.ts` and
`sensitive-files.ts`.

## Phase 1: Chains and one round-start service (S-07-T1)

- Schema: `round_chains` (`id uuid`, `pull_request_id`, `expected_head_sha` null, `created_at`);
  `runs.chain_id` references it (migration backfills chains for existing runs).
  `pull_requests.level` (null: repository default) for the PR's level.
- `@pra/db`: `createRun`, `startRound`, `sendStageJob`; `setChainExpectedHead(db, chainId, sha)`
  for S-14. A ready event or a manual start opens a new chain at round 1; an `own_fix` start
  continues the PR's latest chain with round `completed + 1` from core `chainState`.
- Worker: the ready path calls `startRound`; level = PR level ?? repository default.
- Test `apps/worker/test/chains.test.ts`: ready → round 1 trigger ready at repo default; draft
  and ready again → new chain; failed/cancelled rounds do not count; a PR level change leaves the
  running run's level.

## Phase 2: Pushes (S-07-T2)

- `GitHubGateway.compareCommits(fullName, base, head) → { aheadBy, behindBy, status }` in the
  interface, Octokit adapter (`GET /repos/{o}/{r}/compare/{base}...{head}`), Unconfigured and
  Fake (`setCompare` / default from a map, recorded calls).
- `runs.commits_since` + `runs.commits_since_head`: commits between the run's head and the PR head
  it was measured against. A `headChanged` PR event hook measures each completed round of the
  latest chain; a `runCompleted` hook measures the finished round when the head moved during it.
  A failing compare falls back to the commit-count difference.
- `synchronize`: if the head equals the latest chain's `expected_head_sha`, core
  `nextAutomaticRound` decides; start `own_fix` round through `startRound`. Otherwise nothing.
- Test `pushes.test.ts` per the task's "Done when".

## Phase 3: Fix check (S-07-T3)

- `packages/agents/src/reviewer/fix-check.ts`: `fixCheckOutputSchema`
  (`{ fixes: [{ findingId, resolved, reason }] }`) and `renderFixCheckPrompt`.
- Schema `finding_fix_checks` (`finding_id`, `run_id`, `resolved`, `reason`; unique per pair).
  `StageResult` gains optional `fixChecks`, stored in `storeResultInTx`.
- Executors: `fix_diff` (no agent: diff since the previous completed round's head plus the
  Implement findings, as output), `check_fixes` (reviewer in fix-check mode), `reproductions`
  (no agent; reruns nothing unless scripts exist).
- Full review: a reviewer context provider lists earlier Implement findings; the review schema
  gets optional `fixes`, mapped to `fixChecks`.
- Test `fix-check.test.ts` per the task's "Done when".

## Phase 4: Manual start, PR level, head-aware summary (S-07-T4)

- `POST /api/prs/:repo/:number/start-review { level }` (unsigned, 409 `run_active`),
  `PUT /api/prs/:repo/:number/level { level }` (unsigned, timeline `pr_level_changed`).
- Loader: findings and questions from the latest completed full round (round 1 of its chain);
  reviewed SHA from the latest completed round; `resolved` from the newest fix check;
  `commitsSinceReview` from `runs.commits_since`; PR level from `pull_requests.level`.
- Summary section `head`: reviewed SHA, head, commits since, completed rounds, rounds max, PR
  level, repo default level, fix counts of the latest round; findings carry source SHA and
  commits behind.
- Test `apps/api/test/routes/start-review.test.ts`.

## Phase 5: Start review control and banners (S-07-T5)

- `StartReview` header action (Popover, level Select marking the repo default, hint, disabled
  reason), `start_review` main action, banner lines for `new_commits` / `rounds_used`, header meta
  "Reviewed abc123 · 2 new commits since". Test `start-review.test.tsx`.

## Phase 6: Findings from earlier commits and fix results (S-07-T6)

- Findings tab strips "From abc123 · N commits behind" and "X of Y fixes resolved"; finding line
  slot Resolved / Not resolved. Tests `stale-findings.test.tsx`, `fix-status.test.tsx`.

## Phase 7: e2e chains (S-07-T7)

- Stack: a second feature commit and a fix commit in the git fixture (shas in the stack state), a
  `deliverPullRequest` synchronize variant, a `ScriptedReviewer` that answers fix checks and can
  hold a session for a PR-number range until a flag row appears. `e2e/chains.spec.ts`.

## Phase 8: Sensitive files per PR (S-11-T1)

- Schema `sensitive_files` (`pull_request_id`, `path`, `pattern`, `reason`, `status`, `actor`,
  `member_id`, `comment`, `at`, `head_sha`); `pull_requests.sensitive_version`.
- `runCompleted` hook matches the round's changed files with `matchSensitiveFiles` (repository
  `sensitivePatterns`) and adds new paths as pending; the `headChanged` hook resets sent back to
  pending. Loader fills `input.sensitive`. Test `sensitive-files.test.ts`.

## Phase 9: Approve and send back API (S-11-T2)

- `POST .../sensitive/approve { version }` (hand) and `POST .../sensitive/send-back
  { version, comment, signedBy }`; 409 `sensitive_stale`; timeline entries; summary lists files.
  Test `sensitive.test.ts`.

## Phase 10: Sensitive files on the PR page (S-11-T3)

- `approve_sensitive` main action (Approve changes + Send back… dialog), sensitive panel with
  files and patterns, sent-back comment line. Test `sensitive-banner.test.tsx`.

## Phase 11: e2e sensitive files (S-11-T4)

- A seeded repository with sensitive patterns matching the fixture's
  `db/migrations/0001_edge_labels.sql`; `e2e/sensitive-files.spec.ts`.

## Testing Strategy

Each phase's named test file is its "Done when"; `pnpm verify` after each task; `pnpm test:e2e`
after phases 5, 6, 7, 10 and 11.

## Progress

### Phase 1: Chains and one round-start service

- [x] 1.1 `pnpm --filter @pra/worker test chains.test.ts`

### Phase 2: Pushes

- [x] 2.1 `pnpm --filter @pra/worker test pushes.test.ts`

### Phase 3: Fix check

- [x] 3.1 `pnpm --filter @pra/worker test fix-check.test.ts`

### Phase 4: Manual start, PR level, head-aware summary

- [x] 4.1 `pnpm --filter @pra/api test start-review.test.ts`

### Phase 5: Start review control and banners

- [x] 5.1 `pnpm --filter @pra/web test start-review.test.tsx`

### Phase 6: Findings from earlier commits and fix results

- [x] 6.1 `pnpm --filter @pra/web test stale-findings.test.tsx fix-status.test.tsx`

### Phase 7: e2e chains

- [x] 7.1 `pnpm test:e2e chains.spec.ts`

### Phase 8: Sensitive files per PR

- [x] 8.1 `pnpm --filter @pra/worker test sensitive-files.test.ts`

### Phase 9: Approve and send back API

- [x] 9.1 `pnpm --filter @pra/api test sensitive.test.ts`

### Phase 10: Sensitive files on the PR page

- [x] 10.1 `pnpm --filter @pra/web test sensitive-banner.test.tsx`

### Phase 11: e2e sensitive files

- [x] 11.1 `pnpm test:e2e sensitive-files.spec.ts`
