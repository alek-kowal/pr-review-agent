---
change_id: P-20
title: Alerts (S-18-T1–T6, S-18-T8, S-21-T9)
status: done
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-20 from `context/foundation/work-packages.md`, wave 7: alert rules in core, alert
storage and config, evaluation in the worker, ClickUp delivery, the alerts API, alerts in
Activity, on the board, the PR page and the status chip, the end-to-end test, and the signed
Settings → Alerts page. Plan: no; the tasks' "Done when" checks are the plan. One commit per task,
in the listed order.

## Decisions

### S-18-T1 (alert rules in core)

- `packages/core/src/alerts.ts`: `alertConditions(snapshot, config)` returns the conditions plus
  the day, the kinds that are on and the PR ids checked; `reconcileAlerts(known, conditions)` takes
  every stored alert (any status), so a key that was ever stored never fires again (this is also
  how the cost alert never fires again after a dismiss).
- Keys: `failed:<pr id>:<failure no>`, `rounds:<pr id>:<chain id>`, `cost:<pr id>`,
  `budget:<day>:<percent>`. The budget alert fires at the chosen percent (50/70/80/90) and again at
  100%; at 100% both stay active, and both clear when spend falls below their threshold or at
  midnight (the day is in the key).
- Clears carry an end note code (`alert_end_retried`, `_new_review`, `_below_threshold`,
  `_midnight`, `_pr_closed`). The cost alert never clears here. An alert of a kind switched off is
  left as it is (its note would otherwise be untrue).
- Title and next step are reason codes (stored as JSON). The ClickUp comment is the bot's output,
  not app copy, so `alertCommentText` lives in core (like `notifyText`); the worker posts it and
  Settings → Alerts previews the same string.
- `AlertConfigSchema` (defaults: all on, $5, 80%, no general task) and `AlertConfigWriteSchema`
  (general task required) are shared by db, worker, api and web.

### S-18-T2 (alert storage and config)

- `alerts` (`packages/db/src/schema/alerts.ts`): title, next step and end note are reason-code
  JSON. Delivery status is `pending | sent | not_configured | failed`; `to_general_task` records
  whether the comment goes to the general alerts task. Ended by is `bot | hand`.
- `alert_config` is one row (id 1) with real columns and checks (cost > 0, percent in 50/70/80/90);
  migration `0021_alerts` inserts it by hand (like `app_settings` in 0015) and adds the
  `pra_notify_change` trigger on `alerts`, so SSE sees every alert change. Keep both when the
  migration is regenerated.
- `knownAlerts(db, keys)` reads the active alerts plus any alert with one of the keys about to fire,
  so reconcile never scans the whole history.

### S-18-T3 (alert evaluation in the worker)

- Evaluation runs in its own pg-boss job `alerts.evaluate` (policy `stately`: requests during an
  evaluation merge into the next one), never inside a stage, so alerts cannot stop or delay a
  round. Cron `ALERTS_CRON` every minute covers the budget and midnight.
- Moments: instead of run hooks plus api calls, one worker listener on `pra_change` for `runs`,
  `agent_sessions`, `pull_requests` and `app_settings` (throttled 500 ms) asks for an evaluation.
  That covers a stage failing, a round completing, a chain ending, a retry or a new start made by
  the api (no hook exists for those), each recorded session cost and each live turn cost, a PR
  closing and a budget change. No hot file is edited.
- Snapshot: open PRs only; state from the existing `loadPrStateInputs` + core `prState`. The
  failure number is the failed round's run id (a retry is a new run). The rounds chain is the
  latest round's chain id. Real spend is `sum(runs.cost_usd)` of kinds `round` and `implementer`
  (live per turn, trials and the analyst left out). Today's spend is the existing `spentToday`
  (every kind, as the budget gate counts it); the day is local to the app time zone.
- Each fire adds a `alert_raised` timeline entry (actor bot, source key `alert:<id>`); clears add
  none. NOTIFY comes from the `alerts` trigger.

