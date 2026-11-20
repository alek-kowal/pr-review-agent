# Stage files — Plan Brief

> Full plan: `context/changes/STAGEFILES-stage-files/plan.md`

## What & Why

Each agent stage's instruction files become a choice in Settings → Pipeline (global, with an
optional repository override), and instruction files split into instructions (what an agent is
told) and documents (reference material). Alek wants to try alternative rules for a stage without
editing the one file every repository shares.

## Starting Point

Stages hard-code their file keys; the pipeline sheet is read-only and looks up global files only,
so repository-scope files show "no active version". Instructions and reference files sit in one
list, and the editor cannot make a draft active from the history or throw a draft away.

## Desired End State

The Pipeline sheet has a scope picker and per-slot pickers with the resolved version, inheritance
and reset, saved as a signed change. A run freezes its stage → files map and every stage reads it.
Settings → Instructions shows Instructions and Documents with "Read by" and descriptions, hides
unused files, and creates new files. Every non-active version can be made active; a draft can be
discarded.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Where slots are declared | `packages/agents/src/pipeline.ts`; core holds types, resolution, sentinel | Core may not import agents, and api/worker/gap checks need one rule |
| Storage | New table `stage_file_choices` (repository null = global; prompt, rules, documents) | No generic settings table exists; null columns read naturally as "inherit" |
| Built in | Sentinel `@built-in` for the reviewer prompt | `sameJson` treats null as absent, so "built in" must be a value |
| Reviewer default documents | All Markdown documents, expanded at freeze | Keeps today's behaviour while the two unused JSON files show as unused |
| Rules file name in `knowledge/` | Always `review-rules.md`, whatever file is assigned | Stored prompts name it; the other adapters already do the same |
| Freeze | `runs.stage_files` jsonb, written with the frozen versions | Same transaction and trial path as `freezeRunInstructions` |
| Stale check | `before` required on the new route | The task requires a real 409 |
| Make active | One `/activate` for drafts and archived versions; `/rollback` removed | One signed action covers both |
| Discard draft | Delete, or archive when a trial/run references it | FKs cascade; trials and run history must survive |
| New file | Global or repository scope, v1 as an unsigned draft | Matches Save as draft; activation stays signed |
| "Read by" | Global choice + repository overrides (with slug) | A global file picked by one repository must not look unused |

## Scope

**In scope:** kinds + migration backfill, import map kinds/skips, slots and choices, signed
setting, freeze, worker stages and pre-check, gaps, scoped pipeline API and sheet, Instructions
sections/Read by/descriptions/filter/New file, Make active, Discard draft, Run detail readers,
tests, docs.

**Out of scope:** editable diagram, per-level choices, changing which versions a run freezes,
deleting files, level copies in New file, fix_check slots.

## Architecture / Approach

core (kinds, `resolveStageFiles`) → db (`instruction_files.kind`, `stage_file_choices`,
`runs.stage_files`) → agents (`PIPELINE_STAGES[].slots`, `stageFilesFor`) → worker (freeze in
`startStageInTx`, `stageFilesOf` in each stage) → api (`PUT /api/settings/stage-files/:stage`,
`GET /api/pipeline?repository=`, instructions routes) → web (Pipeline sheet, Instructions page,
editor, Run detail).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data model | Kinds, choices table, frozen column, slots, import map | Migration backfill regex vs core rule |
| 2. Worker | Freeze + stages read assigned files | Reviewer `knowledge/` change breaks prompts |
| 3. API | Signed setting, scoped pipeline, instructions routes | Response shape churn for the web |
| 4. Web | Scope picker, slot editor, two sections, version actions | Many copy strings, component tests |
| 5. e2e + docs | One spec over the whole path; decision docs | e2e flakiness under load |

**Prerequisites:** Postgres up (`docker compose up -d db`), main merged before the final verify.
**Estimated effort:** ~5 phases, 1-2 sessions.

## Open Risks & Assumptions

- The reviewer's stored prompt may name files other than `review-rules.md` that are no longer in
  `knowledge/` (prompts of other stages); documents stay, so the risk is small.
- Kinds of the same key at different scopes are kept equal by copying the kind; New file refuses a
  conflicting kind.

## Success Criteria (Summary)

- Alek picks another rules file for one stage on one repository and the next run uses it, visible
  in Run detail.
- The Pipeline sheet shows real versions for a repository's files.
- Instructions and documents are separate, and unused files are out of the way.
