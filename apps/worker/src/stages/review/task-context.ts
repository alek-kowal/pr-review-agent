// Reviewer context provider (S-06-T3): the ClickUp task the run's Task stage linked, so the
// reviewer reads what the PR is meant to do (FR-029).
import { taskOfRun } from '../task.ts';
import type { ReviewerContextProvider } from './context.ts';

export const taskContextProvider: ReviewerContextProvider = {
  key: 'task',
  async sections({ deps, run }) {
    const output = await taskOfRun(deps.db, run.id);
    if (output?.status !== 'linked') return [];
    const { task } = output;
    const head = [`${task.name} (${task.customId ?? task.id}): ${task.url}`];
    if (task.status) head.push(`Status: ${task.status}`);
    const description = task.description.trim() || '(no description)';
    return [{ title: 'ClickUp task', body: `${head.join('\n')}\n\n${description}` }];
  },
};
