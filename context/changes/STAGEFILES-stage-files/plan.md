# Stage files: choose each stage's instruction files, instructions vs documents — Implementation Plan

## Overview

Settings → Pipeline stops being read-only for one thing: which instruction files each agent stage
reads. Every instruction file gets a kind (`instruction` or `document`). Each agent stage declares
named slots (`prompt`, `rules`, `documents`). A choice is a signed setting at global scope with an
optional repository override. A run freezes the choice when it starts, and the worker stages read
the files their slots point to. Settings → Instructions splits into Instructions and Documents, shows
who reads each file, and can create a new file. The editor gets "Make active" on every non-active
version and "Discard draft".

Why: Alek (20 Nov) wants to try alternative rules for a stage without editing the one file every
repository shares. The deployed app also showed three defects this fixes: the Pipeline sheet said
"no active version" for repository-scope files, Instructions mixed prompts with reference material,
and a draft could not be made active from the history or thrown away.

## Current State Analysis

- Stage → file mapping is descriptive only: `packages/agents/src/pipeline.ts:35,51-63,97,122,133`
  (`instructionFiles`); the worker never reads it. Each stage hard-codes its keys:
  judge `apps/worker/src/stages/change-type.ts:20-21,82-87` (skipped when missing), review
  `apps/worker/src/stages/review/index.ts:83-90` + `review/prompt.ts:6` (built-in fallback
  `BUILT_IN_REVIEWER_PROMPT`, core `instructions.ts:326`), verify `verify.ts:50,104-114`, implement
  `implementer.ts:39-40,208-214`, analyse `analyse.ts:20-21,39-49,72` (lessons optional).
- The reviewer's `knowledge/` dir receives every resolved file (`review/index.ts:84`,
  `materialiseInstructions`). The verifier, implementer and analyst adapters already write their
  rules under a fixed name (`packages/agents/src/verifier/verifier.ts:101`, `analyst.ts:213-217`).
- Required files: core `REQUIRED_INSTRUCTION_FILES` / `missingInstructions` / `instructionGaps`
  (`packages/core/src/instructions.ts:251-319`), used by the INSTR pre-check
  (`apps/worker/src/run/instructions-preflight.ts:13-33`), the stages, the api gaps
  (`apps/api/src/pr-view/sections/instruction-gaps.ts:17-29`, `routes/api/instructions/index.ts:117-132`)
  and the web copy fallback (`apps/web/src/copy/reasons.ts:31-50`, `copy-coverage.test.ts:19`).
- Freeze: `freezeRunInstructions` (`packages/db/src/queries/instructions.ts:204-237`) runs in
  `startStageInTx` (`apps/worker/src/run/execute-stage.ts:323-345`) when a queued run starts; the
  snapshot goes to `runs.instruction_versions` (jsonb, `schema/runs.ts:116-118`).
- Files: `instruction_files` has no kind (`schema/instructions.ts:32-56`). No route creates a file;
  files come from import/seed (`importInstructionV1`), copies (`startInstructionCopy`, no web UI) and
  learning's `lessons.md`. No version is ever deleted. `trials.draft_version_id` and
  `run_instruction_versions.version_id` cascade on delete.
- Versions: `POST /api/instructions/:id/activate` (drafts) and `/rollback` (archived with
  `activatedAt`) share one signed path (`routes/api/instructions/index.ts:166-207`,
  `settings/instructions-store.ts`). The editor shows Rollback only for once-active archived versions
  (`InstructionEditor.tsx:314-318`); no Discard draft, no hint.
- Pipeline API looks up global files only (`routes/api/pipeline/index.ts:50-70`): the "no active
  version" bug, since `pnpm instructions:import` puts everything at repository scope by default
  (`packages/db/src/testing/fixtures/instructions-import.json`).
- Signed settings: `applySignedSettingsChange` + `SettingsStore<T>`
  (`apps/api/src/settings/signed-change.ts`); `sameJson` treats null/absent fields as equal. Areas
  are free text; audit labels live in `apps/web/src/copy/audit.ts:37-48`. There is no generic
  key-value settings table. Web signing: `SignedSaveDialog` + `SignatureField`
  (`features/settings/SignedSaveDialog.tsx`, `features/signature/SignatureField.tsx`).
