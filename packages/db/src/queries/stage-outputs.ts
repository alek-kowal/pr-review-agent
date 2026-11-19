// What earlier stages of a run produced: later stages read it (Review reads the change type,
// Verify and the judge read the task).
import { and, desc, eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { stageExecutions } from '../schema/runs.ts';

/** The output of the stage's latest succeeded attempt in the run, or null when there is none. */
export async function succeededStageOutput(
  db: Executor,
  runId: number,
  stage: string,
): Promise<unknown> {
  const [row] = await db
    .select({ output: stageExecutions.output })
    .from(stageExecutions)
    .where(
      and(
        eq(stageExecutions.runId, runId),
        eq(stageExecutions.stage, stage),
        eq(stageExecutions.status, 'succeeded'),
      ),
    )
    .orderBy(desc(stageExecutions.attempt))
    .limit(1);
  return row?.output ?? null;
}
