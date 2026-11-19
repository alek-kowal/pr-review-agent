---
change_id: P-27
title: Run on the Mikrus VPS (1 vCPU, 4 GB), several reviews in flight
status: implemented
created: 2026-11-19
updated: 2026-11-20
archived_at: null
---

## Notes

Orchestrator task P-27. Target: Mikrus `wojtek118`, unprivileged LXC (no KVM), Ubuntu 24.04,
1 vCPU, 4 GB RAM (about 3.5 GB free, no swap), 27 GB disk, Docker 29 (runc; gVisor does not work
there, see Decisions),
nginx on :80 behind the Mikrus proxy (Cytrus, TLS, routes `*.mikrus.dev` by `server_name`).
Nothing here connects to the VPS. One commit per step.

What exists today: the `run.stage` queue is worked with pg-boss's default one job at a time, so
two admitted runs (Settings `agentSlots`, default 2) still run their stages one after another.
Sandbox runs ask for `--cpus 2`, which Docker refuses on a 1-CPU host. The per-repository package
cache (`<DATA_DIR>/cache/<slug>`, pnpm store at `/cache/store`) already exists, but the install
step mounts it separately from the worktree, so pnpm cannot hardlink across the two mounts and
copies every package (about 1.5 GB of `node_modules` per run on WB).

## Plan

1. **Two limits.** `WORKER_AGENT_CONCURRENCY` (default 3): pg-boss `localConcurrency` of
   `run.stage`, i.e. stages in flight at once (they mostly wait for Claude).
   `WORKER_SANDBOX_CONCURRENCY` (default 1): `LimitedSandbox`, a FIFO semaphore around
   `Sandbox.run` shared by every caller in the process (fetch, install, Verify and fix-check
   reproductions, `patch.check`). Waiting honours the run's abort signal (cancel, timeout).
   Gates stay as they are: queue gate and slots (admission), budget, usage limit, chains.
2. **Sandbox resources.** `SANDBOX_CPUS` (1), `SANDBOX_MEMORY_MB` (2048), `SANDBOX_PIDS` (1024),
   `SANDBOX_FETCH_TIMEOUT_MINUTES` (10), `SANDBOX_INSTALL_TIMEOUT_MINUTES` (15),
   `SANDBOX_REPRO_TIMEOUT_MINUTES` (5), `SANDBOX_RUNTIME` (`auto` | `runc` | `runsc`),
   `SANDBOX_SHARED_STORE` (on). CPUs are capped at the daemon's `NCPU`. Shared store: before the
   install step the worker hardlinks the repository's store into a fresh `.pra-store-*` folder
   inside the worktree (same mount as `node_modules`), points pnpm at it and removes it after.
   Cleanup CLI for files of ended runs, old caches and mirrors of disconnected repositories.
3. **`pnpm sandbox:bench`** (`apps/worker/src/cli/sandbox-bench.ts`): clones the repository,
   runs its configured fetch and install (and an optional `--check` command) through the same
   `installDependencies` and limits as the worker; prints wall time and sampled peak memory.
4. **`deploy/mikrus/`**: Postgres in Compose on 127.0.0.1; api and worker as systemd services
   from the checkout's build; nginx site with a basic-auth gate; timers for backup, cleanup and
   health; `deploy.sh` (from the Mac, push over SSH, `--dry-run`); `bootstrap.md`.
5. **Docs**: README deploy section, `docs/deploy-mikrus.md`, `.env.example`, Needs Alek rows.

## Decisions

- **Limits from env, not Settings.** Both are process resources fixed when the worker
  subscribes to the queue (pg-boss `localConcurrency`); a Settings value would need a restart
  anyway. Settings → status chip `agentSlots` still decides how many runs are admitted; keep
  `WORKER_AGENT_CONCURRENCY` ≥ `agentSlots` or admitted runs wait for a free worker.
- **Sandbox limit per process, in memory.** One worker process runs on the VPS, so a semaphore
  is exact and needs no table. A stage waiting for the sandbox holds one of the stage workers;
  with slots ≤ concurrency every admitted run still has its worker, so nothing starves. The
  Checks stage's timeout (Settings → Review levels, default 30 min) includes this wait.
- **Shared store trade-off.** Hardlinked files are the store's files: a PR's install script
  that writes into `node_modules` in place changes the store copy, and later installs of other
  PRs of the same repository get the changed file. Bounded: the store is per repository (never
  shared across repositories), every sandbox has no network and no secrets, so a poisoned file
  can only change sandbox results (install outcome, reproductions) of that repository, never
  the worker, the host or a push (`node_modules` is ignored by git). Mitigations: the fetch step
  still runs no PR code; only files the fetch step wrote are linked back into the store;
  `npm_config_verify_store_integrity=true` makes pnpm re-hash a store file whose mtime changed,
  which catches accidental in-place edits (patch-package and the like) but not a script that
  also resets the mtime; the cleanup timer wipes a cache after `--cache-max-age-days` (7);
  `SANDBOX_SHARED_STORE=false` restores the copy mode. Read-only store files would not help:
  the container runs as the files' owner and may chmod them back. The automated security
  review flagged this; it stays on by default because the task asks for it, and Alek decides. Mounting one folder that holds the store
  and the worktree was rejected: it would expose other runs' worktrees of the same repository,
  which push patches come from.
