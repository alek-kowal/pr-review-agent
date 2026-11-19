# WB Factory: design decisions

Status, 18 Nov 2026:
- Step 1 of `02-design-brief.md` is answered.
- Alek's feedback on the structure is applied, along with `04-accounts-and-signatures.md` and `05-review-triggers.md`.
- The structure (step 2) is approved: navigation, screens and flows A–E as in the chat on 18 Nov. They are summarised under "Approved structure".
- Step 3: the first version of the prototype is built in `prototype/` (see `prototype/README.md`). It is waiting for Alek's click-through.

## Approved structure

- **Top bar:**
  - WB Factory
  - Pull requests · Activity · Insights · Settings
  - search (PR number, title, author)
  - factory status chip ("Running · $4.76 / $50 today"), which opens pause and budget
  - no account menu
- **Settings groups:**
  - Factory: Budget & status, Models, Team, Integrations
  - Repositories
  - Review: Review levels, Instructions, Pipeline
  - Improve: Experiments, Learning
  - System: Audit log
- **Screens:**
  1. Pull requests: the landing board with a Person filter.
  2. PR detail, in every state from the table below.
  3. Run detail.
  4. Activity.
  5. Insights: Cost, Quality, Trust ladder.
  6. Settings → Budget & status, Models, Team, Integrations.
  7. Settings → Repositories → repo.
  8. Settings → Review levels.
  9. Settings → Instructions.
  10. Settings → Pipeline.
  11. Settings → Experiments.
  12. Settings → Learning.
  13. Settings → Audit log.
- **Flows:**
  - A: PR ready → round 1 runs automatically.
  - B: team review (opinions, Notify author) → author decides → merge.
  - C: Implement with agent → push → automatic fix check (rounds 2–3).
  - D: change an instruction safely.
  - E: learning after a PR closes.

Sources: Alek's answers in chat, `04-accounts-and-signatures.md`, `05-review-triggers.md`.

## Answers from step 1

| # | Question | Decision | What it changes in the design |
|---|---|---|---|
| 1 | UI language | **English** | All UI copy is English |
| 2 | Pipeline diagram | **Read-only diagram plus structured settings** | No editor. The diagram appears in Settings → Pipeline and in Run detail. Everything configurable is a form |
| 3 | Level 5 (autofix) and level 6 (learning) | **Both in v1** | PR detail shows when autofix is running, what it pushed, or why it is waiting. Review levels shows the autofix conditions. Settings → Learning and Flow E are in scope. Insights → Trust ladder shows the level-5 shadow log ("level 5 would have fixed 3 of 8 PRs") |
| 4 | Findings in GitHub | **One sentence on the PR, no link, nothing else.** Text: "Ready for team member review (round 2)" | The app is private and the PRs are public, so the comment never links to the app. Findings, opinions and decisions live only in the app |
| 5 | Who answers, decides, merges, starts paid runs | **One shared account, one role, signed actions.** See `04-accounts-and-signatures.md` | See "Accounts, roles and signatures" |

## Accounts, roles and signatures

`04-accounts-and-signatures.md` applies in full. It replaces §3.7 of `01-analysis.md`.

What it means for the screens:
- **No sign-in screen, no account menu, no roles.** The shared access gate (shared password, SSO proxy or VPN) sits outside the app, and the UI shows nothing about it.
- **Settings → Team.** Each member has a name, a GitHub login and a ClickUp user. This list feeds signatures and the person filter.
- **No Inbox page.** An inbox is the **Person** filter on Pull requests. It shows PRs the person authored or signed something on. The default is everyone.
- **Findings have opinions and decisions.**
  - Opinions: **Worth implementing** or **Not worth it**, with an optional comment, signed. A finding can have many opinions.
  - Decisions: **Implement**, **Reject** (reason required) or **Defer to ClickUp**, signed. Anyone may decide.
  - Each finding says who usually decides, for example "Usually decided by: Kasia (author)".
  - A decision on someone else's PR is recorded as such, for example "Rejected by Tomek (author: Kasia)".
- **Signed review.** A reviewer saves opinions on several findings at once, for example "Tomek's review: 2 worth implementing, 1 not worth it". **Notify author** then appears. It posts a ClickUp comment on the PR's task that mentions the author.
- **Signature field.** It sits inside each action's own form or confirmation. It is prefilled with the last name used in this browser and chosen from Team. One signature covers a bulk action.
- **Bot actions** are signed as "Factory bot".
- **Timeline.** The History tab on PR detail becomes **Timeline**. Every entry shows who acted: a person's name, the bot, or "by hand" for unsigned starts.
- **Opinions carry over.** In the next round, opinions move to the matching finding (same file and content) and are marked "from round 1".

