# P-15 Retry, cancel and stage outputs — Plan Brief

> Full plan: `context/changes/P-15-retry-cancel-stage-outputs/plan.md`; decisions: `change.md`.

## What & Why

Runs must be recoverable and stoppable: retry a failed round from its failed stage, cancel a
queued or running run so spend stops at once, cancel on PR close, survive a worker restart, and
correct what webhooks missed. The PR page also shows Checks, change type and a large-PR warning.

## Starting Point

Core already models cancel, retry (`reused` stages) and restart recovery; `AgentRunner` takes an
abort signal; live sessions store cost per turn; `pra_change` notifications exist. Missing: retry
rows, a cancel path, the worker listener, the poll, routes and UI.

## Key Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Retry shape | New run row with `retry_of`, reused stage rows copied | Failed attempt keeps its cost and never counts |
| Cancel state | `cancel_requested_at` + actor, no new status | Avoids touching the active-run index and every reader |
| Who finishes a cancel | Always the worker (listener + backstops) | One writer for run status and hooks |
| Restart code | `interrupted_by_restart` at worker start | Task text; in-process path keeps `interrupted` |
| Reconcile | pg-boss cron, never starts a review | Core rule: no auto-review of an imported board |
| Change type on PR | Read from latest completed round's outputs | No new PR columns |

## Phases at a Glance

1–2 retry (worker, route, UI) · 3–5 cancel (worker, controls, close) · 6 restart · 7 e2e retry/
cancel · 8 reconcile · 9–10 Checks/change type UI and e2e. One commit per phase.

## Open Risks

- Reused Checks means no installed dependencies in a retried round's new worktree.
- One worker process is assumed by the restart sweep.
