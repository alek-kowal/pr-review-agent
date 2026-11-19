// S-23-T6: the PR's latest analysis, for the learning line in the banner of a closed PR ("Analyst
// is running", "Analyst finished: N candidates", "Analyst failed").
import { resolveLevel } from '@pra/core';
import { getAppSettings, latestAnalysisOf, prLevel } from '@pra/db';
import { z } from 'zod/v4';
import { defineSection } from '../section.ts';

export const LearningSchema = z.object({
  /** The PR's level has learning (level 6): the bot analyses it when it closes. */
  levelLearns: z.boolean(),
  analysis: z
    .object({
      id: z.number().int(),
      status: z.enum(['running', 'finished', 'failed']),
      startedBy: z.enum(['bot', 'hand']),
      /** Candidates the analysis created or raised; null until it finishes. */
      candidates: z.number().int().nullable(),
      runId: z.number().int().nullable(),
      at: z.iso.datetime({ offset: true }),
    })
    .nullable(),
});

export const learningSection = defineSection({
  key: 'learning',
  schema: LearningSchema,
  async build({ db, repository, pullRequest }) {
    const analysis = await latestAnalysisOf(db, pullRequest.id);
    const globalLevel = (await getAppSettings(db)).value.defaultLevel;
    return {
      levelLearns: resolveLevel(prLevel(repository, pullRequest, globalLevel)).features.learning,
      analysis: analysis && {
        id: analysis.id,
        status: analysis.status as 'running' | 'finished' | 'failed',
        startedBy: analysis.startedBy as 'bot' | 'hand',
        candidates: analysis.candidateCount,
        runId: analysis.runId,
        at: (analysis.finishedAt ?? analysis.createdAt).toISOString(),
      },
    };
  },
});