## Review triggers and rounds

`05-review-triggers.md` applies in full. It replaces automatic review on every new commit and the old "Limit 3 rounds" state.

What it means for the screens:
- **A push never starts a review.**
  - Round 1 starts automatically when the PR becomes ready for review in GitHub. It is signed as Factory bot.
  - Anyone can click **Start review** at any time. It is not signed, and the timeline shows "Review started by hand".
  - Rounds 2 and 3 start automatically only when the PR's head is exactly the commit our implementer pushed. They are signed as Factory bot.
- **Start review** is on every PR page, in every state, not only when it is the main action.
- **Round label.** Examples: "Round 2 of 3 · started by Factory bot after fix abc123" and "Round 1 of 3 · started by hand".
- **Rounds 2 and 3 are fix checks.**
  - The Findings tab shows each finding marked Implement as **Resolved** or **Not resolved**, for example "2 of 2 fixes resolved".
  - Round 1 is always a full review.
- **A push during a running round** leaves the round running. Its result is labelled "Reviewed abc123 · 2 new commits since".
- **When the head moves**, "Ready to merge" disappears, because merge is pinned to the reviewed SHA.
  - The banner then says "N new commits since last review" with **Start review**.
  - This is the author's move: the card is in Action needed and says "usually Kasia (author)".
  - It takes priority over findings still open from the reviewed commit. Those stay usable, labelled "from abc123 · 3 commits behind".
- **Level 5 autofix:** at most 2 automatic patches per chain.

### PR states, banners and board lanes

| State | Next step banner | Main action | Board lane |
|---|---|---|---|
| Draft | "Draft: review starts when the PR is ready for review" | Start review (optional) | Not reviewed |
| Never reviewed (e.g. a fork) | "Not reviewed yet" | Start review | Not reviewed |
| Queued, factory paused or budget reached | "Queued: factory paused by Tomek (release freeze)" / "Queued: daily budget reached ($50 of $50)" | Resume in the status chip | Agents working |
| Round 1 running | "Review starting: PR marked ready for review", live stepper, live cost | Cancel | Agents working |
| Fix check running | "Re-review starting: Factory bot pushed a fix (round 2 of 3)", live stepper, live cost | Cancel | Agents working |
| Questions waiting | "Answer 2 questions" | Answer (signed) | Action needed |
| Findings to decide | "Decide 4 findings · usually Kasia (author) · 1 review so far" | Opinions and signed review, then Notify author; decisions (signed) | Action needed |
| Sensitive files changed | "Approve changes to 2 sensitive files" | Approve (not signed) / Send back (comment, signed) | Action needed |
| Waiting for the fix | "2 findings to implement · usually Kasia (author)" | Implement with agent (level 4+) | Action needed |
| Fixing | "Implementer is fixing 2 findings · started by Kasia" (or "by Factory bot") | Cancel | Agents working |
| Patch ready | "Patch ready: 2 of 2 fixed, reproductions pass", or "Autofix waiting: patch touches a sensitive file" | Push (PR number and signature) | Action needed |
| New commits since last review | "3 new commits since last review (abc123)" | Start review | Action needed |
| Automatic rounds used | "Automatic rounds used (3 of 3)" | Start review | Action needed |
| Stage failed | "Review stage timed out after 30 min. This round is not counted" | Retry from Review | Action needed |
| Ready to merge | "Ready to merge: checklist green at abc123" | Merge (PR number and signature) | Ready to merge |
| Merged or closed | "Merged by Kasia" plus the learning status at level 6 | None | Leaves the board |

### Signature details (confirmed by Alek unless marked)

- **Sensitive files.**
  - **Approve** is not signed. The timeline shows "Approved by hand".
  - **Send back** is a person's action, not the bot's. It needs a comment for the author and is signed, like an opinion.
- **Audit log.** Every change that lands in the audit log is signed in its confirmation:
  - pause and resume,
  - budget,
  - models,
  - levels,
  - repo settings,
  - the team list,
  - activating or rolling back an instruction version,
  - accepting or rejecting a lesson.
- **Trials.** Starting a trial counts as starting a review by hand, so it is not signed. The timeline shows "Started by hand".
- **"Implement" is the decision** ("this must be fixed"). The level-4 action that runs the implementer agent is **Implement with agent**.
  - It is signed because it leads to a push on someone's PR.
  - The Implement decision form offers it as a checkbox, so one signature can cover both.
