---
change_id: P-14
title: Questions and signed reviews (S-08-T1–T11)
status: implemented
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-14 from `context/foundation/work-packages.md`. Plan: no; the tasks' "Done when"
checks are the plan. One commit per task. Main was merged at the start of both sessions; the
second merge kept main's move of sensitive files out of the run-completed hooks (the opinion
carry hook stays after chains). Final check: `pnpm verify` (975 tests) and `pnpm test:e2e`
(20 specs) pass.

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
- T9: the reviewer double asks 2 questions only for PR numbers in `QUESTION_PRS` (260–269), so
  other specs keep none; once the brief has "Answers from the team" it asks none and adds one
  finding (the new result). The spec runs on `LEVEL_TWO_REPOSITORY`, since level 1 allows no
  questions. The second review is a manual start (a new chain, so the strip reads "New results
  from round 1"); a fix check would carry nothing. The double writes each full review's brief to
  `holdDir` (`briefFile`), which is how the spec sees that the reviewer got the answers. Team
  members are added through the api (`teamMember`).
- T10: core `notifyText` returns prose, against the "reason codes only" rule, because it is the
  ClickUp comment itself (bot output in ClickUp, not app copy) and the task names it; the web
  shows the api's text as is. The text starts "@Kasia:"; the HTTP gateway posts a leading
  "@Name:" as the ClickUp mention tag, so ClickUp shows one mention and the preview equals the
  posted `text`. The action is unsigned (timeline actor "by hand", kind `author_notified`).
  Checks, all before any gateway call: review of this PR (404 `review_not_found`), linked task
  (409 `no_linked_task`), author is an active Team member with a ClickUp user (409
  `author_has_no_clickup_user`, also when the author is not in Team). Once per review: an
  already notified review returns 200 with its stored notification; concurrent posts claim
  `reviews.notified_at` first, and a failed post (502, or 422 when ClickUp is not configured)
  gives the claim back. `integrationFailure` moved to `apps/api/src/integration-failure.ts` for
  both ClickUp routes.
- T11: the card lists the reviews saved on this page (`features/notify/pending.ts`, in memory per
  PR, like drafted opinions); Not now or a posted comment removes it, and a reload forgets it (the
  timeline keeps the review). The preview query is keyed by the linked task, so linking one in
  the card's dialog (the exported S-06 `LinkTaskForm`) shows the comment at once. "Link a ClickUp
  task" shows only when the repository has ClickUp settings; any other preview error shows its
  copy with Not now only. e2e: a new level-1 `CLICKUP_REPOSITORY` with ClickUp settings, a
  ClickUp double that knows WB-123, and a subclass that appends each `createComment` call to
  `commentsFile(holdDir)` so the spec can count calls made in the stack process.
- Merge of main (P-16 pause/budget/queue, P-19 merge from the app, S-06 task link):
  - Migrations: main's `0014_pr_checks` and `0015_pause_budget_queue` stay untouched. This
    branch's `0014_questions_and_reviews` is regenerated on top as `0016_questions_and_reviews`
    (`pnpm db:generate --name questions_and_reviews`); the generated SQL is the same as before,
    and the hand-added `pra_notify_change` triggers for `answers`, `opinions` and `reviews` are
    put back at its end.
  - `loadPrStateInputs`: `reviewers` counts the distinct signers of opinions (this branch), `ci`
    and `changesRequestedBy` come from the stored GitHub state (main).
  - Run hooks: `carryOpinionsOnRunCompleted` stays after chains; `wakeQueueOnRunEnd` stays last
    on completed, failed and cancelled. Barrels, error codes, main-action slots, live targets
    and web fixtures keep both sides. `routeTree.gen.ts` regenerated with `vite build` (same as
    main's).
  - e2e: both sides added a `CLICKUP_REPOSITORY`. Main's (level 2, `CLICKUP_TASKS`, used by
    clickup-link.spec.ts) keeps the name; this branch's level-1 repository for notify-author.spec.ts
    becomes `NOTIFY_REPOSITORY` (`acme/notify-repo`, installation 55500008, since main's
    `MERGE_REPOSITORY` took 55500006). One `RecordingClickUp` double knows `CLICKUP_TASKS` and
    WB-123. `QUESTION_PRS` moves from 260–269 to 270–279: pause-budget.spec.ts uses 260 and 265,
    and the stack picks the reviewer by PR number.
  - merge.spec.ts (main) runs its tests in order (`test.describe.configure({ mode: 'default' })`):
    all its PRs share the fixture head, and a `check_suite` refreshes every open PR at that head,
    so in parallel one test's green CI turned another's checklist green before it was asserted
    open.
