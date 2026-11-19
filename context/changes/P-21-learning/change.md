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
