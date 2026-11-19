---
change_id: P-18
title: Implementer and fork PRs (S-13-T2–T7, S-16-T1–T4)
status: impl_reviewed
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-18 from `context/foundation/work-packages.md`, wave 7. Plan: yes, see `plan.md`
(brief: `plan-brief.md`). One commit per task, in the listed order. Planning ran without
questions (orchestrator rule: decide and record).

## Decisions

- **Reason codes stay lower snake_case.** The task's `LEVEL_BELOW_4`, `NO_IMPLEMENT_DECISIONS`,
  `RUN_ACTIVE` and `FORK_READ_ONLY` are the existing `implement_below_level {level, need}`,
  `run_active {kind, status}`, `fork_read_only` and a new `no_implement_decisions`. The gate checks
  fork first, then level, then decisions, then an active run.
- **The implementer takes every open Implement finding** of the latest round (core `toFix`), the
  same set the Fixing banner counts, not only the findings ticked in one form.
- **Patch base is the reviewed commit:** the head SHA of the latest completed round. The
  implementer run is created with that SHA, so the worktree stage checks it out.
- **Run inputs in `implementer_requests`** (run id, finding ids, revised patch, note) in the new
  `schema/patches.ts`, so the shared `runs` table gets no new column.
- **Stage executors by run kind.** The registry gains a per-kind map checked before the shared
  map, because `reproductions` already names the fix-check executor.
- **The patch is written when the run completes** (a `runCompleted` hook for kind `implementer`,
  unique on run id). A cancelled or failed run never leaves a patch; a redelivered job cannot
  write a second one.
- **Revise is a new implementer run** (trigger `revise`): it goes through pause, budget, slots and
  Cancel like the first run. Its worktree starts from the base plus the current patch files; the
  new revision supersedes the old one when it completes. Revise is unsigned ("by hand"), as the
  task says for all patch endpoints.
- **Changed files come from the worktree** through a new `GitMirror.worktreeChanges(worktree)`
  (git status against the checked-out base, with each file's base content). Both base and after
  content go to BlobStore, so the API diffs without git.
- **Reproduction result on the patched tree:** exit 3 (`REPRO_EXIT.notReproduced`) is `pass`, any
  other exit is `fail`, a fixed finding without a reproduction script is `not_run`. The banner's
  `reproductionsPass` is true when at least one ran and none failed.
- **Patch check is a plain job** (`patch.check`, no run, no model spend): edit and revert reset
  the reproduction results and queue it; it bumps `checkVersion` so the web can hold the new
  result behind "View new results".
- **Concurrency:** edit and revert carry the patch revision and the file's blob key; a superseded
  patch, another revision or another blob key returns 409 `patch_stale`.
- **API paths follow the existing PR routes:** `POST /api/prs/:repo/:number/implement`, not
  `/api/prs/:id/implement`.
- **Disabled reasons are visible text, not a Tooltip:** a disabled control cannot take focus, so
  the reason sits under the checkbox and the banner button, tied with `aria-describedby`.
- **The implement stage stores the runner's own result** as its output; the patch is built from
  it when the run completes.
- **The patch API diffs with core `lineDiff`** over the base and after blobs, so it needs no git.
- **Revise writes `patch_revise_requested` as "by hand"**, like every patch endpoint.
- **Fork policy lives in the plan:** core `planRun({ fork })` gives `RunState.offSteps` (install in
  Checks, reproductions in Verify, `fork_read_only`) and turns a fix check's Reproductions stage
  off. `runPlanOf(run, pullRequest)` recomputes it from the PR's fork flag, so no column stores
  it; the manual start passes `fork` into `planRun` too.
- **Off steps reach the web as `offSteps` on every stage view** (latest round, the stepper's
  `roundProgress` steps, Run detail), computed by `offStepsOf` from the same core
  `forkOffSteps`. The stepper and Run detail print "Install: off for forks"; a stage off for a
  fork reads "off for forks", not "off at level N".
- **The manual start keeps 201**, not the 202 the S-16-T3 text names: the endpoint already
  answered 201 with the new run, and the web and tests rely on it.
- **The Start review popover note is its own line** with the task's exact words; it replaces the
  shorter "Fork: read-only review." hint.
- **DecisionForm reads `implementer.block` from the cached PR view** instead of a request of its
  own.
- **"Raise this PR to level 4" is also in the Implement form**, or the S-13-T7 flow cannot reach
  level 4 before deciding.
- **The Fixing banner names Team members** (`useTeamNames`) only when `startedBy` is a member;
  Cancel there uses `implementer.activeRun.id`.
- **Patch detail is cached as `['patch', id, checkVersion]`**, outside the PR keys, so a new
  check result does not refetch the PR; reverted files are hidden from the diff list.
- **e2e doubles:** the Sandbox double exits 3 on a patched worktree (the bug no longer happens)
  and logs each call to `sandboxCalls` (JSON lines with the mounted host paths, so a spec counts
  a run's calls by `run-<id>`); `StackGitHub.getPullRequest` falls back to the stored row, which
  carries `isFork`; `deliverPullRequest` takes a fork owner for the head repository. The
  implementer hold flag is global (`IMPLEMENTER_HOLD`), so `implement-patch.spec.ts` runs
  serially.
- **Merges with main (P-20 alerts, P-21 learning):** alerts kept 0022 and learning 0023; the
  implementer migration is `0024_implementer_patches.sql`, regenerated with its hand-added
  `patches_notify_change` trigger. The board keeps main's level resolution (repository default,
  else the global default); the stage registry holds the analyst's `analyse` next to the
  implementer's `<kind>:<stage>` keys.
