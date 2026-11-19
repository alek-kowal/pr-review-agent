---
change_id: P-08
title: Board and signed decisions (S-02-T2, S-02-T4, S-02-T6, S-02-T7, S-02-T9, S-02-T10)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-08 from `context/foundation/work-packages.md`: board lanes from the core state table
and signed decisions on findings (north star code). Tasks in order: S-02-T2, S-02-T4, S-02-T6,
S-02-T7, S-02-T9, S-02-T10 in `context/foundation/roadmap-tasks.md`. Plan: no; the tasks' "Done
when" checks are the plan. One commit per task.

## Decisions

- **Codes and lanes are core's, not the task's examples.** The task writes lanes `action`, `not`,
  `work`, `ready` and banners `decide_findings` / `findings_to_implement`; the API returns core's
  names instead: lanes `not_reviewed`, `agents_working`, `action_needed`, `ready_to_merge`, and
  banners `state_findings_to_decide { count, reviewers }` / `state_waiting_for_fix { count }`.
  Core's state table (F-03) is the single source; a second vocabulary would need a mapping.
- T2: `loadPrStateInputs(db, ids)` (`packages/db/src/queries/pr-state.ts`) loads many PRs in a
  fixed number of queries (PRs, state runs, active members; then findings, questions and failed
  stages of the right runs; then current decisions), so the board makes no query per PR.
  `loadPrStateInput(db, id)` is the one-PR form. It returns the core `PrStateInput` plus what the
  views need (repository, PR, author member, reviewed round, finding rows, decisions).
- T2: it reads runs of kind `round` and `implementer` only (trials and the analyst never change a
  PR's state). Findings and questions come from the newest completed round, with their verdicts
  and current decisions. The reviewed sha is that round's head sha; commits since the review are
  `commits_count − commits_count_at_start` (never below 0). The failed round is the newest round
  when it failed, with its newest failed stage. A queued run's cause is `slot` until S-10 adds the
  others; `retryFrom`, `closedBy`, `changeType`, sensitive files, patch, reviewers, CI and
  "changes requested" stay empty until their slices. The PR's level is its newest round's frozen
  level, else the repository's `defaultLevel`.
- T2: the PR author maps to an active Team member by GitHub login, case-insensitively. Core's
  `who` reason keeps the login; the API adds `author: { login, memberId, name }` to the board card
  and as a PR view section, so the web can say "Kasia (author)".
- T2: `GET /api/board` returns `lanes.{not_reviewed: {cards, drafts}, agents_working,
  action_needed, ready_to_merge}`, `mergedOrClosed` and `repositoryCount`. A card is repository
  slug, number, title, author, `isDraft`, `openedAt` (the web shows the age), the whole
  `nextStep` and `badges`. Cards are most recently opened first; Action needed is then sorted
  stably by `actionNeededOrder`. Drafts are cards whose state is `draft` (a draft with a running
  round is in Agents working). Merged or closed PRs show when GitHub updated them in the last 7
  days (`pull_requests.updated_at`; there is no closed-at column).
- T2: `GET /api/prs/:repo/:number` gains three sections, `nextStep`, `checklist` and `author`,
  which share one state load per request (`prStateOf(context)`, a WeakMap on the view context).
- T2 (extension point): board card badges are reason codes from `CARD_BADGES`
  (`apps/api/src/board/card-badges.ts`, empty for now); a later package adds a function there and
  copy for its code.
- T4: `POST /api/prs/:repo/:number/decisions` and `POST /api/decision-batches/:id/undo` live in
  `apps/api/src/routes/api/decisions/index.ts` with `autoPrefix = '/api'`, because their paths
  sit under two other folders. Checks in order: no `signedBy` → 400 `signature_required`; Reject
  with an empty or blank reason → 400 `reason_required`; unknown PR → 404 `pr_not_found`; then
  one transaction locks the signer (400 `signer_unknown` when not an active member) and calls
  `decideFindings` (a savepoint). A finding of another PR → 404 `finding_not_found` with
  `missing`; a moved version → 409 `decision_conflict` with `params.conflicts[]` = `{ findingId,
  version, decision }`, where `decision` (or null after an undo) names the signer. A finding id
  without an expected version counts as moved.
- T4: both endpoints answer with the refreshed PR view `{ nextStep, checklist, findings }`; the
  decision also returns `batchId` for Undo. Undo needs no signature (the task gives it none; the
  batch keeps its signer and `undone_at`). Undo errors: 404 `decision_batch_not_found`, 409
  `decision_already_undone`, 409 `decision_changed_since` with `findingIds`.
- T4: the findings response (`GET .../findings` and the decision results) gains per finding
  `version`, `decision` (`batchId`, decision, reason, `signedBy: { id, name }`, `decidedAt`) and
  core's `needsDecision`. Its schemas moved to `apps/api/src/pr-view/findings.ts`, and it is now
  built from `loadPrStateInput`, so the tab and the state table read the same round.
- T6: `/prs` is the board (`apps/web/src/features/board`). The S-01 list (`features/prs/PrList`,
  its `?repo=` filter, `prListQuery`, `repositoriesQuery` and `copy.prs`) is removed; filters come
  back in S-17 (P-24). `GET /api/prs` stays in the api, unused by the web.
- T6: copy lives in new files `copy/nextStep.ts` (banner title, card short line and who line for
  every `state_*` and `who_*` code, main action labels; texts from the prototype's `nextStep()`)
  and `copy/board.ts`, each registered with one line in `copy/index.ts`, so later packages append
  without touching one long object. `lib/next-step.ts` turns a `NextStepView` into text; actors
  are named "PR Review Agent", "hand" or the member's name (else "a teammate").
- T6: card ages count from the board's fetch time (`dataUpdatedAt`), so render stays pure (the
  `react-hooks/purity` lint) and the age refreshes with the 10 s refetch. The title is the card's
  link, stretched over the card, so its accessible name is the title (the S-01 e2e finds PRs by
  it). Cards leave out "usually X (author)", "no one needs to act" and an empty who; Ready to merge
  cards are two lines; the merged-or-closed table shows the banner text as the outcome.
- T6 (extension point): `CARD_BADGE_SLOTS` (`features/board/slots.ts`) for badges that need more
  than a reason code; reason-code badges from the api render with `copy.board.badges[code]`.
