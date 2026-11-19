# P-14 handoff

Stopped on the usage limit. Done and committed: S-08-T1, T2, T3. Decisions so far:
`context/changes/P-14-questions-and-signed-reviews/change.md`.

## In progress: S-08-T4 (WIP commit)

Done: schema (in migration 0014), `packages/db/src/queries/reviews.ts` (`saveReview`,
`opinionsOf`, `reviewsOf`, `getReview`), loader `PrStateLoad.opinions` and `reviewers` count.

Left for T4:
- `apps/api/src/pr-view/findings.ts`: add `opinions[]` to `FindingSchema`
  (`{ id, signedBy:{id,name}, value, comment, fromRound, carried, at }`) from `load.opinions`.
- `apps/api/src/routes/api/reviews/index.ts`: `POST /api/prs/:repo/:number/reviews
  { opinions[{findingId, value: 'worth'|'not_worth', comment?}], signedBy }` → 400
  `signature_required` / `signer_unknown`, 404 `finding_not_found`, else `refreshedView` +
  `review { id, worth, notWorth }`. Copy `answers/index.ts`.
- `apps/api/test/routes/reviews.test.ts` per the task's Done when; web `FindingView.opinions` type.

## Left: S-08-T5 … T11

T5 `usuallyDecidedBy` in core + store author on `decideFindings` (columns exist) + decision label
reason code; T6 opinions UI and review tray; T7 `matchFinding` + carry-opinions run hook
(`RUN_HOOKS.runCompleted`); T8 View new results (replace `useRefreshFindingsWhenRoundEnds` in
`PrPage.tsx`); T9 e2e `questions-reviews.spec.ts` (needs questions in `SCRIPTED_REVIEW`); T10
notify-author API (core `notifyText`, `createComment` once per review via `reviews.notified_at`);
T11 notify card + `notify-author.spec.ts` (e2e stack needs exposed ClickUp calls). Then merge
main, regenerate 0014 if numbers clash (keep the hand-added triggers), `pnpm verify` and
`pnpm test:e2e`.
