---
change_id: README
title: A README for PR Review Agent
status: done
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Replace the missing root `README.md` with one a developer reads in 30 seconds: centered hero,
one-line pitch, badges, why, how it works, screenshots, features, quick start, architecture,
configuration, development and links to `docs/`. All graphics live in `docs/assets/readme/`.

## Research: what we borrowed and from where

- **Light and dark hero through `<picture>`** (Excalidraw, tRPC): a hand-written SVG banner with a
  `(prefers-color-scheme: dark)` `<source>`. GitHub documents the markup in its changelog
  (github.blog/changelog/2022-05-19-specify-theme-context-for-images-in-markdown-beta); Supabase's
  older `#gh-dark-mode-only` fragments are not used.
- **A short, centered badge row** (Excalidraw, tRPC have about five; Cal.com's six-plus is noise):
  CI status from GitHub Actions plus static shields.io badges for Node, pnpm and TypeScript only.
- **Proof before prose** (tRPC's demo GIF, Excalidraw's captioned figure): one large board
  screenshot under the pitch, the rest in a small captioned gallery.
- **A "how it works" diagram** (Supabase's architecture section): a Mermaid flow from "ready for
  review" to the signed decision and merge, which GitHub renders natively
  (docs.github.com/…/creating-diagrams).
- **Features as a table or checklist, one line each** (Supabase's `- [x]` list with a link per
  item): a two-column feature table that says what ships today and marks planned work.
- **Copy-paste quick start in about five commands** (tRPC), with the deep setup handed to a
  separate guide (Excalidraw → here `AGENTS.md` and `docs/`).
- **`<details>` for long, optional material** (Cal.com collapses its manual database setup): the
  env var table and "connect a repository" stay collapsed.
- **GitHub alert callouts** (Cal.com's `> [!NOTE]`): one note for "Postgres must be up".

Pitfalls avoided: very long READMEs with duplicated steps (Cal.com), default secrets in the README,
hot-linked third-party images, heavy GIFs.

## Decisions

- **Truth today.** Claims come from the PRD, the merged work packages on `main` and the code.
  After merging main (P-21), levels 1–3 and 6 are "Yes"; levels 4 and 5 (P-18 implementer, P-22
  push and autofix), read-only fork PRs and a hosted deploy are "Planned". Chains with fix checks
  are not claimed: round 2 needs the bot's own push (P-22). When P-18 or P-22 merges, flip their
  rows in the level table and the "On the roadmap" line.
- **Screenshots** (`pnpm readme:shots`): `playwright.readme.config.ts` reuses the e2e config's
  webServer (the test stack and its doubles) with `testDir: e2e/readme` and `testMatch:
  *.readme.ts`, so `pnpm test:e2e` never runs it. Own repository `acme/readme-demo` (level 3,
  installation 55500010, green CI) seeded in `e2e/support/stack.ts`; PR numbers `README_PRS`
  80–89, used by no spec and below `FAILING_PR_FROM`. The Agents working card is a review held by
  `hold-82`, written after the other rounds finish (holding it earlier slowed the others past a
  minute). Each shot is 1440 wide at 1x, clipped below the content, in light and dark through
  `emulateMedia` (the app follows the system theme). Run detail was dropped: the doubles show
  "0 s" stages.
- **Assets** (`docs/assets/readme/`, about 0.9 MB in total): two hand-written SVG hero banners
  (the app's logo, its colour tokens, a system font stack because GitHub serves SVG as an image)
  and eight PNG screenshots, 65–155 KB each.
- **Badges**: GitHub Actions CI (the repository is private: the badge shows for people with
  access) and static shields.io badges for Node, pnpm, TypeScript and PostgreSQL. No license badge:
  the repository has no license file.
- **Mermaid**: GitHub renders it with its own light or dark theme, so the diagram sets no colours.
  It could not be rendered locally (no Mermaid package here, and loading it from a CDN was not
  allowed); the syntax uses only flowchart features GitHub's Mermaid supports, and node ids avoid
  keywords.

## README link check

A throwaway script (not committed) read every `](…)`, `src`, `srcset` and `href` in `README.md`
and checked each relative path exists and each `#anchor` matches a heading: 9 anchors, 15
documents and folders, 10 images, all resolve. External: the CI badge and its workflow link, and
four static shields.io badges.

## Verify

After merging main: `pnpm verify` passed (214 test files, 1369 tests); `pnpm test:e2e` passed (71
passed, 1 skipped by the a11y spec's own condition) and did not run `shots.readme.ts`;
`pnpm readme:shots` passed.