- Migrations: latest `0029_github_poller.sql`; hand-written data SQL inside a generated migration has
  precedent (`0017_instruction_files.sql:25-37`, `0021_level_model_settings.sql:18-34`).

## Desired End State

- `instruction_files.kind` is `instruction` or `document` for every row; existing `prompt-*.md` and
  `*-rules.md` rows are instructions, the rest documents.
- `PIPELINE_STAGES` declares slots: judge (`change_type`) prompt + rules; review prompt (built-in
  allowed) + rules + documents; verify and implement prompt + rules; analyst prompt + rules +
  documents. Defaults are today's keys, so a database with no choices behaves as today (except the
  reviewer no longer gets prompts, other stages' rules or `.json` files in `knowledge/`).
- `stage_file_choices` holds global and per-repository choices; every write is signed, logged in
  `settings_changes` (area `stage_files`) and refused with 409 on a stale `before`.
- A run stores its resolved stage → files map in `runs.stage_files` when it starts; the stages and
  the pre-check read it; Run detail shows which stage read each frozen file.
- Settings → Pipeline has a scope picker (Global or a connected repository). The sheet shows each
  slot with a picker, the active version resolved for the scope with a link, the inheritance state
  and a reset, and saves with a signature.
- Settings → Instructions shows Instructions and Documents sections with a description and a
  "Read by" column, hides unused files behind "Not used by any stage", and has "New file".
- The editor offers "Make active" on every non-active version, "Discard draft" on a draft, and a
  hint that a draft changes nothing until made active.
- Verify: `pnpm verify` and `pnpm test:e2e` pass; the new e2e spec picks another rules file for
  Verify on one repository and sees the run, the Pipeline sheet and "Read by" reflect it.

### Key Discoveries:

- The verifier/implementer/analyst adapters put the rules text under a fixed name whatever the
  source key (`verifier.ts:101`, `analyst.ts:213-217`): the reviewer can do the same, so a stored
  `prompt-reviewer.md` that names `review-rules.md` keeps working with another rules file.
- `saveInstructionDraft` archives a draft a trial references instead of editing it
  (`queries/instructions.ts:446-499`); Discard follows the same rule so trials and runs keep their
  rows (the FKs cascade).
- `sameJson` drops null fields, so "no override for this slot" must be an absent/null field and
  "built in" must be a non-null value (a sentinel).
- `trialReplacements` swaps a trial's draft in at freeze time (`execute-stage.ts:330-338`); the
  stage-file freeze happens in the same block, so trials freeze a choice too.

## What We're NOT Doing

- No editable diagram, no new stages, no change to models, timeouts or attempts.
- No per-level stage-file choices (levels keep their level copies of files).
- No change to which file versions a run freezes: it still freezes every resolved file
  (`freezeRunInstructions`); only the stage → file choice is new. Version "Runs" counts keep their
  meaning.
- No deletion of files or of active/archived versions; no UI for level copies in "New file".
- No change to the import's scope rules (the default map still files under the repository).
- No `fix_check` slots: its prompt stays built in (`FIX_CHECK_PROMPT`).

## Implementation Approach

Bottom-up, each phase green on its own: data model and pure rules first (core, db, agents), then
the run/worker path, then the API, then the web, then e2e and docs. The one migration lands in
Phase 1 with every schema change. Slot declarations live in `packages/agents/src/pipeline.ts` (as
asked); core holds only the slot types, the pure resolution, the built-in sentinel and which slots
are required, so `packages/core` keeps its import boundary (core may not import `@pra/agents`). The
web gets slots only through the API.

## Critical Implementation Details

- **Stage keys.** Choices are keyed by the pipeline stage key (`change_type`, `review`, `verify`,
  `implement`, `analyst`); core's `INSTRUCTION_STAGES` uses `analyse`. Core exports the map
  (`analyse → analyst`) once; nothing else translates by hand.
- **Built in vs inherit.** Stored choice fields are absent/null for "inherit" and the string
  `BUILT_IN_FILE = '@built-in'` for the reviewer's built-in prompt. New file keys may not start
  with `@`.
- **Freeze ordering.** Expand the reviewer's default "all Markdown documents" at freeze time from
  the files the run resolved (kinds come from the file rows), in the same transaction as
  `freezeRunInstructions`, so a document added later never changes a running run.
