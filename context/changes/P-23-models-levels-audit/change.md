---
change_id: P-23
title: Models, levels and audit log (S-21-T1–T8, S-20-T5)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-23 from `context/foundation/work-packages.md`, wave 8. Plan: no; the tasks'
"Done when" checks are the plan. One commit per task, in the listed order.

## Decisions

### S-21-T1 (level and model settings in core and db)

- Core already had the ladder, inheritance (`resolveLevel`), `DEFAULT_MODELS` and the model-name
  check from P-02. `resolveLevelSettings(n, overrides, roleModels)` (new `level-settings.ts`)
  builds on `resolveLevel` and adds what Settings needs: what the level adds, its own values,
  origins and every role's model (`RunModels`). `levelModelOverrides` feeds the Models page note.
- Storage follows the task: tables `level_settings` (level 1–6, own values as jsonb) and
  `model_settings` (role, model). The migration adds the six empty level rows and the five default
  models (a model already in `app_settings.models` moves over), then drops `models` from
  `app_settings`. The hand-written inserts sit at the end of `0014_level_model_settings.sql`; if
  the migration is regenerated after a merge, copy them back.
- The global default level lives in `app_settings.defaultLevel` (default 1). The repository's
  `defaultLevel` is now nullable (null = global default); `prLevel` takes the global default, and
  the PR view's `repositoryDefault` is the effective default. Settings → Repositories offers
  "Global default" in the level Select; a newly connected repository starts with it.
- `modelFor` no longer skips a set but invalid name: the run that would use it fails before any
  spend (`model_invalid`, S-21-T2) instead of quietly running another model.
- Tests that write level or model settings use their own database (the tables are global).
