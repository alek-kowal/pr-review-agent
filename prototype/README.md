# WB Factory: clickable prototype

The UX spec for the React + shadcn/ui build. It settles what each screen shows, what comes next and whose move it is. It is not production code.

## Open it

Double-click `index.html`. No build step, no server.

- It needs the internet once, for fonts and four pinned libraries: Preact 10.24.3, htm 3.1.1, Lucide 0.454.0, Tailwind play CDN 3.4.17.
- Nothing else is called: no LLM, no GitHub, no ClickUp. Every run is simulated in the browser and costs nothing.
- Demo state is kept in `localStorage` (also the theme and the last signature name). **Reset demo** in the Prototype guide (dashed chip at the right end of the top bar) brings everything back. State older than 6 hours is reseeded on load.
- A simulated round takes about 15–25 s. The durations and costs it shows are realistic (about 2.5 min and $1.30 per round). The four runs seeded on the board move slowly on purpose, so those states stay visible for several minutes.

## Route map

| Route | Screen |
|---|---|
| `#/prs` | Pull requests board. Person is always visible; Repo, Forks, Level and Hide drafts sit in the **Filters** popover. All of them are in the URL: `?person=kasia&repo=workflowbuilder&forks=hide\|only&level=3&drafts=hide` |
| `#/pr/272` | PR detail. `?tab=findings\|questions\|patch\|timeline` |
| `#/runs/r272-1` | Run detail. `?tab=stages\|transcript` |
| `#/activity` | Active alerts (with failed runs and Retry), one In progress table (running and queued), Finished today (collapsed) |
| `#/insights/overview` · `/cost` · `/quality` · `/trust` | Insights. Overview = the five pilot metrics (`docs/06-metrics.md`); filters `?range=14&person=kasia&repo=…` |
| `#/settings/budget` · `/models` · `/team` · `/integrations` · `/alerts` | Settings → Factory |
| `#/settings/repos` · `/repos/workflowbuilder` | Settings → Repositories |
| `#/settings/review-levels` · `/review-levels/3` | Review levels: ladder and one level |
| `#/settings/instructions` · `/instructions/review-rules` | Instructions: list and editor |
| `#/settings/pipeline` | Read-only pipeline diagram |
| `#/settings/experiments` · `/experiments/<trial>` | Trials and Compare |
| `#/settings/learning` · `#/settings/audit` | Learning, Audit log |

Every PR state is on the board at once:

| State | PR | State | PR |
|---|---|---|---|
| Draft | #281, #256, #38 | Waiting for the fix | #265 |
| Never reviewed (fork) | #274, #266 | Fixing | #271 |
| Queued | #253 | Patch ready | #263 |
| Round 1 running | #277 | Autofix waiting (sensitive file) | #268 |
| Fix check running | #270 | New commits since last review | #239 |
| Questions waiting | #272, #76 | Automatic rounds used (3 of 3) | #250 |
| Findings to decide | #269, #39 | Stage failed | #262 |
| Sensitive files changed | #264 | Ready to merge | #252, #251, #278, #40 |
| Merged / closed | #260, #258 (under the board) | | |

## Flows, click by click

The dashed, monospace controls ("PROTOTYPE") stand in for what happens in GitHub. They are not part of the product. On a PR page they are one small line at the right end of the tabs row: **marks ready** (drafts only), **pushes 2 commits**, **closes the PR**.

**A. PR ready → round 1**
1. Open `#/pr/281` (Draft).
2. In the dashed PROTOTYPE line click **marks ready**.
3. Watch the banner and the stepper: Checks → Task → Change type → Review → Verify, with live progress and cost. When the round ends the stepper folds into one line ("Round 1 of 3 · … · finished … · $…"); **Stages** opens it again.
4. The round ends in **Answer 1 question** (Action needed). Open the **Timeline** tab: bot entries, including `GitHub comment posted: "Ready for team member review (round 1)"`.

**B. Team review → author decides → merge**
1. Open `#/pr/272`. On **Questions** pick an option for each question, sign as Tomek, **Save 2 answers**.
2. On **Findings** press `j` `w`, `j` `w`, `j` `n` (or use the buttons). The tray shows "Your review: 3 opinions". **Save review…** → sign → **Save review**.
3. The card under the banner previews the ClickUp comment. Click **Notify author**.
4. Go to Pull requests and set **Person** to Kasia. Open #272.
5. Tick two findings → **Implement…** in the bulk bar → sign as Kasia. Open another finding → **Reject…** (reason) or **Defer to ClickUp**.
6. Banner: **Approve changes** to the sensitive files (not signed), or **Send back…** (comment + signature).
7. Banner now says "2 findings to implement". In the dashed PROTOTYPE line click **pushes 2 commits** → "2 new commits since last review" → **Start review**.
8. When the round ends, click **View new results**: "2 of 2 fixes resolved". Banner: **Merge #272…** → type 272, sign → **Merge #272**. The PR leaves the board; find it under "Merged or closed".

