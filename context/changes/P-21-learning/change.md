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
