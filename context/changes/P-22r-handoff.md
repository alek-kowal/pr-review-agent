# P-22r handoff (impl-review of P-22 "Push, autofix and shadow log")

Done (one commit each, `git log c7084a9..HEAD`; main merged in 534ecd5, README only):
- Push job retry: a landed push is finished, not refused as head_moved (new `GitMirror.patchCommit`); redelivery repeats `expectOwnFix`.
- `[remote rejected]` (branch protection, signed-commit rulesets) → `push_rejected` refusal + Timeline, not lost.
- Autofix push holds on pause/budget (hook and job); start holds `rounds_used` at a chain's last round; forced change type wins; shadow push keeps a held start's reason; PR lowered below 5 → shadow at start, `autofix_level_lowered` at push; the bot's push job re-runs the push rule and refuses a person-edited patch (`autofix_patch_edited`); started-attempt guard; recovery runs `autofixOnPatchReady`.
- Tests: head_moved push test isolated; moved-head Timeline assertion.

Left (partial task first):
1. Write `context/changes/P-22-push-autofix-shadow/review.md` (IMPL-REVIEW-REPORT format, like P-18's): findings above as F1..F10, FIXED with SHAs; set P-22 `change.md` status `impl_reviewed`.
2. Observations to list: P-18 O1 fallback in `sendRefusal` remains (all codes mapped); Insights `shadowByRepository` unbounded in 14 days; push-dialog test uses 12 for both numbers; timeline-autofix test inserts `autofix_pushed` by hand; signer hard-deleted → push attributed to bot (unreachable); `git add --all` drops gitignored patch paths.
3. Needs Alek: S-14-T6 real GitHub smoke; repos whose rulesets require signed commits will refuse the bot's push (`push_rejected`); PRD Q3 signer in GitHub.
4. Not yet run: `pnpm verify` and `pnpm test:e2e` (web copy changed). Targeted unit tests (core, worker autofix/push-job/implementer-run, integrations push-patch) and typecheck passed.
