// S-03-T9: the PR page's stepper and round line: the latest round's label, its steps with their
// cost (core `stepperModel`, the same as Run detail) and the cost so far.
import { chainState, roundLabel } from '@pra/core';
import { getRunDetail, latestRound, runRecord, runsOfPullRequest } from '@pra/db';
import { z } from 'zod/v4';
import { offStepsOf } from '../off-steps.ts';
import { iso, OffStepSchema, ReasonSchema } from '../round.ts';
import { defineSection } from '../section.ts';
import { runSteps, stageRows } from '../stepper.ts';

const timestamp = z.iso.datetime({ offset: true });

export const RoundStepSchema = z.object({
  key: z.string(),
  status: z.enum(['done', 'running', 'failed', 'queued', 'off']),
  /** Every attempt of the stage. */
  costUsd: z.number(),
  errorCode: z.string().nullable(),
  /** The error's params (the missing files of an instructions error); null without an error. */
  errorParams: z.record(z.string(), z.unknown()).nullable(),
  /** Why the level (or a fork's read-only policy) turns the stage off. */
  offReason: ReasonSchema.nullable(),
  /** Steps inside the stage the plan turns off: a fork's install and reproductions (S-16). */
  offSteps: z.array(OffStepSchema),
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
});

export const roundProgressSection = defineSection({
  key: 'roundProgress',
  schema: z
    .object({
      runId: z.number().int(),
      /** `round_label` ("Round 2 of 3 · started by ..."). */
      label: ReasonSchema.nullable(),
      steps: z.array(RoundStepSchema),
      /** The running stage, or null. */
      current: z.string().nullable(),
      /** Sum of the round's session costs, live per agent turn. */
      costUsd: z.number(),
    })
    .nullable(),
  async build({ db, pullRequest }) {
    const run = await latestRound(db, pullRequest.id);
    if (!run) return null;
    const [detail, runs] = await Promise.all([
      getRunDetail(db, run.id),
      runsOfPullRequest(db, pullRequest.id),
    ]);
    if (!detail) return null;
    const steps = runSteps(run, stageRows(detail.stages, detail.sessions), pullRequest.isFork);
    return {
      runId: run.id,
      label: roundLabel({ id: String(run.id) }, chainState(runs.map(runRecord))),
      steps: steps.map((step) => ({
        key: step.key,
        status: step.status,
        costUsd: step.costUsd,
        errorCode: step.errorCode,
        errorParams: step.errorParams ?? null,
        offReason: step.offReason,
        offSteps: offStepsOf(run, pullRequest.isFork, step),
        startedAt: iso(step.startedAt),
        finishedAt: iso(step.finishedAt),
      })),
      current: steps.find((step) => step.status === 'running')?.key ?? null,
      costUsd: detail.sessions.reduce((sum, session) => sum + session.costUsd, 0),
    };
  },
});
