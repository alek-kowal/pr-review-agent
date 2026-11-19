# P-21 Learning (S-23-T1–T7)

After a level 6 PR closes, the analyst proposes at most 5 lesson candidates; a person edits,
tries, rejects (signed) or accepts (signed) them, and an accepted lesson becomes a new active
`lessons.md` version of the PR's repository. Plan: no (the tasks' "Done when" checks are the plan).

## Decisions

### S-23-T1 (model)

- **Candidate status values are core's** `proposed` / `accepted` / `rejected` (`CandidateStatus`
  from the F-03 rules); `proposed` is the task's "open".
- **Candidates belong to a repository** (`lesson_candidates.repository_id`): duplicates merge only
  inside one repository, and accept writes that repository's `lessons.md`. The core rules run with
  candidate ids as strings and PRs by their row id (PR numbers repeat across repositories).
- **`pr_count` is stored** next to `lesson_candidate_sources` (unique per candidate and PR) and
  recomputed from them in the same transaction.
- `mergeCandidates` caps the proposals at 5 (core `capProposals`) and then applies
  `mergeCandidate` to each; `canAcceptLesson` leaves the signature to the signed route. Its
  refusal is `needs_more_prs { have, need }`; the web words it "1 of 2 PRs: waits for one more".
- **The bot analyses a PR once**: a partial unique index on `analyses (pull_request_id)` where
  `started_by = 'bot'`. Analyses by hand are not limited.
- Candidates of one repository merge under a transaction advisory lock, so two analyses finishing
  together never create the same candidate twice.
- After merging `main` (P-15 took migration 0020), the learning migration was regenerated as
  `0021_learning`.

### S-23-T2 (adapter)

- The analyst is one Messages API call with structured output (no tools, no sandbox), like the
  judge: `createAnthropicAnalyst()` in the worker, `FakeAnalyst` in tests and e2e.

### S-23-T3 (job)

- **The job is the run engine, not a separate pg-boss queue**: an analysis is a run of kind
  `analyst` with one stage `analyse`, created by `createRun` under one transaction with its
  `analyses` row. So pause, budget and slots apply through the usual gates, and its cost sits in
  the run kind `analyst` (Insights' analyst bucket, outside PR cost).
- The bot starts it from both the `closed` and the `merged` PR hooks, after `cancelOnClosed`; the
  bot's unique index makes the second call a no-op.
- The analyst reads people's GitHub comments through `GitHubGateway.listReviewComments`; core
  `buildCases` drops the PR author's own comments by login. The stage stores only counts of what it
  read; the input itself is the session's prompt.
- The analyst's prompt and rules are instruction files (`prompt-analyst.md`, `analyst-rules.md`).
  There is no built-in default: without them the stage fails `analyst_instructions_missing`.
- The candidates merge in the `runCompleted` hook (status "finished", count); `runFailed` and
  `runCancelled` end the analysis "failed".

### S-23-T4 (API)

- **Routes**: `/api/learning/candidates` (GET, `PUT /:id`, `POST /:id/reject|accept|draft`) and
  `POST /api/prs/:repo/:number/analyst` (keyed by repository slug and number like merge, not by
  PR id; 202 with the run, 409 `pr_open` on an open PR).
- **Reject and accept are one `learning` settings store** (entity = candidate id, value = title,
  text, status, reason, lessons version). Accept's store write calls `acceptLessonCandidate`, which
  also writes the bot's `instructions` row, so one accept leaves two log rows. `before` is the
  stored candidate, with the `text` the signer saw when the client sends it (409
  `settings_stale` after someone else's edit).
- Checks in this order: 404, 409 `candidate_not_open { status }`, 409 `needs_more_prs { have,
  need }` (core `canAcceptLesson`), then the signature (400) inside the signed change. Reject
  without a reason is 400 `reason_required`.
- **"Try on a PR…"** is `POST /api/learning/candidates/:id/draft`: it saves the `lessons.md`
  draft with the lesson (unsigned) and returns `{ fileId, versionId }`; the web then starts
  `POST /api/trials` with that draft. Accepting later creates a fresh version, not this draft.

### S-23-T5 (Settings → Learning)

- One page with three lists: open candidates (cards with Edit, Try on a PR…, Reject…, Accept…),
  Accepted lessons (with `lessons.md vN` and who accepted), and Rejected (with the reason).
- Below 2 PRs the card's PR count itself reads "1 of 2 PRs: waits for one more" and Accept is
  disabled with the same text in a Tooltip (on a focusable wrapper, since a disabled button gets
  no pointer events). Added the shadcn `tooltip` primitive; there was none.
- "Try on a PR…" reuses the S-22 form: `TryOnPrDialog` now builds a small `TrialTarget` (file
  key, repository, draft) and its form is exported as `TryOnPrForm`. The Learning card first
  saves the lessons draft, then opens that form limited to the candidate's repository.
- Reject and Accept send the text the signer saw, so an edit in between is 409 `settings_stale`.

### S-23-T6 (status on closed PRs)

- A `learning` PR view section: `levelLearns` and the latest analysis (status, who started it,
  candidate count, run). The banner line shows on any closed PR that has an analysis, not only
  at level 6, so a hand-run analysis (S-23-T8's smoke) shows its status too.
- Failed links to the run's Run detail; finished links to Settings → Learning.
- "Run analyst" is a header action on every closed PR, disabled while an analysis runs.
- Live updates: the learning migration adds `pra_notify_change` triggers on `analyses` (PR view
  and Learning) and `lesson_candidates` (Learning); the web maps them in `LIVE_TARGETS`.
- "Merged by <name>" already comes from the merged state's banner (P-19); nothing added.

### S-23-T7 (end to end)

- A new e2e repository `learning-repo` at level 6. The merged PR is #247, not the prototype's
  #278: 278 is in `QUESTION_PRS`, whose reviewer asks questions. Earlier closed PRs #241 and #244
  give the prior candidates; #250 is the next round after the accept. Each number shifts by the
  Playwright retry (0–2), so a retry starts from fresh PRs.
- The prior candidates come from the real path (the spec delivers `closed` for #241 and #244 and
  the bot runs the analyst), not from stack seeds, so a retry can rebuild them. The spec clears
  the repository's candidates first and expects lessons.md "newest + 1".
- The in-app merge does not start the analyst; the spec then delivers `pull_request.closed`
  (merged) as GitHub would (`deliverPullRequest(..., 'merged', ...)`).
- The e2e analyst double (`ScriptedAnalyst`) writes its input to the hold dir and waits while a
  hold file exists, so the spec sees "Analyst is running" before "Analyst finished".
- "The next round gets the lesson" is checked on the `lessons.md` in the reviewer's knowledge
  folder: the reviewer prompt points to that folder and does not inline the lessons.
- The candidate title follows the prototype: "Snapshot tables must be generated or tested".
