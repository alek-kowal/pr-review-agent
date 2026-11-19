# P-23 handoff

- Done (one commit each): S-21-T1–T8. main (P-11r) merged cleanly before T4. Decisions per task in `context/changes/P-23-models-levels-audit/change.md`.
- Left: only S-20-T5 (retire the WB seed). No code written yet; working tree clean.
- S-20-T5 findings so far: `packages/db/seeds/workflowbuilder.json` is the only WB config in source; move it to a test fixture (e.g. `packages/db/src/testing/fixtures/`) and repoint `packages/db/src/seed.test.ts:20` and `seed-clickup.test.ts:13`. Update AGENTS.md:32 (seed example) and add a "Connect a repository" section (Settings → Repositories).
- `scripts/check-repo-agnostic.ts`: no `scripts/` dir yet; root tsconfig/vitest don't include `scripts/`. Add it to `pnpm lint` in root package.json, plus `check-repo-agnostic.test.ts` (fails when a WB name is added under `apps/worker/src`).
- Names to ban outside tests/fixtures/testing: `workflowbuilder`, `workflow builder`, `synergycodes`, `wb-factory`. Do NOT ban bare `WB`: `WB-123` is the ClickUp task id example in copy/docs comments, and `index.css` says "WB design tokens"; `apps/worker/src/handlers/github-comment.ts:2` and `packages/core/PORTING.md:3` mention WB/wb-factory (reword or allow-list).
- Exclude from the scan: `*.test.ts(x)`, `test/`, `testing/`, `fixtures/`, `e2e/`, `node_modules`.
- Last checks: T4–T8 tests, lint and typecheck of touched files green; `pnpm test:e2e models-levels-audit.spec.ts settings-team.spec.ts` passed. Full `pnpm verify` and full `pnpm test:e2e` not run yet after T4–T8: run both before the final commit.
- Final commit: delete this file; change.md must get an S-20-T5 Decisions section and `status` updated.
