---
change_id: P-24
title: Board filters, search and shortcuts (S-17-T1–T9)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-24 from `context/foundation/work-packages.md`, wave 8. Plan: no; the tasks' "Done
when" checks are the plan. One commit per task, in the listed order.

## Decisions

- **T1 card exceptions.** The card gets `isFork`, `level { number, repositoryDefault }` (the level
  the next round starts at) and `round { number, max }` (completed rounds of the chain). The web
  shows the level badge `L<n>` only when it differs from the repository default, the round label
  only from round 2 on, the repository only when several are connected (as before), and a Fork
  badge on forks (the prototype's exception badges). The author and the age never shrink; the
  round label and the repository truncate first.
- **T2 age tie-break: longest waiting first.** "Then by age" in an urgency sort reads as: among
  equal ranks, the PR opened first is the most urgent. This replaces P-08's newest-first order
  inside each group (its api test now expects oldest first). Core gets `actionNeededRank` and the
  comparator `byUrgency` in `urgency.ts` (not in the hot `pr-state.ts`); the api and the web lane
  both sort with it, so the lane is right whatever order the api sends.
- **T3 `person` is the member's GitHub login** (`?person=kasia`): readable in a shared link and
  unique among active members. Authored = the PR's author login matches (case-insensitive);
  signed = `prsSignedBy(memberId)` for every member, removed ones included, with that login.
- **T3 `prsSignedBy` unions** decision batches, opinions, reviews, answers, sensitive file
  approvals, signed review starts (`runs.started_by_member_id`), task links and every signed
  timeline entry. Merges from the app are timeline entries (`pr_merged`, actor member), and so
  will pushes be, so S-14 needs no change here.
- **T3 level filter** compares the level the next round starts at (`input.level`, the level the
  card shows), applied after loading because it needs the repository default. The other filters
  are SQL conditions in `boardPullRequestIds`. Filters also narrow the merged/closed list.
