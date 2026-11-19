<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Manual start, chains and sensitive files (P-11)

- **Plan**: context/changes/P-11-manual-start-chains-sensitive/plan.md
- **Scope**: all 11 phases (`git diff b2a8189^1 b2a8189`)
- **Date**: 2026-11-19
- **Reviewer**: package P-11r (decisions in `context/changes/P-11r-review/change.md`)
- **Verdict**: REJECTED as merged (sensitive files failed open); F1–F8 are fixed in P-11r, F9–F11 are left (see handoff)
- **Findings**: 1 critical, 7 warnings, 3 observations

Focus, as asked: round chains (3-round cap, triggers, webhook/job races, restart mid-chain),
sensitive files and holds that must stop a merge or push, and test doubles.

## Verdicts

| Dimension | Verdict | Note |
|-----------|---------|------|
| Plan Adherence | WARNING | Run creation sits in `packages/db/src/queries/start-round.ts`, not `src/runs/`; `runs.chain_id` has no foreign key (F10). |
| Scope Discipline | PASS | Extras are recorded in P-11's change.md. |
| Safety & Quality | FAIL | F1 critical; F2–F8 warnings. All fixed. |
| Architecture | PASS | Package boundaries hold; doubles only behind `@pra/*/testing`; no runtime fake mode. |
| Pattern Consistency | PASS | |
| Success Criteria | WARNING | Automated criteria pass; several tests assert less than their "Done when" (F11). |

## Checked and OK

- Triggers: only `opened` (not draft), `ready_for_review`, a manual start and an own fix on the
  chain's expected head start a round; `synchronize` never does otherwise. Retries of a started
  event skip via the outcome written in the run's transaction.
- 3-round cap: core `nextAutomaticRound` counts completed rounds only; the active-run unique index
  stops a second concurrent round; failed/cancelled rounds do not count (no automatic retry).
- Restart mid-chain: a queued run without its job is re-sent by `resendLostJobs`; a running stage
  is interrupted at start (P-05r). A failed fix check stalls the chain until a manual start.
- Core gating: pending and sent back both block Ready to merge; `pushByItself` checks patch files
  against the patterns (not wired yet, S-14).
- API: CSRF hook, `{ error: { code, params } }`, signer checks, 409 stale.
- Test doubles: no production import of `@pra/*/testing`; separate `./testing` exports.

## Findings

### F1 — A failed sensitive-file scan let Ready to merge through
- **Severity**: ❌ CRITICAL · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality
- **Location**: apps/worker/src/run/sensitive-files.ts, run/hooks.ts
- **Detail**: The scan was a `runCompleted` hook: it runs after the run commits and only logs
  errors. A git failure or a worker stop after the commit left no rows and a green PR, never retried.
- **Fix**: scan in a `beforeRoundStart` gate that opens or throws; the round stays queued and is re-sent.
- **Decision**: FIXED (0a04682)

### F2 — Approved file stayed approved after later commits changed it
- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality
- **Location**: packages/db/src/queries/sensitive-files.ts
- **Detail**: FR-046 approves changes; a rewritten migration reached Ready to merge unseen.
- **Fix**: the scan diffs each approval head to the round head and reopens changed files.
- **Decision**: FIXED (1731534)

### F3 — Approval from a page loaded before a push was accepted
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Fix**: a push moves the sensitive version while files wait (409 `sensitive_stale`).
- **Decision**: FIXED (2980b3a)

### F4 — Renaming a file out of a sensitive path was not detected
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Fix**: match the old path of renames too. **Decision**: FIXED (ed6baf0)

### F5 — A moved head could read as 0 commits since review
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Dimension**: Safety & Quality
- **Location**: packages/db/src/queries/pr-state.ts `commitsSinceRun`
- **Detail**: force push with the same count, failed compare or a reset gave 0 → Ready to merge on an unreviewed head.
- **Fix**: at least 1 when the head differs. **Decision**: FIXED (93228fd)

### F6 — Fix push recorded after its webhook never started the fix check
- **Severity**: ⚠️ WARNING · **Impact**: 🔎 MEDIUM · **Dimension**: Safety & Quality
- **Location**: apps/worker/src/run/chains.ts, packages/db/src/queries/start-round.ts
- **Detail**: `setChainExpectedHead` was order dependent; S-14 records the SHA after the push.
- **Fix**: worker `expectOwnFix` (idempotent) plus an atomic compare-and-clear of the expected head.
- **Decision**: FIXED (0a55a7c). S-14/P-22 must call `expectOwnFix`, not `setChainExpectedHead`.

### F7 — Finished round measured against the head at its last stage's start
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW · **Fix**: re-read the PR. **Decision**: FIXED (c3b20d2)

### F8 — Lock order could deadlock approve with a push; timeline copy missing
- **Severity**: ⚠️ WARNING · **Impact**: 🏃 LOW
- **Detail**: reset/add locked file rows before the PR row; `pr_level_changed`, `sensitive_*` showed raw kinds.
- **Decision**: FIXED (65bfaab, e2fc9bc)

### F9 — After 3 rounds the bot's unchecked fix head can reach Ready to merge
- **Severity**: ⚠️ WARNING (latent until S-14) · **Impact**: 🔎 MEDIUM
- **Location**: packages/db/src/queries/pr-state.ts `commitsSinceReview` (expected head → 0)
- **Detail**: if people then decide the remaining Implement findings otherwise, nothing holds the PR; that head was never reviewed or scanned.
- **Fix**: core input flag (e.g. `ownFixUnchecked`) that keeps `rounds_used` until a new chain reviews the head.
- **Decision**: PENDING (handoff)

### F10 — `runs.chain_id` has no foreign key to `round_chains`
- **Severity**: 🔍 OBSERVATION · **Impact**: 🏃 LOW · **Fix**: add the FK in the next migration that touches `runs` (parallel packages make a new migration risky now).
- **Decision**: PENDING (handoff)

### F11 — Tests assert less than their "Done when"; rollout gaps
- **Severity**: 🔍 OBSERVATION · **Impact**: 🏃 LOW
- **Detail**: start-review 409 only while queued and no "by hand" check; fix-check "diff since previous round" cannot tell round head from PR base; no round-3 `fromSha` test. Open PRs reviewed before deploy (or before a pattern is added) are not scanned until their next round; a rerun scan after adding patterns is a rollout step. Fix-check answers can be steered by PR content (prompt injection) for findings without Verify scripts.
- **Decision**: PENDING (handoff)