- **Migration.** Generated with `pnpm db:generate --name stage-files`; the kind backfill is a
  hand-written `UPDATE` marked `-- Hand-written (STAGEFILES)`, kept when regenerating after a merge.

## Phase 1: Data model, kinds and slot declarations

### Overview

All schema changes and the pure rules, with no behaviour change yet.

### Changes Required:

#### 1. Core: kinds and stage-file rules

**File**: `packages/core/src/instructions.ts`, new `packages/core/src/stage-files.ts`, `packages/core/src/index.ts`

**Intent**: Name the two kinds and the default-kind rule; define slots, choices and their pure
resolution so api, worker and tests share one rule.

**Contract**:
- `INSTRUCTION_KINDS = ['instruction', 'document']`, `InstructionKind`; `defaultKindOf(fileKey)`:
  `instruction` when the basename matches `prompt-*.md` or ends `-rules.md`, else `document`.
- `instructionFileKeyProblem(key)`: reason code or null (non-empty relative posix path, no `..`
  segment, no leading `/` or `@`, at most 200 chars).
- `FILE_STAGE_KEYS = ['change_type','review','verify','implement','analyst']`, `FileStageKey`;
  `FILE_STAGE_OF_INSTRUCTION_STAGE = { verify:'verify', implement:'implement', analyse:'analyst' }`.
- `STAGE_SLOT_NAMES = ['prompt','rules','documents']`; `StageSlotDecl` =
  `{ name:'prompt'|'rules', kind:'instruction', default: string, builtIn?: true, required?: true }`
  | `{ name:'documents', kind:'document', default: readonly string[] | 'all-markdown' }`.
- `BUILT_IN_FILE = '@built-in'`.
- `StageFileChoice = { prompt?: string; rules?: string; documents?: string[] }` (absent = inherit).
- `StageFiles = { prompt: string | null; rules: string | null; documents: string[] }` (prompt null =
  built in); `FrozenStageFiles = Partial<Record<FileStageKey, StageFiles>>`.
- `resolveStageFiles(slots, { global, repository }, documentKeys)`: per slot repository ?? global ??
  default; `'all-markdown'` → the `.md` keys of `documentKeys`, sorted. Also returns per slot its
  `source: 'default' | 'global' | 'repository'` for the API.
- `stageFileReaders(fileKey, frozen)`: the stage keys whose files include `fileKey`.

#### 2. DB schema and the migration

**File**: `packages/db/src/schema/instructions.ts`, new `packages/db/src/schema/stage-files.ts`, `packages/db/src/schema/runs.ts`, `packages/db/src/schema/index.ts`, `packages/db/migrations/0030_stage-files.sql`

**Intent**: Store the kind, the choices and the frozen choice.

**Contract**:
- `instruction_files.kind text not null default 'document'` + check in (`instruction`,`document`).
- `stage_file_choices`: `id`, `repository_id` (null = global, FK cascade), `stage text not null`,
  `prompt text`, `rules text`, `documents jsonb` (`string[]`), `updated_at`; unique
  `(repository_id, stage)` nulls not distinct.
- `runs.stage_files jsonb` nullable, `$type<FrozenStageFiles>()` (null for runs started before).
- Migration via `pnpm db:generate --name stage-files`, plus the hand-written backfill:
  `UPDATE instruction_files SET kind = 'instruction' WHERE file_key ~ '(^|/)prompt-[^/]*\.md$' OR file_key ~ '-rules\.md$'`.

#### 3. DB queries

**File**: `packages/db/src/queries/instructions.ts`, new `packages/db/src/queries/stage-files.ts`, `packages/db/src/queries/index.ts`

**Intent**: Carry the kind everywhere a file is read or created; read, lock and write choices.

**Contract**:
- `kind` on `InstructionFileRow` (picked up by `selectFiles`), on `InstructionVersion` (add `kind`
  to `versionWithFile` at `queries/instructions.ts:36-42`, the type's Pick at `:24-25` and
  `withFile` at `:111-124`), and on the list summary. `toLayer` and core `InstructionLayer` stay
  as they are.
