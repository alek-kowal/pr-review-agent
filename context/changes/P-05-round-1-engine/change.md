---
change_id: P-05
title: Round 1 engine (S-01-T5, T6, T9, T10, T11, T15)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-05 from `context/foundation/work-packages.md`, wave 3: webhook to round 1 to
findings to one GitHub sentence, end to end with doubles. Plan: yes, see `plan.md` (brief in
`plan-brief.md`). One commit per task, in the listed order.

The planning step ran without questions (orchestrator rule: decide and record).

## Decisions

Planning decisions are in `plan-brief.md` "Key Decisions Made". Implementation-time decisions
are added per task below.

### S-01-T6 (`github.event` handler and round 1)

- Webhook rounds are always round 1 of a new chain (`roundStartForEvent` returns round 1), so the
  handler does not call `chainState`; later rounds and chains are P-11's `createRun`.
- Out-of-order deliveries: a payload whose `updated_at` is older than the stored snapshot does not
  overwrite it and fires no PR event hooks; the round decision then uses the stored PR.
- Outcomes besides core reason codes: `round_started`, `repository_not_connected`, `ping`,
  `payload_missing`, `payload_invalid`, `event_ignored` (no handler for the type).
- `run_active` comes from core (an active blocking run) or from the `runs_one_active_per_pr`
  unique index when two events race.
- Worker tests: pg-boss 12 only sends from a started instance, so `test/support.ts` starts the
  queue with `supervise` and `schedule` off; "an unchanged PR is left alone" is checked by the row's
  `xmin`. The smoke test runs on its own database (`createTestDatabase()`).

### S-01-T9 (review stage)

- The executor lives in `apps/worker/src/stages/review/` (`index.ts`, `schema.ts`, `brief.ts`,
  `prompt.ts`, `context.ts`) instead of one `stages/review.ts`; the stage contract is
  `src/stages/stage.ts`, paths in `src/stages/paths.ts`.
- The brief and the built-in prompt are English (project language); WB's imported
  `prompt-reviewer.md` replaces the built-in prompt when it has `{{knowledgeDir}}` and `{{repoDir}}`.
- The brief always has a "Limits" section (max findings, allowed severities, questions); "Review
  level" only when the frozen level has a `brief`, "Change risk" only with a change type (P-09).
- Workspace documents (README, CLAUDE, AGENTS, `*.decision-log.md`) come from walking the touched
  `apps/*`/`packages/*` folders of the fresh worktree: `GitMirror` has no file listing, and a new
  worktree holds only tracked files.
- After `enforce` (which keeps the reviewer's order) findings are sorted most severe first, stable,
  so ordinal 1 is the most severe. A line ≤ 0 is stored as null; a `recommended` index outside the
  options as null. P's optional `fix` has no column yet: it stays in the stage output by ordinal,
  with `summary`, `risk`, `gatedNotes`, the reported counts and `enforce`'s dropped counts.
- The installation token is fetched only when the repository has an installation id; a local or
  public remote needs none.
- The knowledge directory is materialised with files `0444` and folders `0555`; `removeTree`
  restores write access before deleting. A file key that leaves the folder is skipped.
- `createGitFixture` and `isolatedGitExec` went into `@pra/integrations/testing` now (plan:
  phase 6), since the review-stage test needs them.

### S-01-T10 (`run.stage` handler)

- The run state is rebuilt from core `planRun` (level number from the frozen level) plus the
  latest attempt per stage (`src/run/state.ts`). The round kind comes from the round number
  (> 1 is a fix check) until P-11 stores it.
- When a queued run starts, stages its level turns off get a `stage_executions` row with status
  `off` and the off reason as output, so the run's history is complete.
- Gates run before the start transaction. A gate that says wait ends the job with no change (run
  stays queued, stage pending) and logs the reason; whoever opens the gate (P-16) sends the stage
  job again.
- Timeout: the frozen level's `stageTimeoutMinutes` aborts the executor's signal; the executor
  then has 30 s to return its sessions (so their cost is recorded) before the stage fails
  `stage_timeout` without them.
- A thrown error with a snake_case `code` (for example `IntegrationError`) fails the stage with
  that code; anything else (including Node errno codes) with `stage_error`.
- Blob keys: `runs/<runId>/<stage>-<attempt>/session-<n>/prompt.txt` and `transcript.json`,
  written before the transaction. Sessions and their cost are stored even when the transition is
  refused (the run changed meanwhile, e.g. a later cancel).
- Hooks fire after the commit; a failing hook is logged, not rethrown (a retried job would find
  the stage done and do nothing). End hooks run before the worktree and
  `<dataDir>/sessions/run-<id>` are removed; removal failures are logged.
- Recovery at worker start (`src/run/recover.ts`): a running stage fails `interrupted` (then the
  `runFailed` hooks and cleanup), a queued run gets its first pending stage job, a running run with
  no running stage its next one. It assumes one worker process, as deployed.
- `executeStage` is exported for direct calls; `runs.not_checked` is written only when the
  reviewer listed something.

### S-01-T11 (after-round comment)

- The setting is checked twice: in the `runCompleted` hook (no job when off) and again in the
  handler (switched off while the job waited). Only runs of kind `round` with status `completed`
  post.
- At most once per run: under the run's row lock the handler claims the run's `comment`
  `github_actions` row (`sending`); a `sending` or `posted` row is never posted again, a `failed`
  one is re-claimed by the pg-boss retry. A crash between claiming and posting leaves `sending`
  and no comment, which is preferred to a double post on a public PR.
- No `github_actions` unique index was added (other packages edit that table); the row lock
  serialises claims.
- `run-round.test.ts` also checks the whole chain: a completed round ends with one `posted`
  comment row.
