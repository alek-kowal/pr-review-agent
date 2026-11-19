# Push, autofix and shadow log Implementation Plan

## Overview

A Team member pushes a ready patch to the PR branch as `pr-review-agent` after typing the PR
number and signing; the push is never forced and the fix check (round 2 of 3) starts by itself.
At level 5 the bot decides, implements and pushes on its own when every autofix condition holds,
and otherwise waits with a reason. At levels 3–4 the same checks only write a shadow log, shown on
the PR Timeline and in Insights → Trust ladder.

## Current State Analysis

- `GitMirror` (`packages/integrations/src/git-mirror.ts:10`) clones, fetches, adds detached
  worktrees and lists worktree changes. The installation token reaches git only through
  `gitAuthEnv(token)` (`http.extraHeader` via `GIT_CONFIG_*` env). No commit or push exists.
- The mirror is a `clone --mirror`, so `remote.origin.mirror=true`: `git push origin <refspec>`
  would push with mirror+force flags. The push must target the remote **URL**, not `origin`.
- `GitHubGateway` has `getInstallationToken`, `getPullRequest` (`headRef`, `headSha`, `isFork`)
  and `getPullRequestState` (fresh head). No `getUser`, no bot identity.
- FR-016 hand-off already exists: `expectOwnFix(deps, chainId, sha)`
  (`apps/worker/src/run/chains.ts:111`) stores `round_chains.expected_head_sha`; the
  `synchronize` path (`startFixCheckOnPush`) starts the `own_fix` round, and a person's commit on
  top starts nothing (`apps/worker/test/pushes.test.ts`).
- Patches (`packages/db/src/schema/patches.ts`) have statuses ready/superseded/pushed/discarded but
  no pushed SHA or refusal. The patch is written in `storePatchOnCompleted`
  (`apps/worker/src/run/patches.ts:28`), the "patch ready" moment.
- Core has the F-03 autofix rules: `autofixDecision(input)` (start) and `pushByItself(patch, pr)`
  (push), with reason codes in `packages/core/src/reasons/autofix.ts`. Nothing calls them yet.
  Core `Patch.waiting` is `'sensitive' | null`, hard-coded null in `corePatch`.
- Decisions: `decision_batches.signed_by` is a NOT NULL FK to `team_members`; `currentDecisions`
  inner-joins the signer, so the bot cannot sign Implement decisions yet.
- `startImplementer` (`packages/db/src/queries/implementer.ts:89`) hard-codes trigger
  `manual`/`revise`; its `prepare(tx)` runs in the run's transaction (place for decisions).
- PR banner: core `nextStep` already maps a ready patch to `action('push')`; the web has no `push`
  entry in `MAIN_ACTIONS` (`apps/web/src/features/pr/slots.ts:31`). The merge dialog
  (`apps/web/src/features/merge/MergeAction.tsx`) is the model for a typed-number signed dialog.
- Trust ladder: `GET /api/insights/trust` (`apps/api/src/routes/api/insights/index.ts:417`) and
  `TrustTab` (`apps/web/src/features/insights/TrustTab.tsx`).

## Desired End State

- `push-recheck.spec.ts` and `autofix.spec.ts` pass, plus every task's named unit test.
- A pushed commit is authored by the App's bot, carries `Co-authored-by` for a person's push,
  has the neutral message, and its push argv never holds the token, `--force` or a `+` refspec.
- Level 5 PRs fix and push themselves or show "Autofix waiting: <reason>"; levels 3–4 write
  shadow entries; Trust ladder shows "Level 5 shadow log".

### Key Discoveries:

- Token handling to copy: `gitAuthEnv` (`git-mirror.ts:95`).
- Patch job model: `handlePatchCheck` (`apps/worker/src/run/patches.ts:68`) and
  `applyPatchFiles` (`apps/worker/src/stages/implementer.ts:99`).
- Run hooks: `RUN_HOOKS.runCompleted` order (`apps/worker/src/run/hooks.ts:46`); hooks fire after
  commit, one failing hook does not stop the others.
- Queue: `JOBS`, `JobPayloads`, `QUEUE_SETTINGS` (`packages/db/src/queue.ts`).
- Signed route pattern: `apps/api/src/routes/api/patches/index.ts` (`RouteRefusal`,
  `lockActiveTeamMember`), errors in `apps/api/src/plugins/errors.ts`.

## What We're NOT Doing

