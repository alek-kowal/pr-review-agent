// The Task stage (S-06-T3), from level 2: links the PR to its ClickUp task (an id in the branch
// or title, else a task that mentions the PR) and keeps the task for the reviewer, the judge and
// the verifier. No ClickUp for the repository, or no task found, is recorded and the round goes
// on; a ClickUp error fails the stage so Retry is offered.
import { findTaskId } from '@pra/core';
import {
  getTaskLink,
  readRepositoryConfig,
  succeededStageOutput,
  upsertTaskLink,
  type Db,
  type TaskLinkHow,
} from '@pra/db';
import { CLICKUP_NOT_CONFIGURED, IntegrationError, type ClickUpTask } from '@pra/integrations';
import type { StageContext, StageError, StageExecutor, StageResult } from './stage.ts';

/** A reason code with params, as stage outputs carry them (the web maps codes to copy). */
const reason = (code: string, params: Record<string, unknown> = {}): StageError => ({
  code,
  params,
});

/** A task description longer than this is cut in the stage output and in the agents' input. */
export const TASK_DESCRIPTION_LIMIT = 20_000;

export type TaskOutput =
  | {
      status: 'linked';
      how: TaskLinkHow;
      task: {
        id: string;
        customId: string | null;
        name: string;
        url: string;
        status: string | null;
        description: string;
      };
    }
  /** `clickup_not_configured`, `no_task_linked` or `linked_task_not_found`. */
  | { status: 'not_configured' | 'no_task'; reason: StageError };

export const taskStage: StageExecutor = {
  key: 'task',
  usesAgent: false,
  run: runTask,
};

/** The PR's address on GitHub, as a task description would link it. */
export const pullRequestUrl = (fullName: string, number: number): string =>
  `https://github.com/${fullName}/pull/${number}`;

async function runTask(context: StageContext): Promise<StageResult> {
  const { deps, pullRequest, repository } = context;
  const settings = readRepositoryConfig(repository).value.clickup;
  const done = (output: TaskOutput): StageResult => ({
    status: 'succeeded',
    output,
    sessions: [],
    findings: [],
    questions: [],
    notChecked: [],
  });

  if (!settings) {
    return done({
      status: 'not_configured',
      reason: reason('clickup_not_configured', { missing: ['RepositoryConfig.clickup'] }),
    });
  }

  try {
    const link = await getTaskLink(deps.db, pullRequest.id);
    if (link) {
      // An earlier round, or a person, already linked it: read the task again for its text.
      const task = await deps.clickup.getTask(settings, link.taskId);
      if (!task) {
        return done({
          status: 'no_task',
          reason: reason('linked_task_not_found', { taskId: link.taskId }),
        });
      }
      return done(linked(task, link.how));
    }

    let found: { task: ClickUpTask; how: TaskLinkHow } | null = null;
    const fromBranch = findTaskId(pullRequest.headRef, '', settings.taskIdPattern);
    const id = fromBranch ?? findTaskId('', pullRequest.title, settings.taskIdPattern);
    if (id) {
      const task = await deps.clickup.getTask(settings, id);
      if (task) found = { task, how: fromBranch ? 'branch' : 'title' };
    }
    if (!found) {
      const prUrl = pullRequestUrl(repository.githubFullName, pullRequest.number);
      const task = await deps.clickup.findTaskMentioningPr(settings, prUrl);
      if (task) found = { task, how: 'search' };
    }
    if (!found) {
      return done({ status: 'no_task', reason: reason('no_task_linked', { searchedId: id }) });
    }

    await upsertTaskLink(deps.db, {
      pullRequestId: pullRequest.id,
      taskId: found.task.customId ?? found.task.id,
      url: found.task.url,
      name: found.task.name,
      how: found.how,
      linkedBy: 'bot',
      linkedByMemberId: null,
    });
    return done(linked(found.task, found.how));
  } catch (error) {
    // No ClickUp key on this server: like a repository without ClickUp, the round goes on.
    if (error instanceof IntegrationError && error.code === CLICKUP_NOT_CONFIGURED) {
      return done({ status: 'not_configured', reason: reason(error.code, error.params) });
    }
    throw error;
  }
}

function linked(task: ClickUpTask, how: TaskLinkHow): TaskOutput {
  return {
    status: 'linked',
    how,
    task: {
      id: task.id,
      customId: task.customId,
      name: task.name,
      url: task.url,
      status: task.status,
      description: task.description.slice(0, TASK_DESCRIPTION_LIMIT),
    },
  };
}

/** The task the run's Task stage linked, or null (no ClickUp, no task, or no Task stage). */
export async function taskOfRun(db: Db, runId: number): Promise<TaskOutput | null> {
  const output = (await succeededStageOutput(db, runId, 'task')) as TaskOutput | null;
  return output?.status === 'linked' ? output : null;
}

/** The task as plain text for the judge and the verifier: name, status and description. */
export function taskText(output: TaskOutput | null): string | null {
  if (output?.status !== 'linked') return null;
  const { task } = output;
  const id = task.customId ?? task.id;
  return [`# ${task.name} (${id})`, task.status ? `Status: ${task.status}` : '', task.description]
    .filter(Boolean)
    .join('\n\n');
}
