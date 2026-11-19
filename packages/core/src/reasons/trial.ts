declare module '../reason.ts' {
  interface ReasonParams {
    /** A trial run skips the stage: it never calls GitHub or ClickUp (S-22-T6). */
    off_in_trial: { stage: string };
    /** A trial needs one of the file's versions that is still a draft. */
    trial_needs_draft: { versionId: number; status: string | null };
  }
}

export {};
