<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Implementer and fork PRs (P-18)

- **Plan**: context/changes/P-18-implementer-and-fork-prs/plan.md
- **Scope**: all 10 phases (S-13-T2..T7, S-16-T1..T4); change = `git diff d61080e^1 d61080e`
- **Date**: 2026-11-19
- **Reviewed in**: task P-18r (branch `task/P-18r`), fixes committed there one per finding
- **Verdict before fixes**: REJECTED (one critical: host command execution from the implementer)
- **Verdict after fixes**: APPROVED; open items below are observations or need Alek
- **Findings**: 1 critical, 9 warnings (all fixed); 9 observations (not fixed, listed)

## Verdicts

| Dimension | Before | After fixes |
|-----------|--------|-------------|
| Plan Adherence | WARNING (S-13-T7 Timeline check missing) | PASS |
| Scope Discipline | PASS | PASS |
| Safety & Quality | FAIL (F1) | PASS |
| Architecture | PASS | PASS |
| Pattern Consistency | WARNING (copy gaps, accessible name) | PASS |
| Success Criteria | WARNING (one vacuous test) | PASS |

Checked and fine: no GitHub writes on any P-18 path (only a `getPullRequest` read); every start
path (implement, decide `withAgent`, revise, fix check on push, webhook) refuses forks, and the
worktree stage re-reads `isFork` from GitHub; fork code never runs (install and reproductions off,
`patch.check` and implementer reproductions skip forks); the reproduction sandbox has no network, a
read-only mount, env `HOME`/`PATH` only and no capabilities; the implementer session has Read,
Glob, Grep, Edit, Write only (Bash denied) and only the model key in its env; no secrets reach the
prompt, blobs or logs; the new routes sit behind the global `X-PRA-Request`/Origin hook; the
client never picks a blob key to read; one patch per run (unique `run_id`); cancel and failure
leave no patch; a closed PR cancels implementer runs; no test double or env-flag fake mode in
runtime code (`IMPLEMENTER_HOLD` lives only in `e2e/support`); AGENTS.md rules hold (imports,
package boundaries, copy only in `apps/web/src/copy`, error shape).

## Findings

### F1 — The implementer agent could run any command on the worker host

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: packages/agents/src/path-guard.ts:48; packages/integrations/src/git-mirror.ts:179
- **Detail**: The path guard let Write create `<worktree>/.git` and files under it.
  `worktreeChanges` ran `git -C <worktree> status`, which discovers the git dir through that
  file. A prompt injection in PR content could make the agent write `.git` → `gitdir: evil` and
  `evil/config` with `core.fsmonitor = "<cmd>"`. The next `git status` (right after the session,
  and on every retry) ran `<cmd>` on the host with the worker's whole env (`ANTHROPIC_API_KEY`,
  `DATABASE_URL`, AWS and ClickUp keys, the App private key path). Reproduced with git 2.50.
- **Fix**: the guard denies any write with a `.git` path segment (case-insensitive);
  `worktreeChanges` (and the new `resetWorktree`) name the mirror's admin dir on the command line
  after checking `.git` is a plain file pointing into `<mirrors>/<owner>/<repo>.git/worktrees/`,
  with `core.fsmonitor=false`. Tests: `packages/agents/src/path-guard.test.ts` (new),
  `git-mirror.test.ts` (an fsmonitor canary never fires).
- **Decision**: FIXED (4681def)

### F2 — Revise on an outdated patch undid newer commits; patch writes followed symlinks

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/db/src/queries/implementer.ts:73; apps/worker/src/stages/implementer.ts:66
- **Detail**: `reviseGate` checked only `status === 'ready'`. After the author pushed and a round
  reviewed the new head, Revise checked out the new head and laid revision 1's whole files (built
  on the old head) over it, silently reverting the newer changes. `writeFiles` checked paths only
  as text, so a symlinked folder of the commit took writes and deletes outside the worktree.
- **Fix**: refuse revise with `patch_stale` when `patch.baseSha` is not the reviewed head;
  `writeFiles` refuses a path through a symlink (deleting a symlink itself is allowed).
- **Decision**: FIXED (803efad)

### F3 — One patch check for the whole system; a lost check left a patch "checking" forever

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/api/src/routes/api/patches/index.ts:82; packages/db/src/queue.ts:80
- **Detail**: `patch.check` uses the `stately` policy but was sent without a singleton key, so
  pg-boss allowed one queued and one active check across all patches; other sends were dropped
  and those patches stayed `checking` with every reproduction `not_run`. Nothing resent them.
- **Fix**: `sendPatchCheckJob` with `singletonKey: patch:<id>`; `resendLostJobs` resends a check
  for every ready patch still `checking`.
- **Decision**: FIXED (ae0f75e)

### F4 — A completed implementer run could lose its patch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/worker/src/run/patches.ts:28; apps/worker/src/run/hooks.ts:62
- **Detail**: The patch is written by a `runCompleted` hook whose errors are only logged;
  recovery looks only at running runs. A db error or crash after the last stage left a completed
  run (up to $5 spent) with no patch and nothing to retry it.
- **Fix**: `resendLostJobs` re-runs the idempotent hook for implementer runs completed in the
  last 24 h without a patch (`implementerRunsWithoutPatch`).
- **Decision**: FIXED (f5c4c74)

### F5 — Patch edits during an active revise run were accepted, then lost

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/db/src/queries/patches.ts:163
- **Detail**: Only the UI blocked edits while revising. A second tab's edit after the revise run
  read the files answered 200, then the new revision superseded the patch without it.
