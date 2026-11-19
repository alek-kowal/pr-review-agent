import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { IntegrationError, IntegrationNotConfiguredError } from '../errors.ts';
import { FakeClickUpGateway } from '../testing/clickup.ts';
import { isCustomTaskId, type ClickUpSettings } from './clickup-gateway.ts';
import {
  CLICKUP_API,
  createClickUpGateway,
  HttpClickUpGateway,
  UnconfiguredClickUpGateway,
} from './http-clickup-gateway.ts';

const KEY = 'pk_test_never_logged';
const SETTINGS: ClickUpSettings = { workspaceId: '9012', spaceId: '777' };
const NOW = Date.parse('2026-11-19T12:00:00Z');
const PR_URL = 'https://github.com/synergycodes/workflowbuilder/pull/12';

const rawTask = (overrides: Record<string, unknown> = {}) => ({
  id: '86c0abc',
  custom_id: 'WB-123',
  name: 'Make saving reliable',
  markdown_description: '## Goal\nSaves never overwrite each other.',
  description: 'Goal Saves never overwrite each other.',
  url: 'https://app.clickup.com/t/86c0abc',
  status: { status: 'in progress' },
  list: { id: '901' },
  ...overrides,
});

/** Every request the double saw, with its URL, method, headers and JSON body. */
const requests: { method: string; url: URL; auth: string | null; body: unknown }[] = [];
const server = setupServer();
server.events.on('request:start', async ({ request }) => {
  const text = request.method === 'GET' ? '' : await request.clone().text();
  requests.push({
    method: request.method,
    url: new URL(request.url),
    auth: request.headers.get('authorization'),
    body: text ? JSON.parse(text) : null,
  });
});
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  requests.length = 0;
});
afterAll(() => server.close());

const gateway = () => new HttpClickUpGateway({ apiKey: KEY, now: () => NOW });

