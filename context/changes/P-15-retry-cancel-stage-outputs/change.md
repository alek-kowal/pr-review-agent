---
change_id: P-15
title: Retry, cancel and stage outputs (S-09-T1–T7, S-03-T14, S-04-T6, S-04-T7)
status: implemented
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-15 from `context/foundation/work-packages.md`, wave 6. Plan: yes, see `plan.md`
(brief: `plan-brief.md`). One commit per task, in the listed order. Planning ran without questions
(orchestrator rule: decide and record).

## Decisions

- **A retry is a new run row** (`runs.retry_of`), not a second attempt inside the failed run: the
  failed run keeps its status and cost, and the chain counts only completed rows. Same chain,
  round number, frozen level, head SHA and commits count as the failed run. Succeeded stages are
  copied as `reused` rows with `stage_executions.reused_from_stage_id` and their output; what a
  reused stage produced outside its output is copied too (Review: findings, questions and the
  run's `not_checked`; Check fixes: fix checks). Retry code lives in `@pra/db`
  (`queries/retry.ts`), next to `createRun` but not inside it (H2 belongs to P-17 in this wave).
- **A retried round's worktree is new.** Reused Checks does not install again (no Sandbox call on
  retry, as S-09-T1 asks), so stages after it run without the PR's installed dependencies.
- **No `cancelling` run status.** A cancel request sets `runs.cancel_requested_at` plus who asked
  (`cancelled_by`, `cancelled_by_member_id`) and why (`cancel_reason`: `by_hand`, `pr_closed`);
  the status stays `queued`/`running` until the worker finishes the cancel. Adding a status would
  touch the one-active-run index, core `RunStatus` and every reader for a state that lasts
  milliseconds.
- **The worker always finishes a cancel.** It listens on `pra_change` (the S-03-T1 channel); a
  `runs` change with a cancel request aborts the run's in-flight stage (one `AbortController` per
  run in `RunCancellation`), or, with nothing in flight, cancels it at once. Backstops: the start of
  every stage job, the 5-minute resend loop, the listener's reconnect and worker start. The api
  never writes the cancelled status itself.
- **Cancel waits a short grace for partial cost.** After the abort the executor has
  `CANCEL_GRACE_MS` (2 s) to return its sessions; live sessions already stored each turn's cost.
  A session that returns later still updates its own cost row (money spent stays true, NFR Cost
  truth) but nothing else: no findings, outputs or status.
- **Cancel wiring (T3).** `RunCancellation` lives in `WorkerDeps.cancellation` (default from
  `withDefaults`, own file so `deps.ts` does not import the stage runner). `executeStage`
  registers the run's controller before the start transaction, so a cancel from then on aborts
  instead of racing; the start transaction refuses a run with a cancel request. The guard in
  `storeResultInTx` cancels the run under its lock whenever a request exists, even if the stage
  succeeded just before the abort (its findings and outputs are dropped). `afterTransition`
  deletes the run's queued stage jobs on `cancelled`. The `run_cancelled` timeline entry carries
  the asker as actor and `params.reason`. The listener re-reads the run on every `runs` change
  (cost writes included); one indexed read each, accepted.
- **Cancel controls (T4).** `POST /api/runs/:id/cancel` answers 202 `{status: 'cancelling'}`;
  a second request is accepted and keeps the first asker. The banner cancels
  `view.latestRound` while it is queued or running; the button stays off after the 202 until the
  live refresh. "Cancelled by hand · $1.12 spent" is the timeline row: actor "By hand", the
  sentence "Round 1 cancelled", the entry's cost; a close reads "Run cancelled: PR closed".
- **Close cancels (T5).** `cancelOnClosed` runs on `closed` and `merged`, after the PR's own
  timeline entry, for the PR's active blocking run only (trial and analyst runs are not the PR's
  round). It records the request as the bot and finishes it in the same job, so a stage of this
  process stops at once without waiting for the listener.
- **Stage jobs:** `retryLimit: 0`, and each send sets `expireInSeconds` to the run's stage timeout
  plus 10 minutes (the backstop). A cancel deletes the run's queued `run.stage` jobs
  (`findJobs` + `deleteJob`).
- **Restart code:** worker start fails a left-running stage with `interrupted_by_restart` (new core
  `STAGE_ERROR.interruptedByRestart`); the in-process "left running" path keeps `interrupted`. A
  running run with a cancel request is cancelled instead. One worker process is assumed: at start,
  no stage of ours is live.
- **E2e retry and cancel (T7).** The stack's scripted reviewer gains `FAIL_ONCE_PRS` (150–159):
  the first session of such a PR is invalid, the next answers. The retry runs on the level-two
  repository, so Checks, Task and Change type are there to be reused. Held reviewers now stop on
  the session's abort and answer `cancelled` with the $0.12 turn spent, as the real adapter
  does; the cancel specs use held PRs 360+, 370+ and 380+ (live-progress keeps 350+).