- **Fix**: `changeFile` refuses with 409 `run_active` (kind `implementer`) while a queued or
  running run revises the patch.
- **Decision**: FIXED (3c018e8)

### F6 — Undo after "Implement with agent" left the run fixing undecided findings

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/web/src/features/findings/decisions.ts:104; packages/db/src/queries/decisions.ts:240
- **Detail**: The decision toast still offered Undo when the decision started the implementer,
  and `undoDecisionBatch` did not know about the run: it kept fixing findings no longer decided
  Implement and its patch landed anyway.
- **Fix**: undo refuses (409 `run_active`, kind `implementer`) while an active implementer run
  takes a finding of the batch; the toast offers no Undo for such a batch.
- **Decision**: FIXED (c79bdc5)

### F7 — The patch diff could block or crash the API on large files

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/core/src/instructions.ts:179
- **Detail**: `lineDiff` allocates an (n+1)(m+1) table on every patch GET and edit: 20k changed
  lines took about 1.6 GB and seconds of blocked event loop; past about 30k the allocation failed
  and the Patch tab could not open.
- **Fix**: past 4M cells (about 2,000 × 2,000 lines) the changed middle reads as replaced.
- **Decision**: FIXED (a711b33)

### F8 — Resetting the worktree corrupted binary files and could delete tracked files

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/worker/src/stages/implementer.ts:112
- **Detail**: `resetWorktree` wrote each changed file's base back from `git show` read as a UTF-8
  string: a binary base came back corrupted, and a base git could not show (`null`) deleted a
  tracked file, which the next `worktreeChanges` then put into the patch.
- **Fix**: new `GitMirror.resetWorktree` runs `git reset --hard` and `git clean -d` (ignored
  files stay) with the fixed git dir from F1.
- **Decision**: FIXED (1a25d00)

### F9 — Patch tab and copy gaps

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/web/src/features/patch/queries.ts:37; apps/web/src/copy/implementer.ts:75;
  apps/web/src/copy/index.ts:208
- **Detail**: On 409 `patch_stale` the tab said "Reload it" with no way to: the detail key holds
  the check version, so every retry hit 409 again. The Revert button's `aria-label` "Revert
  <path>" dropped its visible text "Revert file" (WCAG 2.5.3). The stages `worktree` and
  `implement` and three implementer reason codes had no copy ("error <code>").
- **Fix**: refetch the patch and PR view on `patch_stale`; name "Revert file <path>"; stage names
  and reasons added.
- **Decision**: FIXED (8627e2b, 365fa28, 5e00fe6)

### F10 — A missing e2e check and a vacuous test

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: e2e/implement-patch.spec.ts:95; apps/worker/test/fork-run.test.ts:197
- **Detail**: S-13-T7's Done when names "Timeline shows the signer and the 'by hand' entries";
  the spec never opened the Timeline. "A push of the expected fix head on a fork starts no fix
  check" seeded no chain, so it passed even without the fork rule.
- **Fix**: the spec checks Kasia on the decisions and By hand on edit, revert and revise; the
  fork test seeds a chain expecting the PR head.
- **Decision**: FIXED (e2e0b59, 7bc7a50)

## Observations (not fixed)

- **O1** `sendRefusal` (`apps/api/src/routes/api/patches/index.ts:50`) maps an unknown refusal
  code to `run_active`. Every code the gates return today is mapped; a new one would be
  mislabelled.
- **O2** The worker's state machine calls `runStateOf` without the PR (`execute-stage.ts`,
  `cancel.ts`, `recover.ts`, `retry.ts`), so a fork's fix-check Reproductions step is "pending"
  there and "off" only in the API. Safe today because `fix-check.ts` checks `runPolicy` itself.
- **O3** A ready patch of a closed PR still accepts edits and queues a check (no model spend).
  P-22's push must refuse a closed PR.
- **O4** An edit stores its blob before the 409 check, so a refused edit leaves an orphan blob.
- **O5** `POST .../implement` writes no timeline entry; the signer appears with `run_started`
  from the worker. Same as the manual round start. A run cancelled while queued shows the signer
  only on Run detail.
- **O6** Patches are not matched against sensitive-file patterns. Fine while nothing is pushed;
  P-22 must check it (PRD: "Autofix waiting: patch touches a sensitive file").
- **O7** A file's "after" content is read as UTF-8. The agent can only write text, but a
  binary file it overwrote shows a lossy base in the diff.
- **O8** Tests: `fork.routes.test.ts:78` recomputes `runPlanOf` instead of asserting the route;
  `implementer-run.test.ts` "delivered again" calls the hook by hand rather than redelivering a
  job mid-run; `implement-gate.test.ts:101` names the signer but asserts only `prState`.
- **O9** For P-22 (builds on P-18 now): F2's `patch_stale` on base drift and F5's revise lock
  also matter for Push; push should refuse a patch whose `baseSha` is not the PR head.

## Needs Alek

- **S-13-T8 real smoke** (out of P-18 scope, unchanged): a real implementer run needs
  `ANTHROPIC_API_KEY` and the GitHub App on a test repository; it checks real cost on Run detail
  and that the transcript has no shell call and no path outside the worktree. After F1 it should
  also confirm a Write to `.git` is denied.

## Verification

- Baseline before fixes: `pnpm verify` green; `pnpm test:e2e implement-patch.spec.ts
  fork-pr.spec.ts` 4/4.
- After fixes and `git merge main`: `pnpm verify` green (1465 tests); `pnpm test:e2e` 74 of 74
  passed.
