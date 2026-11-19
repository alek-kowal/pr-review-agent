---
change_id: P-22r
title: Implementation review of P-22 (push, autofix and shadow log)
status: implemented
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Reviews P-22 (10x-impl-review format) and fixes what it finds, one commit per finding. No plan.
Report: `context/changes/P-22-push-autofix-shadow/review.md`. Verdict NEEDS WORK as merged (no
critical; the bot could push where its own rules say wait, and a retried or declined push lost
its outcome); F1–F10 fixed, O1–O6 recorded. Ran over two sessions (handoff in between).
Result: `pnpm verify` green (1553 tests), `pnpm test:e2e` 80 passed, 1 skipped (a first run
under heavy machine load timed out 6 queued-run specs; all passed on rerun).

## Decisions

- **Report path** `review.md` in the P-22 folder (orchestrator), no interactive triage: a finding
  is confirmed by a test that fails without the fix.
- **F1 retry detection by rebuilding the commit** (`GitMirror.patchCommit`, no push): the patch
  always gives the same commit, so a `head_moved` whose head is that commit is this job's own
  landed push. No "pushing" state is stored before the push.
- **F2 a declined push is a refusal, not a retry**: `[remote rejected]` → `push_rejected` with a
  Timeline entry; retrying would hit the same rule.
- **F3 pause and budget hold only the bot's push.** A person's signed push is unchanged, and
  the autofix start is not held: its implementer run queues behind the pause like any run.
- **F4 the start rule holds at the chain's last round** (`rounds_used`) rather than lowering the
  `autofixMaxPatches` maximum: the cap is per chain, the round limit is the real bound.
- **F5 a forced change type wins** over round 1's `change_type` output, as `raiseChangeType`
  already does.
- **F6 the shadow push entry keeps a held start's `would_wait`** and its reasons, so Insights
  counts only what level 5 would have pushed.
- **F7 the start uses the lower of the round's and the PR's level**; the bot's push job re-runs
  the autofix push rule; a bot patch a person edited or reverted is refused
  (`autofix_patch_edited`) and a person pushes it signed.
- **F8 guard throws** in `afterInsert`, rolling the run back, instead of skipping silently.
- **F9 recovery runs `autofixOnPatchReady`** after it stores a lost patch, the same order as the
  `runCompleted` hooks.
- **Not fixed** (O1–O6 in the report): small, unreachable or test-only; listed for later.
