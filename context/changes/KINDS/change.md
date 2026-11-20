---
change_id: KINDS
title: Show instructions apart from documents wherever the app lists instruction files
status: implemented
created: 2026-11-20
updated: 2026-11-20
archived_at: null
---

## Notes

Orchestrator task KINDS. Alek opened Run detail and saw "Instruction versions" as one list that
mixed prompts and rules with 14 feature maps. STAGEFILES already split the two kinds in Settings →
Instructions and the Pipeline sheet; this change applies the split to every other list.

## Decisions

1. **No migration.** A run frozen since STAGEFILES holds each file's `kind`. For an older run the
   API reads the kind of the file now (`instruction_files.kind`, through the version id), else
   core `defaultKindOf` for the name (the version was deleted). `kind` is now required in
   `GET /api/runs/:id`.
2. **One shared piece**: `features/instructions/kinds.ts` (`groupByKind`, instructions first) and
   `KindGroup.tsx` (heading "Instructions (5)"; documents fold in a native `<details>` when there
   are more than 5). Headings come from `copy.instructions.kindTitles` / `kindCount`.
3. **Run detail** keeps the card "Instruction versions" and holds two named lists. A row links to
   its file's editor (`fileId`; runs before S-22 hold none and show plain text) and still names the
   stages that read it ("Read by Verify").
4. **Insights → Quality** listed every frozen version in one table, so documents drowned the
   rules. It is now "Per file version" with one table per kind; the API's version label carries
   the file's kind. Runs with no version recorded stay with the instructions.
5. **The editor** names its file's kind in a badge next to the scope.

## Places checked

| Place | Lists instruction files? | Result |
| --- | --- | --- |
| Run detail (`features/runs/RunPage.tsx`) | yes, frozen versions | split (3) |
| Insights → Quality (`features/insights/QualityTab.tsx`) | yes, a row per version | split (4) |
| Instruction editor (`InstructionEditor.tsx`) | one file; history lists runs, not files | kind badge (5) |
| Settings → Instructions, New file, Pipeline sheet | yes | already split (STAGEFILES) |
| `features/trials/TryOnPrDialog.tsx` | no: one draft, a list of PRs | unchanged |
| Experiments, Compare (`features/trials`) | no: a list of trials, each names its one draft; one diff | unchanged |
| Start review warning, Settings "Missing instruction files", failed-round and judge reasons | only required prompts and rules (documents are never required) | unchanged |
| PR page, round views, Findings tab | no: only a link to Settings → Instructions on a missing-file failure | unchanged |
| Activity, timeline entries, Audit log | no file lists (the audit names one changed file) | unchanged |
| Insights Overview, Cost, Trust, shadow log | no | unchanged |
| Learning | no: always `lessons.md` | unchanged |

## Tests

- API: `runs.test.ts` (kind from the frozen value, the file, the name), `insights-quality`.
- Web: `run-detail.test.tsx` (split, links, fold), `insights-cost-quality.test.tsx`,
  `instructions-editor.test.tsx` (badge).
- e2e: `stage-files.spec.ts` and `instructions.spec.ts` read the Instructions list.
