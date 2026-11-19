---
change_id: P-11
title: Manual start, chains and sensitive files (S-07-T1–T7, S-11-T1–T4)
status: impl_reviewed
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-11 from `context/foundation/work-packages.md`, wave 5. Plan: yes, see `plan.md`.
One commit per task, in the listed order. Planning ran without questions (orchestrator rule:
decide and record).

## Decisions

- **Run creation lives in `@pra/db`** (`packages/db/src/runs/`): `createRun` and `startRound` are
  used by the worker (ready webhook, fix pushes) and the API (manual start), which cannot import
  the worker. `apps/worker/src/run/start-round.ts` stays as a thin wrapper. P-17, P-18 and P-21
  call `createRun` from `@pra/db`.
- **Routes follow the existing keying** `/api/prs/:repo/:number/...`, not `/api/prs/:id/...`.
- **Chains get a table** `round_chains` with `expected_head_sha` (set by S-14's push through
  `setChainExpectedHead`). The fix SHA of an `own_fix` round is its head SHA (FR-016 makes them
  equal), so no extra column. Trigger names stay core's `ready_for_review | manual | own_fix`.
- **PR level** is `pull_requests.level` (null: repository default). Manual start uses the level
  picked in the form; the ready event and fix pushes use the PR level.
- **Commits since** are stored per run (`commits_since`, `commits_since_head`), measured with
  `compareCommits` after a push and when a round ends on a moved head; a failed compare falls back
  to the commit-count difference.
- **Findings shown on the PR** come from the latest completed full round (round 1 of its chain);
  fix checks add Resolved / Not resolved. The reviewed SHA is the latest completed round's head.
- **Sensitive files match `sensitivePatterns`** (pattern plus reason, PRD FR-002 / FR-046), not
  `changeTypeRules.oneWayPaths`; the task's "one-way paths" means these sensitive patterns.
- **Fix check `reproductions` stage** reruns the scripts Verify kept for the checked findings
  (none for a fork PR). Exit 0 (the bug still shows) turns the round's Resolved into Not resolved.
  Without scripts it records `scripts: 0` and succeeds. (Replaces the planned "reruns nothing":
  P-09 already stores the scripts.)

### S-07-T2 (pushes)