- **Cancel and Retry are not signed,** like Start review.
- **Retry from <stage>** (not signed).
  - It is shown when a stage of a round fails, for example a reviewer timeout at 30 min or a GitHub or ClickUp error.
  - It reruns the failed stage and the stages after it. It reuses the results of the stages that succeeded.
  - It keeps the round's number. A failed round is not counted (`05-review-triggers.md`).
  - It is a button, not automatic. A reviewer timeout on a very big PR usually fails again, so a person decides whether to retry or split the PR.

## Feedback on the first structure proposal

- **Board lanes:** Not reviewed · Agents working · Action needed · Ready to merge. The table above lists which state goes in which lane.
  - "Needs you" and "Needs author" are merged into one lane, **Action needed**. With one shared account, "you" means nothing.
  - Each card has a Next step line saying what is needed and who usually does it. It comes from the PR state and the GitHub author.
- **GitHub comment.**
  - The bot posts "Ready for team member review (round N)" after each completed round.
  - Failed or cancelled rounds get no comment.
  - There is no link.
  - The comment can be switched off in Settings → Integrations.
- **Costs show only real spend.**
  - During a run there is a live counter on the PR ("$0.84 so far") and in Activity.
  - After a run, the final cost appears in Timeline, Run detail and Insights.
  - There are no estimates on Start review, Implement with agent or Try on a PR, because nothing has been spent yet.
- **Rename: "Protected paths" → "Sensitive files"** (confirmed).
  - A sensitive file is one where any change needs a human OK, even after a clean review.
  - It is set per repo in Settings → Repositories, as a pattern with a reason.
  - Today's rules (`wb-factory/src/gates.ts`) cover:
    - public package exports (`packages/*/src/index.ts`),
    - published package manifests,
    - Temporal workflow code,
    - DB migrations (`apps/backend/drizzle/`),
    - `deploy/`,
    - `.github/workflows/`,
    - `CLAUDE.md` and `.claude/`.

## Prototype decisions (v1, 18 Nov)

These were made while building. Alek has not reviewed them yet.

**Board**
- **Action needed lane.**
  - It is twice as wide, with two card columns on an amber surface, because it holds the most cards and is where people act.
  - Sort order: failed → questions → decide → sensitive files → patch → fix → new commits → rounds used.
- **Merged and closed PRs** sit in a collapsed "Merged or closed in the last 7 days" list under the board. They leave the board but stay reachable.
- **Author names on cards are never truncated.** The round label shortens first, because the author is what the Person filter and "usually …" refer to.

**Findings**
- **Which findings need a decision:** only Blocking and Worth fixing ones that are not Refuted. Nits are "Optional" and never block (`01-analysis.md` §2.4).
- **Verdict colour:** only Confirmed is coloured (blue). Refuted, Not proven and Unchecked are neutral. A verdict is evidence, not urgency, and amber and red stay reserved for state.
- **Decisions** open a small inline form with the signature prefilled, where Enter confirms. An Undo toast follows. Decisions are signed and stay fast.

**PR page**
- **Questions:** answers are saved together, with one signature, from a sticky bar.
- **Notify author** is a card under the Next step banner showing the exact ClickUp comment. "Not now" hides it. It is visible right after Save review without becoming a blocking state.
- **Sent-back sensitive files** keep the Sensitive files state, with the banner "Sent back by Tomek: Kasia changes 2 sensitive files". A push by the author resets them to pending.
- **Implement with agent below level 4** is disabled with the reason, and offers "Raise this PR to level 4" (unsigned, logged as by hand).
- **When a round finishes while its findings are on screen,** the banner, checklist and stepper update at once. The findings list stays until "View new results", so content never changes under the reader.
- **Stage stepper.** Checks, Task and Change type show as "off at level 1". Verify shows as off at levels 1–2.
- **Retry.** A retry that succeeds keeps the round number and marks earlier stages "reused from the failed round".
- **Cancel** is an outline red button, never the filled primary. It is an available action, not the recommended one.

**Run detail**
- The mini pipeline is full width above the stages. It is unreadable in a 340 px sidebar.

**Signatures**
- Also unsigned, in addition to the list above:
  - Revise,
  - Link a ClickUp task,
  - changing the level for one PR,
  - Save as draft,
  - Run analyst.

  None of them pushes, merges or changes settings in force.

**Settings**
- Every Settings page starts with an "Affects:" line. It has a sticky save bar ("N unsaved changes") that leads to a signed confirmation with a before/after table.
- Level 5 conditions are four numbered rules on the level page. Only "at most N automatic patches per chain" is editable.
- Lesson candidates from only one PR are shown, but Accept is disabled with the reason ("1 of 2 PRs: waits for one more").

**Global**
- The top-bar search opens the ⌘K palette (PRs, people, settings pages, actions). One search surface instead of two.

## Pilot metrics and alerts (19 Nov)

