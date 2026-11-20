---
change_id: P-28
title: Poll GitHub for pull requests until the GitHub App exists
status: implemented
created: 2026-11-20
updated: 2026-11-20
archived_at: null
---

## Notes

Orchestrator task P-28. Alek is not an owner of the GitHub org, so the GitHub App and its webhook
come later. Until then the app finds PRs by polling. `synergycodes/workflowbuilder` is public, so
reads need at most a fine-grained token with "Public repositories (read-only)", and (orchestrator
addition) no token at all: GitHub then allows 60 requests per hour instead of 5000.

What exists: the webhook route stores each delivery (blob + `github_events` row) and queues a
`github.event` job; the worker's `handlePullRequestEvent` upserts the snapshot, asks core
`roundStartForEvent` and runs the PR hooks. The reconcile poll (every 10 min) corrects missed
webhooks silently and never starts a review. `OctokitGitHubGateway` is App-only; without the
three App values every call fails with `github_not_configured`.

## Plan

1. **Core.** `GITHUB_MODES` (`app`, `token`, `anonymous`) and `githubModeOf(env)`;
   `github_read_only` and poller reason codes; the poll schedule (`githubPoll` in app settings:
   interval, from–to, days, time zone) with `pollWindowOpen`, `nextPollAt` (DST-safe through
   `Intl`); `pollTransitions(previous, current)` → the webhook actions a change stands for.
   Read-only gates: `canPush` and autofix (`act` → `shadow`) take `githubReadOnly`.
2. **Integrations.** `TokenGitHubGateway` (Octokit with the token or none): reads only, an ETag
   cache for GETs (a 304 costs no quota), rate-limit tracking from headers, `github_rate_limited`
   with `resetAt` (no request is sent until the reset). Every write (comment, merge, push token,
   bot identity) throws `github_read_only`; `verifyWebhook` throws `github_not_configured`.
   `GitHubGateway` gains `mode`, `getRepository`, `gitToken`, `rateLimit`. `createGitHubGateway`:
   all App values → App; otherwise token mode (with `GITHUB_TOKEN` or anonymous).
   `toRawPullRequest` turns a snapshot back into the payload shape webhooks carry.
   The double gets `mode` and the token-mode refusals.