- **systemd, not Compose, for api and worker.** The worker drives Docker for the sandbox with
  host paths of worktrees; in a container it would need the Docker socket and identical paths.
  Building images on 1 vCPU is slow and costs disk. systemd gives restart on failure and journald
  directly. Postgres stays in Compose (image already on the host, its own volume).
- **Code reaches the server by `git push` over SSH** into a bare repository there, so the
  server needs no GitHub credentials and deploys exactly the local commit.
- **runc with resource caps on Mikrus; gVisor only on a KVM VM later.** Tested on the VPS by
  the orchestrator (runsc release-20261116.0): `docker run --runtime=runsc` fails with
  `configuring device cgroup: loading device filter: operation not permitted`, because an
  unprivileged LXC cannot load the cgroup device BPF filter. The only workaround,
  `runsc --ignore-cgroups`, drops the memory and CPU caps this 1 vCPU / 4 GB box needs. It was
  rolled back; the server is clean. `pra.env` sets `SANDBOX_RUNTIME=runc`; bootstrap installs no
  gVisor. Recorded in `docs/deploy-mikrus.md`.
- **The deploy builds on the server, without a type check.** `remote-deploy.sh` (piped over
  SSH, so the deployed commit's own version runs) installs, builds api and worker with
  `tsc --noCheck` (the commit passed `pnpm verify`; a full check on 1 vCPU is slow and costs
  memory), builds the SPA into `web/releases/<commit>`, runs `pnpm db:migrate` before the restart
  (migrations stay a deploy step, never a start step), then swaps the `web/current` link. Three
  SPA builds are kept so open tabs still load their hashed assets. A lock file stops two deploys,
  and a deploy refuses to start below 2 GiB free.
- **All app settings in `/etc/pra/pra.env`, linked as the checkout's `.env`.** systemd reads it
  for the services, and the CLIs (`db:migrate`, `data:cleanup`, `sandbox:bench`) read the same
  file through `--env-file-if-exists=.env`, so a hand-run CLI never falls back to `.data`. The
  units set only what belongs to the process: `NODE_ENV`, `HOST`, `PORT`, `TRUST_PROXY`,
  `WORKER_HEARTBEAT_FILE`.
- **Health restarts one service, and root runs only `systemctl`.** `pra-health@api|worker`
  (user `pra`, every minute) fails when `/health` does not answer or the heartbeat is older than
  90 s, and `OnFailure` starts `pra-restart@<same>`, which restarts only that service (at most 3
  times in 30 minutes). A 503 (database down) is logged, not restarted: a restart would not help.
  A stopped service or one up for less than 90 s is skipped. Unit files are root-owned copies,
  never links into the checkout `pra` owns; sudo lets `pra` restart exactly the two services.
- **Sandbox containers left by a stopped worker are removed when the worker starts**
  (`ExecStartPre`, label `pra.sandbox`): one worker runs per host, so any such container is an
  orphan. The nightly cleanup also prunes stopped ones and dangling images.
- **Memory pressure order.** `OOMScoreAdjust` 300 for the worker (its Claude Code processes
  inherit it) and 100 for the api, so the kernel spares Postgres. No `MemoryMax`: cgroup limits
  in an unprivileged LXC are not reliable, and the sandbox has its own Docker cap. Defaults stay
  (3 stages, 2048 MB per container); docs name the levers once `sandbox:bench` has run on the
  real repository.
- **nginx gate details.** Only `location = /webhooks/github` skips basic auth (25 MB bodies, like
  the api's limit); `/health` stays behind the gate (the timers check it on loopback). nginx
  overwrites `X-Forwarded-Host` and drops `Authorization` so the api never logs the gate login.
- **nginx reads only the SPA builds.** `/srv/pra` is 711 and `web/` 755 (the deploy sets
  `umask 022`); `www-data` is not added to group `pra`, because the checkout's `.env` points at
  `/etc/pra/pra.env` (root:pra, 640) and the group could read the secrets.
- **`sandbox:bench` checked on the install fixture** (fetch 2.5 s / 68 MiB, install, store links,
  `--check`, exit 0). Shell scripts pass `bash -n` and shellcheck, the nginx template passes
  `nginx -t`, the units pass `systemd-analyze verify` (apart from node and Docker missing in the
  check container). Nothing connected to the VPS; the real run is Alek's P-27 row in
  `work-packages.md`.
- **Backups are on the same disk** (pg_dump custom format, 14 days). Copying them off the server
  is a manual step in the docs, not automated: that would need a second host or account.
