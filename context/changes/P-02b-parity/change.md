---
change_id: P-02b
title: Parity check of packages/core against P
status: implemented
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-02b: compare each ported row of `packages/core/PORTING.md` with the P test it
cites (`~/Projects/wb-factory/test`, read only), fix core or its tests where they differ, and
mark parity per row. Plan: no; the brief's three steps are the plan.

## Decisions

- The full list is in `context/changes/P-02-domain-core/change.md` under "P-02b parity pass",
  next to the T1–T14 decisions it amends.
- Where core differed from P and the PRD and design docs were silent, core now follows P. Where
  the PRD or design docs decide otherwise, ours stays and the `PORTING.md` row cites the source.
- Three read-only subagents compared the P files in parallel (admin/autofix/levels, classify,
  control/review/runs/sync plus the slice files); every reported difference was checked against
  P and the docs before changing code.
