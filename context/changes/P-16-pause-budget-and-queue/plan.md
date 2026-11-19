# Pause, budget and queue Implementation Plan

## Overview

S-10 (FR-021, FR-074, NFR Budget): a Team member pauses PR Review Agent with a reason and resumes
it, sets the daily budget and agent slots (default 2), each signed and logged; rounds wait as
Queued with the reason and start by themselves when the reason clears; no agent stage starts once
today's spend reached the budget.

## Current State Analysis

- `AppSettingsSchema` (`packages/core/src/config.ts:90`) already has `paused`, `pausedReason`,
  `dailyBudgetUsd` (null: no budget) and `agentSlots` (1–20, default 2); one jsonb row in
  `app_settings` (`packages/db/src/queries/app-settings.ts`: `getAppSettings`, `lockAppSettings`,
  `writeAppSettings`). No paused-by, paused-at or time zone. `holdReason()` (config.ts:217) returns
  `paused {note}` / `budget_reached {spentUsd, budgetUsd}`; nothing calls it.
- Gates (P-05): `apps/worker/src/run/gates.ts` `RUN_GATES { beforeRoundStart, beforeSession }`,
  both empty. `executeStage` calls them outside any transaction; a wait stores nothing and ends
  the job (run stays queued, stage pending). `afterTransition` is the single exit from running.
- `resendLostJobs` (recover.ts:55) resends the next stage job of every queued/running run every 5
  minutes and at start, so gates are re-run anyway.
- `spendSince(db, since)` (pr-views.ts:144) sums `agent_sessions.cost_usd` by `created_at`; the
  status route and Insights pass 00:00 UTC.
- Core PR state already has `queued` with `QueueCause` (`paused {by, note}`, `budget`, `slot`) and
  banner codes `state_queued_*`; the db loader hardcodes `{ cause: 'slot' }`
  (`packages/db/src/queries/pr-state.ts:116`). Web copy for these banners exists.
- API: `GET /api/status` returns `{ state: 'running', todaySpendUsd, since }`. Signed settings go
  through `applySignedSettingsChange` (`apps/api/src/settings/signed-change.ts`), body field
  `signedBy`. The api has a pg-boss `queue` in `fastify.deps`.
- Web: `StatusChip` with slots `CHIP_TONES`, `CHIP_SEGMENTS`, `CHIP_SECTIONS`
  (`features/shell/status-chip-slots.ts`); settings registry already lists id `budget` with copy
  "Budget & status"; `MAIN_ACTIONS` has no `resume`; Activity In progress rows show "Queued" only.
- E2E: one shared stack, `fullyParallel: true`; no AgentRunner call recorder (assert with `sql`).

## Desired End State

- `pnpm --filter @pra/db test status.test.ts`, `pnpm --filter @pra/core test start-gate.test.ts`,
  `pnpm --filter @pra/worker test budget-gate.test.ts`, `pnpm --filter @pra/api test
  status-routes.test.ts`, `pnpm --filter @pra/web test status-chip-controls.test.tsx
  budget-settings.test.tsx queued-banner.test.tsx` and `pnpm test:e2e pause-budget.spec.ts` pass,
  plus `pnpm verify` and the full e2e suite.

### Key Discoveries:

- `run.stage` queue is `exclusive` per `<runId>:<stage>`; a resend while the waiting job is still
  active is dropped, so the 1-minute cron is the safety net.
- Worker test deps share one database across files; leftover running runs would fill the slots.
- `playwright.config.ts` runs specs in parallel against one stack; a global pause would hit them.

## What We're NOT Doing

- No `agent_status` / `audit_entries` tables (work-packages decision); the Audit log page is S-21.
- No budget check between sessions inside one stage; no per-repository slots.
- No change to core `pr-state.ts` (hot file H7, P-14 this wave): the slot banner keeps its text;
  the busy PRs appear in Activity's reason.
- No structural edit of `execute-stage.ts` (H1, P-15 this wave).

## Implementation Approach

Pure decision in core (`startGate`), persistence and spend in db (`run_waits`, `spentToday`),
enforcement in the worker through the existing gate registry plus a drainer job, signed routes in
the api, and the UI through the chip, banner, board and Activity extension points.

## Critical Implementation Details

- **Timing & lifecycle**: the gate's slot claim and the run's queued → running transition are in
  different transactions; a claimed (admitted) queued run therefore counts as a slot holder. Every
  gate decision re-evaluates fully (excluding the run itself), so a retried job or a retried run
  never bypasses the gate.
- **State sequencing**: the api sends `run.drain` only after its transaction commits.

## Phase 1: Status data (S-10-T1)

**Files**: `packages/core/src/config.ts`, `packages/db/src/schema/status.ts`, `schema/index.ts`,
`packages/db/src/queries/status.ts`, `queries/index.ts`, a migration, `packages/db/src/status.test.ts`.

- `AppSettingsSchema` + `pausedBy: string | null`, `pausedAt: string | null` (ISO),
  `timeZone: string` (valid IANA zone, default `Europe/Warsaw`).
- `run_waits`: `run_id` PK → runs (cascade), `admitted_at`, `reason` jsonb (`Reason`),
  `waiting_since`, `updated_at`; `pra_notify_change` trigger; app_settings gets the trigger too.
