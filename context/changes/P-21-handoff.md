# P-21 handoff (merge main)

Stopped on a usage limit. The merge of main is committed; decisions are in
`context/changes/P-21-learning/change.md` → "Merge main (P-21 task)".

State at the stop:

- `pnpm typecheck`, `eslint`, `prettier --check`, `scripts/check-repo-agnostic.ts` and `pnpm test`
  (1314 tests) pass.
- `pnpm test:e2e`: 63 passed, 5 failed, all in `e2e/a11y-layout.spec.ts` (S-17-T9 from P-24):
  Settings → Learning, Models, Review levels, Review levels → Level 5, Audit log. These pages have
  no `data-work-start` element, so `open()` times out.

Left to do:

1. Add `data-work-start` to the main work area and to the error alert (the P-24 pattern, see
   `apps/web/src/features/pipeline/PipelinePage.tsx`) in:
   `features/learning/LearningPage.tsx`, `features/models/ModelsPage.tsx`,
   `features/levels/ReviewLevelsPage.tsx`, `features/levels/LevelPage.tsx`,
   `features/audit/AuditPage.tsx`.
2. Rerun `pnpm test:e2e`; fix any axe or focus finding these pages then show.
3. Run `pnpm verify`, commit (`fix(P-21): work start on the new Settings pages`), delete this
   handoff.
