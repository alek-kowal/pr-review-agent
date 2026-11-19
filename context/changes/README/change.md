---
change_id: README
title: A README for PR Review Agent
status: in progress
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
