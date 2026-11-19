// S-06-T3: the Task stage with a `FakeClickUpGateway`, and the task reaching the reviewer.
import type { RepositoryConfig } from '@pra/core';
import {
  and,
  eq,
  getRun,
  getTaskLink,
  insertRun,
  schema,
  upsertPullRequest,
  upsertTaskLink,
  type PullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import { aPullRequest, aRun } from '@pra/db/testing';
import { CliGitMirror, IntegrationError, type ClickUpTask } from '@pra/integrations';
import {
  createGitFixture,
  FakeClickUpGateway,
  isolatedGitExec,
  type GitFixture,
} from '@pra/integrations/testing';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { executeStage } from '../src/run/execute-stage.ts';
import { reviewStage } from '../src/stages/review/index.ts';
import { pullRequestUrl, type TaskOutput } from '../src/stages/task.ts';
import {
  connectRepository,
  createTestWorkerDeps,
  jobsWhere,
  type TestWorkerDeps,
} from './support.ts';

const CLICKUP: RepositoryConfig['clickup'] = {
  workspaceId: '9012',
  spaceId: null,
  followUpListId: null,
  taskIdPattern: 'WB-\\d+',
};

const TASK: ClickUpTask = {
  id: '86c1abc',
  customId: 'WB-12',
  name: 'Rename edge labels inline',
  description: 'Users double-click an edge label to rename it. Empty labels fall back to the id.',
  url: 'https://app.clickup.com/t/86c1abc',
  status: 'in progress',
  listId: '901',
};

let fixture: GitFixture;
let deps: TestWorkerDeps;

beforeAll(async () => {
  fixture = await createGitFixture();
  deps = await createTestWorkerDeps();
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
});

afterAll(async () => {
  await deps.close();
  await fixture.remove();
});

beforeEach(() => {
  deps.clickup = new FakeClickUpGateway({ tasks: [TASK] });
});

type Setup = { repository: Repository; pullRequest: PullRequest; run: Run };

async function setup(
  pr: { headRef?: string; title?: string } = {},
  clickup: RepositoryConfig['clickup'] = CLICKUP,
): Promise<Setup> {
  const repository = await connectRepository(deps.db, { clickup });
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha, ...pr }),
  );
  const run = await insertRun(
    deps.db,
    aRun(pullRequest.id, { levelNumber: 2, headSha: fixture.headSha }),
  );
  return { repository, pullRequest, run };
}

/** Runs Checks, then Task; returns the Task stage row. */
async function runTaskStage(run: Run) {
  expect(await executeStage(deps, run.id, 'checks')).toBe('succeeded');
  const outcome = await executeStage(deps, run.id, 'task');
  const [row] = await deps.db
    .select()
    .from(schema.stageExecutions)
    .where(and(eq(schema.stageExecutions.runId, run.id), eq(schema.stageExecutions.stage, 'task')));
  return { outcome, row: row!, output: row!.output as TaskOutput };
}

