# Pause, budget and queue — Plan Brief

> Full plan: `context/changes/P-16-pause-budget-and-queue/plan.md`

## What & Why

S-10: pause PR Review Agent with a reason and resume it, set the daily budget and agent slots,
each signed and logged; rounds wait as Queued with the reason and start by themselves; no agent
stage starts once today's spend reached the budget (FR-021, FR-074, NFR Budget).

## Starting Point

Settings already hold paused, reason, budget and slots in `app_settings`; P-05 left empty start
gates; core already renders Queued banners; the status chip has extension slots.

## Desired End State

The status chip shows Running / Paused by X (reason) / Daily budget reached with today's spend
against the budget and signed Pause, Resume and Change budget; Settings → Budget & status sets
budget and slots; the banner, board card and Activity show why a round waits.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Storage | `app_settings` + `settings_changes` | One audit log (work-packages) |
| Queue data | New `run_waits` table (slot claim + reason) | No edit to hot `runs`/`execute-stage.ts` |
| Atomic slots | Advisory xact lock in the gate | 10 concurrent starts never exceed slots |
| Order | Oldest first, enforced in gate and drainer | FR-021 "starts by itself" in order |
| Wake-up | `run.drain` job: api, end hooks, 1-minute cron | Covers resume, freed slot, midnight |
| Budget check | Before each agent stage | P-05 `beforeSession` granularity |
| E2E isolation | Own Playwright project run first | Global pause would break parallel specs |

## Phases at a Glance

| Phase | Delivers | Key risk |
| --- | --- | --- |
| 1 | Settings fields, `run_waits`, `spentToday` | Migration conflicts at merge |
| 2 | Core `startGate` | — |
| 3 | Gates + drainer in the worker | Races; shared test DB |
| 4 | Signed status routes | — |
| 5 | Chip controls, `/settings/budget` | Settings redirect order |
| 6 | Queued reason in banner, board, Activity | Hot `pr-state.ts` loader line |
| 7 | `pause-budget.spec.ts` | Parallel specs |

## Open Risks & Assumptions

- A stage with several sessions may overspend the budget by that stage's cost.
- A resend dropped by the exclusive stage queue waits for the next minute's drain.
