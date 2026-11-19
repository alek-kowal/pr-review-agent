
declare module '../reason.ts' {
  interface ReasonParams {
    candidate_created: { id: string };
    candidate_merged: { id: string; prs: number };
    /** The same lesson was rejected before; it starts over as a new candidate. */
    candidate_started_over: { id: string; rejectedId: string };
    lesson_already_accepted: { id: string };
    proposals_capped: { kept: number; dropped: number };
    candidate_not_open: { status: string };
    needs_more_prs: { have: number; need: number };
    signature_required: NoParams;
    can_accept: { prs: number };
  }
}