describe('HttpClickUpGateway', () => {
  test('whoAmI reads the key’s user; a 401 is clickup_auth_failed', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.get(`${CLICKUP_API}/user`, ({ request }) => {
        keys.push(request.headers.get('authorization'));
        return keys.length === 1
          ? HttpResponse.json({ user: { id: 42, username: 'Bot', email: 'x' } })
          : HttpResponse.json({ err: 'Token invalid' }, { status: 401 });
      }),
    );

    expect(await gateway().whoAmI()).toEqual({ id: '42', username: 'Bot' });
    await expect(gateway().whoAmI()).rejects.toMatchObject({ code: 'clickup_auth_failed' });
    expect(keys).toEqual([KEY, KEY]);
    expect(gateway().missingEnv).toEqual([]);
  });

  test('getTask by custom id sends custom_task_ids and the workspace, and maps the task', async () => {
    server.use(http.get(`${CLICKUP_API}/task/:id`, () => HttpResponse.json(rawTask())));
    const task = await gateway().getTask(SETTINGS, 'WB-123');

    expect(task).toEqual({
      id: '86c0abc',
      customId: 'WB-123',
      name: 'Make saving reliable',
      description: '## Goal\nSaves never overwrite each other.',
      url: 'https://app.clickup.com/t/86c0abc',
      status: 'in progress',
      listId: '901',
    });
    const [request] = requests;
    expect(request!.method).toBe('GET');
    expect(request!.url.pathname).toBe('/api/v2/task/WB-123');
    expect(Object.fromEntries(request!.url.searchParams)).toEqual({
      custom_task_ids: 'true',
      team_id: '9012',
      include_markdown_description: 'true',
    });
    expect(request!.auth).toBe(KEY);
  });

  test('getTask by default id sends no custom id flags; 404 is null', async () => {
    server.use(
      http.get(`${CLICKUP_API}/task/:id`, ({ params }) =>
        params.id === '86c0abc'
          ? HttpResponse.json(rawTask({ custom_id: null, markdown_description: undefined }))
          : HttpResponse.json({ err: 'Task not found' }, { status: 404 }),
      ),
    );
    const task = await gateway().getTask(SETTINGS, '86c0abc');
    expect(task).toMatchObject({
      customId: null,
      description: 'Goal Saves never overwrite each other.',
    });
    expect(requests[0]!.url.searchParams.has('custom_task_ids')).toBe(false);
    expect(await gateway().getTask(SETTINGS, 'gone1')).toBeNull();
  });

  test('findTaskMentioningPr pages through recent tasks of the space for the PR link', async () => {
    server.use(
      http.get(`${CLICKUP_API}/team/:team/task`, ({ request }) => {
        const page = new URL(request.url).searchParams.get('page');
        return HttpResponse.json(
          page === '0'
            ? {
                tasks: [
                  rawTask({ id: 'a', markdown_description: `See ${PR_URL}3 for the other one` }),
                ],
                last_page: false,
              }
            : {
                tasks: [rawTask({ id: 'b', markdown_description: `PR: ${PR_URL}` })],
                last_page: true,
              },
        );
      }),
    );
    const task = await gateway().findTaskMentioningPr(SETTINGS, PR_URL);

    expect(task?.id).toBe('b');
    expect(requests).toHaveLength(2);
    const query = requests[0]!.url.searchParams;
    expect(requests[0]!.url.pathname).toBe('/api/v2/team/9012/task');
    expect(query.get('space_ids[]')).toBe('777');
    expect(query.get('include_closed')).toBe('true');
    expect(query.get('subtasks')).toBe('true');
    expect(query.get('date_updated_gt')).toBe(String(NOW - 90 * 24 * 3600 * 1000));
  });

  test('findTaskMentioningPr stops at the last page and returns null', async () => {
    server.use(
      http.get(`${CLICKUP_API}/team/:team/task`, () =>
        HttpResponse.json({ tasks: [rawTask()], last_page: true }),
      ),
    );
    expect(await gateway().findTaskMentioningPr({ workspaceId: '9012' }, PR_URL)).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url.searchParams.has('space_ids[]')).toBe(false);
  });

  test('createComment posts plain text, or a tag for the mentioned user', async () => {
    server.use(
      http.post(`${CLICKUP_API}/task/:id/comment`, () =>
        HttpResponse.json({ id: 458, hist_id: 'h', date: 1 }),
      ),
    );
    expect(await gateway().createComment(SETTINGS, '86c0abc', { text: 'Review done.' })).toEqual({
      id: '458',
    });
    expect(requests[0]!.body).toEqual({ comment_text: 'Review done.', notify_all: false });

    await gateway().createComment(SETTINGS, 'WB-123', {
      text: 'Please look.',
      mentionUserId: '42',
    });
    expect(requests[1]!.url.pathname).toBe('/api/v2/task/WB-123/comment');
    expect(requests[1]!.url.searchParams.get('custom_task_ids')).toBe('true');
    expect(requests[1]!.body).toEqual({
      comment: [{ type: 'tag', user: { id: 42 } }, { text: ' Please look.' }],
      notify_all: false,
    });
  });

  test('createTask posts name, markdown description and parent to the list', async () => {
    server.use(
      http.post(`${CLICKUP_API}/list/:list/task`, () =>
        HttpResponse.json(rawTask({ id: 'new1', url: 'https://app.clickup.com/t/new1' })),
      ),
    );
    const created = await gateway().createTask(SETTINGS, '901', {
      name: 'Follow-up: race in save',
      description: '**From PR #12**',
      parentId: '86c0abc',
    });
    expect(created).toEqual({ id: 'new1', url: 'https://app.clickup.com/t/new1' });
    expect(requests[0]!.url.pathname).toBe('/api/v2/list/901/task');
    expect(requests[0]!.body).toEqual({
      name: 'Follow-up: race in save',
      markdown_content: '**From PR #12**',
      parent: '86c0abc',
    });

    await gateway().createTask(SETTINGS, '901', { name: 'n', description: 'd' });
    expect(requests[1]!.body).toEqual({ name: 'n', markdown_content: 'd' });
  });

  test('a 401 is clickup_auth_failed; other failures are clickup_error with the status', async () => {
    server.use(
      http.get(`${CLICKUP_API}/task/:id`, ({ params }) =>
        params.id === 'auth1'
          ? HttpResponse.json({ err: 'Token invalid', ECODE: 'OAUTH_025' }, { status: 401 })
          : HttpResponse.json({ err: 'Rate limited' }, { status: 429 }),
      ),
    );
    await expect(gateway().getTask(SETTINGS, 'auth1')).rejects.toMatchObject({
      code: 'clickup_auth_failed',
    });
    const error = await gateway()
      .getTask(SETTINGS, 'busy1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error).toMatchObject({ code: 'clickup_error', params: { status: 429 } });
  });

  test('a repository without ClickUp settings fails before any request', async () => {
    const calls = [
      gateway().getTask(null, 'WB-1'),
      gateway().findTaskMentioningPr(null, PR_URL),
      gateway().createComment(null, 'WB-1', { text: 'x' }),
      gateway().createTask(null, '901', { name: 'n', description: 'd' }),
    ];
    for (const call of calls) {
      await expect(call).rejects.toMatchObject({ code: 'clickup_not_configured' });
    }
    expect(requests).toHaveLength(0);
  });
});

