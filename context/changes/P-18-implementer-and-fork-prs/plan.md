# Implementer and fork PRs (P-18) Implementation Plan

## Overview

Work package P-18 (wave 7): S-13-T2 to T7 and S-16-T1 to T4. Implement with agent turns findings
decided as Implement (level 4 and above) into a patch through an implementer run; the team reviews
the patch per file, edits, reverts or revises it before anything is pushed (push is P-22). Fork PRs
get a read-only run policy built into the core run plan.

## Current State Analysis

- Core already has run kind `implementer` with stages `worktree`, `implement`, `reproductions`
  (`run.ts:8`, `planRun` maps the kind at :77), `FEATURE_ON_FROM.implement = 4`, a `Patch` type
  (`model.ts:116`, statuses ready/pushed/discarded), and the state table's `fixing`,
  `patch_ready` and `waiting_for_fix` (action `implement_with_agent`, disabled with
  `implement_below_level`). The db loader hard-codes `patch: null` (`queries/pr-state.ts:368`).
- `createRun` (`db/queries/start-round.ts:87`) takes `{pullRequest, kind, level, plan, trigger,
  startedBy, beforeInsert?, inTransaction?}` and refuses `run_active` through the
  `runs_one_active_per_pr` index (round and implementer block each other).
- The worker stage registry is keyed by stage key only; `reproductions` already belongs to the
  fix check. No executor exists for `worktree` or `implement` (they would fail
  `stage_not_available`). `runImplementer` (`@pra/agents`) exists with tools Read, Glob, Grep,
  Edit, Write; a missing key fails `model_access_not_configured`.
- `GitMirror` has `addWorktree`, `diff`, `removeWorktree`; tests use the real `CliGitMirror` on a
  git fixture. `FakeSandbox` records calls; `FakeAgentRunner` takes function steps that edit files
  under `input.cwd`.
- Fork handling today: `roundStartForEvent` never auto-starts a fork; Verify and the fix check skip
  reproductions with `!pullRequest.isFork`; Checks still installs for forks; `startFixCheckOnPush`
  has no fork check. No `runPolicy`, no step-level plan.
- Web: Patch tab is a placeholder; `MAIN_ACTIONS` has no `implement_with_agent` entry;
  `CancelAction` cancels only the latest round; no Tooltip primitive (radix-ui umbrella installed).
- e2e: the stack's `ScriptedAgents` has no implementer role; behaviour is chosen by PR number
  ranges in `e2e/support/env.ts`.

## Desired End State

Every task's "Done when" test passes, `pnpm test:e2e implement-patch.spec.ts` and
`pnpm test:e2e fork-pr.spec.ts` pass the S-13 and S-16 slice checks, and `pnpm verify` is green.

## What We're NOT Doing

- Push, the fix check after push and level 5 autofix (P-22). Patch status `pushed` stays unused.
- S-13-T8 (real smoke, Needs Alek).
- A GitMirror double: tests keep the real `CliGitMirror` on a fixture.

## Phases (one commit per task)

1. **S-13-T2** Core: `canImplementWithAgent(pr, findings)` (`implement-gate.ts`), reason
   `no_implement_decisions`, `PatchStatus` gains `superseded`. Db: `schema/patches.ts` with
   `patches`, `patch_files` and `implementer_requests`; queries `patches.ts` (insert revision,
   edit file, revert file, supersede, latest patch); loader feeds `patch`. Tests:
   `implement-gate.test.ts`, state-table cases, `patches.test.ts`.
2. **S-13-T3** Worker: kind-specific executors (`implementer` → `worktree`, `implement`,
   `reproductions`), `GitMirror.worktreeChanges`, patch stored by a `runCompleted` hook, revise as
   a new implementer run, `patch.check` job. Test: `implementer-run.test.ts`.
3. **S-13-T4** API: `withAgent` on the decide route, `POST /api/prs/:repo/:number/implement`,
   `/api/patches/:id` routes, PR view section `implementer`. Test: `implement.routes.test.ts`.
4. **S-13-T5** Web: checkbox in DecisionForm and BulkBar, banner action with Dialog, Raise to
   level 4, Fixing Cancel. Test: `implement-with-agent.test.tsx`.
5. **S-13-T6** Web: Patch tab. Test: `patch-tab.test.tsx`.
6. **S-13-T7** e2e: implementer role in the stack, `implement-patch.spec.ts`.
7. **S-16-T1** Core: `runPolicy(pr)`, `planRun({..., fork})` marks install and reproductions steps
   off with `fork_read_only`. Test: `fork-policy.test.ts`.
8. **S-16-T2** Worker: Checks and Verify read the plan steps; fix check on push skips forks.
   Test: `fork-run.test.ts`.
9. **S-16-T3** API run stages carry off steps; web popover note and "off for forks" labels.
   Tests: `fork-pr.test.tsx`, `fork.routes.test.ts`.
10. **S-16-T4** e2e: fork webhook fixture option, `fork-pr.spec.ts`.

## Progress

- [x] 1 S-13-T2 patch record and gate
- [x] 2 S-13-T3 implementer, revise and patch-check jobs
- [x] 3 S-13-T4 implement and patch API
- [x] 4 S-13-T5 Implement with agent in the form and banner
- [ ] 5 S-13-T6 Patch tab
- [ ] 6 S-13-T7 e2e implementer flow
- [x] 7 S-16-T1 fork run policy in core
- [x] 8 S-16-T2 fork policy in the worker
- [ ] 9 S-16-T3 fork PR on board and PR page
- [ ] 10 S-16-T4 e2e fork review
