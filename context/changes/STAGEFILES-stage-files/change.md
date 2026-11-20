---
change_id: STAGEFILES-stage-files
title: Choose each stage's instruction files in Settings → Pipeline; instructions vs documents
status: implementing
created: 2026-11-20
updated: 2026-11-20
archived_at: null
---

## Notes

Orchestrator task STAGEFILES. Alek (20 Nov) wants to try alternative rules for a stage without
editing the one file every repository shares, so the pipeline stops being read-only for the
choice of instruction files. Seen on the deployed app: the Pipeline sheet said "no active
version" for files the import put at repository scope; Settings → Instructions mixed agent
instructions with reference material; version history offered no "Make active" for a draft and
no "Discard draft".

Workflow: `/10x-plan` → `/10x-plan-review` → `/10x-implement` (one commit per phase) →
`/10x-impl-review`. Nobody answers questions tonight: each choice a skill asks for is taken
here under Decisions.

## Decisions

Taken during `/10x-plan` (complexity HIGH; the recommended option each time, nobody to ask).

1. **Slots are declared in `packages/agents/src/pipeline.ts`** as asked; core holds only the slot
   types, `resolveStageFiles`, the `@built-in` sentinel and which stages require prompt and rules,
   because core may not import `@pra/agents` and the pre-check and gaps need one rule.
2. **Choices live in a new table `stage_file_choices`** (repository null = global; `prompt`,
   `rules`, `documents`; null = inherit). There is no generic settings table, and per-slot null
   columns match `sameJson`, which treats null as absent.
3. **Choices are keyed by the pipeline stage key** (`analyst`, not `analyse`); core holds the one
   map from `INSTRUCTION_STAGES`.
4. **The reviewer's default documents are all Markdown documents**, expanded when the run starts.
   Today's behaviour stays (feature maps, lessons, repository knowledge), while
   `review-levels.json` and `review-profiles.json`, which no code uses, show as "Not used by any
   stage" without deleting them.
5. **The reviewer's rules file is written to `knowledge/review-rules.md` whatever file is
   assigned**, the way the verifier, implementer and analyst adapters already name their rules, so
   a stored `prompt-reviewer.md` that names `review-rules.md` keeps working.
6. **The analyst gets a `documents` slot** (default `lessons.md`), rendered as
   `knowledge/<key>`; judge, verify and implement get prompt and rules only; fix_check stays built
   in with no slots.
7. **The new route requires `before`** (other settings routes default it to the stored value), so
   a stale save always gets 409.
8. **"Make active" is one `/activate` for any non-active version**; `/rollback` and its button go.
9. **Discard draft deletes the draft, or archives it when a trial or run references it** (the FKs
   cascade, and `saveInstructionDraft` already archives such drafts). Discarding a file's only
   version removes the file too. Unsigned, like Save as draft, so no `settings_changes` row.
10. **New file** creates a global or repository file with v1 as an unsigned draft; keys may not
    start with `@`; a key that exists at another scope must keep its kind.
11. **"Read by"** for a global file lists the global choice's readers plus every repository
    override that names the key, with the repository's slug; a repository copy lists that
    repository's readers.
12. **A run still freezes every resolved file version**; only the stage → files map is new
    (`runs.stage_files`). Run detail shows the reading stages per frozen file.
13. **e2e proof of use:** the verifier double copies the `instructions/verify-rules.md` it
    received into a hold file (like `lessonsFile`), and Run detail shows the file read by Verify.

Taken during `/10x-plan-review` (verdict REVISE, all seven findings fixed in the plan; report in
`reviews/plan-review.md`):

14. **Old API fields and routes go with the web switch** (Phase 4), not in the API phase: the
    web's types are hand-written and its tests stub fetch, so an early removal would break the app
    without failing `pnpm verify`.
15. **At Global scope the Pipeline sheet names the repositories that hold a copy** of a slot file
    with no global file, so the deployed data (files at repository scope) explains itself.
16. **A choice may outlive its file**; the sheet then shows "(no active version)" and the run
    reports the file missing, like any other missing file.