- No `head_changes` row from the push job: the webhook writes it (sender is the bot). FR-016
  reads `round_chains.expected_head_sha`, set by `expectOwnFix`.
- No new Settings page: level 5's `autofixMaxPatches` exists (P-23); the worker reads it from
  the round's frozen level.
- No real GitHub smoke (S-14-T6 is Alek's).
- No shadow entries at levels 1–2 (no verified findings there).

## Implementation Approach

Follow the task order; each task's "Done when" passes before the next. Integrations first (push
primitive), then the core rule and worker job, endpoint, dialog, e2e; then autofix storage and
core wrapper, worker hooks, PR page, e2e, Trust ladder.

## Critical Implementation Details

- **Never push to `origin`.** The mirror remote has `mirror=true`, which makes git add mirror and
  force flags. Push `<sha>:refs/heads/<branch>` to `remoteUrl(fullName)`.
- **Deterministic commit.** Author and committer dates come from the patch (`createdAt`), so a
  retried job rebuilds the same SHA and a second push of it is a no-op, not a second commit.
- **Ordering after a push:** mark the patch pushed and call `expectOwnFix` after the git push
  succeeds; `expectOwnFix` handles the webhook arriving first.
- **Autofix start bypasses the core paused/budget holds** (`paused: false, budgetReached: false`):
  the task wants the implementer run created and Queued by the existing gates with the pause
  reason.

## Phase 1: S-14-T1 Non-forced push in GitMirror and GitHubGateway

### Changes Required:

#### 1. GitMirror push

**File**: `packages/integrations/src/git-mirror.ts`

**Intent**: Commit patch files in a fresh worktree at `baseSha` as the bot and push them without
force; map a non-fast-forward rejection to `head_moved`.

