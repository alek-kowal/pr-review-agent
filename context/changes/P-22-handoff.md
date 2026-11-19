# P-22 handoff

- Done: S-14-T1–T5, S-15-T1 (350098d), S-15-T2 (46ba492). Main already merged (nothing new then).
- Partial: S-15-T3 (c84276b, wip). In: core `Patch.waiting: Reason | null`, banner
  `state_autofix_waiting { reason }`; db `autofixWaitingOf` + `statePatch` fill it; web
  `copy/autofix.ts` (reason phrases, Timeline rows incl. `patch_pushed`/`patch_push_refused`),
  wired into `nextStep.ts`, `timeline.ts`, `copy/index.ts`. Not run yet: `pnpm verify` for T3.
  Left: `apps/web` `autofix-banner.test.tsx` (each reason code → sentence), `apps/api`
  `timeline-autofix.test.ts` (seed `recordAutofixAttempt`/`recordShadow` with `at`, GET
  `/api/prs/<slug>/<number>/timeline`, rows in time order, actor bot; see `test/routes/timeline.test.ts`).
  Then commit T3 as `feat(S-15-T3)` (the wip commit stays), tick plan 8.1/8.2, add T3 decisions.
- Then: S-15-T5 (e2e `autofix.spec.ts`, own repos at level 5 with a sensitive pattern, and level 3),
  S-19-T9 (Trust ladder shadow: use `shadowByRepository`), plan phases 9–10.
- Know: attempts/shadow writers add their bot Timeline entries themselves; the push job records
  `pushed`/`waiting` attempts when `signedBy` is null. Decisions so far are in change.md.
- Full `pnpm verify` under load can time out web tests; rerun the package alone to confirm.
