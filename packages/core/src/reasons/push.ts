declare module '../reason.ts' {
  interface ReasonParams {
    /** The typed number is not the PR's number. */
    pr_number_mismatch: { number: number };
    /** Only a ready patch is pushed; a pushed, superseded or discarded one is not. */
    patch_not_ready: { status: string };
    /** The PR head is no longer the commit the patch was made on. */
    head_moved: { headSha: string };
    /** Every file of the patch is reverted: there is nothing to push. */
    patch_empty: NoParams;
  }
}

export {};
