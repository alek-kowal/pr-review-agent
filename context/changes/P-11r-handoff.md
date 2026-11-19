# P-11r handoff

Stopped on the usage limit. Done: F1–F8 fixed and committed (see P-11 `review.md`).

Left:
1. F9: core flag so an unchecked own-fix head after 3 rounds never reaches Ready to merge
   (`packages/core/src/pr-state.ts` prState + loader `packages/db/src/queries/pr-state.ts`).
2. F10: FK `runs.chain_id → round_chains.id` in the next migration touching `runs`.
3. F11: tighten tests (start-review 409 while running + "by hand"; fix-check round 3 `fromSha`;
   pushes T1/T2 from the drift report).
4. Run `pnpm test:e2e` (sensitive-files and chains specs: the scan moved to round start; timeline
   copy changed). `pnpm verify` was green (918 tests) after F1–F8.
5. Set P-11r `status: implemented` and P-11 `status: impl_reviewed` when done.
