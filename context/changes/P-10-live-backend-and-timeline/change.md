---
change_id: P-10
title: Live backend and timeline (S-03-T1–T7)
status: planned
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-10 from `context/foundation/work-packages.md`, wave 4: change notifications, SSE,
live cost per turn, core round label / stepper / time summary, the timeline and PR state log,
and the run detail, timeline, activity and status APIs. Plan: yes, see `plan.md` (brief in
`plan-brief.md`). One commit per task, in the listed order.

The planning step ran without questions (orchestrator rule: decide and record).

## Decisions

Planning decisions are in `plan-brief.md` "Key Decisions Made". Implementation-time decisions
are added per task below.

### S-03-T1 (change notifications)

- Migration `0006_live_notify.sql` is hand-written (`drizzle-kit generate --custom`): one
  plpgsql function `pra_notify_change()` reads `pull_request_id` / `run_id` from `to_jsonb(NEW)`,
  so any later table with those columns needs only a `CREATE TRIGGER` line. Sessions look up
  their run through `stage_executions`. If the migration must be renumbered at merge, recreate it
  with `--custom` and copy the SQL; drizzle-kit cannot regenerate it.
- `listenChanges(db | url, onChange, { onReconnect, onError, retryMs, maxRetryMs })` opens its
  own `pg.Client` (`application_name = 'pra-live'`), never a pool slot; it reconnects with
  backoff (100 ms doubling to 5 s) and calls `onReconnect`, since changes in the gap are lost.
- `run-round.test.ts` (P-05): the stage-timeout double now also resolves when the signal is
  already aborted. Under full-suite load the worktree setup outlasted the 180 ms timeout, the
  double waited the 30 s grace, and the worker's next jobs timed out.
