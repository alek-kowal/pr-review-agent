# Brief: WB Factory design as a clickable HTML prototype

## Goal

Design the production WB Factory UI as a **clickable HTML prototype**. Alek's bar is **an extremely intuitive UI with great UX**:
- Every step of every flow is obvious: what is happening now, what comes next, and whose move it is.
- In the admin area, every element is where a user would look for it first.

The prototype is the spec for the React build that follows. Its job is to settle the UX, not to be production code.

## What is already decided

- **Product:** an internal tool for the Synergy team. One organisation, a few to a dozen developers plus a lead, our own repos. No multi-tenancy.
- **Architecture and stack:** see `01-analysis.md` §3–4. The production UI will be React with shadcn/ui (Radix + Tailwind), so the prototype should use a visual language that maps onto shadcn components.
- **Live progress:** shown over SSE. The PR page uses a compact stepper for the run; the read-only diagram (React Flow) lives in admin.
- **Real mode only:** never design or mention a "fake agents" mode.

## Inputs

Read these first:
- `~/Projects/wb-factory-prod/docs/01-analysis.md`:
  - **§5 Input for design** in full: roles, screen inventory, admin inventory, 25 UX problems, proposed navigation (Inbox · Pull requests · Activity · Insights · Settings), screen list, 5 key flows.
  - **§1 Process map** and **§2.4 Domain rules**: what the UI must represent.
- The old versions, for reference only:
  - `~/Projects/wb-factory-wb/screenshots/`
  - the live apps at http://localhost:4300 and http://localhost:4400

  Rules for the live apps:
  - GET only.
  - Never press anything that starts a review, trial, analyst, implementer, push, merge or ClickUp task. Those cost money and act on real PRs.
  - Don't open `/admin/file*` pages. Their GETs can write version rows (§0 of the analysis).

## Step 1: ask Alek before designing

Ask these 5 questions in one go. They come from §6 of the analysis.

1. UI language: Polish (as today) or English (as WB)?
2. Editable pipeline diagram in the product (e.g. as a WB showcase), or read-only diagram plus structured settings?
3. Level 5 (autofix) and level 6 (learning after a PR closes) in v1, or later?
4. Should findings reach authors in GitHub (PR comments), or stay in the app only?
5. Who answers the reviewer's questions, decides on findings, merges and starts paid runs: the PR author, or only the lead?

## Step 2: agree on the structure before building screens

Show Alek a short proposal and wait for his OK:
- the navigation,
- the screen list with one line per screen,
- the key flows as numbered steps.

Start from §5.5 and §5.6 of the analysis. Change them only where the answers to step 1 require it.

## Step 3: build the prototype

- **Location:** `~/Projects/wb-factory-prod/prototype/`. Every screen must be clickable end to end through the key flows.
- **Data:** realistic sample data modelled on real runs (PR sizes, findings, costs and durations from the analysis).
- **States:** cover every state the UI can be in, not just the happy path:
  - nothing to do,
  - review running with live progress,
  - questions waiting,
  - findings to decide,
  - failed or timed-out stage with a retry,
  - budget paused,
  - ready to merge,
  - merged/closed.
- **Process:** before writing the UI, load the `frontend-design` skill. When Alek wants a link to share, publish the prototype as a private Artifact.
- **Writing:** UI copy in the chosen language. Talk to Alek in Polish, simply. Design docs stay in English.
- **Presentation:** present the prototype as a whole. Don't mark what is new or changed compared to the old versions.

## Done when

Alek can click through all 5 key flows and the admin area without asking "where is X?" or "what happens now?". Record decisions and open points in `~/Projects/wb-factory-prod/docs/03-design-decisions.md`.
