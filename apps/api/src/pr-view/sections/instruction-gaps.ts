// INSTR: the required instruction files a round of this PR's repository would miss, per level.
// Start review warns about the selected level's gaps, since such a round stops before its first
// stage (the worker's pre-check).
import { stageFilesFor } from '@pra/agents';
import { INSTRUCTION_STAGES, instructionGaps, LEVEL_NUMBERS } from '@pra/core';
import { activeInstructions, stageFileChoicesOf, toLayer, type Executor } from '@pra/db';
import { z } from 'zod/v4';
import { defineSection } from '../section.ts';

export const InstructionGapSchema = z.object({
  level: z.union(LEVEL_NUMBERS.map((n) => z.literal(n))),
  stage: z.enum(INSTRUCTION_STAGES),
  /** Missing or empty files, in the order core lists them. */
  missing: z.array(z.string()),
});

/** Per level, the required files a run of the repository would miss (core `instructionGaps`). */
export async function repositoryInstructionGaps(
  db: Executor,
  repositoryId: number,
): Promise<z.output<typeof InstructionGapSchema>[]> {
  const layers = (await activeInstructions(db, repositoryId)).map(toLayer);
  // The repository's current stage files (STAGEFILES); documents never make a gap.
  const stageFiles = stageFilesFor(await stageFileChoicesOf(db, repositoryId), []);
  return instructionGaps(layers, repositoryId, stageFiles);
}

export const instructionGapsSection = defineSection({
  key: 'instructionGaps',
  schema: z.array(InstructionGapSchema),
  build: ({ db, repository }) => repositoryInstructionGaps(db, repository.id),
});
