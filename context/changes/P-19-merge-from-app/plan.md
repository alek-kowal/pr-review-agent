# Merge from the app (P-19) Implementation Plan

## Overview

Work package P-19 (wave 7): S-12-T1 to T5 and S-06-T8. The merge checklist uses real CI and
"changes requested" from GitHub, a green PR merges by typing its number and signing (a squash merge
pinned to the reviewed SHA, re-checked against fresh GitHub state, never bypassing branch
protection), Ready to merge leaves when the head moves, and a Playwright spec covers the ClickUp
task link, task context and follow-up.

## Current State Analysis

- Core already has the checklist (`packages/core/src/checklist.ts`, 7 rows incl. `ci_green` and
  `no_changes_requested`), the `merge` main action (signed) on `ready_to_merge`, and the reason
  codes. `prState` ignores CI and reviews; `checklist.ok` needs every row and `ready_to_merge`.
- The state loader hardcodes `ci: []` and `changesRequestedBy: []`
  (`packages/db/src/queries/pr-state.ts:326`); nothing stores CI (the Checks stage keeps it only in
  its stage output) or reviews.
- `GitHubGateway` has `getCiStatus` (P-09) but no merge, PR-state or review reads.
- Webhooks: the api stores every event and queues `github.event`; the worker handles only
  `pull_request` and `ping`. A `synchronize` already updates `head_sha` at once; with no compare yet
  and an equal commit count (force push) `commitsSinceRun` returns 0, so the state can stay Ready
  to merge on a moved head.