**C. Implement with agent → push → fix check**
1. Open `#/pr/265`. **Implement with agent…** → sign → **Start the implementer**. Live "Fixing".
2. **Patch** tab: diff per file, **Edit**, **Revert file**, **Revise with this note**.
3. **Push to …** → type 265, sign. Factory bot starts **Round 2 of 3**, a fix check. It ends in "2 of 2 fixes resolved" → Ready to merge.
4. Variants: `#/pr/38` (level 5: mark it ready and watch autofix push by itself), `#/pr/268` (autofix waiting: sensitive file), `#/pr/250` (automatic rounds used), and "pushes 2 commits" on any PR while a round runs (the round continues; nothing new starts).

**D. Change an instruction safely**
1. Open `#/settings/instructions/review-rules`. Edit the text; the diff against the active version appears on the right.
2. Write the note → **Save as draft**.
3. **Try on a PR…** → **Start the trial**. The Compare page fills in when both versions are done.
4. **Go to activate version 4** → **Activate version 4…** → sign. Check `#/settings/audit`.

**E. Learning after a PR closes**
1. Open `#/pr/278` (level 6, ready). **Merge #278…** → type, sign.
2. The banner shows "Learning: Analyst is running", then "Analyst finished".
3. Open `#/settings/learning`: the candidate "Snapshot tables…" now has 2 PRs. **Edit**, then **Accept…** → sign.
4. It appears under Accepted lessons as `lessons.md` version 3, and in the Audit log.

Also try: the status chip (pause with a reason, resume, budget), ⌘K, `?`, the theme toggle, **Retry from Review** on #262, and **Start review ▾** in any PR header (review level for the next round, then Start review).

## Files

| File | What is in it |
|---|---|
| `index.html` | Head, fonts, Tailwind config, script order |
| `styles.css` | Design tokens (light and dark) and component classes |
| `js/core.js` | Store, hash router, formatting, icons, line diff |
| `js/data.js` | Sample data (`seed()`) |
| `js/sim.js` | PR state rules (`prState`, `nextStep`, `checklist`), simulated runs, every action |
| `js/ui.js` | Primitives: Button, Pill, Info (ⓘ), Fold, Combobox, Signature, Dialog, Sheet, Popover, Toast, Stepper |
| `js/shell.js` | Top bar, status chip, command palette, shortcuts |
| `js/board.js`, `js/pr.js`, `js/findings.js`, `js/dialogs.js` | Board, PR detail, tabs, PR dialogs |
| `js/pages.js` | Run detail, Activity, Insights, pipeline diagram |
| `js/settings.js`, `js/settings2.js` | Settings pages |
| `js/guide.js`, `js/app.js` | Prototype guide, boot |

`prState()` and `nextStep()` in `js/sim.js` are the state table from `03-design-decisions.md` as code. Start there for the React build.

To publish as an Artifact: publish `index.html` as the page and pass `styles.css` and `js/*.js` as supporting files at the same paths.

## Design tokens

All colours are CSS custom properties on `:root` in `styles.css`, taken from the Workflow Builder design system. Dark values are redefined under `prefers-color-scheme: dark` and under `:root[data-theme="dark"]`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f5f5f7` | `#151516` | App background |
| `--surface` | `#ffffff` | `#212225` | Cards, top bar, dialogs |
| `--surface-2` / `--inset` | `#f5f5f7` / `#edeff3` | `#1b1c1e` / `#2c2d31` | Table heads, code, hover |
| `--border` / `--divider` | `#d5d8e0` / `#edeff3` | `#383a40` / `#2e3034` | 1px borders, row lines |
| `--text` / `-2` / `-3` / `-4` | `#151516` `#4d5059` `#5e626d` `#6f7480` | `#f5f5f7` `#d5d8e0` `#b3b7c2` `#9499a5` | Text levels |
| `--brand` (+ hover, active) | `#3969ff` `#144cf5` `#0f3fcc` | `#3969ff` `#527dff` `#6b90ff` | Primary button, focus ring, selected |
| `--brand-text` / `--brand-bg` | `#0f3fcc` / 10% blue | `#99b3ff` / 18% blue | Links, "Agents working" |
| `--ok` / `--warn` / `--bad` (+ `-bg`, `-line`, `-solid`) | `#15803d` / `#855509` / `#c41a1a` | `#4ade80` / `#ffc26e` / `#f87171` | Ready, Action needed, Failed |
| `--coral` | `#ed4c46` | `#f77772` | Logo dot only |

