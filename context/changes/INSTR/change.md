---
change_id: INSTR
title: Rounds fail fast and readably on missing instruction files
status: implemented
created: 2026-11-20
updated: 2026-11-20
archived_at: null
---

## Notes

Orchestrator task INSTR. On the deployed app a level-3 round on a Workflow Builder PR ran
Checks, Task, Change type and Review ($0.82 API-equivalent), then failed at Verify with the raw
code "error verifier_instructions_missing" in the stage strip, the round banner and the
Findings tab.

**Cause.** The production database had 0 rows in `instruction_files`: nobody ran
`pnpm instructions:import` on the server. The reviewer still worked because `prompt-reviewer.md`
has a built-in fallback (`BUILT_IN_REVIEWER_PROMPT`); Verify needs `prompt-verifier.md` and
`verify-rules.md` and has none, so it failed after the money was spent. The web copy had no
entry for `verifier_instructions_missing`, so the raw code showed.

## Decisions

1. **One list of stage error codes, in core.** `STAGE_ERROR_CODES` (`packages/core/src/
   stage-errors.ts`). The worker's `StageError.code` is typed with it, so a stage that writes a
   new literal code does not compile until the code is listed; agent error codes pass through
   the same type (all of `AGENT_ERROR_CODES` are listed). A thrown error whose code is not listed
   fails its stage as `stage_error` with the thrown code in `params.code` (`errorOf`), so even an
   unknown integration error never reaches the UI raw. Tests: web `copy-coverage.test.ts` (every
   listed code has copy), worker `stage-error-codes.test.ts` (agent and integration codes are
   listed; `errorOf`).
2. **Required instruction files live in core.** `REQUIRED_INSTRUCTION_FILES`: Verify
   (`prompt-verifier.md`, `verify-rules.md`), Implement and Analyse. The reviewer is not listed
   (built-in prompt) and neither is the judge (it is skipped without its files, the rules alone
   set the change type; Run detail now names its missing files). Stages, the pre-check, the api
   warnings and the web copy all read this one list.
3. **Error params reach the UI.** The worker already stored `params` as `error_detail`; the
   api now sends them (`errorParams` on stages and steps, `params` on a round's error, the
   `state_stage_failed` banner, new `run_failed` timeline entries). Copy for the instruction
   errors names the files from `params.missing`, or the stage's required files when no params
   are stored, and points to Settings → Instructions; the Findings tab banner links there. The
   copy moved to `apps/web/src/copy/reasons.ts`; a reason may now be a function of its params.
4. **Pre-check before the first stage, not a new run state.** `instructionsPreflight`
   (`apps/worker/src/run/instructions-preflight.ts`) runs in `runStages` on a run's first start,
   for the stages the run will actually run (not off, not reused), and reads the files the way
   the stages do (the versions the run froze, global → repository → level). A gap fails the
   first stage (usually Checks) with `instructions_missing` and `params { stage, missing, gaps }`,
   with no agent session, so the round fails before any money is spent. It reuses the existing
   failed-stage path (banner, stage strip, retry) instead of adding a state. Each stage keeps its
   own check as the safety net. E2e: `e2e/instructions-missing.spec.ts` on
   `NO_VERIFIER_REPOSITORY` (empty repository copies hide the global files).
5. **Warnings, not a blocked start.** The PR view gets an `instructionGaps` section (per level,
   core `instructionGaps` over the repository's active versions) and `GET /api/instructions` a
   `gaps` list (connected repositories with gaps only, by slug). Start review warns about the
   selected level but stays enabled: the round costs nothing when it stops at the pre-check, and
   a person may add the file right after. Settings → Instructions shows the warning above the
   files, also when no file exists yet (the production case), one line per stage and missing
   files with the levels that share them. Core exports `INSTRUCTION_STAGES` as a tuple for the
   Zod enum.
6. **Server import is a script, never run by the agent.** `deploy/mikrus/import-instructions.sh
   <dir> [--dry-run]` uses `deploy.sh`'s SSH settings, streams the folder (no `.git`, no macOS
   `._` files) into `/srv/pra/knowledge-import/<timestamp>` and runs `pnpm instructions:import`
   in `/srv/pra/app` as the deploy user in one SSH call; the copy stays for reference. The
   default map files the copy under the repository it names, so the repository is connected
   first. Documented in docs/deploy-mikrus.md ("First install: instruction files") and in
   bootstrap step 7.
