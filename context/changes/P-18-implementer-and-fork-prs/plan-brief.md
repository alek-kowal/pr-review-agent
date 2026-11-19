# Implementer and fork PRs — Plan Brief

> Full plan: `context/changes/P-18-implementer-and-fork-prs/plan.md`

## What & Why

At level 4 and above a signer can hand the findings decided as Implement to the implementer agent.
It edits only its own worktree; the result is a patch the team reviews per file, edits, reverts or
revises before any push. Fork PRs are reviewed only by hand and never run PR code.

## Starting Point

Core already knows the implementer run kind and the Fixing / Patch ready states, and the agents
package has the implementer adapter. There is no patch table, no worker executor for the
implementer stages, no API or UI for patches, and fork guards are scattered across stages.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Patch write | `runCompleted` hook, unique per run | cancel and redelivery never leave a stray patch |
| Revise | new implementer run | pause, budget, slots and cancel apply unchanged |
| Changed files | `GitMirror.worktreeChanges` + base and after blobs | API diffs without git |
| Stage key clash | per-kind executor map | `reproductions` already names the fix check |
| Fork guard | step-level `off` in the core plan | no single stage carries the guard |

## Phases at a Glance

| Phase | Delivers | Key risk |
| --- | --- | --- |
| S-13-T2 | gate, patch tables, loader | migration number clash at merge |
| S-13-T3 | worker runs, revise, patch check | worktree reuse across stages |
| S-13-T4 | API | decisions and run in one transaction |
| S-13-T5/T6 | form, banner, Patch tab | View new results for patches |
| S-13-T7 | e2e | stack double for the implementer |
| S-16-T1–T4 | fork policy end to end | stepper labels for skipped steps |

## Success Criteria (Summary)

- `implement-patch.spec.ts` and `fork-pr.spec.ts` pass; `pnpm verify` is green.