- The fix push start sits in the `pull_request` handler (the event's outcome is `round_started`);
  measuring commits since is a `headChanged` PR event hook plus a `runCompleted` hook.
- Starting a fix check clears the chain's `expected_head_sha` in the run's transaction, so a
  retried event or a second push on the same commit never starts round 3 by itself.
- The fix PR Review Agent pushed and did not check (chain used its 3 rounds) is not counted as
  "new commits": the PR shows Automatic rounds used, as the task's "Done when" asks.
- When the head equals the reviewed SHA there are 0 commits since, whatever the commit counts say.
- The loader takes findings and questions from the latest completed full round (round 1 of its
  chain), so a fix check, which writes no findings, keeps them on the PR (moved here from T4).

### S-07-T3 (fix check)

- The reviewer lives in `apps/worker/src/stages/review`; there was no `packages/agents/src/reviewer`.
  The fix-check mode is an adapter there (`packages/agents/src/reviewer/fix-check.ts`) with a
  built-in prompt, not a stored instruction file, because only the full review has one.
- Rounds 2 and 3 check every Implement finding of the chain's round 1, on the diff since the
  chain's latest completed round. A finding the session does not answer is stored Not resolved.
- Round 1 of a new chain lists the previous full round's Implement findings that are not resolved
  yet (reviewer context provider `earlier_fixes`); only answers for listed ids are stored, and a
  missing answer stores nothing (the field is optional in a full review).
- `finding_fix_checks` keeps one row per finding and round; a later stage of the same round
  replaces it. The loader's `resolved` is the newest row.

### S-07-T4 (manual start, PR level, summary)

- The write routes live in `apps/api/src/routes/api/rounds/` (`autoPrefix = '/api'`), so the
  `prs` folder stays read-only. `POST .../start-review` answers 201 with the run, chain, round
  number and level; 409 `run_active` (params `kind`, `status`) or `pr_closed`.
- "Review started by hand" is the worker's `run_started` entry (trigger `manual`, actor hand); the
  API adds no second entry. `PUT .../level { level | null }` writes `pr_level_changed`
  (`{ from, to }`, by hand) only when the level changes; null returns to the repository default.
- The PR view gets a `head` section (reviewed SHA, head, commits since, completed rounds of 3,
  PR / default / next level, fixes `{ resolved, total }` over the Implement findings once any has
  a fix check). Each finding gets `sourceSha`, `commitsBehind` and its newest `fix`.

### S-07-T5 (Start review control)

- `StartReview` lives in `apps/web/src/features/rounds/`; the header slot shows it on open PRs and
  the `start_review` main action reuses it (primary button).
- The level Select picks the level for this start only, starting at the PR's next level; it does
  not change the PR's level (`PUT .../level` has no UI in P-11, level settings arrive with P-23).
- The disabled reason comes from the latest round's status (queued or running), shown under the
  disabled button; the api's 409 `run_active` is the backstop and shows as a toast.

### S-07-T6 (findings from earlier commits, fix results)

- "X of Y fixes resolved" counts the findings decided Implement that a fix check answered (as
  the prototype does), in the web and in the api's `head.fixes`; findings not checked yet are
  left out rather than counted as unresolved.
- The "commits behind" strip uses the findings' own `sourceSha` / `commitsBehind`, so it also
  shows after a fix check moved the reviewed SHA while the findings stay from round 1.
- A finding resolved by a fix check is dimmed like a refuted one; its decision row stays.

### S-07-T7 (e2e chains)

- The git fixture takes `fixes` (one commit each on `feature` after the reviewed head) and returns
  `fixShas`; the e2e stack adds three and seeds `FakeGitHubGateway` comparisons between them, so
  commits since go through `compareCommits` (the count fallback stays covered by worker tests).
- A review session is held with a file `hold-<PR number>` in the stack's `holdDir` (in
  `StackState`), not a DB flag row: spec and stack share the machine and no table is needed.
- The reviewer double answers by session kind: a full review by brief, a fix check (no brief)
  resolves every finding except at `fixShas[1]`, where the first stays unresolved, and a verifier
  answers unverified. The stack imports the global verifier instruction files so level 3 runs.
