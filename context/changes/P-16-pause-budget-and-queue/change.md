---
change_id: P-16
title: Pause, budget and queue (S-10-T1–T7)
status: implemented
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
- **Merge with S-11 (main):** the sensitive files scan moved from a run hook to a
  `beforeRoundStart` gate on main. The queue gate runs first, so a round that waits is scanned
  only when it really starts. Worker test deps use `NO_QUEUE_GATES` (renamed from `NO_RUN_GATES`),
  which keeps the sensitive files gate.
- **Queued reads the same everywhere (T6).** Core's `queueCauseOf` turns a `run_waits` reason into
  the PR state's queue cause; a running run with a wait reason is `queued`. Activity rows carry
  `wait` (the stored reason or null) and show it as "Queued: …"; the board card and the banner
  use the banner copy. The pauser's name comes from the status query (`usePauseNames`), since a
  stored `paused` wait always names the current pause.
- **The banner's Resume… opens the status chip** through a window event (`openStatusChip`), so
  the PR page does not import the top bar; the signed Resume and budget stay in the chip.
- **E2E:** `pause-budget.spec.ts` changes global state, so it runs in its own Playwright project
  that the main project depends on (it runs first, alone) and it restores the state. The e2e
  stack sets agent slots to 20 so parallel specs never wait for a slot.
- **E2E checks (T7):** pause in the chip (signed) → a ready PR shows "Queued: paused by …" and
  has no agent session → Resume… on the banner → Resume (signed) → the round finishes; then a
  $0.01 budget (below the round's spend) → the next PR shows "Queued: daily budget reached" with
  no agent session; the three `settings_changes` rows (pause, resume, budget) carry the signer.
  The spec restores the state through the api in `finally` (resume, budget null) and then sees the
  budget-held round start by itself. PR numbers 260–269 belong to this spec.
- **Merge with S-12 (P-19, main):** main's `0014_pr_checks` migration and its snapshot stay
  untouched. This package's migration was regenerated on top as `0015_pause_budget_queue`
  (`pnpm db:generate --name pause_budget_queue`); the generated SQL equals the old 0014 and the
  hand-written tail (the `app_settings` row and the two notify triggers) is carried over verbatim.
  Both sides kept in `ApiErrorCode` (pause/resume plus merge codes), `MAIN_ACTIONS` (`resume` and
  `merge`), the `@pra/db` queries barrel (`status.ts`, `merge.ts`) and the e2e stack imports.
  `NextStepBanner.test.tsx` keeps this package's `renderBanner` (QueryClient for the status query)
  and drops `aChecklist`, since main moved the checklist tests to `checklist.test.tsx`.
  `routeTree.gen.ts` was regenerated with `vite build`; it did not change.
