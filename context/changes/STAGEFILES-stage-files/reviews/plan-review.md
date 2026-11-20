<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Stage files — choose each stage's instruction files, instructions vs documents

- **Plan**: context/changes/STAGEFILES-stage-files/plan.md
- **Mode**: Deep
- **Date**: 2026-11-20
- **Verdict**: REVISE (SOUND after the fixes below)
- **Findings**: 0 critical, 4 warnings, 3 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

9/9 paths ✓ (`settings.pipeline.tsx` exists, no search params yet), symbols ✓
(`freezeRunInstructions`, `startStageInTx`, `selectVersions`, `lessonsFile`), brief↔plan ✓. A
sub-agent confirmed every run kind (round, retry, trial, implementer, analyst) freezes through
`startStageInTx`, so one freeze site covers them all; `fix_check` is not a run stage.

## Findings

### F1 — Phase 1 removes `instructionFiles` while two users still read it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §4
- **Detail**: `apps/api/src/routes/api/pipeline/index.ts:64` and
  `apps/worker/test/pipeline-descriptor.test.ts:19-21` read `instructionFiles`; Phase 1 would not
  typecheck.
- **Fix**: Phase 1 moves both to the slots (same API response).
- **Decision**: FIXED

### F2 — Phase 3 removes API fields the web still uses

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §2, §3
- **Detail**: `apps/web/src/lib/api-types.ts` is hand-written and web tests stub fetch, so removing
  `instructions[]` and `/rollback` in Phase 3 leaves the Phase 3 commit with a broken app while
  `pnpm verify` stays green.
- **Fix**: Phase 3 adds the new fields and routes alongside; Phase 4 removes the old ones with the
  web switch.
  - Strength: every phase commit is a working app. Tradeoff: two places to delete later.
    Confidence: HIGH — the sub-agent found no codegen. Blind spot: none significant.
- **Decision**: FIXED

### F3 — Migration kind test method left to guess

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 success criteria
- **Detail**: the fresh test database already ran the migration on an empty table, so the
  backfill needs an explicit way to be tested.
- **Fix**: the test runs the hand-written statement from the migration file over inserted rows and
  compares with `defaultKindOf`.
- **Decision**: FIXED

### F4 — e2e retry collides on the New file key

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 5 §1
- **Detail**: the e2e database lives for the whole stack run, so a retried spec would get 409
  `instruction_file_exists`.
- **Fix**: key and PR number carry `testInfo.retry`.
- **Decision**: FIXED

### F5 — Where the freeze gets file kinds

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §3, Phase 2 §2
- **Detail**: `toLayer`, `withFile` and the freeze snapshot map explicit fields; the plan did not
  say how `documentKeys` learn kinds.
- **Fix**: `kind` added to `versionWithFile`, the `InstructionVersion` Pick and `withFile`; the
  freeze reads kinds from its frozen versions; core layers unchanged.
- **Decision**: FIXED

### F6 — Touch points the plan did not list

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phases 2, 4, 5
- **Detail**: `api-types.ts`, `test/fixtures.ts`, the audit area label, `review-stage.test.ts`,
  `analyst.test.ts`, `pipeline-page.test.tsx`, `instructions-editor.test.tsx`,
  `instructions.routes.test.ts` (rollback) and `e2e/instructions.spec.ts:55-58` (region "Global").
- **Fix**: listed in the phases that change them.
- **Decision**: FIXED

### F7 — Choices that name a vanished key; Global view of repository-only files

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2-3, Phase 4 §1
- **Detail**: no behaviour was defined for a choice whose file goes away, and at Global scope the
  deployed data (files only at repository scope) would still read "no active version".
- **Fix**: missing behaves like any missing file; the Global view names the repositories that hold
  a copy (`copies`).
- **Decision**: FIXED
