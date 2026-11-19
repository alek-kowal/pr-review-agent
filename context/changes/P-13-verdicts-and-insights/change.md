---
change_id: P-13
title: Verdicts and Insights (S-05-T3, S-05-T4, S-19-T1–T8)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-13 from `context/foundation/work-packages.md`, wave 5. Plan: no; the tasks'
"Done when" checks are the plan. One commit per task, in the listed order.

## Decisions

### S-05-T3 (verdicts and evidence on findings)

- The findings API reads `finding_verifications` of the reviewed round (`loadFindingsView`) and
  returns `verification: { reason, verifierReason, reproduction }` per finding (null when Verify
  did not run). `reproduction` is null when no sandbox run happened; it carries exit code,
  timed out, output tail and `repaired`. Quotes stay in the existing `evidence` field
  (`{ file, line, quote }`).
- `unchecked: N` is a top-level field of the findings response: the count of unchecked findings
  when the round's level is below 3, null otherwise.
- The decisions route's refreshed view uses the same loader, so verification data survives a
  decision.
- Web: the verifier's words under "Verifier: <verdict>" (prototype), quotes as `<pre>`, and the
  reproduction folded in a native `<details>` "Technical details". A level-3 finding skipped
  for its change type (`verify_off_for_change_type`) says so instead of "Not verified at this
  level".
- No loader or core change: core `needsDecision` already drops Refuted findings from "to decide".
