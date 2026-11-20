# ALERTTL: the PR timeline tells the truth about an alert's ClickUp comment

## Cause

`evaluateAlerts` wrote the `alert_raised` timeline entry as soon as the alert row was stored, and
its copy read "Alert posted as a ClickUp comment…". Nothing checked `deliveryStatus`. On PR #282
the alert had no task (no linked task, no general alerts task), so it was `not_configured`, no
delivery job was queued, and the timeline still said "posted".

## What changed

- `alert_raised` is neutral: "Alert raised: <title>". It no longer stores `taskId`.
- A new entry kind, `alert_delivery`, says how the comment went. It is written only when the
  outcome is known: in `deliver.ts` after the attempt, and in `evaluate.ts` at once when the alert
  is `not_configured` at creation (no job runs then).
- `alerts.delivery_reason` (jsonb, migration `0031_alert-delivery-reason`) stores a
  `{ code, params }` reason. Not sent: `alert_delivery_no_key` (names the missing env var),
  `alert_delivery_no_app_url`, `alert_delivery_no_task` (`forPr`), `alert_delivery_clickup_off`
  (no repository has ClickUp set up). Failed attempt: `alert_delivery_failed` with `willRetry`,
  `attempt`, `attempts`, `errorCode`. Core `alertDeliveryBlocker` picks the not-sent reason; the
  copy is in `apps/web/src/copy/alerts.ts`.
- The API returns `delivery.reason` on every alert.

## Decisions

- **Own entry, not an outcome on `alert_raised`.** The timeline is a history: "raised at 10:00,
  could not post at 10:00, posted at 10:01" is true and keeps its times. Updating one entry in
  place would lose them, and `recordTimelineEntry` only inserts.
- **Idempotency.** `sourceKey` is `alert:<id>:delivery:<outcome>`, with outcomes `sent`,
  `not_sent`, `retrying` (a failed attempt that will be retried) and `failed` (the last attempt).
  So a job retried five times adds one "trying again" entry, then one final entry.
- **"Will it be retried" comes from the job itself.** The `alerts.deliver` worker now asks pg-boss
  for metadata (`includeMetadata`), and `willRetry = retryCount < retryLimit`, the same test
  pg-boss uses when it fails a job. The queue is set to `retryLimit: 5` (30 s delay, backoff), so
  there are 6 attempts. After the last one nothing retries: the copy says "gave up after 6
  attempts".
- **Old entries.** Neutral copy covers them. The timeline API also adds the alert's stored
  delivery state to an `alert_raised` entry that has no `alert_delivery` entry (one query, only
  when such entries exist), so #282 reads "Alert raised: … Not sent to ClickUp: no ClickUp task to
  comment on". Old rows have no reason; the copy falls back on what the row shows (task or no
  task). No backfill migration.

## Other places checked

- Activity → Alerts: the column was headed "Posted" but showed when the alert was raised or
  ended. It is now "When", and each row shows the delivery text (before: only in a tooltip).
- PR banner line: already read the delivery status; it now names the reason. "Could not post…;
  trying again" was shown for every failure, also after the job gave up; it now follows
  `willRetry`, and an old failed row without a reason promises nothing.
- `author_notified`, `follow_up_created`, `github_comment_posted`: written after the call
  succeeds. No change.
- `prototype/js/metrics.js` still has the old sentence; the prototype is static and was left.

## Not done

- No e2e for the not-connected paths: the e2e stack always has ClickUp. Worker tests cover each
  reason; the alerts e2e checks the neutral entry and the "Posted to" entry on the timeline.
- A `pending` alert whose job was lost stays "Posting to…"; nothing re-sends alert jobs. Not part
  of this report.
