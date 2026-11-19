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

### S-03-T10 (Run detail)

- Route `/runs/$runId?tab=stages|transcript` (`features/runs/RunPage.tsx`). Header: link to the
  PR, "Round 1 of 3 on #12" (the run kind for runs that are not rounds), status, who started it,
  level, duration and the total cost ("so far" while running, "up to the failure" when failed),
  plus the failure line. Side cards: cost per session, instruction versions, not checked.
- Stages expand to their readable output; failed, running and Review stages start open. Each
  stage lists its agent sessions with model, turns, cost, files read and actions (files and
  actions fold in `<details>`).
- Stage output renderers are an extension point, `STAGE_OUTPUTS` in
  `features/runs/stage-outputs.ts` (P-15 adds Checks and Change type). P-12 adds Task (the linked
  ClickUp task with its text, or why there is none) and Review (summary, risk, what it reported);
  other stages show their output as keys and values.
- The Transcript tab fetches each session's stored log only when the tab opens (`staleTime:
  Infinity`) and lists what the agent said, each tool call with its main target (same fields as
  the api's summary) and each tool result, errors in red. Long texts are cut at 600 characters.
- "Run details" links: after the round line (`ROUND_LINE_LINKS`); Activity and the Timeline use
  the same `RunDetailsLink`.

### S-03-T11 (Timeline tab)

- `features/timeline/TimelineTab.tsx` reads `GET /api/prs/:repo/:number/timeline` (P-10's
  route, unchanged). The summary shows ready for review, "Open for" / "Ready → merged" /
  "Ready → closed", agents worked, waiting for people and merge, and cost; before the PR was
  ever ready it says "Not ready for review yet."
- Entries are newest first, with a filter: Everything, People (members and "by hand") and PR
  Review Agent. Who acted: the API's `memberName` (kept after a member leaves), "PR Review
  Agent" or "By hand"; entries made in GitHub add "in GitHub" (`params.via === 'github'`).
- One sentence per entry kind in `copy/timeline.ts` `entries` (extension point: a package that
  adds a kind adds one line); an unknown kind shows its name with spaces. Finished runs show their
  final cost and the shared `RunDetailsLink`.

### S-03-T12 (Activity)

- `/activity` (`features/activity/ActivityPage.tsx`) shows one In progress table from P-10's
  `GET /api/activity/in-progress`: PR (links to the PR page), run name (links to Run detail
  through `RunDetailsLink`, which now takes optional children), current stage ("Queued" for
  queued runs, "Starting" between stages), start time ("Not started" while queued), cost so far.
  Empty state: "No agent is working and nothing is queued."
- Live: run, stage and session changes already invalidate the `activity` family (T8); the
  table stays mounted and only its rows change.
- Extension points in `features/activity/slots.ts`: `ACTIVITY_SECTIONS` above or below In
  progress (S-18's Alerts and Finished today) and `IN_PROGRESS_ROW_ACTIONS` at the row end
  (S-09's Cancel). Activity copy moved to `copy/activity.ts`.

### S-03-T13 (live progress E2E)

- The e2e stack's reviewer double holds PRs 350–399 (`HELD_PRS` in `e2e/support/env.ts`): it
  reports one turn ($0.12, through `onProgress`, as the real adapter does), then waits until the
  spec creates `releaseFile(number)` (at most 2 min), then answers the scripted review ($0.31).
  The spec, not a timer, decides when the round moves on, so the running state is checked
  without races.
- `e2e/live-progress.spec.ts` loads the board once and then only clicks: card in Agents working
  under 10 s after the webhook POST, Activity row at Review with $0.12, PR page stepper with
  Review running and "running · $0.12 so far", the stepper folding into the round line after the
  release, Run detail, the Timeline's bot and by-hand entries, and Activity without the run.

### S-06-T4 (link a task by hand, task panel)

- The route is `PUT /api/prs/:repo/:number/task-link` (`routes/api/task-links`), not `:id`: every
  PR route that exists so far (decisions, timeline, view) is keyed by repo and number, and so are
  the web's queries. Unsigned; `X-PRA-Request` and the Origin check apply as to every write.
- Body `{ taskIdOrUrl }`; core `taskIdFromRef` reads an id (`WB-123`, `86c1abc`, `#86c1abc`) or a
  ClickUp task link (`/t/<id>` or `/t/<workspace>/<custom id>`). Errors: 422 `task_ref_invalid`,
  422 `task_not_found` `{ taskId }`, 422 `clickup_not_configured` (no repository settings or no
  key), 502 `clickup_auth_failed` / `clickup_error`. ClickUp errors are read by shape, as in the
  integrations route (autoload loads routes through their own module graph).
- A valid task replaces any earlier link (`upsertTaskLink`, how `hand`, linked by `hand`) and adds
  a `task_linked` timeline entry by hand, in one transaction. The next round's Task stage already
  reads the stored link first, so nothing changed in the worker.
- New PR view section `task` `{ configured, link }`; the panel `features/clickup/TaskPanel.tsx`
  sits in `PR_PANELS` for open PRs: the task's name (opens ClickUp) with its ID and how it was
  linked, plus "Link another task"; "No ClickUp task linked" with "Link a ClickUp task"; or
  "ClickUp not configured for this repository". The dialog keeps the reason on an error and
  closes after a link; the PR view and Timeline refetch.
- No live trigger for `pr_task_links`: the Task stage's link arrives with its stage change (which
  already refreshes the PR view) and a hand link refreshes through its own request.
- Also added the P-10 follow-up copy for `run_not_found`, `session_not_found` and
  `transcript_not_found`.

### S-06-T5 (follow-up task for each deferred finding)

- Migration `0011_decision_follow_ups` adds follow-up columns to `finding_decisions`
  (`follow_up_status` creating/created/failed, task id, url, error as a reason code) and a
  `pra_notify_change` trigger on status updates. No new table; the task's creation is also a
  `follow_up_created` timeline entry by the bot.
- One `clickup.follow-up` job per decision batch, keyed `<batchId>` (`singletonKey`), sent by
  the decisions route on Defer with `startAfter` = `FOLLOW_UP_DELAY_SECONDS` (15 s, past the
  10 s Undo toast), so an undone batch creates nothing.
- Each finding is claimed under the batch row lock that Undo also takes: an undone batch stops
  the job; a `creating` claim is never taken again (no duplicate task after a crash mid-call); a
  `failed` one is retried.
- The task goes to the linked task's list (`getTask(...).listId`), else the repository's
  `followUpListId`; it is a plain task, not a subtask. Name: the finding's title; description:
  where, scenario, suggestion and the PR link.
- Failures are stored on the decision (`clickup_not_configured`, `follow_up_list_missing`, or
  the gateway's code) and rethrown so pg-boss retries; `clickup_not_configured` is not retried.
- If the API cannot send the job, it logs the failure and the decision stands; the worker's
  recovery resends jobs for deferred decisions with no status after 75 s.
- The decision payload carries `followUp` (`null` for other decisions). The web shows it as the
  first `FINDING_ACTION_SLOTS` entry (`features/clickup/FollowUpLine.tsx`): "Deferred to ClickUp
  · <task id link>", "· creating the ClickUp task…", or "· no ClickUp task: <why>".
  `finding_decisions` changes refresh the findings (`LIVE_TARGETS`).