describe('createClickUpGateway', () => {
  test('a missing key gives clickup_not_configured on every call, without any request', async () => {
    const unconfigured = createClickUpGateway({});
    expect(unconfigured).toBeInstanceOf(UnconfiguredClickUpGateway);
    const calls = [
      unconfigured.getTask(SETTINGS, 'WB-1'),
      unconfigured.findTaskMentioningPr(SETTINGS, PR_URL),
      unconfigured.createComment(SETTINGS, 'WB-1', { text: 'x' }),
      unconfigured.createTask(SETTINGS, '901', { name: 'n', description: 'd' }),
    ];
    for (const call of calls) {
      const error = await call.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(IntegrationNotConfiguredError);
      expect(error).toMatchObject({
        code: 'clickup_not_configured',
        params: { missing: ['CLICKUP_API_KEY'] },
      });
    }
    expect(requests).toHaveLength(0);
    expect(createClickUpGateway({ CLICKUP_API_KEY: KEY })).toBeInstanceOf(HttpClickUpGateway);
  });
});

describe('ClickUp ids and the fake', () => {
  test('custom ids have a prefix and a number; default ids have no dash', () => {
    expect(isCustomTaskId('WB-123')).toBe(true);
    expect(isCustomTaskId('86c0abc')).toBe(false);
    expect(isCustomTaskId('WB-')).toBe(false);
  });

  test('FakeClickUpGateway finds by custom id and PR link, and records writes', async () => {
    const fake = new FakeClickUpGateway({
      tasks: [
        {
          id: '86c0abc',
          customId: 'WB-123',
          name: 'Save',
          description: `PR ${PR_URL}`,
          url: 'https://app.clickup.com/t/86c0abc',
          status: 'open',
          listId: '901',
        },
      ],
    });
    expect((await fake.getTask(SETTINGS, 'wb-123'))?.id).toBe('86c0abc');
    expect((await fake.findTaskMentioningPr(SETTINGS, `${PR_URL}`))?.id).toBe('86c0abc');
    expect(await fake.findTaskMentioningPr(SETTINGS, `${PR_URL.slice(0, -1)}`)).toBeNull();
    await fake.createComment(SETTINGS, '86c0abc', { text: 'Done.' });
    expect(fake.calls.at(-1)).toEqual({
      method: 'createComment',
      taskId: '86c0abc',
      text: 'Done.',
      mentionUserId: null,
    });
    await expect(fake.getTask(null, 'WB-123')).rejects.toMatchObject({
      code: 'clickup_not_configured',
    });
  });
});
