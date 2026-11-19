# Decision: reviews start when a PR is ready or on demand; only our own fix commits re-trigger

*Decided by Alek on 2026-11-18. This replaces the automatic review on every new head commit (`01-analysis.md` §1.2 and §2.4 "At most 3 automatic rounds", §3 "cancel-and-replace on every new commit") and the bot's "automatic review on a new commit" in `04-accounts-and-signatures.md`.*

## The rule

- **A push alone never starts a review.**
- A review round starts in only three ways:
  1. **The PR becomes ready in GitHub.** It was opened as ready for review, or it was switched from draft to "Ready for review". Round 1 then starts automatically and is signed as **Factory bot**. Forks are excluded, as before.
  2. **A person clicks "Start review"** on the PR page. Anyone can do this, at any time and in any state. It is **not signed**, and there is no limit on manual starts. The timeline shows "Review started by hand".
  3. **The factory's own implementer pushed a fix**, through "Implement" or level 5 autofix, and that commit is still the PR's head. The next round then starts automatically and is signed as **Factory bot**.
- **How we know the commit is ours:** the implementer records the SHA it pushed. The automatic re-review starts only when the PR's head equals that SHA exactly. If anyone pushes on top of it, the head is no longer ours, so nothing starts.
- **Commits pushed from someone's IDE start nothing.** The PR shows "N new commits since last review" with a "Start review" button.

## Round limit

- **The limit covers one chain:** the round that started it, plus at most 2 automatic re-reviews after our own fixes. That makes 3 rounds. A chain starts with "ready for review" in GitHub or with "Start review".
- **After 3 rounds** the PR shows "Automatic rounds used (3 of 3)" and a "Start review" button.
- **Every new start begins a new chain** and resets the count. That covers a manual start and a PR switched to "Ready for review" again.
- **Rounds 2 and 3 check the fixes, not the whole PR.**
  - They read the diff since the previous round, and check whether each finding marked "Implement" is resolved.
  - Round 1 of every chain is a full review.
  - This replaces "each round reviews from scratch" in `01-analysis.md` §2.4.
- **Only completed rounds count.**
  - A failed round is retried from the stage that failed and doesn't use up a round.
  - A round cancelled by a person doesn't count either.
- **Level 5 autofix:** the existing rule of at most 2 automatic patches now applies per chain, not per PR. This fits the 3-round chain exactly.

## A push during a running round

- **The round is not cancelled**, because someone asked for it.
  - Its result is labelled, for example "Reviewed abc123 · 2 new commits since".
- **Merge stays pinned to the reviewed SHA.**
  - "Ready to merge" disappears as soon as the head moves.
  - The "Next step" banner then says "Start review".
- **Closing the PR cancels its active run.** This still holds.

## What the UI shows

| State | Shown on the PR page | Main action |
|---|---|---|
| Draft | "Draft: review starts when the PR is ready for review" | Start review (optional) |
| Ready, round 1 starting | "Review starting: PR marked ready for review" | None needed. A live stepper shows progress |
| Never reviewed (e.g. a fork) | "Not reviewed yet" | Start review |
| Head moved since the last review | "N new commits since last review (abc123)" | Start review |
| Our fix was pushed | "Re-review starting: Factory bot pushed a fix (round 2 of 3)" | None needed. A live stepper shows progress |
| Chain used up | "Automatic rounds used (3 of 3)" | Start review |

- **Round label**, for example: "Round 2 of 3 · started by Factory bot after fix abc123".
- **In the inbox**, "New commits since last review" counts as the PR author's move.

## Dropped

- **The ideas from the earlier discussion are not needed:**
  - a quiet period before auto-review,
  - a per-PR dollar cap,
  - cancelling a running round on a new commit.
- **The daily factory budget stays.**

## Settled details

- **"Start review" is not signed:** anyone can start a review (see `04-accounts-and-signatures.md`).
- **Rounds 2 and 3 check the fixes only** (see "Round limit" above).
- **GitHub "Ready for review" starts round 1**, so the first round needs no click and later commits from an IDE still start nothing.
