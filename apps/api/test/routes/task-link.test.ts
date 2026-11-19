import {
  closeDb,
  createDb,
  getTaskLink,
  timelineOf,
  upsertRepository,
  type Repository,
} from '@pra/db';
import { aRepositoryConfig, testDatabaseUrl } from '@pra/db/testing';
import { IntegrationError, type ClickUpTask } from '@pra/integrations';
import { FakeClickUpGateway } from '@pra/integrations/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PrViewSchema } from '../../src/pr-view/index.ts';
import { TaskLinkResponse } from '../../src/routes/api/task-links/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { seedPr } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
afterAll(() => closeDb(db));

const TASK: ClickUpTask = {
  id: '86c1abc',
  customId: 'WB-12',
  name: 'Rename edge labels inline',
  description: 'Users double-click an edge label to rename it.',
  url: 'https://app.clickup.com/t/86c1abc',
  status: 'in progress',
  listId: '901',
};

let clickup: FakeClickUpGateway;
let app: FastifyInstance;
beforeEach(async () => {
  clickup = new FakeClickUpGateway({ tasks: [TASK] });
  app = await build({ db, clickup });
});

let withClickUp: Repository;
let withoutClickUp: Repository;
beforeAll(async () => {
  withClickUp = await upsertRepository(
    db,
    aRepositoryConfig({
      clickup: {
        workspaceId: '9012',
        spaceId: null,
        followUpListId: null,
        taskIdPattern: 'WB-\\d+',
      },
    }),
  );
  withoutClickUp = await upsertRepository(db, aRepositoryConfig());
});

const link = (repository: Repository, number: number, taskIdOrUrl: string) =>
  app.inject({
    method: 'PUT',
    url: `/api/prs/${repository.slug}/${number}/task-link`,
    headers: SAME_ORIGIN,
    payload: { taskIdOrUrl },
  });

describe('PUT /api/prs/:repo/:number/task-link', () => {
  test('a valid task is stored with how = hand and recorded by hand on the timeline', async () => {
    const pr = await seedPr(db, withClickUp.id);

    const response = await link(withClickUp, pr.number, 'https://app.clickup.com/t/86c1abc');

    expect(response.statusCode).toBe(200);
    expect(TaskLinkResponse.parse(response.json())).toEqual({
      task: {
        configured: true,
        link: {
          taskId: 'WB-12',
          name: 'Rename edge labels inline',
          url: 'https://app.clickup.com/t/86c1abc',
          how: 'hand',
          linkedBy: 'hand',
        },
      },
    });
    expect(clickup.callsOf('getTask')).toEqual([{ method: 'getTask', id: '86c1abc' }]);
    expect(await getTaskLink(db, pr.id)).toMatchObject({
      taskId: 'WB-12',
      how: 'hand',
      linkedBy: 'hand',
      linkedByMemberId: null,
    });
    const entries = await timelineOf(db, pr.id);
    expect(entries.filter((e) => e.kind === 'task_linked')).toMatchObject([
      {
        actor: 'hand',
        memberId: null,
        params: { taskId: 'WB-12', name: 'Rename edge labels inline' },
      },
    ]);

    // The PR page shows it.
    const view = await app.inject({ url: `/api/prs/${withClickUp.slug}/${pr.number}` });
    expect(PrViewSchema.parse(view.json()).task.link).toMatchObject({ taskId: 'WB-12' });
  });

  test('linking again replaces the earlier task', async () => {
    const pr = await seedPr(db, withClickUp.id);
    clickup.tasks.set('86c1xyz', { ...TASK, id: '86c1xyz', customId: null, name: 'Other task' });

    expect((await link(withClickUp, pr.number, 'WB-12')).statusCode).toBe(200);
    expect((await link(withClickUp, pr.number, '86c1xyz')).statusCode).toBe(200);

    expect(await getTaskLink(db, pr.id)).toMatchObject({ taskId: '86c1xyz', name: 'Other task' });
    const entries = await timelineOf(db, pr.id);
    expect(entries.filter((e) => e.kind === 'task_linked')).toHaveLength(2);
  });

  test('an unknown task is 422 task_not_found and stores nothing', async () => {
    const pr = await seedPr(db, withClickUp.id);

    const response = await link(withClickUp, pr.number, 'WB-999');

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: { code: 'task_not_found', params: { taskId: 'WB-999' } },
    });
    expect(await getTaskLink(db, pr.id)).toBeNull();
    expect(await timelineOf(db, pr.id)).toEqual([]);
  });

  test('text that is no task id or link is 422 task_ref_invalid', async () => {
    const pr = await seedPr(db, withClickUp.id);

    const response = await link(withClickUp, pr.number, 'the edge label task');

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: { code: 'task_ref_invalid', params: {} } });
    expect(clickup.callsOf('getTask')).toEqual([]);
  });

  test('a repository without ClickUp is 422 clickup_not_configured; the view says so', async () => {
    const pr = await seedPr(db, withoutClickUp.id);

    const response = await link(withoutClickUp, pr.number, 'WB-12');

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'clickup_not_configured' } });
    const view = await app.inject({ url: `/api/prs/${withoutClickUp.slug}/${pr.number}` });
    expect(PrViewSchema.parse(view.json()).task).toEqual({ configured: false, link: null });
  });

  test('a ClickUp failure is 502 with its reason', async () => {
    const pr = await seedPr(db, withClickUp.id);
    clickup.failNext('getTask', new IntegrationError('clickup_error', { status: 500 }));

    const response = await link(withClickUp, pr.number, 'WB-12');

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: { code: 'clickup_error', params: { status: 500 } } });
  });

  test('without the request header the CSRF guard rejects it', async () => {
    const pr = await seedPr(db, withClickUp.id);
    const response = await app.inject({
      method: 'PUT',
      url: `/api/prs/${withClickUp.slug}/${pr.number}/task-link`,
      payload: { taskIdOrUrl: 'WB-12' },
    });
    expect(response.statusCode).toBe(403);
  });
});