- **Reconcile never starts a review**, also not on its first run after a repository is connected
  (an empty board does not auto-review everything). So no "first poll" marker is stored. It
  corrects the PR snapshot (new PRs, head, draft, closed, merged), writes a `pr_reconciled`
  timeline entry and a `reconciled` state change per corrected PR, and cancels the active run of a
  PR it finds closed (`pr_closed`, actor bot). PR event hooks are not fired from the poll (they
  are keyed by a webhook delivery).
- **Reconcile corrects CI too (after merging P-19).** P-19 stores CI on `pull_requests`
  (`ci_sha`, `ci_checks`), so the poll reads `getCiStatus` for every listed open PR's head (one
  read per distinct head; CI changes without the head moving) and, when it differs from what the
  PR shows, stores it with `storePrCi` plus a `pr_reconciled` entry and a `reconciled` state
  change (`corrections: ['ci']`, timeline "Corrected from GitHub: CI"). An empty CI read equals
  "nothing stored", so a poll over PRs without CI writes nothing.
- **`listOpenPullRequests` returns summaries** (`number`, `headSha`, `isDraft`, `updatedAt`): the
  list endpoint has no commit counts, so the poll fetches `getPullRequest` only for PRs that are
  new or differ.
- **Reconcile is a pg-boss cron** (`reconcile` job, `*/10 * * * *`, `retryLimit: 0`) scheduled
  by the worker at start; it polls every stored repository. A repository GitHub cannot list, or a
  PR it cannot fetch, is logged and skipped; the next poll tries again.
- **What a poll corrects (T8).** A listed PR is fetched in full when it is not stored, stored as
  not open, or differs in head or draft; a stored open PR missing from the list is fetched to
  learn whether it closed or merged. In one transaction it re-reads the PR (a newer webhook
  snapshot wins), upserts it, writes `pr_reconciled` (actor bot, `params.corrections`: `imported`,
  `head`, `draft`, `ready`, `closed`, `merged`, `reopened`; source key per PR and GitHub
  `updated_at`) and a `reconciled` state change; a close then goes through `cancelForClosedPr`,
  shared with the webhook hook. A snapshot change outside those fields (title, body) is stored
  without a timeline entry.
- **Checks and change type on the PR page (T9).** A new PR view section `checks` (`runId`,
  `changeType {value, reason}`, `forced`, `largePr {lines, threshold}`, `ci`, `install`) reads the
  latest completed round's last succeeded or reused `checks` and `change_type` outputs. The web
  maps `reason.code` to "forced by hand", "raised by the judge" or "set by the rules". The
  Change type panel (`PR_PANELS`, every open PR, or a closed one with values) shows the type as
  grey text, the type forced for the next round, the large-PR warning and Force type (a popover
  with "Automatic" plus the three types; `null` clears the forced type). The route answers
  `{checks}` and writes `change_type_forced` (`{from, to}`, by hand) only when the value changes.
  Outputs render in Run detail through `STAGE_OUTPUTS` (the stepper has no output view).
- **Load timeouts in `pnpm verify`.** Testing Library's `asyncUtilTimeout` is 4 s in the web test
  setup, and `reads-never-write` gets 30 s: they failed only under verify's parallel load. For the
  same reason `durability.test.ts` waits 30 s for the restarted child worker and 20 s for the
  queued round to finish (it passed alone and failed once under verify after merging main).
- **Merge with main (P-19).** Main's `0014_pr_checks` is kept; ours is regenerated as
  `0015_retry_cancel` (the same statements as the old 0014 and 0015). The PR page's main actions
  hold retry, cancel and P-19's merge side by side.
- **Retry is keyed by run id** (`POST /api/runs/:id/retry`, 201 `{run: {id, fromStage}}`); the
  banner retries `view.latestRound.id`, which is the failed round while the state is Stage failed.
  The stage a retry starts from is stored (`runs.retry_from`) rather than re-derived, so the PR
  banner and Run detail read it directly.
- **Stage failed banner text** ends with "This round is not counted"; a `stage_timeout` reads
  "Review stage timed out after 30 min" with the level's stage timeout.
- **E2e Checks and change type (T7).** The stack seeds `large-pr-repo` (level 2,
  `largePrLines: 1`) and gives both level-two repositories `FIXTURE_CI` (2 passed, 1 failed) on the
  fixture head; the level-two repository has fetch and install commands, which the stack's sandbox
  double answers with exit 0. The order spec holds PR `HELD_PRS.from + 40` (retry-cancel keeps
  +10 to +39) and releases it in a `finally`: the worker takes one `run.stage` job at a time, so a
  hold left behind by a failed check would stall every other spec's round. The large-PR spec uses
  PR 220, which no reviewer script holds or fails.
- **Change type route is keyed** `PUT /api/prs/:repo/:number/change-type` (the existing keying,
  as P-11 did), unsigned, timeline "by hand". `large_pr`, CI counts and the install result come
  from the latest completed round's stage outputs; no new PR columns.
