---
change_id: P-17
title: Instructions, trials and pipeline (S-22-T1–T11)
status: in-progress
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
- **Tests and global files.** Test files share one database, so a test that reads global
  instruction files filters to its own rows or uses its own `createTestDatabase()`.
