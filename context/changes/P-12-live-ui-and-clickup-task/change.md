---
change_id: P-12
title: Live UI and ClickUp task (S-03-T8–T13, S-06-T4, S-06-T5)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-12 from `context/foundation/work-packages.md`, wave 5: live updates and the status
chip, the stepper and round line, Run detail, the Timeline tab, Activity, the live-progress E2E
check, linking a ClickUp task by hand and follow-up tasks for deferred findings. Plan: no; the
tasks' "Done when" checks are the plan. One commit per task, in the listed order.

## Decisions

### S-03-T8 (live updates and status chip)

- `src/live/changes.ts` maps each watched table to the query families it invalidates
  (`LIVE_TARGETS`, extension point: a package that adds a trigger adds one line). A table without
  an entry invalidates every query of its PR and the board. A run change invalidates the run, PR
  view, board and Activity; a session change also the status chip; findings and decisions their
  PR's findings, view and the board; timeline entries the Timeline tab only.
- PR queries are keyed by repo and number, change events name PRs by id, so the PR view section
  now returns `pullRequest.id`. A PR query whose view is not loaded yet is invalidated anyway.
- Changes are batched for 150 ms (a turn writes several rows) and invalidated in one call; only
  mounted queries refetch.
- `useLiveUpdates()` runs once in the root layout. Native `EventSource` retries a dropped
  connection itself; when it gives up (closed), a new one opens with backoff 1 s doubling to
  30 s. After any reconnect, and on the server's `resync`, every query is invalidated (changes in
  the gap are lost). Without `EventSource` (jsdom) the hook does nothing.
- Polling is gone from the board, PR view and findings queries; the board keeps refetch on window
  focus.
- Status chip extension points in `features/shell/status-chip-slots.ts`: `CHIP_TONES` by state
  (S-10 adds paused and budget), `CHIP_SEGMENTS` inside the chip (S-18's alert count) and
  `CHIP_SECTIONS` in its popover (S-10's pause and budget controls). The popover shows today's
  spend and a link to Activity. The chip renders nothing until `/api/status` answers.
- Shared formats (`money`, `duration`, `clock`, `dateTime`, `plural`) live in `copy/format.ts`.

### S-03-T9 (stepper and round line)

- New PR view section `roundProgress` (`apps/api/src/pr-view/sections/round-progress.ts`): the
  latest round's run id, `round_label`, the steps with per-stage cost from core `stepperModel`
  (the same steps as Run detail, through the shared `pr-view/stepper.ts`, which also replaced the
  run route's private helpers) and the cost so far (sum of the round's sessions). The existing
  `latestRound` section is unchanged.
- The stepper and round line render as a Next step banner line (`BANNER_LINES`, P-08's slot),
  so P-12 does not edit the PR page frame files (H9, edited by P-11 in this wave).
- Full stepper while the round is queued or running and after a failure; otherwise the round line
  with a Stages toggle. Merged and closed PRs show neither (as the prototype).
- Round label copy: "Round 2 of 3 · started by PR Review Agent after fix abc1234",
  "started by hand", "started by <Team name>", plus "new chain". The bot is named with the
  existing `copy.nextStep.bot`; member names come from `/api/team` (`useMemberNames`).
- `ROUND_LINE_LINKS` in `features/round/slots.ts` takes links after the round line (Run details
  in T10).
