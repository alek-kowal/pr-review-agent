# P-06 handoff

- Done: plan (`context/changes/P-06-sandbox-and-adapters/{plan,plan-brief,change}.md`, Decisions there). No task finished.
- Partial (commit d1f044e, `wip`): S-04-T1. Written: `packages/integrations/src/sandbox/{sandbox.ts,docker-sandbox.ts,index.ts}`, `src/testing/sandbox.ts` (`FakeSandbox`), barrel exports. Not yet typechecked or linted.
- Left for S-04-T1: `sandbox.test.ts` (args via `dockerCreateArgs`, not configured with a missing docker binary) and Docker-gated `sandbox.docker.test.ts` (skip with printed reason; label containers `pra.sandbox.test=<uuid>` and check cleanup by that label; image `node:24-slim`, already pulled locally). Then `pnpm verify`, commit `feat(S-04): ...`.
- Then in order: S-04-T2, S-04-T4, S-05-T1, S-06-T1, S-06-T2, S-13-T1 (contracts in plan.md phases 2–7).
- S-04-T2 is verified by hand (see Decisions): fetch step with network + writable worktree + writable cache; install step `--network none`, cache read-only; commands as `sh -c 'mkdir -p /tmp/bin && corepack enable --install-directory /tmp/bin && <cmd>'` with env `HOME=/tmp`, `PATH=/tmp/bin:/usr/local/bin:/usr/bin:/bin`, `COREPACK_HOME=/cache/corepack`, `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`, `npm_config_store_dir=/cache/store`. WB fetch: `pnpm fetch --frozen-lockfile --ignore-scripts --ignore-pnpmfile`.
- Fixture for install.test.ts: package.json (`packageManager: pnpm@10.12.1`, dep `is-number@7.0.0`, postinstall `node probe.mjs` writing `postinstall-network.txt`) and its lockfile exist in the session scratchpad only; regenerate with `corepack pnpm install --lockfile-only` in `node:24-slim`.
- `@anthropic-ai/sdk` ^1.10 is already in `@pra/agents` (judge uses `messages.create` + `output_config.format` json_schema, `effort: 'low'`).
- Agent SDK: under `permissionMode: 'dontAsk'` `canUseTool` is never called; implementer uses `'default'` + `canUseTool`, all roles get a PreToolUse path-guard hook.
- Migration for `pr_task_links` (S-06-T2): generate last; renumber if P-05/P-07 land one first.
- `pnpm install` was run in this worktree; `docker compose up -d db` (pra-db-1) is running.