### S-18-T4 (ClickUp delivery of alerts)

- Job `alerts.deliver` (policy `exclusive`, 5 retries with backoff), sent only for a new alert,
  with a stable job id and singleton key per alert. The handler skips an alert already `sent`, so
  a job delivered twice posts once. A ClickUp error marks the alert `failed` and rethrows (pg-boss
  retries; a later success sets `sent`).
- Target: the PR's linked task, else the general alerts task (also for the daily budget). It is
  chosen and stored when the alert fires.
- "Not configured" (`not_configured`, copy "Not sent: ClickUp not configured") when there is no
  `CLICKUP_API_KEY`, no `APP_BASE_URL`, no target task, or no ClickUp workspace settings. The
  gateway needs a workspace for custom task ids; a budget alert has no PR, so it uses the first
  repository with ClickUp set up (`anyClickUpSettings`), as does a PR whose own repository has none.
- `APP_BASE_URL` (already listed in `.env.example`, now documented) reaches the worker as
  `WorkerDeps.appBaseUrl`. Links: `<APP_BASE_URL>/pr/<repo slug>/<number>`, Activity for the budget.

### Merge with main

- `main` landed its own `0021_level_model_settings`; the alerts migration is now `0022_alerts`
  (regenerated, with the hand-written config row INSERT and the `alerts` NOTIFY trigger kept).
- Second merge (board filters, urgency sort, search): no new migration. `main` itself did not
  typecheck: the board card's `level.repositoryDefault` read the repository's level, which is now
  null for "Global default". The board now falls back to `app_settings.defaultLevel`, as
  `insights.ts` does; the card's alert count sits next to main's new `level` and `round`.

### S-18-T5 (alerts API)

- `GET /api/alerts?status=active|past` returns `{ alerts, activeCount, pastCount }`; past alerts
  are capped at 100 (the most recently ended), `pastCount` counts them all for "Show N past
  alerts". One alert shape (`apps/api/src/alerts/view.ts`) serves the list, Dismiss and the PR
  view; it carries `runId` (Retry), the delivery status and task, and the end note.
- `POST /api/alerts/:id/dismiss` works on any active alert (the UI offers it on the cost alert,
  the only one that never clears by itself). 404 `alert_not_found`, 409 `alert_not_active`. It adds
  a timeline entry `alert_dismissed` (actor hand, source key `alert:<id>:dismissed`) when the alert
  has a PR; the budget alert has none.
- `alertCount` is a field of every board card (not a badge: `CARD_BADGES` are reason codes, and
  the web puts the bell in its own card slot). The PR view gets an `alerts` section (the PR's active
  alerts, for the banner line). The status chip payload gets `activeAlertCount`.
- SSE: no new event name. The `alerts` trigger sends the existing `change` event with
  `table: 'alerts'`; that is the `alert.changed` signal the web listens for.

### S-18-T6 (alerts in the web)

- Everything plugs into the existing extension points: `ACTIVITY_SECTIONS` (`before`: Alerts),
  `CARD_BADGE_SLOTS` (the bell), `BANNER_LINES` (the PR line), `CHIP_SEGMENTS` (the count) and
  `LIVE_TARGETS.alerts` (`activity`, `board`, `prView`, `status`). The only edits outside slots are
  the strip in `Board.tsx` and the chip's aria-label, which names the alert count (the segment is
  inside a labelled button, so a screen reader would not read it).
- The alert lists use keys under `['activity', 'alerts', ...]`, so the `activity` live family
  refreshes them. Past alerts load only when "Show N past alerts" opens (shadcn `Collapsible`,
  added from the existing `radix-ui` package).
