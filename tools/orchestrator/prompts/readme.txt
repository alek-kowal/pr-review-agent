Task {{ID}}: a great README for PR Review Agent.

You are a fresh session in your own git worktree and branch (task/{{ID}}). Other packages run in parallel in other worktrees. Read AGENTS.md first.

Goal: replace the current README.md with a README a developer at Synergy Codes enjoys opening: clear in 30 seconds, good-looking on GitHub (light and dark theme), and true to the code.

1. Research first, briefly. Look at a handful of the best-regarded READMEs on GitHub (for example from well-known open source projects and "awesome README" lists) and note the ideas worth borrowing: hero banner, one-line pitch, badges, a short "how it works" diagram, screenshots or a GIF, feature grid, quick start, collapsible details. Write 5-8 bullet points of what you took and from where into context/changes/{{ID}}/change.md. Use WebSearch/WebFetch; read only, no sign-ups.
2. Learn what the product really is from context/foundation/ (PRD, roadmap), docs/ and the code. Every claim in the README must be true today; mark planned things as planned.
3. Graphics, all stored in the repo under docs/assets/readme/ (no hot-linked third-party images, no services that need an account or token):
   - A hero banner as hand-written SVG, with light and dark variants via <picture> and prefers-color-scheme.
   - A "how a PR gets reviewed" flow as a Mermaid diagram (GitHub renders it) or an SVG.
   - Real screenshots of the app (board, PR view with findings, settings), captured with Playwright against the e2e test stack and its doubles (e2e/support). Put the capture script under e2e/ as a separate Playwright project or script (for example `pnpm readme:shots`) that normal `pnpm test:e2e` does not run. Use your own test repository name and a PR-number range no other spec uses. Compress images; keep all README assets under about 3 MB in total.
   - Badges only from GitHub itself (Actions status badge) or static shields.io badges that need no token.
4. Layout: centered hero, one-line pitch, badges, a short "Why", "How it works" diagram, screenshots (a small gallery or <details>), features, quick start (from AGENTS.md commands), architecture overview (apps and packages), configuration (env var names only, never values), development, and links to docs/. Keep it scannable; prefer tables and short lines.
5. Verify with `pnpm verify` (lint covers prettier for markdown), and `pnpm test:e2e` only if you touched e2e config. Check the README renders: no broken relative links or image paths (write a quick check or list them in change.md).

Rules from the orchestrator:
- Write and change files only with the Write/Edit tools, never with shell heredocs or sed -i. Shell commands are for running tools.
- Before the final verify, merge main into your branch (`git merge main`); resolve conflicts so both sides survive.
- Commit once per step (Conventional Commits, ending with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>). Do NOT push, merge or rebase. The orchestrator merges.
- Project documents are in English. Ask nothing unless truly blocked.
- Context budget: the orchestrator measures your context and may tell you to stop. Then commit, write context/changes/{{ID}}-handoff.md with what is left (at most 15 lines), and stop.
Never:
- create external accounts, apps or keys, or use a service that needs one
- write to, run anything from, or send requests (other than GET) to ~/Projects/wb-factory*, :4300 or :4400. Reading those folders is allowed.
- add a runtime fake mode
Final reply: Polish, at most 4 lines. Say whether it is done or handed off, and the verify result.
