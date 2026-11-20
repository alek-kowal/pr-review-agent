# FORKS: the Pull requests board hides fork PRs by default

## What changed

- `/prs` without `forks` in the address hides fork PRs. `forks=all` shows every PR, `forks=only`
  only forks. A bad value, and the old `forks=hide`, fall back to the default (hidden), so old
  links keep working.
- Filters → Forks has three choices: Hide forks (default), Show all, Only forks.
- While the default applies, "Forks hidden" stands next to the Filters button with a "Show forks"
  button (sets `forks=all`).
- "Clear filters" returns to the defaults, so forks are hidden again.

## Decisions

- **The API is unchanged; its default stays "all".** `GET /api/board` still takes
  `forks=hide|only`, and no param lists every PR. Nothing in the code asked for another default,
  and other readers of the API keep their result. The web maps the address to the request in
  `boardApiQuery`: no `forks` → `forks=hide`, `all` → no param, `only` → `forks=only`. So the
  request always matches the screen.
- **The default is not a set filter.** No other filter has a default that counts, so "hide" adds
  nothing to the `Filters · n` count and does not show "Clear filters". `all` and `only` count as 1.
- **A hint without a number.** The board response has no count of hidden forks; getting one needs
  a second query, which the task rules out. The hint says "Forks hidden" only.
- **Links to the board** (Cmd+K person → `/prs?person=…`, the `g p` shortcut, the top bar, the PR
  page's back link) carry no `forks`, so they land with forks hidden. None needed a change. Alerts
  and Activity link to PR pages, not to the board.
- The lane's empty text stays "Nothing matches the filters." only when a person set a filter.

## Tests

- `apps/web/src/features/board/filters.test.ts`: missing param → hide, `all`, `only`, bad values.
- `board-filters.test.tsx`: the three choices, the hint, the count, Clear filters.
- Web tests that stub the default board now stub `/api/board?forks=hide`.
- `e2e/fork-pr.spec.ts`: the fork PR is off the board by default and on it after "Show forks".
  `e2e/smoke.spec.ts` routes the board request with its query.
