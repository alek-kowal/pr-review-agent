---
change_id: P-19
title: Merge from the app (S-12-T1–T5, S-06-T8)
status: planned
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-19 from `context/foundation/work-packages.md`, wave 7. Plan: yes, see `plan.md`
(brief: `plan-brief.md`). One commit per task, in the listed order. Planning ran without
questions (orchestrator rule: decide and record).

## Decisions

- **Routes follow the existing keying** `POST /api/prs/:repo/:number/merge`, not `/api/prs/:id/...`
  (as P-11 did). The body is `{ typedNumber, signedBy }`: `signedBy` is the name every signed route
  uses; the task's `signerId` means the same Team member id.
- **CI and changes requested are stored on `pull_requests`** (`ci_sha`, `ci_checks` as core's
  `CiCheck[]`, `changes_requested_by`, `checks_refreshed_at`). The loader uses `ci_checks` only
  while `ci_sha` is the PR's head, so a push empties the CI row at once. The columns arrive with
  T2, because the merge test needs "green in the DB"; T3 fills them from webhooks.
- **Gateway CI maps to core CI** passed → `success`, failed → `failure`, pending → `null`.
- **One merge at a time per PR:** the route holds the PR row `FOR UPDATE` for the whole check and
  GitHub call. A second request waits, then finds the PR merged (the route writes `state = merged`
  in the same transaction) and answers 409 `pr_closed` without calling GitHub. The signer is
  locked before the PR row, the same order as Send back, so the two never deadlock.
- **A GitHub failure that is not a refusal** (network, 5xx, app not installed) rolls the
  transaction back and answers 502 `github_error` (`params.status` when GitHub answered); missing
  App env vars answer 503 `github_not_configured`.
- **Fresh-state order:** typed number (400 `merge_number_mismatch`), signature (400
  `signature_required` / `signer_unknown`), PR open (409 `pr_closed`), fresh head equals the
  reviewed SHA and the stored head (409 `head_moved` `{ reviewedSha, headSha }`), then core's
  `checklist` on the stored state with fresh head, CI and changes requested (409
  `merge_not_ready` `{ items }` with the failing rows). Fresh CI and reviews are stored before the
  answer, so the page shows what the check saw.
- **The squash merge** is `PUT .../pulls/{n}/merge` with `merge_method: squash`, `sha` = reviewed
  SHA, title `<PR title> (#<n>)` and a message of the PR body (when any) plus
  `Signed-off-in-app-by: <name>`. GitHub's 405/409/422 are a refusal (status and message kept
  verbatim, 422 `merge_refused` and a `merge_refused` timeline entry signed by the member); other
  errors answer 502 `github_error`.
- **Success** sets `state = merged`, `merged_at`, `closed_at`, `merge_sha` (GitHub's `updated_at`
  stays, so the later `closed` webhook is not stale and its metrics hook still runs), writes
  `pr_merged` `{ via: 'app', sha, mergeSha }` signed by the member and the state change. The
  webhook's own `pr_merged` entry is skipped when the PR was already merged in the app.

