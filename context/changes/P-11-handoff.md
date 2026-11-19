# P-11 handoff

- Done: S-07-T1 (`bcbd436`) and S-07-T2 (`3154946`), with `pnpm verify` green (764 tests). Plan and decisions: `context/changes/P-11-manual-start-chains-sensitive/{plan,change}.md`.
- Partial: S-07-T3 (`8ff74e0`). Only the `finding_fix_checks` table (`schema/chains.ts`, migration `0013`) exists. Still to do:
  - `packages/agents/src/reviewer/fix-check.ts`: schema `{fixes:[{findingId,resolved,reason}]}` plus prompt and brief.
  - Worker executors `fix_diff`, `check_fixes` and `reproductions`, registered in `stages/index.ts`. Export `reproduce`/`keepRun` from `verify.ts`; `keepRun` hardcodes `verify-`.
  - Optional `fixChecks` on the succeeded `StageResult`, inserted in `storeResultInTx`.
  - Optional `fixes` in the full review schema, plus a reviewer context provider that lists earlier Implement findings.
  - The loader sets `resolved` from the newest fix check (it is still `null`).
  - `fix-check.test.ts`.
- Left: S-07-T4 to T7 and S-11-T1 to T4, as in `plan.md`.
- Code state:
  - `createRun` and `startRound` live in `@pra/db` (`queries/start-round.ts`); the worker's `start-round.ts` is a thin wrapper.
  - Chains use `round_chains.expected_head_sha`; a fix round clears it when it starts.
  - `pull_requests.level` is the PR level; `runs.commits_since`/`commits_since_head` are written by `run/chains.ts` hooks.
  - Loader: findings come from the latest completed full round (`findingsRound`); the reviewed SHA is the latest completed round's head.
- PR routes are keyed `:repo/:number`. The e2e stack has no session hold or push helper yet (P-11 adds them in T7). WB has no sensitive patterns.