3. **DB.** `github_poller` (one row: lease, last start/finish, error, backoff, rate limit),
   `github_poll_repositories` (baseline), `github_poll_pull_requests` (last seen head, draft,
   state, GitHub's `updated_at`). `ingestGithubEvent`: the webhook's store-record-queue step,
   shared by the route and the poller. Job `github.poll` (cron every minute, `stately`, no retry).
4. **Worker.** `github.poll`: off in App mode; due by the schedule (or forced by Poll now); a lease
   so overlapping polls skip; per repository: baseline on first poll (imports the PRs, starts
   nothing), then each transition becomes a synthetic `pull_request` delivery with a stable id
   (`poll:<repo>:<pr>:<action>:<key>`) through `ingestGithubEvent`, and the seen state moves by
   compare-and-set. CI refresh for PRs with an active run. A rate limit stops the poll and sets
   the backoff to GitHub's reset. Reconcile skips in token mode. Read-only: push and comment jobs
   refuse once, autofix records only the shadow log, fetch uses `gitToken`.
5. **API.** Integrations: mode, poller status, schedule (signed, own store), Poll now. Status:
   `githubMode`. Merge and push answer 409 `github_read_only`. Connect a repository by name in
   token mode (`getRepository`).
6. **Web.** Integrations in polling mode (mode line, last/next poll, last error, rate-limit
   warning without a token, baseline note, schedule form, Poll now). "Read-only: GitHub App not
   connected" in the merge dialog, push dialog, Implement and autofix. Connect by name.
7. **Tests and e2e.** Core schedule (window, zone, DST), transitions; gateway (ETag, rate limit,
   refusals, selection); worker (mapping, baseline, dedupe, overlap, CI, backoff, App switch).
   e2e project `github-polling` (runs alone, flips the stack's double to token mode).
8. **Docs.** README, deploy docs, env examples, roadmap "Needs Alek" row and S-01-T16 switch-over.

## Decisions

- **Neither App nor token → anonymous token mode**, not "not configured" (orchestrator addition).
  Anonymous mode reads public repositories only; Settings shows the 60/h warning.
- **Partly set App values fall back to token mode** and Integrations names the missing ones, so a
  half-done switch-over keeps polling instead of going silent.
- **Events through the webhook path.** The poller writes the same `pull_request` payload a webhook
  would (from `getPullRequest`, so commit counts are right) and the same `github.event` job;
  `handlePullRequestEvent` decides starts, pushes and closes. Nothing is duplicated.
- **Dedupe in three layers:** the `github.poll` queue is `stately`; a DB lease skips a poll that
  overlaps a slow one; per transition a compare-and-set on the seen state plus a stable delivery
  id (unique in `github_events`) and job id.
- **Baseline imports without starting.** The first poll of a repository stores what it sees and
  upserts the open PRs as snapshots from the list (one request), with a `pr_reconciled`
  `imported` entry, so they show on the board and Start review works. A repository whose last poll
  is older than 7 days is baselined again (a switch back from App mode after a long time).
- **Polling schedule in app settings** (`githubPoll`), its own signed store (entity
  `github_poll`, area `integrations`), so the existing after-round comment switch is untouched.
- **Poll now is not signed** (like Start review). It ignores the window, not the rate-limit backoff.
- **Read-only refusals happen before the work:** merge and push routes answer 409; the push job
  records a refusal (no retry); autofix runs as shadow. The gateway refuses too, as a second line.
- **After-round comment:** not queued in read-only mode; a job queued before a switch away from
  the App returns `github_read_only` (logged, skipped, no retry).
- **No `GITHUB_TOKEN` scope beyond reads is ever used**; the token is sent only to GitHub's API and
  to git over HTTPS as `x-access-token` Basic auth in the env (like installation tokens).
- **Reconcile is off while polling:** the poller already reads every open PR; the 10-minute
  reconcile runs only in App mode.
- **Baseline reuses reconcile:** `reconcileRepository({ importFromList: true, ci: false })`
  upserts the open PRs from the one list request, so a baseline costs one request per repository.
- **CI refresh only for PRs with an active run**, to keep anonymous mode inside 60 requests/hour.
- **Webhook route rejects delivery ids starting with `poll-`**, so a forged delivery cannot take a
  poller id and block the real transition.
- **New reason `github_poll_failed { items }`**: a poll that could not read some repositories or
  PRs lists them; the poll goes on with the rest.
- **Implement stays enabled in read-only mode:** the patch is made and can be downloaded; only the
  push is off (note under the action).
- **Merge and Push buttons are disabled with the note under them** (described by it), rather than
  a dialog that cannot finish.
- **Connect by name:** `GET /api/settings/repositories/lookup` (404 not reachable, 409 already
  connected). The web lookup query key sits outside the repository settings keys, so the refetch
  after a connect does not ask again and show 409.
- **Web reads the mode from `/api/status` (`githubMode`).** A status that failed reads as `app`
  (the pre-P-28 pages); the API still refuses writes. The layout's `useCostBasis` stays ready once
  the status answered: a second observer refetching a failed status set it back to pending, which
  hid and remounted the page in a loop (found by the Repositories tests).
- **e2e `github-polling` runs last, after `chromium`, not first:** a poll baselines every
  connected repository and would import PRs other specs expect to deliver as webhooks. The stack's
  GitHub double switches mode while `holdDir/github-mode` names one; the spec removes it after.
- **Needs Alek:** a new task S-01-T19 (poll WB, optional token) instead of rewriting S-01-T16;
  S-01-T16 gains the switch-over step.
