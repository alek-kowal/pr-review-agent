---
change_id: P-07
title: Team, signatures and Settings shell (S-02-T1, S-20-T1, S-02-T3, S-02-T5, S-20-T2, S-02-T8)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-07 from `context/foundation/work-packages.md`: Team, the signature field, the
signed-settings change log and the Settings shell with save bar. Tasks in order: S-02-T1, S-20-T1,
S-02-T3, S-02-T5, S-20-T2, S-02-T8 in `context/foundation/roadmap-tasks.md`. Plan: no; the
tasks' "Done when" checks are the plan. One commit per task.

## Decisions

- **One audit log** (work-packages "Decisions made while grouping"): S-02-T1 adds no
  `audit_events` table. Team changes are logged in `settings_changes` (S-20-T1) instead.
- `team_members.id` is a uuid, because core's `Actor` names a member by a string id and
  `runs.started_by_member_id` is already text. The GitHub login is unique among active members
  case-insensitively (`unique index on lower(github_login) where removed_at is null`), so a
  removed member frees their login. Removal is soft; `decision_batches.signed_by` keeps the row,
  so past signatures keep their name.
- `finding_decisions` has one more column than the task names: `version`, the finding's version
  right after the batch. Undo compares it with the finding's current version, so "undo only while
  none of the batch's findings changed since" (S-02-T4) needs no extra query or table.
- `decideFindings(db, …)` and `undoDecisionBatch(db, …)` take a client or a transaction and open
  their own transaction (a savepoint inside a caller's transaction), so they are atomic either
  way. They lock the findings `for update` in id order (no deadlock between two batches), compare
  versions after the lock (READ COMMITTED re-reads the winner's row), and on a conflict write
  nothing and return each moved finding with its current decision and signer name. Findings of
  another PR give `not_found`. Undo bumps the versions too, so a form opened before it conflicts.
- The current decision is read in JS from the non-undone batches, newest batch id first; there
  are only a few batches per finding.
- `settings_changes.actor` is `member`, `bot` or `hand` (core `ACTOR_KINDS`) with `signer_id`
  set exactly for `member` (check constraint); `area` and `entity` are free text, so a new area
  needs no migration.
- `applySignedSettingsChange(db, { store, entity, before, after, signer, signAsCreated?, note? })`
  lives in `apps/api/src/settings/signed-change.ts`. The task's signature has no way to read or
  write an area, so each area passes a `SettingsStore` (`read` locks the current value, `write`
  applies `after`; `teamStore` is the first). It returns a result, not an HTTP reply: `{ ok: false,
  status, code, params }` for `signature_required`, `signer_unknown` and `settings_stale` (409,
  with the stored value as `params.current`). `before` is compared as JSON, ignoring key order and
  treating a missing field as null. Saving what is stored writes no row (`change: null`).
- The first Team member signs as themselves through `signAsCreated`, checked inside the same
  transaction: refused with `signature_required` once Team has an active member.
- Team api lives at `apps/api/src/routes/api/team` (the existing `/api` routes folder), not
  `routes/team`. Team changes are logged in `settings_changes` (area `team`, entity = member id)
  through `applySignedSettingsChange`, not in an `audit_events` table. `POST` signs as the new
  member while Team is empty and ignores `signedBy` then. `PATCH` and `DELETE` take an optional
  `before`; when sent, an edit made in between gives 409 `settings_stale`. `DELETE` answers 204.
  GitHub logins drop a leading `@` and must be a valid GitHub login; an empty ClickUp user is
  stored as null. Unknown or removed member: 404 `team_member_not_found`.
- The signature is split in three: `useLastSigner` (`pra.lastSigner`, every storage access in
  try/catch), `useSignature()` (team query, prefill while the member is still in Team, `remember()`
  for after a successful submit) and `SignatureField` (the Combobox, shown with
  `signature={useSignature()}`). A form owns its signer, so it can block submit without one.
  shadcn `button`, `input`, `label`, `popover`, `command` (new dependency `cmdk`), `dialog` and
  `alert-dialog` were written by hand from the shadcn sources (no network registry run), with
  copy-free close labels passed by the caller.
- With an empty Team the field shows a plain link to `/settings/team` in S-02-T5, because that
  route is built later in the package (S-02-T8 switches it to a router `Link`).
- Settings registry (`apps/web/src/features/settings/registry.ts`): `settingsPages` lists built
  pages only (id, route path, icon); `SETTINGS_PAGE_IDS` holds the approved groups and order, so
  registration order does not matter and labels come from `copy.settings.pages`. Each page stays
  its own file route `routes/settings.<id>.tsx`; the layout route `settings.tsx` renders the
  sidebar and an `Outlet`, and `/settings` redirects to the first registered page (a placeholder
  while none is). The group is named "General" as in the task, not the prototype's "Factory".
- The leave guard lives in `SaveBar` (TanStack `useBlocker` with a resolver, plus `beforeunload`),
  so every page with a SaveBar asks before leaving with unsaved changes. `useSettingsForm(saved,
  fields)` gives the draft, `changes` (before/after rows) and `discard`. `SignedSaveDialog` mounts
  its form per opening, refuses confirm without a signer, keeps the dialog open with the api
  error's copy when the save fails, and remembers the signer only after success.