- `ensureInstructionFile`/`importInstructionV1` take an optional `kind`, default `defaultKindOf`;
  `startInstructionCopy` copies the source's kind.
- `stageFileChoicesOf(db, repositoryId | null)` → `{ global: Map<stage, StageFileChoice>, repository: Map<…> }`;
  `allStageFileChoices(db)` (for "Read by" across repositories); `lockStageFileChoice(tx,
  repositoryId, stage)`; `writeStageFileChoice(tx, repositoryId, stage, choice | null)` (null or an
  empty choice deletes the row).

#### 4. Slot declarations

**File**: `packages/agents/src/pipeline.ts`

**Intent**: Declare each agent stage's slots with today's keys as defaults; keep the descriptor's
file list derived from them.

**Contract**: `PipelineStage.slots: readonly StageSlotDecl[]` (empty for checks, task, fix_check).
change_type: prompt `prompt-classifier.md`, rules `classify-rules.md`. review: prompt
`prompt-reviewer.md` (`builtIn`), rules `review-rules.md`, documents `'all-markdown'`. verify,
implement: prompt + rules from `REQUIRED_INSTRUCTION_FILES` (`required`). analyst: prompt + rules
(`required`), documents `['lessons.md']`. `slotsOf(stage)` and `stageFilesFor(choices,
documentKeys)` (binds `resolveStageFiles` to `PIPELINE_STAGES`) exported. `instructionFiles` is
removed; `REVIEW_INSTRUCTION_FILES` / `ANALYST_INSTRUCTION_FILES` go. Its two users move to the
slots in this phase so it stays green: `apps/api/src/routes/api/pipeline/index.ts:64` lists the
default keys of the prompt and rules slots (same response as today) and
`apps/worker/test/pipeline-descriptor.test.ts:19-21` asserts the slots.

#### 5. Import map

**File**: `packages/db/src/seed/instructions-import.ts`, `packages/db/src/testing/fixtures/instructions-import.json`

**Intent**: Give imported files a kind and stop importing the two unused JSON files.

**Contract**: map gains optional `kinds: Record<fileKey, InstructionKind>` (default
`defaultKindOf`); `skip` adds `review-levels.json`, `review-profiles.json`.

### Success Criteria:

#### Automated Verification:

- Migration generated and applies: `pnpm db:generate --name stage-files` then `pnpm db:migrate`
- Core unit tests for kinds and resolution pass (global, repository override, reset to default, built in, all-markdown): `pnpm --filter @pra/core test`
- DB tests for the migration's kind backfill, choice queries and import kinds pass: `pnpm --filter @pra/db test`. The backfill test reads `packages/db/migrations/0030_stage-files.sql`, takes the statement after `-- Hand-written (STAGEFILES)`, runs it over freshly inserted `document` rows (`prompt-x.md`, `feature-map/prompt-y.md`, `verify-rules.md`, `lessons.md`, `review-levels.json`, `feature-map/sdk.md`) and expects each kind to equal `defaultKindOf`
- `pnpm verify` passes

---

## Phase 2: Runs freeze the choice; stages read assigned files

### Overview

The worker resolves and freezes the stage → files map when a run starts and every stage, the
pre-check and the gaps follow it.

### Changes Required:

#### 1. Core required files follow the choice

**File**: `packages/core/src/instructions.ts`

**Intent**: A required stage needs its assigned prompt and rules, not fixed keys.

**Contract**: `missingInstructions(files, stages, stageFiles: FrozenStageFiles)` reads the keys of
the `prompt` and `rules` slots of each required stage (`FILE_STAGE_OF_INSTRUCTION_STAGE`);
`instructionGaps(layers, repositoryId, stageFiles)`. `REQUIRED_INSTRUCTION_FILES` stays as the
default keys (web copy fallback, slot defaults).

#### 2. Freeze

**File**: `apps/worker/src/run/execute-stage.ts`, new `apps/worker/src/stages/stage-files.ts`

**Intent**: Resolve and store the choice next to the frozen versions; give stages one reader.

