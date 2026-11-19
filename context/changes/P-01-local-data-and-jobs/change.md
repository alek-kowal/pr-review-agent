---
change_id: P-01
title: Local data and jobs (F-02-T1 to F-02-T6)
status: in-progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-01 from `context/foundation/work-packages.md`: roadmap item F-02 (`local-data-and-jobs`),
tasks F-02-T1 to F-02-T6 in `context/foundation/roadmap-tasks.md#f-02-local-data-and-jobs`.
Plan: no. The tasks' "Done when" checks are the plan; one commit per task.

## Decisions

- Compose has a fixed project name (`name: pra`), so every worktree's `docker compose up -d db`
  reuses one `pra-db-1` container and one `pra_db-data` volume. Postgres runs with
  `max_connections=300` to leave room for parallel test runs.
- `.env.example` keeps names only; the local, non-secret compose URL
  (`postgres://pra:pra@localhost:5432/pra`) is documented in a comment above `DATABASE_URL`, so the
  "names only" rule from `AGENTS.md` still holds.
- `psql` is not installed on this Mac, so the T1 check ran through
  `docker compose exec -T db psql "<url>" -c 'select 1'` with the same URLs.