describe('Task stage', () => {
  test('an id in the branch links the PR without a search call', async () => {
    const { pullRequest, run } = await setup({ headRef: 'feature/wb-12-edge-labels' });

    const { outcome, output } = await runTaskStage(run);

    expect(outcome).toBe('succeeded');
    expect(output).toMatchObject({
      status: 'linked',
      how: 'branch',
      task: { id: TASK.id, customId: 'WB-12', name: TASK.name, description: TASK.description },
    });
    expect(deps.clickup.callsOf('getTask')).toEqual([{ method: 'getTask', id: 'wb-12' }]);
    expect(deps.clickup.callsOf('findTaskMentioningPr')).toEqual([]);
    expect(await getTaskLink(deps.db, pullRequest.id)).toMatchObject({
      taskId: 'WB-12',
      how: 'branch',
      linkedBy: 'bot',
      url: TASK.url,
    });
  });

  test('an id in the title links with how = title', async () => {
    const { run } = await setup({ headRef: 'edge-labels', title: 'WB-12: rename edge labels' });

    const { output } = await runTaskStage(run);

    expect(output).toMatchObject({ status: 'linked', how: 'title' });
  });

  test('without an id the PR is linked by a task that mentions it', async () => {
    const { repository, pullRequest, run } = await setup({ headRef: 'edge-labels' });
    const prUrl = pullRequestUrl(repository.githubFullName, pullRequest.number);
    deps.clickup.tasks.set('search-1', {
      ...TASK,
      id: 'search-1',
      customId: null,
      description: `Implementation: ${prUrl}`,
    });

    const { output } = await runTaskStage(run);

    expect(output).toMatchObject({ status: 'linked', how: 'search', task: { id: 'search-1' } });
    expect(deps.clickup.callsOf('getTask')).toEqual([]);
    expect(deps.clickup.callsOf('findTaskMentioningPr')).toEqual([
      { method: 'findTaskMentioningPr', prUrl },
    ]);
    expect(await getTaskLink(deps.db, pullRequest.id)).toMatchObject({
      taskId: 'search-1',
      how: 'search',
    });
  });

  test('a link made by hand is kept and its task read again', async () => {
    const { pullRequest, run } = await setup({ headRef: 'edge-labels' });
    await upsertTaskLink(deps.db, {
      pullRequestId: pullRequest.id,
      taskId: 'WB-12',
      url: TASK.url,
      name: 'old name',
      how: 'hand',
      linkedBy: 'hand',
      linkedByMemberId: null,
    });

    const { output } = await runTaskStage(run);

    expect(output).toMatchObject({ status: 'linked', how: 'hand', task: { name: TASK.name } });
    expect(deps.clickup.callsOf('findTaskMentioningPr')).toEqual([]);
    expect(await getTaskLink(deps.db, pullRequest.id)).toMatchObject({ how: 'hand' });
  });

  test('the reviewer receives the task name and description', async () => {
    const { pullRequest, repository, run } = await setup({ headRef: 'feature/WB-12' });
    await runTaskStage(run);
    deps.agentRunner.enqueue({
      output: { summary: 's', risk: 'low', findings: [], questions: [], notChecked: [] },
    });

    const result = await reviewStage.run({
      deps,
      run: (await getRun(deps.db, run.id))!,
      pullRequest,
      repository,
      level: run.level,
      attempt: 1,
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('succeeded');
    const call = deps.agentRunner.calls.at(-1)!;
    const brief = await readFile(path.join(call.cwd, 'brief.md'), 'utf8').catch(() => null);
    // The session folder is kept until the run ends; the brief holds the task section.
    expect(brief).toContain('## ClickUp task');
    expect(brief).toContain(TASK.description);
    expect(brief).toContain('Status: in progress');
  });

  test('a repository without ClickUp settings records it and the round goes on', async () => {
    const { run } = await setup({ headRef: 'feature/WB-12' }, null);

    const { outcome, output } = await runTaskStage(run);

    expect(outcome).toBe('succeeded');
    expect(output).toEqual({
      status: 'not_configured',
      reason: { code: 'clickup_not_configured', params: { missing: ['RepositoryConfig.clickup'] } },
    });
    expect(deps.clickup.calls).toEqual([]);
    expect((await getRun(deps.db, run.id))!.status).toBe('running');
    const jobs = await jobsWhere(deps.db, 'run.stage', 'runId', run.id);
    expect(jobs.map((job) => job.data.stage)).toContain('change_type');
  });

  test('no ClickUp key on the server is recorded as not configured too', async () => {
    deps.clickup = new FakeClickUpGateway({ unconfigured: true });
    const { run } = await setup({ headRef: 'feature/WB-12' });

    const { outcome, output } = await runTaskStage(run);

    expect(outcome).toBe('succeeded');
    expect(output).toMatchObject({
      status: 'not_configured',
      reason: { code: 'clickup_not_configured', params: { missing: ['CLICKUP_API_KEY'] } },
    });
  });

  test('a PR with no task records it and the round goes on', async () => {
    const { run } = await setup({ headRef: 'edge-labels', title: 'Rename labels' });

    const { outcome, output } = await runTaskStage(run);

    expect(outcome).toBe('succeeded');
    expect(output).toEqual({
      status: 'no_task',
      reason: { code: 'no_task_linked', params: { searchedId: null } },
    });
    expect((await getRun(deps.db, run.id))!.status).toBe('running');
  });

  test('a 500 from ClickUp fails the Task stage with clickup_error', async () => {
    deps.clickup.failNext('getTask', new IntegrationError('clickup_error', { status: 500 }));
    const { run } = await setup({ headRef: 'feature/WB-12' });

    const { outcome, row } = await runTaskStage(run);

    expect(outcome).toBe('failed');
    expect(row).toMatchObject({ status: 'failed', errorCode: 'clickup_error' });
    expect((await getRun(deps.db, run.id))!.status).toBe('failed');
  });
});
