---
change_id: P-18
title: Implementer and fork PRs (S-13-T2–T7, S-16-T1–T4)
status: planned
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