**Contract**: in `startStageInTx`'s queued block, after `freezeRunInstructions`, compute
`stageFilesFor(await stageFileChoicesOf(tx, repositoryId), documentKeys)` where `documentKeys` are
the keys of the frozen versions whose file kind is `document` (`freezeRunInstructions` returns
`kind` in its snapshot entries; a trial's replaced draft is among them), and add
`stageFiles` to the run patch. `stageFilesOf(run, stage)`: the frozen entry, or the declared
defaults resolved over the run's files for a run with `stage_files` null.

#### 3. Stages

**File**: `apps/worker/src/stages/change-type.ts`, `review/index.ts`, `review/prompt.ts`, `verify.ts`, `implementer.ts`, `analyse.ts`, `apps/worker/src/run/instructions-preflight.ts`

**Intent**: Read the slot's file instead of a hard-coded key; keep the fallbacks and error codes.

**Contract**:
- Judge, verify, implement, analyse: prompt/rules from `stageFilesOf`; `missing` params name the
  assigned keys. Judge stays skipped when missing.
- Review: prompt from the slot (`null` or unusable → `BUILT_IN_REVIEWER_PROMPT`); `knowledge/` holds
  only the rules file, written as `review-rules.md` whatever key is assigned (as the other adapters
  do), and the assigned documents under their own keys.
- Analyst: `AnalystInput.lessons` becomes `documents: { fileKey, content }[]` rendered as
  `knowledge/<fileKey>` (`packages/agents/src/analyst/analyst.ts`); a missing assigned document is
  rendered empty, as `lessons.md` is today.
- Pre-check passes the run's frozen stage files to `missingInstructions`.
- Existing tests to adapt: `apps/worker/test/review-stage.test.ts` (knowledge dir: `lessons/edges.md`
  stays as a Markdown document, prompts no longer appear), `packages/agents/src/analyst/analyst.test.ts`
  (`lessons` → `documents`), the verify/implementer/analyst stage tests that assert `missing`.
  e2e `learning.spec.ts:180-192` keeps working because `lessons.md` is a Markdown document.

#### 4. API gaps follow the choice

**File**: `apps/api/src/pr-view/sections/instruction-gaps.ts`

**Intent**: Start-review warnings and Settings → Instructions gaps use the repository's current
choice.

**Contract**: `repositoryInstructionGaps` resolves `stageFilesFor(stageFileChoicesOf(db, repoId), …)`
before `instructionGaps`.

### Success Criteria:

#### Automated Verification:

- Worker test: a run freezes its stage files; changing the choice after it started does not change what it reads: `pnpm --filter @pra/worker test`
- Worker test: Verify with another rules file assigned for the repository sends that file's text; the pre-check reports the assigned key when it is missing
- Worker test: the reviewer's `knowledge/` holds the rules (as `review-rules.md`) and the assigned documents only; the analyst receives its assigned documents
- API test: gaps follow a repository override: `pnpm --filter @pra/api test`
- `pnpm verify` passes

---

## Phase 3: API

### Overview

The signed stage-files setting, the scoped pipeline view, kinds and "Read by" on instructions,
New file, Make active and Discard draft, and stage readers on Run detail.

### Changes Required:

#### 1. Stage-files setting

**File**: new `apps/api/src/settings/stage-files-store.ts`, new `apps/api/src/routes/api/settings/stage-files/index.ts`, `apps/api/src/plugins/errors.ts`

**Intent**: Save one stage's choice at one scope as a signed change.

**Contract**: `PUT /api/settings/stage-files/:stage` body
`{ repository: string | null, before: StageFileChoice | null, after: StageFileChoice | null, signedBy?: string }`
(`before` required, so staleness is always checked). Store area `stage_files`, entity
`global/<stage>` or `<repositoryId>/<stage>`. Validation (400): `stage_file_unknown {fileKey}`
when no file with that key is visible at the scope (global scope: global files; repository scope:
global files and that repository's copies), `stage_file_kind {fileKey, kind}` when the kind does
not match the slot, `stage_file_slot {slot}` for a slot the stage does not declare or
`@built-in` on a slot without `builtIn`. Errors 400 `signature_required`/`signer_unknown`, 404
`repository_not_found`, 409 `settings_stale`. Response: the stage's view (as in the pipeline GET).

#### 2. Pipeline view by scope

**File**: `apps/api/src/routes/api/pipeline/index.ts`

**Intent**: Fix "no active version" and feed the sheet.

**Contract**: `GET /api/pipeline?repository=<slug>`. Response adds `scope: { repository: {id, slug} | null }`,
`repositories: {id, slug}[]` (connected), `options: { instruction: FileOption[], document: FileOption[] }`
(keys visible at the scope with the resolved active version) and per stage `choice: { global, repository }`
(raw, for `before`) and `slots[]`: `{ name, kind, builtIn, required, source, value: string[]
(effective keys; [BUILT_IN_FILE] for built in), files: FileOption[] }` where `FileOption =
{ fileKey, fileId: number|null, version: number|null, scope: InstructionScope|null }` resolved
global → repository for the scope. At Global scope a slot file with no global file but with
repository copies carries `copies: string[]` (their slugs), so the sheet can say where it lives
(the deployed case). `instructions[]` stays until Phase 4 switches the web (the web's
`api-types.ts` is hand-written and its tests stub fetch, so removing it here would break the app
without failing `pnpm verify`).

#### 3. Instructions list, New file, versions

**File**: `apps/api/src/routes/api/instructions/index.ts`, `packages/db/src/queries/instructions.ts`

**Intent**: Kinds and readers in the list; create a file; activate any non-active version; discard
a draft.

**Contract**:
- List and detail files gain `kind` and `readBy: { stage: FileStageKey, repository: string | null }[]`
  (global and level files: the global choice's readers plus each repository override that names the
  key, with its slug; a repository copy: that repository's resolved readers). `.md` documents count
  as read by the reviewer under its default.
- `POST /api/instructions` body `{ fileKey, kind, scope: 'global' | 'repository', repository?, content, note? }`
  → 201 detail; creates the file and version 1 as a `hand` draft (unsigned, like Save as draft).
  400 `instruction_file_key {problem}`, 409 `instruction_file_exists`, 409
  `instruction_kind_conflict` when the key exists at another scope with the other kind.
- `POST /:id/activate` accepts any non-active version (draft or archived); `/rollback` stays until
  Phase 4 moves the web to `/activate`, then goes with its tests
  (`apps/api/test/routes/instructions.routes.test.ts:132,160-167`).
- A choice may name a key that later has no file (its only draft discarded, a repository copy
  gone): the sheet shows "(no active version)" and the run's pre-check or stage reports it missing,
  as for any missing file. Nothing refuses the discard.
- `DELETE /:id/draft` (unsigned): deletes the draft row, or archives it (no `activatedAt`) when a
  trial or a run references it; when it was the file's only version, the file row goes too.
  404 `instruction_version_not_found` when there is no draft. Query `discardInstructionDraft(tx, fileId)`.

#### 4. Run detail readers

**File**: `apps/api/src/routes/api/runs/index.ts`

**Intent**: Show which stage read a frozen file.

**Contract**: run gains `stageFiles: FrozenStageFiles | null`.

### Success Criteria:

#### Automated Verification:

- API tests for `PUT /api/settings/stage-files/:stage`: unsigned 400, unknown signer 400, stale 409, wrong kind 400, unknown key 400, built-in only on the reviewer prompt, reset (`after: null`) removes the override, one `settings_changes` row: `pnpm --filter @pra/api test`
- API tests: pipeline at repository scope resolves repository copies; instructions list has kinds and readers; New file; Make active on an archived never-active version; Discard draft deletes or archives
- `pnpm verify` passes

---

## Phase 4: Web

### Overview

The Pipeline scope picker and slot editor, the two-section Instructions page with New file, the
editor's version actions, and Run detail readers.

### Changes Required:

#### 1. Pipeline

**File**: `apps/web/src/features/pipeline/PipelinePage.tsx`, new `StageFilesForm.tsx`, `queries.ts`, `apps/web/src/routes/settings.pipeline.tsx`, `apps/web/src/copy/pipeline.ts`

**Intent**: Pick the scope, edit a stage's slots and save with a signature.

**Contract**: scope picker (Select: Global + connected repositories) at the top, kept in the
`repository` search param. The sheet shows, per slot: a Select of instruction files (prompt/rules;
"Built in" first for the reviewer prompt), a checkbox list of documents, the resolved file
version as a link (`fileKey vN`, or "(no active version)"), and "Inherited from global" /
"Overridden for this repository" (repository scope) or "Default" / "Changed from default" (global
scope) with Reset. Save opens `SignedSaveDialog` (rows per changed slot) and sends `before` =
the stored choice at that scope. 409 shows the existing stale message. `affects` copy no longer
says read-only. At Global scope a file that exists only as repository copies says so ("Only in
workflowbuilder: pick it above"). This phase removes the API's `instructions[]` and `/rollback`.

#### 5. Types, fixtures, copy and tests the web phase touches

**File**: `apps/web/src/lib/api-types.ts`, `apps/web/src/test/fixtures.ts`, `apps/web/src/copy/audit.ts`, `apps/web/src/features/pipeline/pipeline-page.test.tsx`, `apps/web/src/features/instructions/instructions-editor.test.tsx`

**Intent**: Keep the hand-written types and fixtures in step with Phase 3 and label the new audit
area.

**Contract**: types for the pipeline view, stage-files body, instruction `kind`/`readBy`, run
`stageFiles`; audit area `stage_files: 'Stage files'`; the two existing test files move to the new
layout (sections by kind instead of scope regions, Make active instead of Roll back).

#### 2. Instructions page

**File**: `apps/web/src/features/instructions/InstructionsPage.tsx`, new `NewFileDialog.tsx`, `queries.ts`, `apps/web/src/copy/instructions.ts`

**Intent**: Separate instructions from documents and say who reads each file.

**Contract**: sections Instructions and Documents; columns File (+ one-line description), Scope,
Read by, Active, Draft. Descriptions from `copy.instructions.about` (per known key, modelled on
`prototype/js/data.js:94-121`, plus a `feature-map/` and a `prompt-` pattern). Unused files are
hidden behind a "Not used by any stage (N)" toggle. "New file" dialog: key, kind, scope (Global or
a repository), first version text, note → opens the editor.

#### 3. Editor versions

**File**: `apps/web/src/features/instructions/InstructionEditor.tsx`, `queries.ts`

**Intent**: Make active any non-active version; discard a draft; explain drafts.

**Contract**: history row action "Make active…" (signed, existing dialog) on every draft or
archived version; "Discard draft" (unsigned) next to Save as draft; hint above the history: a
draft changes nothing until it is made active.

#### 4. Run detail

**File**: `apps/web/src/features/runs/RunPage.tsx`, `apps/web/src/copy/runs.ts`

**Intent**: Show the stages that read each frozen file.

**Contract**: each row of "Instruction versions" adds the reading stages (from `run.stageFiles`).

### Success Criteria:

#### Automated Verification:

- Component tests: the Pipeline sheet shows a repository's copy version, inheritance and reset, and saves a signed change with `before`; stale shows the message: `pnpm --filter @pra/web test`
- Component tests: Instructions sections, Read by, unused filter, New file; editor Make active and Discard draft
- `pnpm verify` passes

#### Manual Verification:

- Settings → Pipeline with a repository picked shows the repository's files with versions
- Settings → Instructions reads clearly with real data (descriptions, Read by)

---

## Phase 5: e2e and docs

### Overview

One e2e spec over the whole path, then the docs that recorded the read-only decision.

### Changes Required:

#### 1. e2e

**File**: new `e2e/stage-files.spec.ts`, `e2e/support/env.ts`, `e2e/support/stack.ts`, `e2e/instructions.spec.ts`

**Intent**: Pick another rules file for Verify on one repository and see it used.

**Contract**: repository `stage-files-repo` (installation 55500041, level 3), PRs 1910-1919
(`STAGE_FILES_PRS`, number = from + `testInfo.retry`). The spec creates
`verify-rules-e2e-<retry>.md` (instruction, global; the retry suffix because a retry shares the
stack's database) with New file, makes v1 active (signed),
picks it for Verify on the repository in Settings → Pipeline (signed), sees "Overridden for this
repository", delivers a PR, waits for the round, sees Run detail list `verify-rules-e2e.md` read
by Verify, sees the verifier double received its text (a hold file the double writes from
`instructions/verify-rules.md`, like `lessonsFile`), and sees Settings → Instructions "Read by"
list Verify for the repository. `e2e/instructions.spec.ts:55-58` (region "Global" → the
Instructions section) adapts to the new layout; the a11y specs keep `[data-work-start]` on the
first section.

#### 2. Docs

**File**: `docs/03-design-decisions.md`, `context/foundation/prd.md`

**Intent**: Record the reversed decision and its reason.

**Contract**: row 2 of the step-1 answers, the non-goal at `prd.md:557` and FR-080 at `prd.md:385`
say: the diagram stays read-only, but a stage's instruction files are chosen in the stage sheet
(Alek, 20 Nov: try alternative rules for a stage without editing the file every repository
shares).

### Success Criteria:

#### Automated Verification:

- New spec passes: `pnpm test:e2e e2e/stage-files.spec.ts`
- Full e2e passes: `pnpm test:e2e`
- `pnpm verify` passes after `git merge main`

---

## Testing Strategy

### Unit Tests:

- Core: `defaultKindOf`, `instructionFileKeyProblem`, `resolveStageFiles` (default, global, repository override, reset to inherit, built in, all-markdown expansion), `missingInstructions` with assignments, `stageFileReaders`.
- DB: kind backfill SQL matches `defaultKindOf` over a key list; choice read/lock/write/delete; import kinds and skips.
- Worker: freeze; stage reads assigned file (verify, judge, analyst documents, reviewer knowledge dir); pre-check with an assigned missing file.

### Integration Tests:

- API route tests (Phase 3 list). Component tests (Phase 4 list). One e2e (Phase 5).

### Manual Testing Steps:

1. Pick workflowbuilder in Settings → Pipeline: Verify shows its repository copies with versions.
2. Create a rules file, make it active, pick it for one repository, start a review, check Run detail.
3. Discard a draft; make an archived version active.

## Migration Notes

The kind backfill runs once in the migration. Existing runs have `stage_files` null and read the
declared defaults. No stage choice rows exist after migrating, so behaviour matches today except
the reviewer's `knowledge/` (rules plus Markdown documents only). On the server, re-running the
import is not needed; the two JSON files stay as unused documents.

## References

- Task: `tools/orchestrator/prompts/stagefiles.txt`; INSTR decisions: `context/changes/INSTR/change.md`
- Freeze: `apps/worker/src/run/execute-stage.ts:323-345`; signed settings: `apps/api/src/settings/signed-change.ts`
- Prototype: `prototype/js/data.js:91-124`, `prototype/js/settings2.js:65-110`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data model, kinds and slot declarations

#### Automated

- [x] 1.1 Migration generated and applies — 0d58220
- [x] 1.2 Core unit tests for kinds and resolution pass — 0d58220
- [x] 1.3 DB tests for the migration's kind backfill, choice queries and import kinds pass — 41bd8be
- [x] 1.4 `pnpm verify` passes — 41bd8be

### Phase 2: Runs freeze the choice; stages read assigned files

#### Automated

- [x] 2.1 Worker test: a run freezes its stage files — phase 2 commit
- [x] 2.2 Worker test: Verify reads the assigned rules; the pre-check reports the assigned key — phase 2 commit
- [x] 2.3 Worker test: reviewer knowledge dir and analyst documents follow the assignment — phase 2 commit
- [x] 2.4 API test: gaps follow a repository override — phase 2 commit
- [x] 2.5 `pnpm verify` passes — phase 2 commit

### Phase 3: API

#### Automated

- [x] 3.1 API tests for the stage-files setting (signed, stale, validation, reset) — phase 3 commit
- [x] 3.2 API tests for pipeline scope, instructions kinds/readers, New file, Make active, Discard draft — phase 3 commit
- [x] 3.3 `pnpm verify` passes — phase 3 commit

### Phase 4: Web

#### Automated

- [x] 4.1 Component tests for the Pipeline sheet — phase 4 commit
- [x] 4.2 Component tests for Instructions page and editor — phase 4 commit
- [x] 4.3 `pnpm verify` passes — phase 4 commit

#### Manual

- [ ] 4.4 Pipeline with a repository picked shows its files with versions
- [ ] 4.5 Instructions page reads clearly with real data

### Phase 5: e2e and docs

#### Automated

- [x] 5.1 New e2e spec passes — phase 5 commit
- [x] 5.2 Full e2e passes — phase 5 commit
- [x] 5.3 `pnpm verify` passes after merging main — phase 5 commit
