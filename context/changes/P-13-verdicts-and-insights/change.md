---
change_id: P-13
title: Verdicts and Insights (S-05-T3, S-05-T4, S-19-T1–T8)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-13 from `context/foundation/work-packages.md`, wave 5. Plan: no; the tasks'
"Done when" checks are the plan. One commit per task, in the listed order.

## Decisions

### S-05-T3 (verdicts and evidence on findings)

- The findings API reads `finding_verifications` of the reviewed round (`loadFindingsView`) and
  returns `verification: { reason, verifierReason, reproduction }` per finding (null when Verify
  did not run). `reproduction` is null when no sandbox run happened; it carries exit code,
  timed out, output tail and `repaired`. Quotes stay in the existing `evidence` field
  (`{ file, line, quote }`).
- `unchecked: N` is a top-level field of the findings response: the count of unchecked findings
  when the round's level is below 3, null otherwise.
- The decisions route's refreshed view uses the same loader, so verification data survives a
  decision.
- Web: the verifier's words under "Verifier: <verdict>" (prototype), quotes as `<pre>`, and the
  reproduction folded in a native `<details>` "Technical details". A level-3 finding skipped
  for its change type (`verify_off_for_change_type`) says so instead of "Not verified at this
  level".
- No loader or core change: core `needsDecision` already drops Refuted findings from "to decide".

### S-05-T4 (end-to-end verified findings)

- The e2e stack seeds two more repositories instead of changing WB's level (other specs share
  the stack): `acme/verified-repo` at level 3 with `db/migrations/**` as a sensitive pattern (the
  fixture's migration makes the change a one-way door, so Verify checks every finding, nits
  included) and `acme/level-two-repo` at level 2. Both are in the GitHub double's installations.
- The stack's agent double (`ScriptedAgents`) answers verifier sessions per finding title; the
  `FakeSandbox` handler exits with the code the reproduction script ends with. Results: first
  Blocking Confirmed (exit 0), second Refuted (exit 3), Worth fixing Not proven after a broken
  script and its repair (exit 1 twice), Nit Not proven without proof.
- `prompt-verifier.md` and `verify-rules.md` are imported as global instruction files v1.

### S-19-T1 (lane and head-change logs)

- `pr_state_changes` already existed (P-10, S-03-T5) with its writers in the worker hooks and
  `decideFindings`; nothing added there. Its lane rows are the source of metric 2.
