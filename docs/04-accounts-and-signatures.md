# Decision: one shared account, signed actions

*Decided by Alek on 2026-11-18. This replaces §3.7 of `01-analysis.md` (GitHub OAuth + 3 roles) and answers design question 5.*

## Accounts and roles

- **There is one shared account and one role.** Nobody logs in as themselves. There are no per-user accounts, and there is no "who are you" picker on entry.
- **Everything is visible and clickable for everyone.** No option is hidden or disabled because of who you are.
- **Inboxes are public.** An "inbox" is a filter by person. It shows PRs the person authored (known from GitHub) and PRs where they signed an opinion or an action. The default view shows everything.
- The app itself sits behind one shared access gate: a shared password, an SSO proxy or a VPN. The UI shows nothing about it.

## Opinions and decisions on findings are separate

**Opinion.** Anyone can mark a finding as **Worth implementing** or **Not worth it**, with an optional comment and a signature.
- One finding can have many opinions. They are listed under the finding with names, for example: `✓ Worth implementing: Tomek "breaks JSON import"` and `✗ Not worth it: Piotr "validated earlier in the parser"`.
- A reviewer can save opinions on several findings as one signed review, for example: "Tomek's review: 2 worth implementing, 1 not worth it".

**Decision.** The decisions are **Implement**, **Reject with reason** and **Defer to ClickUp**.
- Anyone can decide. The UI says who usually decides, for example: "Usually decided by: Kasia (author)".
- Deciding on someone else's PR is never blocked. The record says so, for example: "Rejected by Tomek (author: Kasia)".
- The PR owner sees every opinion and comment from others before deciding.

## Signatures

- **The signature is a field inside the action's own form** (a popover or the confirmation page). It is not a global setting.
- **It is prefilled** with the last name used in this browser. The name is picked from the team list, where each member has a name, a GitHub login and a ClickUp user. Usually you only confirm it.
- **One signature covers a bulk action.**
- **Signed actions:**
  - opinions,
  - decisions (implement, reject, defer),
  - answers to the AI's questions,
  - push and merge, signed on the confirmation page next to typing the PR number.
- **Not signed:** viewing, and starting a review by hand.
- **Bot actions are signed too, as the bot** (for example "Factory bot"). This covers:
  - round 1 when a PR becomes ready for review in GitHub,
  - an autofix implementation,
  - the automatic re-review after the factory's own fix commit (see `05-review-triggers.md`; a push by a person starts nothing),
  - the analyst after a PR closes,
  - any other action the system takes by itself.
- **Every entry in a PR's timeline and in the logs shows who acted**: a person's name or the bot.

## Notifications

- **Notify author** appears after a signed review. It adds a comment on the PR's ClickUp task that mentions the author, for example: "@Kasia: Tomek marked 2 findings as worth implementing in PR #274". ClickUp then notifies Kasia.
- There is one ClickUp API key, so the comment's author in ClickUp is the key owner. The signer's name goes in the comment text.

## Still holds from earlier

- **Every PR has a "Next step" banner.** It comes from the PR's state and its GitHub author, not from accounts.

## Open detail for design

- **Carry opinions over between rounds.** After a new commit, the same finding can appear again in the next round. Its earlier opinions should stay with it, matched by file and content, so reviewers don't judge it twice.
