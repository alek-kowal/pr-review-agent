---
change_id: FLAKY
title: Reliable decide.spec.ts, no leaked pra-sbx-* sandbox containers
status: done
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Orchestrator task FLAKY. `e2e/decide.spec.ts` failed now and then at step 6 (no "Kasia decided
this in the meantime." alert); sandbox tests left `pra-sbx-*` containers (Created or Exited).

## Decisions

1. **decide.spec step 6 was an app bug.** The decision form sent the finding versions of its
   latest render. The other browser's decision reaches this page as a live update (SSE →
   refetch) while the Defer form is open; when it landed before the click, the form sent the new
   version, the server accepted it and Defer silently overwrote Kasia's decision: no conflict.
   Without the fix, `--repeat-each 10` failed 3 of 10 at that line. Now the form keeps the
   versions it opened with (`DecisionForm` `seenVersions`); after a conflict it takes the
   conflict's versions, so saving again overrides on purpose. Unit test in
   `FindingDecisions.test.tsx`.
2. **decide.spec could not repeat.** Every `--repeat-each` copy used PRs 330/335 (only the retry
   varied) and saw another copy's decisions, and adding Kasia and Tomek on the Team page raced
   other specs adding them. PRs now start at `DECIDE_PRS_FROM` (1000) + 10 × repeat + retry; the
   failing-reviewer range is bounded to 400–999 (`FAILING_PR_TO`). Team members come from the
   race-safe api helper `teamMember` (settings-team.spec.ts covers the Team page).
3. **Leaked sandbox containers had two causes.** (a) A timed-out test left its run going; when
   the file ended, the Vitest worker exited before `DockerSandbox` removed the container (Created
   or Exited 143). Docker tests now run through `StoppableSandbox`: `afterAll` aborts runs still
   going, waits until each removed its container, then sweeps the file's label. (b) An
   interrupted run (Ctrl-C, a killed `pnpm verify`) leaves its in-flight container, and Vitest
   exits on SIGINT/SIGTERM without global teardown. A global setup
   (`packages/integrations/vitest.config.ts`) labels test containers with the run's session and
   owner (`host:pid`); teardown removes the session's, setup removes those whose owner is gone
   or that are over an hour old. Only `pra-sbx-*` names are ever removed.
4. **Not changed:** the worker's own containers outlive a killed worker the same way (no
   time limit once the process is gone). Out of scope here; worth a startup sweep by
   `pra.sandbox` label in the worker later.