- Migration inserts the `app_settings` row (`{}`; defaults on read).
- `spentToday(db, { timeZone, now? }) → { spentUsd, since }` (local midnight computed in SQL).

Automated: `pnpm --filter @pra/db test status.test.ts` (row with slots 2; fixture across midnight).

## Phase 2: Start gate in core (S-10-T2)

**Files**: `packages/core/src/start-gate.ts`, `reasons/config.ts`, `index.ts`, `test/start-gate.test.ts`.

- `startGate({ status, spentToday, activeRuns, kind, queuedAhead? })` → `{ start: true }` or
  `{ start: false, reason }` with `paused {by, note}` (round only), `budget_reached {spentUsd,
  budgetUsd}` (round and session), `slots_busy {slots, prs}` (round only; `queuedAhead` older runs
  take free slots first). `paused` params gain `by: Actor | null`; `holdReason` fills it.

Automated: `pnpm --filter @pra/core test start-gate.test.ts`.

## Phase 3: Enforce in the worker (S-10-T3)

**Files**: `packages/db/src/queue.ts` (`run.drain`), `queries/status.ts` (holders, waiting runs,
wait upserts), `apps/worker/src/run/budget-gate.ts`, `run/drain.ts`, `run/gates.ts`,
`run/hooks.ts` (one line per end hook), `worker.ts` (handler + cron), `test/support.ts`,
`test/budget-gate.test.ts`.

- Gates as described in Decisions; drainer admits oldest first, refreshes reasons, resends jobs.

Automated: `pnpm --filter @pra/worker test budget-gate.test.ts` (5 ready / 2 slots, budget, pause,
resume, 10 concurrent starts).

## Phase 4: API (S-10-T4)

**Files**: `apps/api/src/routes/api/status/index.ts`, `apps/api/src/settings/status-store.ts`,
`plugins/errors.ts`, `insights/index.ts` (spentToday), `test/routes/status-routes.test.ts`,
`apps/web/src/lib/api-types.ts` (type only).

- `POST /pause {reason, signedBy}`, `POST /resume {signedBy}`, `PUT /budget {dailyBudgetUsd,
  before?, signedBy}`, `PUT /slots {agentSlots, before?, signedBy}`; each sends `run.drain`.
- `GET /api/status`: `state` running | paused | budget_reached, `pausedBy {id, name}`,
  `pausedReason`, `pausedAt`, `dailyBudgetUsd`, `agentSlots`, `timeZone`, `todaySpendUsd`, `since`,
  `queuedCount`.

Automated: `pnpm --filter @pra/api test status-routes.test.ts`.

## Phase 5: Chip controls and Budget & status page (S-10-T5)

**Files**: `apps/web/src/components/ui/progress.tsx`, `features/shell/*`, `features/budget/*`,
`routes/settings.budget.tsx`, `features/settings/registry.ts`, `copy/status.ts`, `copy/budget.ts`,
`live/changes.ts`.

- Chip states and tones (paused warn, budget bad), "$12.40 of $50.00 today" with a progress bar,
  popover section with Pause (reason + signature), Resume (signature), Change budget (signature).
- `/settings/budget`: status, spent today, daily budget and agent slots behind SaveBar + signed
  dialog.

Automated: `pnpm --filter @pra/web test status-chip-controls.test.tsx budget-settings.test.tsx`.

## Phase 6: Queued with the reason everywhere (S-10-T6)

**Files**: `packages/db/src/queries/pr-state.ts` (one line → helper), `queries/status.ts`,
`apps/api` activity route + names, `apps/web/src/features/pr/slots.ts` (`resume`),
`features/activity/*`, `copy/*`, `queued-banner.test.tsx`.

Automated: `pnpm --filter @pra/web test queued-banner.test.tsx` (paused, budget, slots fixtures).

## Phase 7: End to end (S-10-T7)

**Files**: `e2e/pause-budget.spec.ts`, `playwright.config.ts` (project order), `e2e/support/stack.ts`
(slots 20).

Automated: `pnpm test:e2e pause-budget.spec.ts`, then `pnpm verify` and `pnpm test:e2e`.

## Testing Strategy

Unit (core), db integration (own database for app_settings), worker gate tests with an own
database and direct `executeStage` calls plus the drainer, api route tests with an own database,
web component tests with `stubFetch`, one Playwright spec.

## Progress

### Phase 1: Status data

- [x] 1.1 `pnpm --filter @pra/db test status.test.ts`

### Phase 2: Start gate in core

- [x] 2.1 `pnpm --filter @pra/core test start-gate.test.ts`

### Phase 3: Enforce the gate in the worker

- [x] 3.1 `pnpm --filter @pra/worker test budget-gate.test.ts`

### Phase 4: API

- [x] 4.1 `pnpm --filter @pra/api test status-routes.test.ts`

### Phase 5: Chip controls and Budget & status page

- [x] 5.1 `pnpm --filter @pra/web test status-chip-controls.test.tsx budget-settings.test.tsx`

### Phase 6: Queued with the reason everywhere

- [x] 6.1 `pnpm --filter @pra/web test queued-banner.test.tsx`

### Phase 7: End to end

- [x] 7.1 `pnpm test:e2e pause-budget.spec.ts`
- [x] 7.2 `pnpm verify` and full `pnpm test:e2e` after merging main
