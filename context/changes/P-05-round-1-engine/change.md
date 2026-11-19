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
