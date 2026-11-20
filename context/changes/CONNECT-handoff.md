# CONNECT handoff

- Done (3 commits): 9130fe8 repro e2e, 419551f connect fix, f611b3b board "Refresh from GitHub".
- Cause and decisions: `context/changes/CONNECT/change.md`.
- Cause: the connect form's leave guard stayed up during navigation; after a deploy the route
  chunk 404s, TanStack reloads the page, and the browser asks "Reload site?".
- Fix: once connected the form unmounts first, then an effect opens `/settings/repositories`
  with the toast "<name> is connected." No `ignoreBlocker`.
- Left: final `pnpm verify` and full `pnpm test:e2e`. They have not run on the whole branch yet.
- `git merge main` is done (already up to date at 53e3de6). Merge again if main moved.
- Already passing: web unit tests (repositories, board, integrations), the API integrations
  route test, e2e `github-polling` (5 tests, `--no-deps`) and `connect-repo.spec.ts`.
- `pnpm lint` (eslint + prettier) is clean on the changed files; the full lint has not run.
- The API gained `poller.running` (lease held) in `GET /api/settings/integrations`.
- The new e2e repos `acme/connect-{from-list,after-deploy}-<retry>` are in `e2e/support/stack.ts`.
