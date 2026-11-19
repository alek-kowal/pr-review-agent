<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Push, autofix and shadow log (P-22)

- **Plan**: context/changes/P-22-push-autofix-shadow/plan.md
- **Scope**: all 10 phases (S-14-T1..T5, S-15-T1..T3, S-15-T5, S-19-T9); change =
  `git diff c7084a9^1 c7084a9`
- **Date**: 2026-11-19
- **Reviewed in**: task P-22r (branch `task/P-22r`), fixes committed there one per finding
- **Verdict before fixes**: NEEDS WORK (no critical; the bot could push where its own rules say
  wait, and a retried or declined push lost its outcome)
- **Verdict after fixes**: APPROVED; open items below are observations or need Alek
- **Findings**: 10 (8 warnings, 1 guard, 1 test gap), all fixed; 6 observations (not fixed,
  listed)

## Verdicts

| Dimension | Before | After fixes |
|-----------|--------|-------------|
| Plan Adherence | PASS | PASS |
| Scope Discipline | PASS | PASS |
| Safety & Quality | WARNING (F1–F9) | PASS |
| Architecture | PASS | PASS |
| Pattern Consistency | PASS | PASS |
| Success Criteria | WARNING (F10: a test that passed only after another) | PASS |

Checked and fine: the push is never forced and goes to the remote URL, not the mirror's
`origin` (a mirror remote would add `--mirror`/force); the push rule (`packages/core/src/push.ts`)
refuses forks, closed PRs (P-18 O3), a patch not ready, a wrong typed number, an active run, a
base that is not GitHub's fresh head (P-18 O9) and an empty patch; the endpoint stores nothing on
a refusal and sits behind the global `X-PRA-Request`/Origin hook; the job is exclusive per patch;
the same patch always builds the same commit (author and dates from the patch); autofix's push
rule checks sensitive-file patterns (P-18 O6) and the per-chain patch cap; the shadow log writes
no GitHub change; core returns reason codes only and the web maps them to copy.

## Findings

### F1 — A retried push job refused its own landed push; the fix check never started

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: apps/worker/src/run/push.ts:65; packages/integrations/src/git-mirror.ts:293
- **Detail**: When the git push succeeded but the job failed before it marked the patch (a db
  error, a crash), pg-boss retried it. GitHub's head was now the bot's own commit, so `canPush`
  recorded `head_moved`, the patch stayed ready and the fix check never started. A crash after the
  mark lost the hand-off (`expectOwnFix`) the same way.
- **Fix**: on a `head_moved` refusal the job builds the patch's deterministic commit (new
  `GitMirror.patchCommit`, no push) and, when the branch is already at it, finishes as pushed. A
  redelivery of a pushed patch repeats the idempotent `expectOwnFix`.
- **Decision**: FIXED (ff7133a)

### F2 — A push GitHub declined was lost without a trace

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/integrations/src/git-mirror.ts:458; apps/worker/src/run/push.ts:103
- **Detail**: A protected branch, a ruleset that asks for signed commits or a pre-receive hook
  answers `[remote rejected]`. `pushPatch` threw, the job failed its retries and nothing was
  recorded: the signer saw "Pushing to <branch>" and then nothing; autofix showed no reason.
- **Fix**: `pushPatch` returns `remote_rejected`; the job stores the `push_rejected` refusal, its
  Timeline entry and autofix's waiting attempt.
- **Decision**: FIXED (82d4529)

### F3 — A pause or a reached budget did not stop the bot's push

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/autofix.ts:200; apps/worker/src/run/budget-gate.ts:33
- **Detail**: A pause ("release freeze") or the daily budget held new rounds only. An autofix
  implementer run already running finished and the bot pushed its patch; a push job queued before
  the pause pushed too.
- **Fix**: the autofix push rule reads the pause and the budget (`autofix_paused`,
  `autofix_budget_reached`); the bot's push job checks them again right before it pushes. A
  person's signed push is unchanged.
- **Decision**: FIXED (87c9a03)

### F4 — Autofix started a patch after a chain's last round

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/autofix.ts:73
- **Detail**: `autofixMaxPatches` allows up to 10, a chain has 3 rounds. With a cap of 3 or more
  the third round's completion started a third patch and pushed it; `expectOwnFix` then refused
  the fix check (`rounds_used`), so the bot left a commit no round would review.
- **Fix**: the start rule holds with `rounds_used` when the chain's rounds are used ("Autofix
  waiting: no fix check left in this chain (3 of 3 rounds)").
- **Decision**: FIXED (7b31a50)

### F5 — A change type a person forced did not hold autofix

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/worker/src/run/autofix.ts:67
- **Detail**: Autofix read round 1's `change_type` output first and the forced type only when no
  output existed. Fix-check rounds keep round 1 as their findings round, so a person who forced
  One-way door after round 1 to stop the bot was ignored: the next patch was started and pushed.
- **Fix**: the forced type wins, as in `raiseChangeType`.
- **Decision**: FIXED (92f04ed)

