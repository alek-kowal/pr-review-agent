import type { RunStatus } from '../model.ts';
import type { RunKind } from '../vocabulary.ts';

declare module '../reason.ts' {
  interface ReasonParams {
    run_not_queued: { status: RunStatus };
    run_not_running: { status: RunStatus };
    run_not_failed: { status: RunStatus };
    run_not_retryable: { kind: RunKind };
    run_finished: { status: RunStatus };
    run_not_found: { runId: number };
    stage_not_in_plan: { stage: string };
    stage_not_pending: { stage: string; status: string };
    stage_not_running: { stage: string; status: string };
    stage_already_running: { stage: string };
    stage_out_of_order: { stage: string; expected: string };
    no_stage_left: NoParams;
  }
}
