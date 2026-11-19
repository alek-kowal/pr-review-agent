// S-04-T6: Checks and Change type of the PR's latest completed round, for the PR page panel: the
// change type and how it was set (rules, judge raised, forced), CI counts, the install result and
// the large-PR warning. Nothing new is stored on the PR: it all comes from the round's outputs,
// plus the type a person forced for the next round.
import { CHANGE_TYPES } from '@pra/core';
import { latestRound, stageExecutionsOf, type StageExecution } from '@pra/db';
import { z } from 'zod/v4';
import { ReasonSchema } from '../round.ts';
import { defineSection } from '../section.ts';

const ChangeTypeOutputSchema = z.object({
  changeType: z.enum(CHANGE_TYPES),
  reason: ReasonSchema,
  lines: z.number(),
  largePr: z.boolean(),
  largePrLines: z.number(),
});

const ChecksOutputSchema = z.object({
  ci: z.object({ passed: z.number(), failed: z.number(), pending: z.number() }),
  install: z.object({ status: z.string() }),
});

export const ChecksSectionSchema = z.object({
  /** The completed round the values come from; null before the first one. */
  runId: z.number().int().nullable(),
  /** `reason.code`: `forced_by_person`, `judge_raised`, or a rules code (`rules_floor`, ...). */
  changeType: z.object({ value: z.enum(CHANGE_TYPES), reason: ReasonSchema }).nullable(),
  /** The type a person forced; the next round uses it. */
  forced: z.enum(CHANGE_TYPES).nullable(),
  /** Set when the diff is over the repository's large-PR threshold. */
  largePr: z.object({ lines: z.number(), threshold: z.number() }).nullable(),
  ci: ChecksOutputSchema.shape.ci.nullable(),
  install: z.object({ status: z.string() }).nullable(),
});

export type ChecksSection = z.output<typeof ChecksSectionSchema>;

/** The output of the stage's last attempt that produced one (run or reused). */
function outputOf<S extends z.ZodType>(
  stages: StageExecution[],
  key: string,
  schema: S,
): z.output<S> | null {
  const done = stages.filter(
    (s) => s.stage === key && (s.status === 'succeeded' || s.status === 'reused'),
  );
  const parsed = schema.safeParse(done.at(-1)?.output);
  return parsed.success ? parsed.data : null;
}

export const checksSection = defineSection({
  key: 'checks',
  schema: ChecksSectionSchema,
  async build({ db, pullRequest }): Promise<ChecksSection> {
    const forced = pullRequest.forcedChangeType ?? null;
    const run = await latestRound(db, pullRequest.id, { completed: true });
    if (!run) {
      return { runId: null, changeType: null, forced, largePr: null, ci: null, install: null };
    }
    const stages = await stageExecutionsOf(db, run.id);
    const changeType = outputOf(stages, 'change_type', ChangeTypeOutputSchema);
    const checks = outputOf(stages, 'checks', ChecksOutputSchema);
    return {
      runId: run.id,
      changeType: changeType && { value: changeType.changeType, reason: changeType.reason },
      forced,
      largePr: changeType?.largePr
        ? { lines: changeType.lines, threshold: changeType.largePrLines }
        : null,
      ci: checks?.ci ?? null,
      install: checks?.install ?? null,
    };
  },
});
