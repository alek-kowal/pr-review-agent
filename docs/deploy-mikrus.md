# Deploy on the Mikrus VPS

How the app runs on the Mikrus VPS (P-27): 1 vCPU, 4 GB RAM (about 3.5 GB free, no swap),
27 GB disk, Ubuntu 24.04 in an unprivileged LXC container (no KVM), Docker 29 with runc, nginx
on :80 behind the Mikrus proxy (TLS, picks the site by `server_name`). The one-time setup is
[deploy/mikrus/bootstrap.md](../deploy/mikrus/bootstrap.md); every release after it is
`deploy/mikrus/deploy.sh`. The Compose deploy in [deploy/README.md](../deploy/README.md) stays
the option for a bigger VM.

## What runs where

```
browser ──https──▶ Mikrus proxy ──http──▶ nginx :80 ─┬─ /, /assets   SPA from /srv/pra/web/current
GitHub  ──https──▶ (same)                            ├─ /api, /health        ─┐ basic-auth gate
                                                     └─ /webhooks/github ────┴▶ api 127.0.0.1:3000
                                                                (no gate, signed by GitHub)
api, worker: systemd services (user pra) from the checkout /srv/pra/app
worker ──▶ Docker (runc) sandbox containers ──▶ worktrees in /var/lib/pra/data
Postgres 17: Docker Compose, 127.0.0.1:5432, volume pra-mikrus_pg-data
```

- **nginx** serves the SPA build, gates everything with one shared login (htpasswd) and proxies
  the api paths. Only `POST /webhooks/github` skips the gate: GitHub cannot send the login, and
  the api checks each delivery's signature (`GITHUB_WEBHOOK_SECRET`). nginx overwrites
  `X-Forwarded-Host`, and the api trusts it only from loopback (`TRUST_PROXY=loopback`), so the
  CSRF check compares `Origin` with the real host. `/api/live` (server-sent events) is not
  buffered.
- **api and worker** are systemd services, not containers: the worker hands host paths of
  worktrees to Docker for the sandbox, and building images on 1 vCPU is slow and costs disk.
  They restart on failure; `pra-health@api` / `pra-health@worker` (every minute) restart a
  service whose `/health` does not answer or whose heartbeat is older than 90 s. A 503 from
  `/health` (database down) is logged, not restarted. At most 3 health restarts in 30 minutes.
- **Postgres** runs in Compose with its own volume, on loopback only.
- **Timers**: `pra-backup` (03:30, `pg_dump` custom format to `/var/backups/pra`, 14 days kept),
  `pra-cleanup` (04:15, `pnpm data:cleanup`, stopped `pra.sandbox` containers, dangling images).
- **Logs**: `journalctl -u pra-api -u pra-worker`; journald is capped at 500 MB.

## Sandbox runtime: runc, not gVisor

gVisor was tried on this VPS (runsc release-20261116.0) and does not work: `docker run
--runtime=runsc` fails with `configuring device cgroup: loading device filter: operation not
permitted`, because an unprivileged LXC container cannot load the cgroup device BPF filter. The
only workaround, `runsc --ignore-cgroups`, drops the memory and CPU caps this box depends on.
So on Mikrus the sandbox uses runc with resource caps (`SANDBOX_RUNTIME=runc`), and gVisor waits
for a KVM VM. Do not install gVisor on Mikrus. With runc a container shares the host kernel;
what stays: no network, no secrets, a memory, CPU and process cap, and its own worktree mounts.

## Limits

All from `/etc/pra/pra.env`, read once at start (restart the worker after a change). Defaults
in brackets.

| Name                                                  | What                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `WORKER_AGENT_CONCURRENCY` [3]                        | Stages in flight at once; they mostly wait for Claude. Keep it ≥ Settings' agent slots |
| `WORKER_SANDBOX_CONCURRENCY` [1]                      | Sandbox containers at once (install, reproductions, patch checks)   |
| `SANDBOX_CPUS` [1], `SANDBOX_MEMORY_MB` [2048], `SANDBOX_PIDS` [1024] | Per container; CPUs are capped at the host's     |
| `SANDBOX_FETCH_TIMEOUT_MINUTES` [10], `SANDBOX_INSTALL_TIMEOUT_MINUTES` [15], `SANDBOX_REPRO_TIMEOUT_MINUTES` [5] | Per step |
| `SANDBOX_RUNTIME` [auto]                              | `runc` on Mikrus (above)                                            |
| `SANDBOX_SHARED_STORE` [true]                         | Hardlink the repository's pnpm store into installs; `false` copies  |

