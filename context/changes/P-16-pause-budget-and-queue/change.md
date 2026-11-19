---
change_id: P-16
title: Pause, budget and queue (S-10-T1–T7)
status: planned
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-16 from `context/foundation/work-packages.md`, wave 6. Plan: yes, see `plan.md`
(brief in `plan-brief.md`). One commit per task, in the listed order. Planning ran without
questions (orchestrator rule: decide and record).

## Decisions

- **State lives in `app_settings`** (work-packages decision "One audit log"): no `agent_status`
  and no `audit_entries`. `AppSettingsSchema` gains `pausedBy` (Team member id), `pausedAt` and
  `timeZone` (default `Europe/Warsaw`). A migration inserts the single row, so a migrated database
  has it with agent slots 2.
- **Audit entries are `settings_changes` rows** written by `applySignedSettingsChange`, area
  `budget`, entities `status` (`{ paused, reason, by }`), `daily_budget` and `agent_slots`.
- **Signed bodies use `signedBy`**, the field every signed route already uses, not `signerId`.
- **Pause twice / resume while running return 409** `already_paused` / `not_paused`.
- **Queue data is a new table `run_waits`** (own schema file `schema/status.ts`): one row per run
  with `admitted_at` (the run holds an agent slot) and `reason` (why it waits, a reason code). No
  column on `runs` and no structural edit of `execute-stage.ts` (hot file H1, P-15 this wave).
- **Gates go through P-05's registry.** `beforeRoundStart` takes a Postgres advisory transaction
  lock, reads settings, today's spend and the slot holders, and either admits the run (claims the
  slot) or stores the wait reason. `beforeSession` checks the budget only (a paused factory lets
  running rounds finish). A slot holder is a running run or a queued run with `admitted_at`.
- **Oldest first:** a run is admitted only when the free slots exceed the queued, not admitted runs
  older than it. The drainer admits in `created_at` order.
- **Drainer is a pg-boss job `run.drain`** (policy `stately`: one queued plus one active). It is
  sent by the api after every status change, by the run end hooks (a slot frees), and by a pg-boss
  cron every minute, which also covers local midnight. It refreshes every wait reason and sends
  the stage job of each run it lets go.
- **The budget is checked before each agent stage** (P-05's `beforeSession` granularity), not
  between sessions inside one stage.
- **A running round that waits before a session shows as Queued** with the budget reason (the PR
  state loader reads `run_waits`).
- **Today's spend** counts sessions created since local midnight in `timeZone` (`spentToday`).
  The status route and Insights' "today" use it, so both show the same number.
- **Worker test deps run without gates by default**: the shared test database keeps runs of other
  tests that would fill the slots. Gate tests use their own database.
- **Pause and resume conflicts** are checked against the stored state before the signed change and
  again when `applySignedSettingsChange` reports `settings_stale` (someone paused in between), so
  a race also answers 409 `already_paused` / `not_paused`, not `settings_stale`.
- **Every status route answers with the new status** (the `GET /api/status` shape); the web sets
  it into the chip's query and refetches only after an error. `app_settings` and `run_waits`
  changes reach the web through live updates (`LIVE_TARGETS`).
- **Insights' "today" uses `spentToday`** (local midnight), the same number as the chip; the
  Insights day ranges stay whole UTC days.
- **Budget & status saves budget and slots as two signed changes** (two `settings_changes` rows,
  one signature in the dialog). Agent slots is a number input from 1 to 20 (the prototype's
  select had 1–4; the schema allows 20).
- **Settings opens on Budget & status** now, the first page of General in the approved order; the
  Team unit test and `settings-team.spec.ts` open `/settings/team` directly.
- **E2E:** `pause-budget.spec.ts` changes global state, so it runs in its own Playwright project
  that the main project depends on (it runs first, alone) and it restores the state. The e2e
  stack sets agent slots to 20 so parallel specs never wait for a slot.