- Actions follow the task text: a run-failed alert carries "Retry from <stage>" (the shared
  `useRetryRun`, on the alert's `runId`), the cost alert carries Dismiss; the rounds and budget
  alerts clear by themselves and carry no button (the prototype also offered Dismiss there).
- Alert copy (`copy/alerts.ts`) maps the reason codes; it mirrors core's `alertTitleText` wording
  but stays app copy. Delivery reads "Posted to ClickUp WB-123", "Not sent: ClickUp not
  configured", or "Could not post …; trying again". "5 min ago" counts from the query's
  `dataUpdatedAt` (renders stay pure, as the board's ages do).
- Timeline: `alert_raised` "Alert posted as a ClickUp comment on WB-123: <title>" and
  `alert_dismissed` "Dismissed the alert: <title>" (actor column: By hand).
- The "Alert settings" link in Activity → Alerts comes with the Settings page (S-21-T9).

### S-18-T8 (end-to-end alerts)

- The stack passes `appBaseUrl: WEB_URL` to the worker and sets the general alerts task
  (`GENERAL_ALERTS_TASK`, WB-700) in `alert_config` at start, with `writeAlertConfig` instead of raw
  SQL. Alerts are global, so every spec's failing PR now posts a comment to WB-700 too; the specs
  that read the comments file filter by PR, so nothing else changes.
- New PR range `COSTLY_RETRY_PRS` (160–169): the reviewer fails its first session and the retry
  costs $5.50, which passes the $5 cost alert. The PR is in `CLICKUP_REPOSITORY` on a branch naming
  WB-4821, so both alerts go to the PR's task. The no-task case uses a failing PR
  (`FAILING_PR_FROM + 60`) in the main repository.
- ClickUp check: the PR has exactly two comments (the failed run and the cost), both on WB-4821;
  the cost comment carries `<WEB_URL>/pr/clickup-repo/<n>` and "pr-review-agent"; the clear and
  Dismiss add none.
- The chip count is checked through its accessible name (the count is global across parallel
  specs, so the spec checks that a count shows, not its value).

### S-21-T9 (Settings → Alerts)

- API: `alertsStore()` is the `SettingsStore` of area `alerts` with one entity, `config` (the
  config is one row). `GET/PUT /api/settings/alerts` take and return `{ config }`; the PUT body is
  `{ config, before?, signedBy? }` and goes through `applySignedSettingsChange`, so a write leaves
  one `settings_changes` row and a stale `before` gives 409 `settings_stale`. The write schema
  (`AlertConfigWriteSchema`) requires the general alerts task; the stored config may still hold
  null until someone saves the page.
- Web: `features/alerts-settings/AlertSettingsPage.tsx`, route `/settings/alerts`, sidebar entry
  in General after Integrations (Bell icon). Layout follows the prototype: "When to alert" (four
  switches, cost threshold in $, budget Select 50/70/80/90 "and at 100%") and "Where alerts go"
  (ClickUp comment with a preview, the general alerts task, "On the dashboard · Activity").
- The draft keeps the cost as typed text; the save dialog shows one row per setting ("Above
  $5.00" / "Off", "80% and 100%" / "Off"), so a threshold and its switch read as one change, as in
  the prototype. Save is blocked (summary alert plus field errors) when the cost alert is on and
  the cost is not above 0, or the general task is empty. With the cost alert off, an invalid typed
  threshold falls back to the saved one.
- The preview renders core `alertCommentText` (the string the worker posts) for a sample cost
  alert on #42 at 108% of the typed threshold, linking to `window.location.origin/pr/example/42`
  (the sample repository name is copy).
- Activity → Alerts has the "Alert settings" link at the right of its heading.
- `/settings/alerts` is in `e2e/a11y-routes.ts`; the "Activity" link inside the text is always
  underlined (axe `link-in-text-block`).
- `main`'s a11y spec failed on four of main's own Settings pages (Models, Review levels, Level 5,
  Audit log): none marked `data-work-start`. Fixed here so `pnpm test:e2e` is green: the Models
  table, the ladder and the level's "Adds" section (`Section` got a `workStart` prop) and the
  Audit log filters carry the marker. No other change to those pages.

