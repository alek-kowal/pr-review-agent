---
change_id: P-06f
title: Stable Docker sandbox tests under load
status: implemented
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Follow-up to P-06. With several worktrees running `pnpm verify` at once, one Docker test in
`packages/integrations/src/sandbox/sandbox.docker.test.ts` sometimes failed and passed alone. No
plan: one test file changes.

## Decisions

- **The failing test**: `mounts read-only unless writable, and the root filesystem is read-only`
  (reproduced: it failed in 1 of 5 sandbox runs and in both parallel `pnpm test` runs, each time
  with `Test timed out in 5000ms`; the first test of the file timed out once too).
- **Cause: the time budget, not shared state.** The Docker tests ran under Vitest's 5 s default
  (meant for in-process tests), while their own runs declared a 60 s limit. Each container run is
  `docker create`, `docker start --attach` and `docker rm` on the one Docker daemon that every
  worktree's tests share. Measured: ~0.4 s idle, 2–4.6 s per run with two extra `pnpm test` runs in
  parallel (`create` and `start` each up to ~2 s). That test ran three containers in a row, so it
  needed 6–10 s under load. Ruled out: container names (random UUIDs), cleanup (a per-run label),
  temp dirs (`mkdtemp`), the image (already present; `docker pull` of one image is safe in
  parallel), and no code removes another run's `pra.sandbox` containers.
- **Fix**: one container per test (the mounts test is now three tests), one run limit for the file
  (`RUN_LIMIT_MS` = 30 s, the sandbox's own `timedOut` result), and a test budget of one run plus
  15 s for the CLI calls around it. Only this Docker suite changes; the 5 s default stays for
  every other test, and `DockerSandbox` itself is unchanged.
- **Proof**: 5 sandbox runs in a row while two `pnpm test` ran in parallel (machine load ~28 on 12
  cores): 5 of 5 passed; the slowest single-container test took 4.6 s, so even one run per test
  was at the edge of 5 s.

## Follow-ups (not in this change)

- Under the same load, two non-Docker tests timed out or failed in the parallel `pnpm test` runs:
  `apps/api/test/routes/team.test.ts` ("the first member signs as themselves…", 5 s timeout) and
  `apps/web/src/features/findings/Findings.test.tsx` ("groups findings by severity…").
