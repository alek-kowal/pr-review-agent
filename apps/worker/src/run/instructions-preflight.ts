// Before a run's first stage (INSTR): the required instruction files of the stages it will run
// (core `REQUIRED_INSTRUCTION_FILES`), resolved the way the stages resolve them (the versions the
// run froze, global → repository → level). A missing or empty file fails the first stage with
// `instructions_missing` before any agent session, instead of failing a later stage after the
// money is spent. Each stage keeps its own check as the safety net.
import { missingInstructions } from '@pra/core';
import type { Repository, Run } from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import { stageInstructions } from '../stages/instructions.ts';
import type { StageResult } from '../stages/stage.ts';

/** The failed result for the run's first stage, or null when every required file is there. */
export async function instructionsPreflight(
  deps: WorkerDeps,
  run: Run,
  repository: Repository,
  /** The stages the run will run, in order (not off, not reused). */
  stages: readonly string[],
): Promise<StageResult | null> {
  const files = await stageInstructions({ deps, run, repository });
  const gaps = missingInstructions(files, stages);
  const [first] = gaps;
  if (!first) return null;
  deps.logger.warn({ runId: run.id, gaps }, 'instruction files missing: run stopped at its start');
  return {
    status: 'failed',
    error: {
      code: 'instructions_missing',
      params: { stage: first.stage, missing: first.missing, gaps },
    },
    sessions: [],
  };
}
