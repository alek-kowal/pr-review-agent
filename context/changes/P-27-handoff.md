# P-27 handoff

Done (plan and decisions in `context/changes/P-27/change.md`):
- Step 1 (017fccf): `WORKER_AGENT_CONCURRENCY` (3) = `run.stage` localConcurrency, `LimitedSandbox` (`WORKER_SANDBOX_CONCURRENCY` 1), `SANDBOX_*` caps and timeouts, CPUs capped at NCPU, `SANDBOX_RUNTIME`; tests `apps/worker/test/concurrency.test.ts`, `packages/integrations/src/sandbox/profile.test.ts`.
- Step 2 (4f4688f, a251593): shared pnpm store hardlinked into the worktree (`.pra-store`, checked with real Docker); `pnpm data:cleanup`; `.env.example` names.

Left, partial first:
1. Step 3 `sandbox:bench` (wip 7ac0777): add `"sandbox:bench": "node --env-file-if-exists=.env apps/worker/src/cli/sandbox-bench.ts"` to root package.json; in `apps/worker/test/sandbox-bench.test.ts` change the 3 `toContain` row strings to the real layout (`'fetch               0        2 min 03 s   800 MiB'`, `'install             timeout  15 min 00 s  -'`, `'store links (host)  -        4.1 s        -'`); typecheck the CLI; try it on `packages/integrations/src/testing/fixtures/install-repo` with `--install`.
2. Step 4 `deploy/mikrus/`: compose.yaml (postgres:17 on 127.0.0.1, volume), systemd units for api/worker (User=pra, EnvironmentFile=/etc/pra/pra.env, NODE_ENV=production, `node --import ./dist/instrument.js dist/main.js`, worker in docker group, DATA_DIR/BLOB_DIR absolute, WORKER_HEARTBEAT_FILE), nginx site template (basic auth, `location = /webhooks/github` without auth, `/api/` `/webhooks/` `/health` to :3000, SSE `proxy_buffering off`, `X-Forwarded-Host $host`, TRUST_PROXY=loopback), timers (pg_dump backup with retention, `data:cleanup` + docker prune of `label=pra.sandbox` and dangling images, health), `deploy.sh` (git push over SSH to a bare repo, `--dry-run`, host/port/key from env), `bootstrap.md`, `docs/deploy-mikrus.md`. Validate with shellcheck/`bash -n`; never connect.
3. Step 5: README deploy section, Needs Alek rows in `context/foundation/work-packages.md` (subdomain, `.env`, `claude setup-token`, webhook URL, gate password, deploy.sh, bench on WB).
4. `git merge main`, `pnpm verify`, set change.md status, final commit.

Know: the existing `deploy/compose.yaml` stays as is; Mikrus decisions (systemd, git push deploy) are in change.md. Security review flagged the shared store; trade-off and mitigations are recorded, default stays on.