- Web: `Checklist.tsx` exists (failing rows, "Show all N", all-green one line reading "Merge
  checklist · N of N"); `MAIN_ACTIONS` has no `merge`; AlertDialog, `SignatureField`,
  `useSignature`, `apiRequest`/`ApiError` exist.
- e2e: one stack process with in-process doubles; specs reach it only through webhooks, the api,
  SQL and files. No repository has ClickUp settings and `FakeClickUpGateway` has no tasks.

## Desired End State

`pnpm test:e2e merge.spec.ts clickup-link.spec.ts` pass with the S-12 and S-06 slice checks, every
task's "Done when" test passes, and `pnpm verify` is green.

## What We're NOT Doing

- Real GitHub App permissions, branch protection and a real merge (S-12-T6, Alek).
- Real ClickUp key (S-06-T9, Alek).
- Showing who merged in the merged banner (`closedBy` stays null; the timeline shows the signer).
- Auto-refreshing CI on page load or round end; CI and reviews refresh from webhooks and on merge.

## Phase 1 (S-12-T1): GitHub merge and fresh-state reads

- `github-gateway.ts`: `getPullRequestState(fullName, number)` → `{ headSha, state, mergeableState }`;
  `listChangesRequested(fullName, number)` → logins (latest review per reviewer ignoring
  `COMMENTED`/`PENDING`; `APPROVED` or `DISMISSED` clears), via a shared `changesRequestedBy(reviews)`;
  `squashMerge({ fullName, number, sha, title, message })` →
  `{ merged: true, sha } | { merged: false, status, message }`.
- Octokit: `GET pulls/{n}` (`mergeable_state`), paged `GET pulls/{n}/reviews`,
  `PUT pulls/{n}/merge` with `merge_method: 'squash'`; 405, 409 and 422 become a refusal with
  GitHub's message, anything else throws. `UnconfiguredGitHubGateway` fails them too.
- `FakeGitHubGateway`: `addReview`, `refuseMerge(fullName, number, refusal)`, `merges` record; a
  successful merge marks a known PR merged; unknown PR state is a 404 like `getPullRequest`.
- Test: `pnpm --filter @pra/integrations test github.merge.test.ts` (msw): body has
  `merge_method: "squash"` and `sha`; 405 "Required status check … is expected" → refused with
  that message; a later APPROVED clears a reviewer's request.

## Phase 2 (S-12-T2): Merge service and route

- `@pra/db`: columns on `pull_requests` (`ci_sha`, `ci_checks`, `changes_requested_by`,
  `checks_refreshed_at`, migration via `pnpm db:generate`); `storePrCi`, `storeChangesRequested`,
  `lockOpenPullRequest`, `recordPrMergedInApp`, `recordMergeRefused`; the loader reads the columns
  (CI only for the current head).
- `apps/api/src/merge/merge-pr.ts` (service) and `routes/api/merge/index.ts`
  (`POST /api/prs/:repo/:number/merge`), order and answers as in change.md Decisions. Success
  answers `{ sha, mergeSha, by: { id, name } }`.
- New `ApiErrorCode`s: `merge_number_mismatch`, `head_moved`, `merge_not_ready`, `merge_refused`,
  `github_error`.
- Worker `timelineOnMerged` skips the entry when the stored PR was already merged (in the app).
- Test: `pnpm --filter @pra/api test merge.test.ts`: wrong number 400; fresh head ≠ reviewed 409
  `head_moved` and no merge call; CI red fresh but green in the DB 409 with the CI row; green PR
  sends `sha` = reviewed SHA and the trailer; refusal message verbatim (422); two concurrent merges
  make one `squashMerge` call.

## Phase 3 (S-12-T3): Keep the checklist fresh

- Worker handlers `check_suite`, `check_run`, `status` (refresh CI of the repository's open PRs
  whose head is the event's SHA, with `getCiStatus`) and `pull_request_review` (refresh that PR's
  changes requested with `listChangesRequested`). Outcomes `ci_refreshed`, `reviews_refreshed`,
  `no_pull_request`.
- `commitsSinceRun`: a head that differs from the round's head is at least 1 commit since when no
  compare was measured yet (force push with the same commit count).
- Tests: `pnpm --filter @pra/worker test checklist-fresh.test.ts` (failing `check_suite` → CI row
  red; CHANGES_REQUESTED → its row red; ready PR + `synchronize` → `new_commits`, Action needed)
  and `pnpm --filter @pra/api test checklist-fresh.test.ts` (rows from stored fields; merge after
  the head moved → 409 `head_moved`).

## Phase 4 (S-12-T4): Merge checklist and Merge dialog

- `Checklist.tsx`: all green reads "Checklist green at abc1234" (still expands to every row).
- `apps/web/src/features/merge/`: `MergeAction` (banner main action "Merge #272…") and
  `MergeDialog` (AlertDialog): title "Merge #272", "Squash merge at abc1234 into main. Cannot be
  undone from here.", the checklist summary or its failing rows, "Checked again against fresh
  GitHub state when you click Merge.", "Type 272 to confirm" (digits only), `SignatureField` with
  "Recorded as “Merged by …” in the timeline.", Cancel / "Merge #272". Merge is disabled until the
  number matches and a signer is picked (not on a red checklist: the server re-checks fresh state,
  which also refreshes stale CI). Errors: 409 `merge_not_ready` lists the failing rows, 422 shows
  "GitHub refused the merge: <message>", others via `errorText`. Success: toast "#272 merged by
  Kasia", invalidate the PR view and the board.
- Copy in `copy/checklist.ts`, a new `copy/merge.ts`, `copy/index.ts` errors, timeline
  `pr_merged` (via app: "Squash-merged at abc1234") and `merge_refused`.
- Tests: `pnpm --filter @pra/web test checklist.test.tsx merge-dialog.test.tsx`.

## Phase 5 (S-12-T5): End-to-end merge

- Stack: a `merge-repo` (level 1) with its own installation, fix-SHA comparisons, CI green on the
  fixture head, and a refused PR number range; a stack subclass of the GitHub double answers
  `getPullRequestState` for PRs it was not given from the stored row (what the delivered webhooks
  said). `e2e/support/github.ts`: `deliverCheckSuite`.
- `e2e/merge.spec.ts`: CI row failing until a `check_suite` arrives, then "Checklist green at …",
  Merge #N… needs the number and a signer, the PR leaves the board for "Merged or closed in the
  last 7 days"; a refused PR shows GitHub's message; a push removes Ready to merge.

## Phase 6 (S-06-T8): End-to-end task link, context and follow-up

- Stack: a `clickup-repo` (level 2) with ClickUp settings (`WB-\d+`, follow-up list) and
  `FakeClickUpGateway` tasks; `deliverPullRequest` takes a branch name.
- `e2e/clickup-link.spec.ts`: branch `feature/WB-…` links the task, Run detail's Task stage shows
  its description; a PR without an ID or search hit shows "No ClickUp task linked" and links one by
  hand; a finding deferred to ClickUp shows its follow-up task.

## Testing Strategy

Each phase's named test, then `pnpm verify`; phases 4–6 also `pnpm test:e2e`. PR numbers: merge
spec 100–119 on `merge-repo`, ClickUp spec 120–139 on `clickup-repo` (free, below the held range).

## Progress

### Phase 1: GitHub merge and fresh-state reads

- [x] 1.1 `github.merge.test.ts` passes

### Phase 2: Merge service and route

- [x] 2.1 `merge.test.ts` passes

### Phase 3: Keep the checklist fresh

- [x] 3.1 worker and api `checklist-fresh.test.ts` pass

### Phase 4: Merge checklist and Merge dialog

- [x] 4.1 `checklist.test.tsx merge-dialog.test.tsx` pass

### Phase 5: End-to-end merge

- [x] 5.1 `pnpm test:e2e merge.spec.ts` passes

### Phase 6: End-to-end task link, context and follow-up

- [x] 6.1 `pnpm test:e2e clickup-link.spec.ts` passes
- [x] 6.2 merge main, `pnpm verify` and `pnpm test:e2e` green
