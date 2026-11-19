---
change_id: P-18r
title: Implementation review of P-18 (implementer and fork PRs)
status: implemented
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Reviews P-18 (10x-impl-review format) and fixes what it finds, one commit per finding. No plan.
Report: `context/changes/P-18-implementer-and-fork-prs/review.md`. Verdict REJECTED as merged
(F1: the implementer could run a host command through `.git`); F1–F10 fixed, O1–O9 recorded.
Result: `pnpm verify` green (1465 tests), `pnpm test:e2e` 74 of 74 passed.

## Decisions

- **Report path** `review.md` in the P-18 folder (orchestrator), no interactive triage: a finding
  is confirmed by a test that fails without the fix or, for F1, by a reproduction of the attack.
- **F1 defence in two layers:** the path guard denies `.git` writes, and worktree git commands
  never discover the git dir from the worktree (`--git-dir` checked to point into a mirror).
- **F8 reset through git** (`GitMirror.resetWorktree`: `reset --hard` and `clean -d`, ignored
  files kept) instead of writing bases back; no GitMirror double exists, tests use the real one.
- **F6 refuses undo on the server** (409 `run_active`, kind `implementer`) and hides Undo in the
  toast; Cancel the run first.
- **F4 sweep window** is the last 24 h of completed implementer runs, like the event resend.
