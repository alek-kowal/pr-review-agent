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
