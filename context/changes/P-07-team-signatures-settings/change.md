---
change_id: P-07
title: Team, signatures and Settings shell (S-02-T1, S-20-T1, S-02-T3, S-02-T5, S-20-T2, S-02-T8)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-07 from `context/foundation/work-packages.md`: Team, the signature field, the
signed-settings change log and the Settings shell with save bar. Tasks in order: S-02-T1, S-20-T1,
S-02-T3, S-02-T5, S-20-T2, S-02-T8 in `context/foundation/roadmap-tasks.md`. Plan: no; the
tasks' "Done when" checks are the plan. One commit per task.

## Decisions

- **One audit log** (work-packages "Decisions made while grouping"): S-02-T1 adds no
  `audit_events` table. Team changes are logged in `settings_changes` (S-20-T1) instead.
- `team_members.id` is a uuid, because core's `Actor` names a member by a string id and
  `runs.started_by_member_id` is already text. The GitHub login is unique among active members
  case-insensitively (`unique index on lower(github_login) where removed_at is null`), so a
  removed member frees their login. Removal is soft; `decision_batches.signed_by` keeps the row,
  so past signatures keep their name.
- `finding_decisions` has one more column than the task names: `version`, the finding's version
  right after the batch. Undo compares it with the finding's current version, so "undo only while
  none of the batch's findings changed since" (S-02-T4) needs no extra query or table.
- `decideFindings(db, …)` and `undoDecisionBatch(db, …)` take a client or a transaction and open
  their own transaction (a savepoint inside a caller's transaction), so they are atomic either
  way. They lock the findings `for update` in id order (no deadlock between two batches), compare
  versions after the lock (READ COMMITTED re-reads the winner's row), and on a conflict write
  nothing and return each moved finding with its current decision and signer name. Findings of
  another PR give `not_found`. Undo bumps the versions too, so a form opened before it conflicts.
- The current decision is read in JS from the non-undone batches, newest batch id first; there
  are only a few batches per finding.
