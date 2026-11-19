# P-17 handoff (usage limit reached)

Plan and decisions: `context/changes/P-17-instructions-trials-pipeline/{plan,change}.md`.

## Done

- **S-22-T1** committed (`2380113`): `instruction_files`, `instruction_versions` keyed by file,
  `run_instruction_versions`, core `resolveInstructions`, `lineDiff`, `diffSummary`,
  `BUILT_IN_REVIEWER_PROMPT` in core. Migrations 0014 (hand-edited data move, see the comment in
  the SQL) and 0015 (drops old columns). Re-apply the hand edit if 0014 is regenerated.

## In progress: S-22-T2 (committed as `wip`)

Written: `packages/db/src/seed/instructions-import.ts`, `src/cli/instructions-import.ts`,
`seeds/instructions-import.json`, root script `instructions:import`, test
`src/instructions-import.test.ts`. Two failing db tests to fix:

1. `seed.test.ts` "running the command twice": expects 11 imported but gets 10 + 1 kept, because
   the import test creates the global `prompt-reviewer.md` in the shared test database first.
   Fix: make the seed test count `imported + kept` (or scope its assertion), not `imported` alone.
2. `instructions-import.test.ts` "an unknown repository": check the actual error (run the test
   alone); likely the rejection shape or a count changed by a parallel test file.

Then: `pnpm --filter @pra/db test`, run the import against a scratch copy
(`cp -R ~/Projects/wb-factory/knowledge <scratch>`; seed WB first), commit T2.

## Left

T3 to T11 as in `plan.md` (worker reads frozen versions; instructions API; editor; trials
table/startTrial/compareFindings; trials API; Try/Experiments/Compare; pipeline API; pipeline
diagram with `@xyflow/react`; e2e `instructions.spec.ts`, `e2e/a11y-routes.ts`, AGENTS.md
command). Then `git merge main`, `pnpm verify`, `pnpm test:e2e`.
