declare module '../reason.ts' {
  interface ReasonParams {
    /** Implement with agent: no finding is decided Implement and still open. */
    no_implement_decisions: NoParams;
    /** An edit or revert named a patch revision or file content that is no longer stored. */
    patch_stale: { revision: number };
  }
}

export {};