Accepted by Alek. Full definitions are in `06-metrics.md`.
- **Insights → Overview** is the new first tab.
  - It shows the team's five pilot metrics, each with its sample size.
  - It splits the time from ready to merge into the board's three lanes, and lists the PRs in a table.
  - There are no trend deltas.
- **PR page → Timeline** starts with a summary: ready for review, ready → merge, agents worked, waiting for people and merge, cost.
- **Alerts** go to a **ClickUp comment** on the PR's task and to a **visual mark on the dashboard**:
  - a bell and a red edge on the card,
  - a red pill on the PR page,
  - a strip above the board,
  - a count on the status chip,
  - a list in Activity.
- **Cost alert at $5 per PR.** It is a warning, not a cap.
- **New Settings page:** Factory → Alerts.
- **The ClickUp alert comment links to the app.** ClickUp is internal, unlike public GitHub. *Alek to confirm.*
- **A timed-out session now records its cost up to the timeout.** In the demo, #262 shows $3.85. The old app recorded nothing (`01-analysis.md` §1.7).
- **Fix.** Tinted badges rendered grey because `.badge` overrode the tone classes. They now show their tone (for example "To decide" in amber, "Confirmed" in blue).

## Simplification pass (19 Nov)

Alek asked: "simplify; don't change the flow logic; collapse extra information". A design review (Fable) proposed the changes and another agent implemented them. Presentation only: the state machine, signatures and round triggers are unchanged. All flow tests pass (95 of 95).

**Global rules for every screen**
1. Say it once.
2. One filled button per screen.
3. Colour means state.
4. Show exceptions, not defaults.
5. Helper text sits behind ⓘ.
6. The work starts by y≈380 at 1440×900.
7. Pills are for state only.
8. Things that need nothing are smaller.

**Board**
- Cards are three lines: title; #number · author · age; next step.
- Repo, level and round appear only when they differ from the default.
- Cards drop "usually X (author)". The PR banner keeps the full phrase (approved by Alek).
- Ready to merge cards are two lines.
- Drafts are one-line rows under "N drafts" in Not reviewed.
- Filters: Person is always visible. Repo, Forks, Level and Hide drafts are in one Filters popover.
- The Action needed lane keeps its double width, amber header and count, and loses the amber fill.

**Alerts**
- One bell on the card.
- On the PR page, a secondary line inside the Next step banner.
- The board strip has no helper sentence. (Approved by Alek.)

**PR page**
- The header is the title plus one grey line. There is no state pill and no breadcrumb.
- The banner colour and title are the state. Scroll-only banner buttons are removed.
- Start review and the review level are a quiet header button with a popover, on every open PR.
- The stage stepper is full only while agents run or after a failure. Otherwise it is one expandable round line with the "Round N of 3 · started by …" label.
- The merge checklist shows failing rows only ("Show all N"). All green is one line. There is no Merge button in the sidebar.
- The total PR cost is in the Timeline summary. The live counter is in the banner while a run is live.
- Findings rows show a badge only for a decision or a fix result. Verdicts and opinions are plain grey text. This replaces "only Confirmed is coloured (blue)".
- The findings filter appears only from 7 findings up.
- The Rounds card marks a second round 1 as "new chain".

**Other screens**
- Overview tiles are a label, a number and one line with the sample size. The PR table and "Not measured yet" are collapsed.
- Activity shows active alerts (including failed runs), one "In progress" table, and a collapsed "Finished today". Past alerts sit behind "Show N past alerts".
- Settings: hints are behind ⓘ. Inherited level values are plain text with Override.
- A failed run shows its cost up to the failure. For #262 that is $3.85, on both the PR page and Run detail.
- Prototype scaffolding: the guide is a chip in the top bar, and the GitHub simulation is one dashed line in the tabs row.

**For Alek to check (possibly too far)**
- The total cost is not on the default PR tab, only in Timeline.
- PR pages have no breadcrumb.
- There is no one-click jump to the first undecided finding.
- Settings help is hover or focus only, which is weaker on touch screens.
- Notify author and Accept (Learning) are no longer filled buttons.

## Open points

- **Agent slots.** The prototype adds "Queued: both agent slots are busy" (two rounds at a time, set in Budget & status). Is that a real production setting, or should Queued only mean paused or budget reached?
- **Revise and "Raise this PR to level 4".** Both are unsigned in the prototype. Should they be signed?
- **Nits.** Should a nit be decidable at all, or only get opinions?
- **GitHub App name.** The bot's name shows on public PRs, so pick a neutral one. The prototype uses the placeholder `wb-review-bot`.
- **PR with no linked ClickUp task.** Notify author cannot post anywhere. The design shows the reason and a "Link a ClickUp task" action.
