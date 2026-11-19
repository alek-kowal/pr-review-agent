---
change_id: P-17
title: Instructions, trials and pipeline (S-22-T1–T11)
status: implemented
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-17 from `context/foundation/work-packages.md`, wave 6. Plan: yes, see `plan.md`.
One commit per task, in the listed order. Planning ran without questions (orchestrator rule:
decide and record).

## Decisions

- **Files, then versions.** `instruction_files` holds the identity (scope, repository or level,
  file key); `instruction_versions` (S-01-T1's table, moved to `schema/instructions.ts`) now points
  at a file. Its old scope, repository and key columns are dropped; the migration moves existing
  rows into files by hand-edited SQL (re-apply it if the migration is regenerated after a merge).
- **Level copies are global per level** (prototype: "Replace the global file at one review
  level"): scope `level` has a level and no repository. Resolution per file key: level copy, then
  repository, then global.
- **JSON fallback is generic.** For a `.json` file the layers merge field by field. A layer that
  does not parse is skipped (`instruction_json_invalid`); a field whose JSON type differs from the
  lower layer's keeps the lower value (`instruction_field_invalid`). Only active versions resolve.
- **Runs freeze their versions.** At run start the worker writes `run_instruction_versions` and
  keeps the `runs.instruction_versions` jsonb snapshot (Run detail and Insights read it). Stages
  read the frozen set, so activating a version never changes a running run. Runs started before
  this package (no rows) fall back to the active versions.
- **Trials take the draft only.** Trial B overrides one file with its draft; a lesson candidate as
  trial B comes with P-21 (S-23), which adds the lesson text variant to the same override.
- **Trial runs skip the PR.** Trial runs write no timeline events, GitHub comments or ClickUp
  notices, and never touch the PR state table, chains or PR cost.
- **The pipeline lists global files.** `GET /api/pipeline` shows the global active instruction
  files per stage; a per-repository view is out of scope.
- **One draft per file, saved in place.** `PUT /api/instructions/:id/draft` updates the file's
  draft or adds the next version number as the draft. A draft that a trial read is kept as the
  trial saw it: the next save archives it (never active) and starts the next version. Rollback
  takes only archived versions that were active once.
- **Activation in the settings log.** Area `instructions`, entity = file id, value
  `{ fileKey, version }`; the stored `after` adds `added`/`removed` line counts. A copy
  (`POST /:id/copies`, repository by slug or level) starts as an unsigned draft version 1. The
  editor has no copy button yet (not in S-22-T5's list).
- **Trial runs skip Checks and Task** (`off_in_trial`): those stages read GitHub and ClickUp, and
  a trial calls neither. Both runs skip them, so the compare stays fair. A trial uses the PR's
  level and records the commit both runs review.
- **Compare rule.** Findings match on file, lines within 3 of each other (a finding without a line
  matches any line) and the title in lower case without punctuation or accents; closest pairs
  match first, one to one.
- **Try on a PR picks from the board.** The dialog offers the board's open PRs (drafts included);
  a repository file offers only its repository's PRs. The trial opens its Compare page. A run
  change invalidates the trial queries (live family `trials`), so Compare fills in by itself.
- **Pipeline descriptor in `@pra/agents`.** `PIPELINE_STAGES` lists the eight stages with role,
  `ROLE_TOOLS`, the integrations a code stage calls, instruction file keys, output schema and
  fields, attempts and the level where each turns on. Agent output fields come from the schemas;
  the review and Checks fields are literal and a worker test keeps them equal to the worker's
  schema and types. `GET /api/pipeline` resolves each model with core `modelFor` at the stage's
  own level (`resolveLevel(onFrom)`; stored level overrides come with P-23), the timeout from
  that level, and each file key against the global files.
- **Attempts are 1.** A failed stage stops the run and Retry is a button (S-15); a job retry
  marks a stage left running as interrupted. Verify adds one repair of a broken reproduction.
  Fix check uses its built-in prompt (no instruction file); the Analyst lists none until P-21.
- **Pipeline diagram nodes are buttons.** `@xyflow/react` (v13) with dragging, connecting,
  selecting, deleting, panning and scroll zoom off and `nodesFocusable` off; each custom node is
  one `<button>` (re-enabling the pointer events React Flow turns off), so Tab, click and Enter
  open the Sheet. Nodes carry a fixed size so they show before React Flow measures them. A table
  of the stages sits under the diagram, as in the prototype. shadcn `Sheet` added to
  `components/ui`.
- **Tests and global files.** Test files share one database, so a test that reads global
  instruction files filters to its own rows or uses its own `createTestDatabase()`.
- **E2e trial PRs.** `instructions.spec.ts` edits the stack's global `review-rules.md`, which
  every spec reads. The scripted reviewer reacts only for `TRIAL_PRS` (272–279) and only when the
  rules name that PR (`trialRule`): then the Nit gives way to one Worth fixing finding, so run B
  differs. A retry takes the next PR number and reads the draft's version number from the page.
- **The Try dialog stops its submit.** It is portalled inside the editor's form, and React
  bubbles a portal's submit to that form; its save would set the tried draft aside.
- **`e2e/a11y-routes.ts` started here** with the Instructions, Experiments and Pipeline routes;
  S-17-T9 (P-24) adds the check and the other routes.
- **Merge of main (P-16 pause/budget/queue, P-19 merge from the app).** Main's `0014_pr_checks`
  and `0015_pause_budget_queue` stay untouched. This branch's migrations were deleted and
  regenerated on top as `0016_instruction_files`, `0017_instruction_versions_by_file` and
  `0018_trials`. For 0016 the schema was set for one generate to its in-between state (the old
  scope, repository and key columns kept, trials left out), then the hand-written data move and
  the `activated_at` backfill were added back. All three SQL files match the old ones byte for
  byte, and a further `db:generate` reports no change. `routeTree.gen.ts` was regenerated with
  `vite build` (same as the auto-merge). Error codes, copy, Settings registry (Budget page next to
  Instructions, Pipeline, Experiments) and the schema and query barrels keep both sides.

## Verify

`pnpm lint`, `pnpm typecheck` and `pnpm test:e2e` (18 specs) pass. `pnpm test` fails only on api
tests whose first `build()` passes the 5 s limit when the machine load is above 40; the api
suite passes in full with `--maxWorkers=3`.

After the merge of main: `pnpm verify` passes (154 files, 1067 tests) and `pnpm test:e2e` passes
(25 specs).