### F6 — The shadow log overstated "would have pushed"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/worker/src/run/autofix.ts:255
- **Detail**: At levels 3–4 a round whose start was held (One-way door, unsure verdicts, open
  questions) wrote `would_wait`; when a person then implemented and the patch passed, the push
  entry wrote `would_push`. That entry is the PR's latest, so Insights → Trust ladder counted it
  as "would have fixed and pushed" although level 5 would never have started: evidence for raising
  a repository to level 5 was inflated.
- **Fix**: the push entry stays `would_wait` with the start's reasons.
- **Decision**: FIXED (f3933d7)

### F7 — A lowered level or a person's edit did not stop the bot

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: apps/worker/src/run/autofix.ts:87; apps/worker/src/run/autofix.ts:218;
  apps/worker/src/run/push.ts:70
- **Detail**: A PR lowered from 5 to 4 mid-chain still started a bot implementer run (model
  spend) from the level-5 fix-check round. A bot patch whose PR was lowered, or that a person
  edited or reverted while its push job waited, was still pushed by the bot without re-run
  reproductions.
- **Fix**: the start takes the lower of the round's and the PR's level (shadow at 3–4); the push
  rule holds with `autofix_level_lowered`; the push job re-runs the push rule for the bot (pause,
  budget, level, sensitive files, cap) and refuses a patch a person changed
  (`autofix_patch_edited`; a person pushes it signed).
- **Decision**: FIXED (fed93d3)

### F8 — An autofix run could commit without its `started` attempt

- **Severity**: ℹ️ GUARD (not reachable today)
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/worker/src/run/autofix.ts:124
- **Detail**: `recordAutofixAttempt` skips a conflicting row, so a second start for the same
  round would commit an implementer run with no `started` row: uncounted by the patch cap and
  never pushed. The hook fires once per round today.
- **Fix**: `afterInsert` throws when no row was written, which rolls the run back.
- **Decision**: FIXED (9a5ca4a)

### F9 — A recovered patch got no autofix push or shadow entry

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/worker/src/run/recover.ts:146
- **Detail**: When the `runCompleted` hooks failed, recovery (P-18 F4) wrote the missing patch but
  did not run `autofixOnPatchReady`: the bot's patch was neither pushed nor shown as waiting, and a
  person's patch at levels 3–4 got no shadow entry.
- **Fix**: recovery runs `autofixOnPatchReady` after it stores the patch.
- **Decision**: FIXED (0616cb2)

### F10 — A push test passed only after another test; a Timeline check missing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: packages/integrations/src/push-patch.test.ts; apps/worker/test/push-job.test.ts
- **Detail**: The `head_moved` case in `push-patch.test.ts` passed only because the first test had
  already moved `feature` in the shared bare remote; run alone it fast-forwarded. The moved-head
  case of the push job did not check its Timeline entry (S-14-T2 names it).
- **Fix**: the case puts a person's commit on the branch itself; the job test asserts the
  `patch_push_refused` entry.
- **Decision**: FIXED (3217133, e8c32ad)

## Observations (not fixed)

- **O1** P-18 O1 stays: `sendRefusal` (`apps/api/src/routes/api/patches/index.ts:61`) maps an
  unknown refusal code to a fallback. Every code the push and patch gates return is mapped today.
- **O2** `shadowByRepository` (`packages/db/src/queries/autofix.ts:249`) reads every shadow row
  of the window and keeps each PR's latest in memory; no limit. Fine for 14 days of one team's
  PRs; a `DISTINCT ON` query if it grows.
- **O3** `push-dialog.test.tsx` uses 12 for the route's and the PR view's number, so it cannot
  tell which one the dialog asks the signer to type.
- **O4** `timeline-autofix.test.ts` inserts the `autofix_pushed` entry by hand instead of
  running the push job; the job's own test covers the write.
- **O5** If a signer were hard-deleted between the endpoint and the job, the push would be
  attributed to the bot. Team members are never hard-deleted, so it is unreachable.
- **O6** The patch commit is built with `git add --all`
  (`packages/integrations/src/git-mirror.ts:307`): a patch file under a gitignored path is left
  out of the commit. The implementer rarely writes there; worth a refusal if it happens.

## Needs Alek

- **S-14-T6 real push smoke** (out of scope, unchanged; steps in `work-packages.md`): one commit
  by `pr-review-agent[bot]`, no force push, a `Co-authored-by:` line, round 2 starts after the
  fix; a moved head is refused. After F2, also note what GitHub answers when a rule declines.
- **Signed-commit rulesets**: a repository whose rules require signed commits refuses the bot's
  push; after F2 that is recorded as `push_rejected`, but such a repository cannot use push or
  autofix until the App's commits are signed or the rule lets the App through.
- **OQ3 (provisional)**: the commit is the bot's with the signer as `Co-authored-by`; the
  branch rules found in S-12-T6/S-14-T6 confirm or change that.

## Verification

- Before fixes: targeted unit tests for core, worker (autofix, push job, implementer run) and
  integrations (push-patch) and `pnpm typecheck` passed after each fix.
- After fixes and `git merge main`: `pnpm verify` green (1553 tests); `pnpm test:e2e` 80
  passed, 1 skipped (a first run under heavy machine load timed out 6 specs waiting for queued
  runs; all passed when run again).
