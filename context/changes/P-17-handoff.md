# P-17 handoff (context full)

Plan and decisions: `context/changes/P-17-instructions-trials-pipeline/{plan,change}.md` (Decisions are up to date through T7).

- Done: T1 `2380113`, T2 `b600520`, T3 `dea4403`, T4 `ae54d40`, T5 `dd1425c`, T6 `a545fb2`, T7 `e74dad9`. Main merged at session start (no conflicts).
- Partial T8 (`236f3a8`, wip): only `apps/web/src/lib/api-types.ts` trial types and `apps/web/src/copy/trials.ts`. Still to do: in `copy/index.ts` import `trials` and add it to `copy`, add errors `trial_needs_draft`, `trial_not_found`; `features/trials/queries.ts` (`/api/trials`, `/api/trials/:id`, POST body `{ pr: { repo, number }, instructionDraft: versionId }`); `TryOnPrDialog` (PR Combobox from `boardQuery()` cards, like `ConnectPicker`); `ExperimentsPage`; `ComparePage` (reuse `features/instructions/DiffView.tsx`, link "Go to activate version N" to `/settings/instructions/$id`); routes `settings.experiments.index.tsx` and `settings.experiments.$id.tsx`; registry entry `experiments`; pass `tryOnPr` to `InstructionEditor` in `routes/settings.instructions.$id.tsx` (the prop exists); test `trial-compare.test.tsx`; run `vite build` for `routeTree.gen.ts`.
- Left: T9 to T11 as in `plan.md`.
- Migrations: 0014 (hand-edited data move), 0015 (T1), 0016_trials (T6). If main adds 0016, keep main's and regenerate ours.
- Trial runs: Checks and Task are off (`off_in_trial`), no timeline/state writes; run B freezes the draft via `trialReplacements` in `execute-stage.ts`.
- Test files share one database: use unique file keys or `createTestDatabase()` for global instruction files.
- `pnpm verify`: green except web/Docker tests that time out when machine load is high (~60); each passes when rerun alone.
