---
change_id: P-04
title: Data model and PR page (S-01-T1 to T3, S-01-T12 to T14)
status: in-progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-04 from `context/foundation/work-packages.md`: roadmap item S-01
(`first-review-round`), tasks S-01-T1, T2, T3, T12, T13 and T14 in
`context/foundation/roadmap-tasks.md#s-01-first-review-round`. Plan: no; the tasks' "Done when"
checks are the plan. One commit per task.

## Decisions

- Ids are `integer generated always as identity`, as in F-02's `smoke` table. Enumerations are
  `text` columns with a Drizzle `enum` type and a `check` constraint, not Postgres enums, so later
  packages add a value with a plain migration and no `alter type`.
- `repositories.config` holds the whole core `RepositoryConfig`; `slug` and `github_full_name` are
  copied from it into their own unique columns. Writes go through `parseRepositoryConfig` (throws
  `RepositoryConfigInvalidError`, code `repository_config_invalid`); reads go through
  `readRepositoryConfig` (`parseWithFallback`, so one broken field falls back with a warning).
  `getRepositoryByFullName` compares case-insensitively (GitHub names are).
- `pull_requests.opened_at` and `updated_at` are GitHub's dates. `upsertPullRequest` writes only
  when a field differs (`on conflict ... do update ... where (...) is distinct from (...)`) and
  returns `{ created, changed }`, so S-01-T6 can leave an unchanged PR alone.
- `recordGithubEvent` is `on conflict (delivery_id) do nothing` and returns the stored row with
  `created: false` on a redelivery, which S-01-T5 needs for "202, still one row and one job".
- `app_settings` is one row with `id = 1` (check constraint). `getAppSettings` reads a missing row
  as the defaults; `ensureAppSettings` inserts them once.
- `instruction_versions`: a unique constraint `NULLS NOT DISTINCT` on (scope, repository, file,
  version), a partial unique index allowing one `active` version per file (`coalesce` on the
  nullable repository id), and a check that global rows have no repository and repository rows
  have one. `importInstructionV1` never overwrites an existing version 1; newer content is S-22's
  job (a new version), not the seed's.
- `pnpm db:migrate` was checked twice on a throwaway database (`create database`, migrate, migrate,
  `drop`), never on the shared `pra` database, so other worktrees' dev data and migrations are
  untouched.
