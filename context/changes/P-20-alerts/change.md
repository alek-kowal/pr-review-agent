---
change_id: P-20
title: Alerts (S-18-T1–T6, S-18-T8, S-21-T9)
status: in_progress
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
