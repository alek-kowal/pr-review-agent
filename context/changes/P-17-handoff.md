# P-17 handoff (context full)

Plan and decisions: `context/changes/P-17-instructions-trials-pipeline/{plan,change}.md`.

- Done: S-22-T1 (`2380113`), S-22-T2 (`b600520`).
- Partial, committed as `wip`: S-22-T3. Done: `freezeRunInstructions`, `runInstructions` and `activateInstructionVersion` in `packages/db/src/queries/instructions.ts`; `apps/worker/src/stages/instructions.ts` used by review, verify and change type; freezing in `execute-stage.ts`; `apps/worker/test/run-instructions.test.ts` passes.
- T3 fixes left: (1) in `apps/api/src/routes/api/runs/index.ts`, change `level`/`fileId` `.nullable().default(null)` to `.nullable().optional()`. This fixes the typecheck and 2 failing `runs.test.ts` tests. (2) Remove the unused `uniqueId` import in `apps/worker/test/review-stage.test.ts` (lint).
- Then: `pnpm verify` and commit T3 as `feat(S-22): ... (T3)`.
- Left: T4 to T11 as in `plan.md`. Not yet in `change.md` Decisions: trials take the draft only, not a lesson candidate (P-21 adds that); trial runs skip timeline and PR writes; the pipeline lists global files.
- Migration 0014 has hand-written SQL that moves the data. Re-apply it if 0014 is regenerated after a merge.
- Test files share one database, so global instruction files collide between them. Use `createTestDatabase()` or file keys unique to the test.
