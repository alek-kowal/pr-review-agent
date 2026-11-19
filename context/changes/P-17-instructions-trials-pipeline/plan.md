# Instructions, trials and pipeline (P-17) Implementation Plan

## Overview

Work package P-17 (wave 6): S-22-T1 to T11. Instruction files by scope (global, repository, level
copy) with versions, drafts and signed activation; runs that freeze and record the versions they
read; trials that run a draft against the active versions on one commit without touching the PR;
and a read-only pipeline descriptor with its diagram.

## Current State Analysis

- `instruction_versions` (S-01-T1, `schema/repositories.ts`) keys a version by scope, repository
  and file key; scope is only `global | repository`. `importInstructionV1` (seed, e2e stack)
  creates version 1; `activeInstructions` lists a repository's active versions.
- Review, verify and change type read `effectiveInstructions(activeInstructions(...))` at stage
  time, so a version activated mid-run would change a running run. `startStageInTx` snapshots the
  active versions into the `runs.instruction_versions` jsonb (Run detail, Insights → Quality).
- Run kind `trial` exists; trials are not blocking kinds (`BLOCKING_RUN_KINDS`), the state loader
  reads only `round` and `implementer`, the after-round comment, chains and sensitive files run
  only for `round`, and the PR timeline sums only spend kinds.
- `ROLE_TOOLS` is exported from `@pra/agents`; `modelFor` from core resolves a role's model.
- Web: Settings registry already names `instructions`, `pipeline`, `experiments`; there is
  `SignedSaveDialog`, `SignatureField`, Combobox (cmdk), no Sheet, no diff utility, no
  `@xyflow/react`. `e2e/a11y-routes.ts` does not exist yet.

## Desired End State

Every task's "Done when" test passes, `pnpm test:e2e instructions.spec.ts` passes the S-22 slice
check, and `pnpm verify` is green.

## What We're NOT Doing

- Lesson candidates as trial B (S-23, P-21): the trial row and run freezing take a version
  override; P-21 adds the lesson text variant.
- Per-repository pipeline view: the pipeline lists global active files.
- Model and level settings pages (P-23); the descriptor reads the same resolver the worker uses.

## Phases (one commit per task)

1. **T1** `schema/instructions.ts`: `instruction_files` (scope global | repository | level, with
   repository or level), `instruction_versions` moved there and keyed by `file_id` (plus note,
   author, activation signer and time), `run_instruction_versions`. Hand-edited migration moves
   existing rows into files. Core `instructions.ts`: `resolveInstructions(layers, target)` with
   JSON field fallback; `lineDiff` for the editor and the trial diff.
2. **T2** `pnpm instructions:import --from <dir>` with `packages/db/instructions-import.json`.
3. **T3** `freezeRunInstructions` at run start (rows + jsonb snapshot) and `runInstructions` for
   stages; review, verify and change type read the frozen set.
4. **T4** `/api/instructions` routes; activation through `applySignedSettingsChange`
   (`instructionsStore`, area `instructions`).
5. **T5** Settings → Instructions list and editor.
6. **T6** `trials` table, `startTrial` (two `createRun` kind `trial`), trial B freezes the draft,
   trial runs skip PR writes; core `compareFindings`.
7. **T7** `/api/trials` routes (+ candidates list for the picker).
8. **T8** Try dialog, Settings → Experiments, Compare page.
9. **T9** `GET /api/pipeline` from `PIPELINE_STAGES` (`@pra/agents`), settings and versions.
10. **T10** Settings → Pipeline with a read-only `@xyflow/react` diagram and a Sheet.
11. **T11** `e2e/instructions.spec.ts`, `e2e/a11y-routes.ts`, AGENTS.md command.
