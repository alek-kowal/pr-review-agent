---
change_id: P-14
title: Questions and signed reviews (S-08-T1–T11)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-14 from `context/foundation/work-packages.md`. Plan: no; the tasks' "Done when"
checks are the plan. One commit per task.

## Decisions

- **Routes follow the existing PR paths**: `/api/prs/:repo/:number/answers` (and later
  `/reviews`, `/notify-author`), not `/api/prs/:id`; the signer field is `signedBy` as in
  decisions, not `signerId`.
- **One S-08 migration** (`0014_questions_and_reviews`) holds `answers`, `reviews`, `opinions`
  and the decision author columns (`decision_batches.author_login`, `author_member_id`, for T5).
  Its live-notify triggers are hand-added at the end: keep them when regenerating it at merge.
- T1: questions were already rows. An answer save adds a row per question; the newest row is the
  answer (older ones stay). Concurrency: the client sends `expectedAnswerId` (null when it saw
  the question open); a moved answer gives 409 `answer_conflict` with `params.conflicts[]` =
  `{ questionId, answer }` naming the signer. Own text wins over a picked option. Errors:
  `answer_invalid` (no answer, duplicate question, option out of range), `question_not_found`.
  Timeline kind `questions_answered {count}`; the loader marks questions answered, so the PR
  leaves `questions_waiting`.
- T2: Save is enabled only when every open question has an answer and a signer (the task, not
  the prototype's partial save). A shadcn `radio-group` primitive was added. The banner's
  `answer` main action links to `?tab=questions`. `LIVE_TARGETS` gains answers, opinions, reviews.
- T3: a reviewer context provider (`answers-context.ts`) adds answers to questions of earlier
  runs (`runId < run.id`) to the brief; fix checks get the same list as `answers.md` plus one
  prompt line (`FIX_CHECK_ANSWERS_LINE`). The text renderer lives in `@pra/agents`
  (`teamAnswersBody`).
- T4: one opinion row per finding and signer (upsert), so a signer's newer opinion
  replaces only their own and concurrent signers both persist. `from_round` is the finding's
  round number in its chain (`runs.round_no`); a carried copy sets `carried_from_id`. `reviews`
  keeps the counts as saved; `reviewers` in the state input = distinct opinion signers.
  `saveReview` and `saveAnswers` lock the PR row first (`lockPullRequestRow`): rows pointing at
  the PR take a key-share lock and `recordStateChange` then locks it for update, which deadlocked
  two concurrent saves.
- T5: core `usuallyDecidedBy` (active member by login, case-insensitive, else the login) also
  feeds the loader's `authorMember`. `decideFindings` stores the author (`prAuthor`). The api
  sends `finding.usuallyDecidedBy` (null when no decision is needed) and `decision.author` +
  `decision.label { signer, author|null }` (core `decisionLabelNames`); decisions stored before
  T5 fall back to the PR's current author. The web shows the label from the api.
- T6: drafted opinions live in a small in-memory store per PR (`features/opinions/draft.ts`),
  so they survive tab switches like the prototype's `UI.draft`. Opinions are line and action
  slots; the tray shows only while nothing is selected for bulk (as in the prototype) and only
  while the PR is open. No bulk "opinion for all selected" and no Undo of a saved review (no api
  for it); the toast says the author is not notified yet (T11 adds the card).
- T7: `matchFinding` = same file and Jaccard word similarity of normalised title + scenario
  ≥ 0.75 (`FINDING_MATCH_THRESHOLD`); `matchFindings` pairs each finding at most once, most
  alike first. Only a full review (round 1 of a chain) carries, from the PR's previous completed
  full review; fix checks add no findings. Copies keep signer, value, comment, review, original
  `from_round` and time; `on conflict do nothing` keeps a signer's own newer opinion and makes a
  rerun add nothing. Registered as `carryOpinionsOnRunCompleted` after the chains hook.
- T8: the findings answer gains `resultsRound` (the PR's latest completed round, so a fix check
  counts as new results too, as in flow B step 8). The Findings tab pins the answer it shows
  (`usePinnedResults`): a newer `resultsRound` waits behind "New results from round N · View new
  results"; changes within the shown round, and the very first results, show at once. The PR
  view (banner, checklist, stepper) is never held. `useRefreshFindingsWhenRoundEnds` became
  `useFetchResultsWhenRoundEnds` (it only refetches). The pin lives in the tab, so leaving the
  tab shows the newest results on return. `chains.spec.ts` checks fix counts inside its reload
  loop, since a round ending while the page is open now waits behind the strip.
