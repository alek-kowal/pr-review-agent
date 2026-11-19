// Learning (S-23-T3): the bot starts the analyst when a PR whose level has learning (level 6) is
// merged or closed, and the analysis records its candidates and status when its run ends.
import { resolveLevel } from '@pra/core';
import {
  analysisOfRun,
  endAnalysis,
  finishAnalysis,
  prLevel,
  startAnalysis,
  succeededStageOutput,
} from '@pra/db';
import type { PrEventHook } from '../github-events/pr-hooks.ts';
import type { AnalyseOutput } from '../stages/analyse.ts';
import type { RunHook } from './hooks.ts';

/** `closed` and `merged`: one analysis by the bot per PR, at a level with learning. */
export const learningOnClosed: PrEventHook = async ({ deps, repository, pullRequest }) => {
  if (!resolveLevel(prLevel(repository, pullRequest)).features.learning) return;
  const started = await startAnalysis(deps, { pullRequestId: pullRequest.id, startedBy: 'bot' });
  if (started.started) {
    deps.logger.info(
      { pullRequestId: pullRequest.id, analysisId: started.analysis.id, runId: started.run.id },
      'analyst started by the bot',
    );
  }
};

/** The analyst's run completed: its candidates merge into the repository's candidates. */
export const learningOnRunCompleted: RunHook = async ({ deps, run }) => {
  if (run.kind !== 'analyst') return;
  const analysis = await analysisOfRun(deps.db, run.id);
  if (!analysis) return;
  const output = (await succeededStageOutput(deps.db, run.id, 'analyse')) as AnalyseOutput | null;
  const result = await finishAnalysis(deps.db, {
    analysisId: analysis.id,
    proposals: output?.candidates ?? [],
  });
  if (result.finished) {
    deps.logger.info(
      { runId: run.id, analysisId: analysis.id, created: result.created, merged: result.merged },
      'analyst finished',
    );
  }
};

/** The analyst's run failed or was cancelled: "Analyst failed". */
export const learningOnRunEnded: RunHook = async ({ deps, run }) => {
  if (run.kind !== 'analyst') return;
  const analysis = await analysisOfRun(deps.db, run.id);
  if (analysis) await endAnalysis(deps.db, analysis.id, 'failed');
};
