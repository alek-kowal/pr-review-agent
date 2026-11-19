---
change_id: P-11r
title: Implementation review of P-11 (manual start, chains, sensitive files)
status: implementing
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Reviews P-11 (10x-impl-review format) and fixes what it finds, one commit per finding. No plan.
Report: `context/changes/P-11-manual-start-chains-sensitive/review.md`. Handed off: see
`context/changes/P-11r-handoff.md`.

## Decisions

- **Report path** `review.md` in the P-11 folder (orchestrator), no interactive triage: a finding
  is confirmed when a new test fails without the fix (F8 lock order: by reading the lock order).
- **Sensitive scan is a start gate**, not a run-end hook: `sensitiveFilesGate` in
  `RUN_GATES.beforeRoundStart` always opens or throws. Rows now appear when a round starts (also
  for rounds that later fail), which fails closed. Replaces P-11's "a completed round adds".
- **Approval is per content** (replaces P-11's "an approved path stays approved"): each round's
  scan diffs the approval head to the round head and reopens changed files; an approval head git
  cannot compare reopens its files.
- **A push moves the sensitive version** while any file waits, so an old page's approve is 409.
- **Head moved ⇒ at least 1 commit since review**, whatever compare or counts say.
- **S-14's push must call worker `expectOwnFix(deps, chainId, sha)`** after pushing; it starts the
  fix check if the webhook came first and is idempotent for a retried push job. `startRound` takes
  the expected head with a compare-and-clear in the run's transaction.
- **No new migration** in P-11r (parallel packages): the `runs.chain_id` FK is left for later.
