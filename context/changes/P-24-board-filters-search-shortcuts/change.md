---
change_id: P-24
title: Board filters, search and shortcuts (S-17-T1–T9)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-24 from `context/foundation/work-packages.md`, wave 8. Plan: no; the tasks' "Done
when" checks are the plan. One commit per task, in the listed order.

## Decisions

- **T1 card exceptions.** The card gets `isFork`, `level { number, repositoryDefault }` (the level
  the next round starts at) and `round { number, max }` (completed rounds of the chain). The web
  shows the level badge `L<n>` only when it differs from the repository default, the round label
  only from round 2 on, the repository only when several are connected (as before), and a Fork
  badge on forks (the prototype's exception badges). The author and the age never shrink; the
  round label and the repository truncate first.
- **T2 age tie-break: longest waiting first.** "Then by age" in an urgency sort reads as: among
  equal ranks, the PR opened first is the most urgent. This replaces P-08's newest-first order
  inside each group (its api test now expects oldest first). Core gets `actionNeededRank` and the
  comparator `byUrgency` in `urgency.ts` (not in the hot `pr-state.ts`); the api and the web lane
  both sort with it, so the lane is right whatever order the api sends.
- **T3 `person` is the member's GitHub login** (`?person=kasia`): readable in a shared link and
  unique among active members. Authored = the PR's author login matches (case-insensitive);
  signed = `prsSignedBy(memberId)` for every member, removed ones included, with that login.
- **T3 `prsSignedBy` unions** decision batches, opinions, reviews, answers, sensitive file
  approvals, signed review starts (`runs.started_by_member_id`), task links and every signed
  timeline entry. Merges from the app are timeline entries (`pr_merged`, actor member), and so
  will pushes be, so S-14 needs no change here.
- **T3 level filter** compares the level the next round starts at (`input.level`, the level the
  card shows), applied after loading because it needs the repository default. The other filters
  are SQL conditions in `boardPullRequestIds`. Filters also narrow the merged/closed list.
- **T4 filter controls.** Person is a Popover + Command combobox (the SignatureField pattern) over
  active Team members; a login in the address that is not in Team shows as `@login`. The Filters
  Popover uses native `<select>`s (as the prototype does) and the shadcn Checkbox. The board
  response gains `repositories` (slugs) for the Repository select, so the board needs no call to
  Settings. An invalid value in the address is dropped, not shown as an error. The previous
  board stays on screen while a new filter loads (`keepPreviousData`).
- **T5 search** (`searchPullRequests` in `@pra/db`): every word of the query must match the
  number (`272` or `#272`), the title or the author (GitHub login or active Team name),
  case-insensitively, with LIKE wildcards escaped. An exact number comes first, then open PRs,
  then the newest; at most 20. Merged and closed PRs are found too.
- **T5 palette.** The palette filters People, Settings and Actions itself (`shouldFilter: false`)
  because PRs come from the server; the first item is selected whenever the list changes, so
  "272" + Enter opens #272. A person opens the board filtered to them (`/prs?person=<login>`).
  The Actions registry is `features/palette/actions.ts` (Pause opens the status chip; Start
  review opens the PR header's popover through a window event, like `open-status-chip.ts`).
  Actions run after the dialog has closed (`onCloseAutoFocus`), so the popover they open keeps
  the focus; otherwise focus returns to where it was, or to the top-bar Search button.
- **T5 `CommandDialog` and `Kbd`** were added to `components/ui` (shadcn), with the title and
  description passed in, so the primitives hold no copy. The TopBar test now allows the Search
  and theme buttons in the top bar (still no account menu).
- **T6 the focused finding** is the line last moved to with `j`/`k` or focused by any means
  (click, Tab, the Decide action). It gets a brand border (`data-current`). `j`/`k` start at
  the first finding shown and stop at the ends; the other keys need a focused finding. `x`, `w`,
  `n`, `i`, `r` and `d` work only while the PR can be decided, the same rule as their buttons.
- **T6 decision forms move up to the list.** Which form is open on which finding now lives in
  `FindingList` (`DecisionFormsContext`, `decision-forms.ts`), so `i`/`r`/`d` open a finding's
  form after expanding it; the form stays open if the finding is collapsed and opened again.
  Enter confirms through the form's own rule: the focused submit button for Implement, the
  reason box for Reject and Defer.
- **T6 Kbd hints sit inside the buttons**, as in the prototype's `Btn kbd`: Implement…,
  Reject…, Defer to ClickUp…, Worth implementing and Not worth it show their key in a `Kbd`
  (`aria-hidden`, plus `aria-keyshortcuts`), so the accessible names do not change. No hover
  tooltip primitive was added.
- **T6 global keys** live in `ShortcutsDialog` (root layout): `?` opens the list; `g` then `p`
  or `a` within 1.5 s goes to Pull requests or Activity. The palette's "Show keyboard
  shortcuts" opens it through a window event (`open-shortcuts.ts`). Key names come from the
  same maps the buttons use (`DECISION_KEYS`, `OPINION_KEYS`).
- **T7 the theme is a class on `<html>`**: `dark` or `light` (`features/theme/theme.ts`). The
  CSS keeps a `prefers-color-scheme` block for `:root:not(.light)`, so the system theme shows
  even before the script runs; `data-theme` is gone. The dark values were already in
  `index.css` (copied from `prototype/styles.css` in P-01); the shadcn variables only point at
  WB tokens, so they need no dark block. `theme.test.tsx` checks both points against the file.
- **T7 storage** key `pra:theme`; reads and writes are in try/catch. When storage fails, the
  choice holds in memory until reload. `main.tsx` applies the theme before the first render; no
  inline script in `index.html`, so a stored choice that differs from the system can flash for
  one frame on load. With no stored choice, a change of the system theme follows live.
- **T7 toggle** is an icon button between Search and the status chip (Moon → dark, Sun →
  light, named "Switch to the dark/light theme"); the palette action "Toggle theme" does the
  same. Sonner gets the app's theme instead of `system`.