- Type: Poppins 600 (headings, card titles), Inter 400/500/600 (body 14px, secondary 13px, meta 12px), JetBrains Mono 12px (SHAs, paths, diffs). Tabular numerals on money and durations (`.num`).
- Shape: 1px borders; radius 6px controls, 8px cards, 12px dialogs; shadows only on overlays.
- State tones: amber = a person must act, blue + pulse = agents working, green = ready, neutral = not reviewed, red = failed or alert. At most one tinted surface per screen (the Next step banner; the alert strip on the board).

## UI pattern → shadcn/ui

| Pattern in the prototype | shadcn/ui |
|---|---|
| `Btn` (`primary`, `secondary`, `outline`, `ghost`, `danger`) | Button (default, secondary, outline, ghost, destructive) |
| State pill, verdict / decision / level badges | Badge (custom variants per tone) |
| Cards, sidebar cards, lanes | Card |
| Next step banner, strips (new results, stale findings) | Alert |
| PR tabs, Insights tabs, Run tabs | Tabs |
| All / To decide / Decided, Inherited / Own value | ToggleGroup |
| Merge, Push, activate / rollback, signed save | AlertDialog |
| Save review, Implement, Try on a PR, Link task, shortcuts | Dialog |
| Status chip panel, board Filters, Start review (level + start) | Popover, DropdownMenu |
| ⓘ helper text (`Info`) | Tooltip (or HoverCard for the long ones) |
| "Show all N", "Show N past alerts", Finished today, PR table on Overview (`Fold`) | Collapsible |
| Person filter, signature field, PR picker | Combobox (Popover + Command) |
| ⌘K palette and top-bar search | Command (CommandDialog) |
| Level and model selects, audit filters | Select |
| Tooltips (shortcuts, "why disabled") | Tooltip |
| Toasts with Undo / View | Sonner |
| Tables (Activity, Settings, Audit) | Table |
| Pipeline stage panel | Sheet |
| Card and stepper progress, budget bar | Progress |
| Finding selection, Implement with agent | Checkbox |
| GitHub comment switch | Switch |
| Question options | RadioGroup |
| Notes, reasons, instruction editor | Textarea, Input, Label |
| Breadcrumbs | Breadcrumb |
| Settings navigation | Sidebar |
| Expandable finding, run stages, round line → stepper, technical details | Collapsible / Accordion |
| Avatars in signatures and timeline | Avatar |
| Keyboard hints | Kbd |
| Loading (not shown: data is local) | Skeleton |
| Stage stepper, bulk bar, review tray, save bar, pipeline diagram, charts | Custom (stepper; sticky bars; React Flow read-only; Recharts via shadcn Chart) |

## Pilot metrics and alerts

- `js/metrics.js` holds the five pilot metrics (Insights → Overview), the alerts and the time summary on the PR Timeline tab. Definitions: `docs/06-metrics.md`.
- Alerts are derived from state on every clock tick. They post a (simulated) ClickUp comment and a PR timeline entry, and clear by themselves when the problem is gone; the cost alert stays until someone dismisses it.
- To see an alert appear live: open `#/pr/262` and click **Retry from Review**. The retry pushes the PR's spend over $5 and the cost alert fires, while the failed-run alert clears.

## Simplification pass (19 Nov)

Presentation only; the state machine, signatures and timings are unchanged. The rules every screen follows:

1. **Say it once.** A state, count, cost or next step appears in one place per screen.
2. **One filled button per screen.** If the banner has the action, nothing repeats it. No disabled copies.
3. **Colour means state.** One tinted surface per screen. Severity is a dot, verdicts and metrics are plain text.
4. **Show exceptions, not defaults.** No mark for the default level, round 1, the main repo, an undecided finding, a zero count or a passing check.
5. **Helper text sits behind ⓘ** (`Info`), or on empty states.
6. **The work starts by y≈380 at 1440×900.** Finished history is one line (round line), or lives in Timeline and Run detail.
7. **Pills are for state only.** Everything else is plain grey text separated by " · ".
8. **Things that need nothing are smaller:** Ready to merge cards are two lines, drafts are one-line rows, history is collapsed (`Fold`).