- `head_changes` (own schema file `schema/metrics.ts`): PR, GitHub event id (unique, so a
  retried event or the backfill writes once), before/after SHA, pusher login, `by_bot`,
  `is_base_merge`, at (the event's `received_at`).
- **By bot** is a sender of type `Bot` or a login ending in `[bot]` (no bot login is configured
  anywhere; any App or bot push is "not a person", which is what metric 5 asks).
- **Base merge** is a core rule (`isBaseMerge`): the new head is a two-parent merge on top of
  the old head whose second parent is the PR's base SHA or whose message is git's
  `Merge branch '…' into …`. The commit comes from a new `GitHubGateway.getCommit` (interface,
  Octokit adapter, unconfigured gateway, fake with `addCommit`). Bot pushes skip the lookup. A
  failed lookup is logged and the change is stored as not a base merge (a hook that throws
  would retry the whole event, and an unconfigured GitHub would retry forever).
- `pull_requests.ready_at` (first ready event's `received_at`, never moved), `closed_at`,
  `merged_at`, `merge_sha` (GitHub's times and merge commit from the snapshot, which now carries
  `closedAt`, `mergedAt`, `mergeSha`). Written by `metricsOn*` PR event hooks registered next to
  the timeline hooks; `PrEventContext` now carries the raw `payload` (for `before`, `after`,
  `sender`).
- Backfill: `backfillMetricLogs` replays every stored `pull_request` event (payload from
  BlobStore) through the same writers; command `pnpm --filter @pra/worker metrics:backfill`
  (worker package script, not root, to stay off the H14 hot file). `pr_state_changes` is not
  backfilled: states depend on runs and decisions, which raw GitHub events do not hold.
- Migration `0011_metric_logs.sql`. If another migration lands first, delete it and run
  `pnpm db:generate` again (`--name metric_logs`).

### S-19-T2 (metric calculations in core)

- `packages/core/src/metrics.ts`: `prMetrics(history)` gives one PR's figures (also the PR
  table's row); `pilotMetrics(rows)` gives the five metrics as `{ value, sampleSize, tooFew }`
  (`tooFew` below `TOO_FEW_PRS = 10`). Medians for metrics 1–3 (the prototype's choice), counts
  for 4 and 5.
- Metric 1 sums stage durations (`started_at` → `finished_at`) of rounds and implementer runs,
  any status; queue time is outside stages, so it never counts. A stage still running counts
  once it ends.
- Metric 2: total from `ready_at` (fallback: the first ready state) to `merged_at`; the lane
  split reuses `timeSummary` over the state log. Time back in Not reviewed (a draft again) is
  waiting for people, so it adds to Action needed. Lanes are summed over merged PRs (the
  prototype's "where the time goes").
- Metric 3: sessions of rounds and implementer runs; trial and analyst sessions are summed apart.
- Metric 4: a PR counts when its state log has `rounds_used` (core's state for "a chain used 3 of
  3 with a fix still open"); next to it, PRs with more than 3 rounds in total.
- Metric 5: from the first `ready_to_merge` state: a head change by a person that is not a base
  merge, or a merge at a head SHA not seen since (the ready head or a later head change). The
  sample is merged PRs (as the prototype's "X of N merged"); merged PRs that never reached Ready
  to merge count as not changed.

### S-19-T3 (Overview and Cost API)

- A PR is in the range when it finished (`coalesce(merged_at, closed_at, updated_at)`, the last
  for rows from before the S-19-T1 logs) in the last 14 or 30 days; `range` defaults to 30.
  Overview covers merged and closed PRs; metrics 2 and 5 use the merged ones only.
- The author filter runs in the API over the loaded histories. `authors` lists every PR author in
  the range (repository filter applied), so the web's author select can switch freely.
- Cost counts rounds and implementer runs; trials and the analyst come as `separate.trial` and
  `separate.analyst` (zero when none). Days are UTC: the range's first day starts at midnight and
  `byDay` lists every day, zero when nothing was spent. A session counts on the day it was
  recorded; its level is the run's frozen level.
- Cost also returns today's spend against the daily budget and the mean cost of completed rounds
  (the Cost tab's stat tiles, S-19-T6). An unknown `repo` is 404 `repository_not_found`.
- `seedPrHistory` (`@pra/db/testing`) writes one PR with its runs (one stage and one session
  each), findings with verdicts and decisions, state rows and head changes. The API tests and
  the e2e seed share it.

### S-19-T4 (Quality and Trust ladder API)

- Rates are a core rule (`qualityRates`, `TOO_FEW_FINDINGS = 5`): Confirmed and Refuted are
  shares of the findings whose round ran Verify (the run's frozen level), Implement is the share
  of decided findings (a current, not undone decision). Below 5 findings every rate is null.
- Quality takes `range` and `repo` like Cost (no author filter): rounds and implementer runs
  created in the range. Trials and the analyst count nowhere. Levels 1–6 are always listed; a
  level row says `unchecked` for levels below Verify's level (1–2), whatever its findings.
  Average round = mean run cost of that level's rounds.
- Per instruction version: a run counts once for every version it recorded (`runs.instruction_versions`),
  so groups overlap; runs with none recorded form one group with `instruction: null`, listed
  last. Labels (file, version, scope, repository, `active`) come from `instruction_versions`.
- Trust ladder: one row per repository by slug (the `repo` filter applies). The level is the
  config's `defaultLevel`; it holds since its last change in `settings_changes` (area
  `repositories`, `defaultLevel` differs or the row created it), else since the repository was
  connected. Rates use every round of the repository at that level, of any age.
