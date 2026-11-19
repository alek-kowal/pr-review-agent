import { latestRound, stageExecutionsOf } from '@pra/db';
import { RoundSchema, roundView } from '../round.ts';
import { defineSection } from '../section.ts';

/** The PR's most recent round, whatever its status; null before the first round. */
export const latestRoundSection = defineSection({
  key: 'latestRound',
  schema: RoundSchema.nullable(),
  async build({ db, pullRequest }) {
    const run = await latestRound(db, pullRequest.id);
    if (!run) return null;
    return roundView(run, await stageExecutionsOf(db, run.id));
  },
});