Memory budget, worst case: Postgres about 250 MB, api 150 MB, worker 200 MB plus up to 3 Claude
Code processes of 250–400 MB, one sandbox container up to `SANDBOX_MEMORY_MB`, nginx, Docker and
the system about 300 MB: just over 4 GB with the defaults. That is fine while installs stay well
under their cap; measure first (below). If memory runs out, the kernel kills the worker's
processes first (`OOMScoreAdjust`), then the api, before Postgres. Levers, in order:
`SANDBOX_MEMORY_MB` to the measured install peak plus 30 %, then `WORKER_AGENT_CONCURRENCY=2`
(and agent slots 2).

## Measure

`pnpm sandbox:bench` runs a repository's fetch and install (and an optional `--check` command)
through the worker's own install code and limits, and prints wall time and peak memory per
step. On the server, as `pra`:

```sh
cd /srv/pra/app
pnpm sandbox:bench --repo <git url or mirror path> --slug <connected repository slug>
pnpm sandbox:bench --repo <url> --install 'pnpm install --offline --frozen-lockfile' \
  --fetch 'pnpm fetch --frozen-lockfile --ignore-scripts' --check 'pnpm -r build' --fresh
```

`--fresh` empties the bench's package cache first (cold install); run it twice to see the warm
one. A container step that fails or times out makes the bench exit 1 and prints its output.
Restarting the worker removes running sandbox containers, the bench's too.

## Deploy

`deploy/mikrus/deploy.sh [--ref <commit>] [--dry-run]` from your machine (settings in
`deploy/mikrus/deploy.env`, names in `deploy.env.example`):

1. pushes the commit over SSH to `/srv/pra/repo.git` (branch `deploy`), so the server needs no
   GitHub access and gets exactly that commit;
2. pipes `bin/remote-deploy.sh` of that commit to the server, which checks it out, runs
   `pnpm install --frozen-lockfile`, builds api and worker without a type check (the commit
   passed `pnpm verify`), builds the SPA into `web/releases/<commit>`, runs `pnpm db:migrate`,
   switches `web/current`, restarts api and worker and waits until both are healthy.

A deploy refuses to start with less than 2 GiB free. Restarting the worker interrupts running
stages: pg-boss waits up to 30 s, then the rest are sent again. Deploy when the board is quiet,
or pause the queue in the app first. Roll back with `--ref <older commit>`; migrations only go
forward, so roll back code only across additive migrations. The last three SPA builds stay on
disk so open tabs still load their assets.

## Operate

| Task                 | Command (on the server)                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| Status               | `systemctl status pra-api pra-worker`; `systemctl list-timers 'pra-*'`           |
| Logs                 | `journalctl -u pra-worker -f`; health restarts: `journalctl -u 'pra-health@*'`   |
| Restart              | `systemctl restart pra-worker` (root)                                            |
| Back up now          | `systemctl start pra-backup`                                                     |
| Restore              | `docker exec -i pra-mikrus-db-1 pg_restore -U pra -d pra --clean --if-exists < /var/backups/pra/<file>.dump` (stop api and worker first) |
| Free disk            | `systemctl start pra-cleanup`; `sudo -iu pra sh -c 'cd app && pnpm data:cleanup --dry-run'` |
| Change settings      | edit `/etc/pra/pra.env`, then `systemctl restart pra-api pra-worker`             |

Backups sit on the same disk as the database: copy them off the server now and then
(`scp -P <port> pra@<host>:/var/backups/pra/*.dump .`).

## Security notes

- The worker and the timers that touch Docker run with the `docker` group, which can do
  anything on the host that Docker can. That is the price of a host-run sandbox driver; the
  worker runs no PR code itself, only inside sandbox containers.
- Unit files are root-owned copies, and `pra-restart@` (root) runs only `systemctl`, never a
  file from the checkout. `pra` may restart exactly the two services through sudo, nothing else.
- The shared pnpm store trade-off (one repository's installs can change files later installs of
  the same repository see) is described in `context/changes/P-27/change.md`.
