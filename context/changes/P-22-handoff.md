# P-22 handoff

- Done: S-14-T1 (8fafa59), T2 (8a8651b), T3 (558a9ac), T4 (02b56fb), T5 (92ca534). Main (with the
  P-18 review) merged in d6193d3; review items O1/O3/O6/O9 recorded in change.md (O3 applied:
  `canPush` refuses `pr_closed`). `pnpm verify` green (1494 tests), full `pnpm test:e2e` 77 passed.
- Left: S-15-T1 (not started, nothing uncommitted), S-15-T2, T3, T5, S-19-T9. Follow `plan.md`
  phases 6–10; Progress boxes 1.1–5.1 are ticked.
- S-15-T1 starting points: core `autofixDecision` / `pushByItself` and reason codes in
  `packages/core/src/autofix.ts`, `reasons/autofix.ts`; `DEFAULT_AUTOFIX_MAX_PATCHES` and level 5
  `autofixMaxPatches` in `levels.ts`. Add `autofixCheck(point, input)` (act ≥5, shadow 3–4, off
  below; push adds fork + per-chain cap), the two tables (`pnpm db:generate --name autofix`), and
  bot-signed decisions (`decision_batches.signed_by` nullable + `actor`, left join in
  `currentDecisions`).
- Know: push job `handlePatchPush` (`apps/worker/src/run/push.ts`) with `signedBy: null` = autofix
  push (`autofix_pushed` timeline kind); queue it with `sendPushJob(queue, patchId, null)`.
- e2e: `push-repo` (level 4, PRs 265–267) has a bare remote, git-compare and green CI in
  `StackGitHub`; the sandbox double treats committed `// Fixed:` lines as patched; the
  implementer hold skips the push repo. Autofix e2e needs its own repos (level 5, level 3).
- Write files only with Write/Edit (no sed/heredocs). Worker tests: `node:child_process`.
