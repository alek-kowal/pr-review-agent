import { JOBS, sendJob, type Queue } from '@pra/db';

/**
 * Queues one stage of one run. The `run.stage` queue is `exclusive` on the key, so a second send
 * while the first job is queued or active is dropped.
 */
export function sendStageJob(queue: Queue, runId: number, stage: string): Promise<string | null> {
  return sendJob(queue, JOBS.runStage, { runId, stage }, { singletonKey: `${runId}:${stage}` });
}
