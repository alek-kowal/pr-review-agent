<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Choose each stage's instruction files; instructions vs documents

- **Plan**: context/changes/STAGEFILES-stage-files/plan.md
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-11-20
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 7 observations

Evidence: two review agents (plan drift; safety and patterns) over `git diff 3aec469^..HEAD`, each
finding checked against the code. Automated criteria: `pnpm verify` (261 files, 1804 tests) and
`pnpm test:e2e` (88 passed, 1 skipped) green after `git merge main` (already up to date). Manual
4.4 and 4.5 are unchecked: the run was unattended, nobody looked at the app by hand.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Make active racing Discard draft writes a false audit row

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/api/src/settings/instructions-store.ts:39-41
- **Detail**: `write()` finds the target version without a lock, then ignores a null from
  `activateInstructionVersion`. If Discard deletes the draft in between, the `settings_changes`
  row says "v2 activated" and the API answers 200 while v1 stays active. Unreachable before
  STAGEFILES, because versions were never deleted.
- **Fix**: throw (the transaction rolls back) when `activateInstructionVersion` returns null.
- **Decision**: FIXED

### F2 — Discard draft locks in the opposite order to Save as draft

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/db/src/queries/instructions.ts:572-580
- **Detail**: Save locks the file row, then the draft; Discard locks the draft, then may delete the
  file. A file whose only version is the draft can deadlock (500); otherwise Save updates a deleted
  draft and answers 404 for a file that exists.
- **Fix**: Discard locks the file row `FOR UPDATE` first, like Save and copy.
- **Decision**: FIXED

### F3 — "All Markdown documents" in the view differs from what runs read

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: apps/api/src/settings/stage-files.ts:211-217 (`documentKeysAt`), :277-302
- **Detail**: The worker expands the reviewer's default documents over the run's frozen active
  versions, level copies included (`execute-stage.ts:343`). The view and "Read by" expand over
  global and repository files of kind document, drafts included, level copies left out. So a
  draft-only document shows as read by Review, and a document that exists only as a level copy
  shows "Not used by any stage". The plan counts `.md` documents as read by the reviewer for level
  files too.
- **Fix**: count only files with an active version, and include level copies.
  - Strength: the view then says what a run reads; the plan's rule for level files holds.
  - Tradeoff: at a repository scope a level-only document shows for every level, though only runs
    at that level read it.
  - Confidence: HIGH — same rule as the worker's expansion, one helper.
  - Blind spot: none significant; route tests cover "Read by".
- **Decision**: FIXED

### F4 — New file checks, then inserts

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/db/src/queries/instructions.ts:530-566
- **Detail**: two concurrent New file requests for one key and scope: the loser gets a unique
  violation (500) instead of 409. Two at different scopes with different kinds both pass the kind
  check, breaking "one key keeps one kind".
- **Fix**: take `pg_advisory_xact_lock` on the key before the checks (pattern of `learning.ts:213`).
- **Decision**: FIXED

### F5 — Placeholder choice rows outlive a 409 or no-op save

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/db/src/queries/stage-files.ts:80-98
- **Detail**: the comment says a rolled-back transaction never keeps the empty row the lock
  inserts, but `applySignedSettingsChange` commits on `settings_stale` and on a save that changes
  nothing. Reads skip empty rows, so it is harmless.
- **Fix**: correct the comment.
- **Decision**: FIXED

### F6 — The editor does not refetch the file after a failed change

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/web/src/features/instructions/queries.ts:82
- **Detail**: after a 409 on Make active or a 404 on Discard, the editor keeps the stale versions
  until a reload.
- **Fix**: refetch the file on error too.
- **Decision**: FIXED

### F7 — Error code written as a string literal

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: apps/api/src/routes/api/settings/stage-files/index.ts:53
- **Detail**: `'repository_not_found'`; sibling routes use `ApiErrorCode.RepositoryNotFound`.
- **Fix**: use the enum.
- **Decision**: FIXED

### F8 — Extra queries in the instructions routes

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: apps/api/src/routes/api/instructions/index.ts:144-164, :338-347
- **Detail**: the list runs one choices query per repository and lists repositories twice; the
  detail loads all files, choices and repositories for "Read by". Fine at a handful of
  repositories.
- **Fix**: read the choices once with `allStageFileChoices`.
- **Decision**: SKIPPED — a few repositories today; not worth the churn in this package.

### F9 — Two planned tests are missing

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: apps/worker/test/stage-files.test.ts, packages/db/src/instructions-import.test.ts
- **Detail**: Testing Strategy lists "stage reads assigned file (… judge …)" and "import kinds
  and skips"; no test makes the judge read an assigned file, and no test runs the default map's
  skip of `review-levels.json` / `review-profiles.json`.
- **Fix**: add both tests.
- **Decision**: FIXED

### F10 — Plan records lag the code

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: plan.md Progress; context/foundation/prd.md:384; change.md Decisions
- **Detail**: Progress for phases 2–5 says "phase N commit" instead of SHAs; FR-079 still says
  "activate a version or roll back"; small extras are not recorded (store file named
  `settings/stage-files.ts`, `source` returned by `resolveStageSlots` rather than
  `resolveStageFiles`, optional `note` on the stage-files PUT, 204 when Discard removes the file,
  `kind` on Run detail versions).
- **Fix**: SHAs in Progress, FR-079 says "make any version active, discard a draft", extras as
  Decisions.
- **Decision**: FIXED