**Contract**: `pushPatch(input: PushPatchInput): Promise<PushPatchResult>` with
`PushPatchInput = { repo; branch; baseSha; files: { path; content: Uint8Array | null }[];
message; author: GitIdentity; coAuthor?: GitIdentity | null; date: Date; token? }` and
`PushPatchResult = { ok: true; sha } | { ok: false; reason: 'head_moved' }`. Identity and dates
go through `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env; the trailer is a second `-m`. Exported
`PUSH_COMMIT_MESSAGE = 'Apply fixes from pr-review-agent review'` and
`coAuthorTrailer(identity)`.

#### 2. GitHubGateway identities

**Files**: `packages/integrations/src/github/{github-gateway,octokit-github-gateway}.ts`,
`packages/integrations/src/testing/github.ts`

**Intent**: Look up a signer's GitHub id and the App's bot identity for the commit.

**Contract**: `getUser(login): Promise<{ id: number; login: string } | null>` and
`getBotIdentity(): Promise<GitIdentity>` (`<slug>[bot]`,
`<id>+<slug>[bot]@users.noreply.github.com`, from `GET /app` and `GET /users/<slug>[bot]`,
cached). Fake: configurable users, fixed bot `pr-review-agent[bot]`. `noreplyEmail(id, login)`
helper.

### Success Criteria:

#### Automated Verification:

- `pnpm --filter @pra/integrations test` passes `push-patch.test.ts` against a local bare repo
  (trailer and bot author; argv has no token, `--force` or `+`; moved remote gives `head_moved`
  and stays unchanged; message has no finding title or URL)

## Phase 2: S-14-T2 Push rule, push job and hand-off to the fix check

### Changes Required:

#### 1. Core push rule

**File**: `packages/core/src/push.ts` (+ `reasons/push.ts`)

**Contract**: `canPush(patch, pr, typedNumber, freshHeadSha): { allowed: true } | { allowed:
false; reason }`. Codes (lower snake_case, as P-18 did): `fork_read_only`, `patch_not_ready
{status}`, `pr_number_mismatch {number}`, `run_active {kind,status}`, `head_moved {headSha}`,
`patch_empty`. Order: fork, patch status, number, active run, head, empty.

#### 2. Patch push columns and job

**Files**: `packages/db/src/schema/patches.ts`, `packages/db/src/queries/patches.ts`,
`packages/db/src/queue.ts`, `apps/worker/src/run/push.ts`, `apps/worker/src/worker.ts`

**Intent**: Patches gain `pushedSha`, `pushedAt`, `pushRefusal` (Reason jsonb). Job
`patch.push { patchId, signedBy: string | null }` (exclusive, singleton key = patch id). The
handler re-reads the head (`getPullRequestState`), runs `canPush` (typed number = PR number),
reads the files from BlobStore, calls `pushPatch`, then marks the patch pushed, calls
`expectOwnFix(latest chain, sha)` and writes the timeline entry `patch_pushed` (actor = signer,
params `{ sha, branch }`) — or, with no signer, `autofix_pushed` (actor bot). A refusal stores
`pushRefusal` and a `patch_push_refused` entry, pushes nothing.

### Success Criteria:

#### Automated Verification:

- `pnpm --filter @pra/core test` passes `push-rule.test.ts` (one case per reason code)
- `pnpm --filter @pra/worker test` passes `push-job.test.ts` (one push on double delivery;
  moved head records `head_moved`; synchronize with the SHA starts "Round 2 of 3" own fix; a
  person's commit on top starts nothing)
- Migration applies (`pnpm db:migrate`)

## Phase 3: S-14-T3 Push endpoint

**File**: `apps/api/src/routes/api/patches/index.ts`

**Contract**: `POST /api/patches/:id/push` body `{ typedNumber, signedBy }` (the codebase's
signer field). 400 `signature_required`/`signer_unknown`; 404 `patch_not_found`; 409 with the
`canPush` reason as `{ error: { code, params } }` (`head_moved` carries `headSha`); 202
`{ queued: true }` and exactly one `patch.push` job.

### Success Criteria:

#### Automated Verification:

- `pnpm --filter @pra/api test` passes `push.routes.test.ts`

## Phase 4: S-14-T4 Push dialog on Patch ready

**Files**: `apps/web/src/features/patch/PushAction.tsx`, `features/patch/queries.ts`,
`features/pr/slots.ts` (`push` main action), `copy/patch.ts` or `copy/implementer.ts`,
`copy/index.ts` errors.

**Intent**: Banner action "Push to <branch>…" opens an AlertDialog: patch summary (files, fixed
of total, reproductions), typed PR number, SignatureField; confirm disabled until both are
filled. 409 refusals in plain words; success closes and toasts.

### Success Criteria:

#### Automated Verification:

- `pnpm --filter @pra/web test` passes `push-dialog.test.tsx`

## Phase 5: S-14-T5 End-to-end push and fix check

**Files**: `e2e/push-recheck.spec.ts`, `e2e/support/{stack,env}.ts`

**Intent**: Own repository (level 4) and PR range; the stack's remote for it accepts pushes and
counts them (bare clone of the fixture). Main path, moved head, person's commit on top.

### Success Criteria:

#### Automated Verification:

- `pnpm test:e2e push-recheck.spec.ts` passes

## Phase 6: S-15-T1 Autofix attempts and shadow records

**Files**: `packages/core/src/autofix.ts`, `packages/db/src/schema/autofix.ts`,
`packages/db/src/queries/autofix.ts`, `packages/db/src/schema/team.ts`, `queries/decisions.ts`

**Contract**:
- Core `autofixCheck(point: 'start' | 'push', input)` →
  `{ mode: 'act' | 'shadow' | 'off'; allowed; reasons; reason }`; `act` from level 5 (the
  ladder is cumulative, so level 6 too), `shadow` at levels 3–4, `off` below. Start wraps
  `autofixDecision`; push wraps `pushByItself` plus fork and the per-chain cap. The name
  `autofixDecision` stays the F-03 start rule.
- `autofix_attempts (id, pull_request_id, chain_id, round_run_id, patch_id, implementer_run_id,
  point, outcome started|pushed|waiting, reasons jsonb, sha, at)`.
- `autofix_shadow (id, pull_request_id, repository_id, run_id, patch_id, level, point, decision
  would_start|would_push|would_wait, reasons jsonb, fixed, total, at)`, unique per
  (run, point) / (patch, point).
- Queries: `autoPatchesInChain(db, chainId)`, `recordAutofixAttempt`, `latestAutofixWaiting(db,
  patchId)`, `recordShadow`, `shadowOfPr`, `shadowByRepository(db, { repositoryId?, since,
  minLevel })`.
- Bot-signed decisions: `decision_batches.signed_by` nullable + `actor` column (member|bot,
  check: member ⇔ signed_by set); `currentDecisions` left-joins the signer, a bot batch reads
  `signerName = 'pr-review-agent'`, `signedBy: null`.

### Success Criteria:

#### Automated Verification:

- `pnpm --filter @pra/core test` passes `autofix-decision.test.ts`
- `pnpm --filter @pra/db test` passes `autofix.test.ts`; migration applies

## Phase 7: S-15-T2 Autofix and shadow in the worker

**Files**: `apps/worker/src/run/autofix.ts`, `apps/worker/src/run/hooks.ts`,
`packages/db/src/queries/implementer.ts`

**Intent**: `autofixOnRoundCompleted` (kind `round`) and `autofixOnPatchReady` (kind
`implementer`, after `storePatchOnCompleted`). Level ≥5 start: bot Implement decisions in
`prepare`, `startImplementer({ startedBy: BOT, trigger: 'autofix' })`, attempt `started`,
timeline `autofix_started`. Hold: attempt `waiting` + timeline `autofix_waiting`. Patch ready of
an autofix run: push conditions → queue `patch.push` with no signer, or attempt `waiting`.
Levels 3–4: shadow entries only (start at round end; push at a person's patch).

### Success Criteria:

#### Automated Verification:

- `pnpm --filter @pra/worker test` passes `autofix.test.ts` (five cases of the task)

## Phase 8: S-15-T3 Autofix and shadow on the PR page

**Intent**: Core `Patch.waiting: Reason | null` → banner `state_autofix_waiting { reason }`;
db `statePatch` fills it from the latest waiting attempt of the patch. Timeline kinds
`autofix_started`, `autofix_pushed`, `autofix_waiting`, `autofix_shadow` come from the tables
through the existing `timeline_entries` writer (actor bot), so the timeline API needs no join.
Web copy for each reason code and timeline kind.

### Success Criteria:

#### Automated Verification:

- `pnpm --filter @pra/web test` passes `autofix-banner.test.tsx`
- `pnpm --filter @pra/api test` passes `timeline-autofix.test.ts`

## Phase 9: S-15-T5 End-to-end autofix

**Files**: `e2e/autofix.spec.ts`, stack repos at level 5 (one with a sensitive pattern the
implementer double touches) and level 3.

### Success Criteria:

#### Automated Verification:

- `pnpm test:e2e autofix.spec.ts` passes

## Phase 10: S-19-T9 Shadow log in Insights → Trust ladder

**Intent**: `GET /api/insights/trust` adds per repository `shadow: { days: 14, eligible,
needed: 5, wouldFix, prs: [{ number, decision, reason }] }`, latest entry per PR, level ≥3.
TrustTab section "Level 5 shadow log" with ⓘ "Nothing was pushed", or "Not enough data yet
(n of 5 PRs)".

### Success Criteria:

#### Automated Verification:

- `pnpm --filter @pra/api test` passes `insights-shadow.routes.test.ts`
- `pnpm --filter @pra/web test` passes `shadow-log.test.tsx`
- `pnpm verify` and `pnpm test:e2e` pass after merging main

## Testing Strategy

Unit tests per task as named; worker tests use real `CliGitMirror` on a fixture with a bare
remote; e2e uses its own repositories and PR ranges.

## Progress

### Phase 1: S-14-T1

#### Automated

- [x] 1.1 push-patch.test.ts passes

### Phase 2: S-14-T2

#### Automated

- [x] 2.1 push-rule.test.ts passes
- [x] 2.2 push-job.test.ts passes
- [x] 2.3 Migration applies

### Phase 3: S-14-T3

#### Automated

- [x] 3.1 push.routes.test.ts passes

### Phase 4: S-14-T4

#### Automated

- [x] 4.1 push-dialog.test.tsx passes

### Phase 5: S-14-T5

#### Automated

- [x] 5.1 push-recheck.spec.ts passes

### Phase 6: S-15-T1

#### Automated

- [x] 6.1 autofix-decision.test.ts passes
- [x] 6.2 db autofix.test.ts passes, migration applies

### Phase 7: S-15-T2

#### Automated

- [ ] 7.1 worker autofix.test.ts passes

### Phase 8: S-15-T3

#### Automated

- [ ] 8.1 autofix-banner.test.tsx passes
- [ ] 8.2 timeline-autofix.test.ts passes

### Phase 9: S-15-T5

#### Automated

- [ ] 9.1 autofix.spec.ts passes

### Phase 10: S-19-T9

#### Automated

- [ ] 10.1 insights-shadow.routes.test.ts passes
- [ ] 10.2 shadow-log.test.tsx passes
- [ ] 10.3 pnpm verify and pnpm test:e2e pass after merging main
