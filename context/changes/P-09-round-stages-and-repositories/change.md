---
change_id: P-09
title: Round stages and repositories (S-04-T3, S-06-T3, S-04-T5, S-05-T2, S-20-T3, S-20-T6, S-20-T4, S-20-T7, S-20-T8)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-09 from `context/foundation/work-packages.md`, wave 4: the Checks, Task, Change type
and Verify stages, and connecting and configuring repositories with integration health in
Settings. Plan: no; the tasks' "Done when" checks are the plan. One commit per task, in the
listed order.

## Decisions

### Across the package

- **`execute-stage.ts` (hot file H1, P-10 in this wave) is not edited.** Stage executors keep
  returning `output`; the two stages that must write domain rows do it themselves, in their own
  transaction, before they return: Task writes `pr_task_links`, Verify writes verdicts on
  `findings` and `finding_verifications` (only while the run is still running, checked under the
  run's lock).
- **`WorkerDeps` gets `judge`, `sandbox` and `clickup`** (`createAnthropicJudge`, `createSandbox`,
  `createClickUpGateway` in `main.ts`; `FakeJudge`, `FakeSandbox`, `FakeClickUpGateway` in
  `test/support.ts` and the e2e stack).
- **One worktree per run, shared by its stages** (`src/stages/worktree.ts`): the first stage that
  needs it checks it out and writes a marker (`sessions/run-<id>/worktree.json`, removed with the
  run's files); later stages reuse it, so Review and Verify see the dependencies Checks
  installed. Review now uses it too. A retried run whose files were removed checks out again
  (without `node_modules` if Checks is reused).

### S-04-T3 (Checks stage)

- `GitHubGateway.getCiStatus(fullName, sha)` reads check runs (paginated, at most 10 pages of
  100) and the combined commit status, and returns counts plus each check's name, source and
  state. A check run that is not completed, or `stale`, is pending; `success`, `neutral` and
  `skipped` pass; any other conclusion fails. Statuses: `success` passes, `failure`/`error` fail.
- Stage output: `ci` (counts and checks) and `install` (`status` ok/failed/skipped, `failedStep`,
  each step's exit code, time-out flag, duration and 4,000-character tail, and `logBlobKey`). The
  whole log of both steps is `runs/<runId>/checks-<attempt>/install.log` in BlobStore.
- A GitHub error without an integration code fails the stage with `github_error` and
  `params.status`; integration errors (`sandbox_not_configured`, `github_app_not_installed`, ...)
  keep their own code.
- The package cache is `<dataDir>/cache/<repository slug>`.
- The run-round test "a stage without an executor fails with `stage_not_available`" now runs
  `executeStage` directly on deps without the Checks executor, since every round stage has one.