- `chains.spec.ts` decides findings through the api (the UI is `decide.spec.ts`'s); it signs with
  the first Team member, adding Kasia (`wb-dev`) only when Team is empty.

### S-11-T1 (sensitive files per PR)

- One `sensitive_files` row per PR and path (pattern, reason, status, actor, member, comment, at,
  head SHA); `pull_requests.sensitive_version` moves with every add, reset, approve and send back.
- A completed round (full or fix check) diffs the PR base to the round's head in the mirror and
  adds new matches as pending (`runCompleted` hook, before the timeline hook so its state change
  counts them). An approved path stays approved when later commits change it again; the task only
  asks for newly matching files.
- Core's `SensitiveFiles` for the PR: approved when every file is (files: all); otherwise the files
  not approved yet, `sent_back` when any of them was sent back (`sentBackBy` its signer).
- Any head change (`headChanged` PR event hook) turns sent back into pending and clears the
  comment and signer; the timeline already logs the push.
- `settleSensitiveFiles` (approve by hand or send back signed) sits in `@pra/db` like
  `decideFindings`: it locks the PR row, compares the version, settles every file not approved
  yet, and writes the timeline entry (`sensitive_approved` / `sensitive_sent_back`) and the state
  change in the same transaction.

### S-11-T2 (approve and send back API)

- Routes follow the PR keying: `POST /api/prs/:repo/:number/sensitive/approve { version }` and
  `.../sensitive/send-back { version, comment, signedBy }` in `routes/api/sensitive/`. Both answer
  the refreshed `nextStep`, `checklist` and `sensitive` sections.
- Errors: 400 `signature_required` / `signer_unknown` / `comment_required`; 409 `sensitive_stale`
  (params `version`) and `sensitive_nothing_pending` when every file is already approved.
- The PR view gets a `sensitive` section: version, status (null without files), each file with
  pattern, reason and status, and `sentBack { by { id, name }, comment, at }` while any file is
  sent back. The checklist row and its reason come from core as before.

### Merge of main (wave 5 siblings P-12, P-13)

- Main's migrations `0011_decision_follow_ups` and `0012_metric_logs` stay. The branch's four
  (`0011_chains`, `0012_commits_since`, `0013_finding_fix_checks`, `0014_sensitive_files`) are one
  regenerated `0013_chains_sensitive_files`, with the hand-written `round_chains` backfill appended.
- The Findings tab keeps P-11's findings round (round 1 of the chain) and takes main's verification
  rows from that same round (`loadFindingsView`), so a fix check does not hide the verdicts.
- PR view sections, banner lines, side panels and finding slots keep both sides, P-11's first:
  `head`, `sensitive`, then `roundProgress`, `task`; the sensitive panel sits above the ClickUp
  task panel; the fix note shows above the follow-up line.
- `GitHubGateway` has both `compareCommits` (P-11) and `getCommit` (P-13). The `headChanged` hooks
  run chains, sensitive files, timeline, then metrics.
- The e2e stack has one `ScriptedAgents`: main's held PRs (`HELD_PRS`, release file) and per-title
  verifier answers, plus P-11's `hold-<number>` flags and fix-check answers.

### S-11-T3 (sensitive files on the PR page)

- The banner's `approve_sensitive` action is two buttons: Approve changes (unsigned, recorded "by
  hand", toast "Sensitive files approved") and Send back… (Dialog listing the files not approved
  yet, a required comment and the `SignatureField`). Both send the `version` the page shows.
- A sent-back banner reads "Sent back by Tomek: Kasia changes 2 sensitive files": the signer's name
  comes from the `sensitive.sentBack` section, the author from the PR's author.
- The checklist reason for approved files is "N sensitive files approved by hand." (pending: "need a
  person's OK", sent back: "sent back").
- The side panel "Sensitive files" (shown while the PR has any) lists each path with "Matches
  <pattern>. <reason>" and a status word: need approval / approved by hand / sent back; sent back
  adds the quoted comment. The banner's second line shows the pending hint or the quoted comment.
- A success merges the answer's `nextStep`, `checklist` and `sensitive` into the cached PR view,
  then refetches the view and the board.

### S-11-T4 (e2e sensitive files)

- The stack seeds its own `sensitive-repo` (level 1, `SENSITIVE_REPOSITORY` in `e2e/support/env.ts`)
  instead of changing WB's settings, so the other specs keep a PR without sensitive files. Its two
  patterns, `db/migrations/**` and `packages/sdk/src/index.ts`, match two of the fixture's changed
  files; the GitHub double gets the branch's comparisons for it too.
- The spec rejects the three findings that need a decision through the api, then works in the UI:
  Approve changes (PR becomes Ready to merge, rows `approved` / `hand`), and Send back… (comment
  required, signed by the first Team member) followed by a `synchronize` push to `fixShas[0]`,
  which turns both files back into pending without the comment.
- Shared spec helpers (`sql`, `writeHeaders`, `signer`, `decide`, `bannerTitle`, `onPrPage`) moved
  from `chains.spec.ts` to `e2e/support/api.ts`; `decide` and `onPrPage` take a repository slug
  (default WB) and `signer` returns the member's id and name.
- PR numbers: sensitive files 200–205; the last chains test moved from 349 to 300 so a CI retry
  never lands in main's held range `HELD_PRS` (350–399).
