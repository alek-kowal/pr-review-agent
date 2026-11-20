---
change_id: CONNECT
title: Connect a repository lands on the list; Refresh from GitHub on the board
status: implemented
created: 2026-11-20
updated: 2026-11-20
archived_at: null
---

## Report

On the deployed app (token mode), Settings → Repositories → Connect a repository by name, then
Connect in the dialog: the server answered 201, but the browser asked to reload the page, and the
page after the reload looked like the connect form again. Expected: no prompt, the list with the
new repository.

## Cause

Two things met:

1. **The leave guard stayed up after a successful connect.** The connect page's `SaveBar` always
   counts at least one unsaved change (nothing is stored before the connect), and the page left
   with `navigate(..., { ignoreBlocker: true })` while the form was still mounted. `ignoreBlocker`
   only skips the router's own blocker; the guard's `beforeunload` handler stayed registered until
   the next route had loaded and the form unmounted.
2. **The router reloads the page when a route's code is missing.** Routes are code-split
   (`autoCodeSplitting`). After a deploy, an open tab still asks for the old chunk names; nginx
   serves only the current release, so the chunk is a 404 and TanStack's `lazyRouteComponent` calls
   `window.location.reload()` (once per session). That is the only `location.reload` in the
   bundle. With the guard still up, the browser turned the reload into its "Reload site?" prompt.

Reproduced in e2e (token mode) by answering the next route's chunk with a 404: the old code showed
a `beforeunload` dialog. Without a missing chunk the dev and production builds both navigated
fine, which is why no test saw it. The old landing page, `/settings/repositories/<id>`, shows
the same form as the connect page, which explains "back on the connect page" after the reload.

## Decisions

- **Fix the guard, not the reload.** Once the connect succeeds the page shows a short status line
  instead of the form, so the form and its `SaveBar` unmount and their guard is gone; an effect
  then navigates (passive effects of the unmounted save bar run first). No `ignoreBlocker` any
  more: had a guard survived, the router would block and the tests would see its dialog. A
  missing chunk after a deploy still reloads the page, now silently.
- **Land on the list** (`/settings/repositories`) with a toast "<name> is connected." The
  status line also hides what the refetched queries say after the connect (the App's list no
  longer offers the repository; a lookup would say "already connected").
- **Other signed saves checked, no change.** Models, Integrations (settings and poll schedule),
  Alerts, Review levels, a level, Budget and a repository's own page stay on their page after a
  save, and their mutation updates or refetches the saved values before the dialog closes, so the
  form resets and the guard counts 0. Only the connect page navigated with a forced count.
- **e2e:** two tests in `github-polling.spec.ts` with their own repositories
  (`acme/connect-from-list-<retry>`, `acme/connect-after-deploy-<retry>`) record every dialog with
  `page.on('dialog')`. The second opens the connect page directly and answers the list route's
  chunk once with a 404, as after a deploy; with the old code it records `beforeunload`.
- **Not done here (deploy):** keeping the previous release's `/assets` reachable for a while would
  avoid the reload after a deploy. It is harmless now, so it stays a possible follow-up.

## Board: Refresh from GitHub

- **Only without the App** (`useGitHubReadOnly`), in the board header's right corner:
  "Updated <n> min ago" (the last poll's end, as of the last fetch, like the cards' ages), the
  button, and the last poll's error as one line (`pollErrorText`, shared with Integrations).
- **Data from `GET /api/settings/integrations`**, as Settings → Integrations reads it; in token mode
  it makes no GitHub request. Refetched each minute, every 2 s while busy. No new endpoint, no
  migration (`github_poller` has no live trigger).
- **The API gains `poller.running`** (the lease is held now). Timestamps alone would read a crashed
  poll as running until the next one; a lease runs out.
- **Busy** while Poll now is in flight, while a poll holds the lease, and after a click until
  `lastFinishedAt` differs from the one seen at the click (no clock comparison between browser
  and server). That wait ends during a rate-limit backoff (the poll would not start) and after
  60 s in any case.
