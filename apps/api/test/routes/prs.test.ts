import {
  closeDb,
  createDb,
  createQueue,
  insertFindings,
  insertQuestions,
  insertRun,
  insertStageExecution,
  sql,
  upsertPullRequest,
  upsertRepository,
} from '@pra/db';
import {
  aFinding,
  aPullRequest,
  aQuestion,
  aRun,
  testDatabaseUrl,
  uniqueId,
} from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { FindingsResponse, PrListResponse } from '../../src/routes/api/prs/index.ts';
import { RepositoriesResponse } from '../../src/routes/api/repositories/index.ts';
import { PrViewSchema } from '../../src/pr-view/index.ts';
import { buildServer } from '../../src/server.ts';

const writer = createDb(testDatabaseUrl(), { max: 2 });
// The api under test reads through a read-only session: any write would fail the request.
const readOnlyUrl = new URL(testDatabaseUrl());
readOnlyUrl.searchParams.set('options', '-c default_transaction_read_only=on');
const reader = createDb(readOnlyUrl.toString(), { max: 2 });
afterAll(async () => {
  await app?.close();
  await closeDb(writer);
  await closeDb(reader);
});

const alpha = `alpha-${uniqueId()}`;
const beta = `beta-${uniqueId()}`;
let app: FastifyInstance;

beforeAll(async () => {
  const a = await upsertRepository(writer, { slug: alpha, githubFullName: `acme/${alpha}` });
  const b = await upsertRepository(writer, { slug: beta, githubFullName: `acme/${beta}` });

  // #1: round 1 completed with findings, then round 1 of a new chain failed at Review.
  const { pullRequest: reviewed } = await upsertPullRequest(
    writer,
    aPullRequest(a.id, { number: 1, title: 'feat: reviewed', updatedAt: new Date('2026-11-03') }),
  );
  const completed = await insertRun(
    writer,
    aRun(reviewed.id, {
      status: 'completed',
      notChecked: ['The migration on real data'],
      costUsd: 0.42,
      createdAt: new Date('2026-11-02T10:00:00Z'),
      startedAt: new Date('2026-11-02T10:00:01Z'),
      finishedAt: new Date('2026-11-02T10:02:00Z'),
    }),
  );
  await insertStageExecution(writer, { runId: completed.id, stage: 'review', status: 'succeeded' });
  await insertFindings(writer, [
    aFinding(completed.id, reviewed.id, 2, { severity: 'nit', title: 'Second' }),
    aFinding(completed.id, reviewed.id, 1, {
      severity: 'blocking',
      title: 'First',
      evidence: [{ file: 'src/index.ts', line: 11, quote: 'items[0]' }],
    }),
  ]);
  await insertQuestions(writer, [aQuestion(completed.id, 1)]);
  const failed = await insertRun(
    writer,
    aRun(reviewed.id, {
      status: 'failed',
      startedBy: 'member',
      startedByMemberId: 'm-7',
      trigger: 'manual',
      createdAt: new Date('2026-11-03T10:00:00Z'),
    }),
  );
  await insertStageExecution(writer, {
    runId: failed.id,
    stage: 'review',
    status: 'failed',
    errorCode: 'model_access_not_configured',
  });

  // #2: a draft with no round; #3: closed; #4: open in the other repository.
  await upsertPullRequest(writer, aPullRequest(a.id, { number: 2, isDraft: true, title: 'wip' }));
  await upsertPullRequest(writer, aPullRequest(a.id, { number: 3, state: 'closed' }));
  await upsertPullRequest(writer, aPullRequest(b.id, { number: 4, title: 'chore: beta' }));

  // Built once for the file (the helper's `build` closes its app after each test).
  app = await buildServer({ db: reader, queue: createQueue(testDatabaseUrl()) }, { logger: false });
  await app.ready();
});

describe('GET /api/repositories', () => {
  test('lists slug and name', async () => {
    const res = await app.inject({ url: '/api/repositories' });

    expect(res.statusCode).toBe(200);
    const body = RepositoriesResponse.parse(res.json());
    expect(body.repositories).toEqual(
      expect.arrayContaining([
        { slug: alpha, name: alpha, githubFullName: `acme/${alpha}` },
        { slug: beta, name: beta, githubFullName: `acme/${beta}` },
      ]),
    );
  });
});

describe('GET /api/prs', () => {
  test('lists open PRs, drafts included, with the latest round status; ?repo= filters', async () => {
    const res = await app.inject({ url: `/api/prs?repo=${alpha}` });

    expect(res.statusCode).toBe(200);
    expect(PrListResponse.parse(res.json())).toEqual({
      pullRequests: [
        {
          repository: { slug: alpha },
          number: 1,
          title: 'feat: reviewed',
          authorLogin: 'octocat',
          isDraft: false,
          latestRoundStatus: 'failed',
        },
        {
          repository: { slug: alpha },
          number: 2,
          title: 'wip',
          authorLogin: 'octocat',
          isDraft: true,
          latestRoundStatus: null,
        },
      ],
    });
  });

  test('without ?repo= it lists every connected repository', async () => {
    const res = await app.inject({ url: '/api/prs' });

    const refs = PrListResponse.parse(res.json()).pullRequests.map(
      (pr) => `${pr.repository.slug}#${pr.number}`,
    );
    expect(refs).toEqual(expect.arrayContaining([`${alpha}#1`, `${alpha}#2`, `${beta}#4`]));
    expect(refs).not.toContain(`${alpha}#3`);
  });

  test('an unknown repository gives 404 repository_not_found', async () => {
    const res = await app.inject({ url: '/api/prs?repo=nope' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'repository_not_found', params: { repo: 'nope' } },
    });
  });
});

describe('GET /api/prs/:repo/:number', () => {
  test('returns the PR and its latest round with every stage, including off ones', async () => {
    const res = await app.inject({ url: `/api/prs/${alpha}/1` });

    expect(res.statusCode).toBe(200);
    const body = PrViewSchema.parse(res.json());
    expect(body.pullRequest).toMatchObject({
      repository: { slug: alpha, name: alpha },
      number: 1,
      title: 'feat: reviewed',
      state: 'open',
      githubUrl: `https://github.com/acme/${alpha}/pull/1`,
    });
    expect(body.latestRound).toMatchObject({
      number: 1,
      status: 'failed',
      level: { number: 1, key: 'diff_only' },
      startedBy: { kind: 'member', memberId: 'm-7' },
      trigger: 'manual',
      costUsd: 0,
      error: { stage: 'review', code: 'model_access_not_configured' },
    });
    expect(
      body.latestRound?.stages.map((s) => [s.key, s.status, s.offReason?.code ?? null]),
    ).toEqual([
      ['checks', 'off', 'off_at_level'],
      ['task', 'off', 'off_at_level'],
      ['change_type', 'off', 'off_at_level'],
      ['review', 'failed', null],
      ['verify', 'off', 'off_at_level'],
    ]);
  });

  test('a PR with no round has latestRound null', async () => {
    const res = await app.inject({ url: `/api/prs/${alpha}/2` });

    expect(PrViewSchema.parse(res.json()).latestRound).toBeNull();
  });

  test('an unknown PR gives 404 pr_not_found; a bad number gives 400', async () => {
    const missing = await app.inject({ url: `/api/prs/${alpha}/999` });
    const otherRepo = await app.inject({ url: `/api/prs/${beta}/1` });
    const bad = await app.inject({ url: `/api/prs/${alpha}/abc` });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: { code: 'pr_not_found', params: { repo: alpha, number: 999 } },
    });
    expect(otherRepo.statusCode).toBe(404);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_request');
  });
});

describe('GET /api/prs/:repo/:number/findings', () => {
  test("returns the latest completed round's findings, questions and not-checked list", async () => {
    const res = await app.inject({ url: `/api/prs/${alpha}/1/findings` });

    expect(res.statusCode).toBe(200);
    const body = FindingsResponse.parse(res.json());
    expect(body.round).toMatchObject({ number: 1, level: { number: 1, key: 'diff_only' } });
    expect(body.findings).toEqual([
      expect.objectContaining({
        ordinal: 1,
        severity: 'blocking',
        title: 'First',
        file: 'src/index.ts',
        line: 11,
        verdict: 'unchecked',
        evidence: [{ file: 'src/index.ts', line: 11, quote: 'items[0]' }],
        scenario: 'When the list is empty, the page crashes.',
        suggestion: 'Return early on an empty list.',
      }),
      expect.objectContaining({ ordinal: 2, severity: 'nit', title: 'Second' }),
    ]);
    expect(body.questions).toEqual([
      expect.objectContaining({ text: 'Should the cache survive a restart?', recommended: 0 }),
    ]);
    expect(body.notChecked).toEqual(['The migration on real data']);
  });

  test('before any completed round it is empty; an unknown PR gives 404', async () => {
    const empty = await app.inject({ url: `/api/prs/${alpha}/2/findings` });
    const missing = await app.inject({ url: `/api/prs/${alpha}/999/findings` });

    expect(empty.json()).toEqual({ round: null, findings: [], questions: [], notChecked: [] });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('pr_not_found');
  });
});

describe('reads never write', () => {
  const TABLES = [
    'repositories',
    'pull_requests',
    'runs',
    'stage_executions',
    'agent_sessions',
    'findings',
    'questions',
    'github_actions',
  ];
  // Only this file's repositories: other test files may write at the same time.
  const counts = async () => {
    const result = await writer.execute<{ counts: Record<string, number> }>(sql`
      with repos as (select id from repositories where slug in (${alpha}, ${beta})),
           prs as (select id from pull_requests where repository_id in (select id from repos)),
           rs as (select id from runs where pull_request_id in (select id from prs))
      select json_build_object(
        'repositories', (select count(*) from repos),
        'pull_requests', (select count(*) from prs),
        'runs', (select count(*) from rs),
        'stage_executions', (select count(*) from stage_executions where run_id in (select id from rs)),
        'agent_sessions', (select count(*) from agent_sessions a join stage_executions s on s.id = a.stage_execution_id where s.run_id in (select id from rs)),
        'findings', (select count(*) from findings where pull_request_id in (select id from prs)),
        'questions', (select count(*) from questions where run_id in (select id from rs)),
        'github_actions', (select count(*) from github_actions where pull_request_id in (select id from prs))
      ) as counts`);
    return result.rows[0]!.counts;
  };

  test("the api's session refuses writes, so a GET that wrote would fail", async () => {
    await expect(reader.execute(sql`create temp table t (x int)`)).rejects.toThrow();
    await expect(
      reader.execute(sql`update repositories set slug = slug where slug = ${alpha}`),
    ).rejects.toThrow();
  });

  test('row counts are unchanged after every GET', async () => {
    const before = await counts();
    expect(Object.keys(before).sort()).toEqual([...TABLES].sort());

    for (const url of [
      '/api/repositories',
      '/api/prs',
      `/api/prs?repo=${alpha}`,
      `/api/prs/${alpha}/1`,
      `/api/prs/${alpha}/2`,
      `/api/prs/${alpha}/1/findings`,
      `/api/prs/${alpha}/999`,
    ]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBeLessThan(500);
      expect(await counts(), url).toEqual(before);
    }
  });
});

test('the endpoints and their schemas appear in /docs/json', async () => {
  const res = await app.inject({ url: '/docs/json' });
  const paths = res.json().paths as Record<string, Record<string, unknown>>;

  const keys = Object.keys(paths);
  expect(keys).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^\/api\/repositories\/?$/),
      expect.stringMatching(/^\/api\/prs\/?$/),
      '/api/prs/{repo}/{number}',
      '/api/prs/{repo}/{number}/findings',
    ]),
  );
  const view = paths['/api/prs/{repo}/{number}']!.get as {
    responses: Record<string, { content: Record<string, { schema: { properties: object } }> }>;
  };
  expect(
    Object.keys(view.responses['200']!.content['application/json']!.schema.properties),
  ).toEqual(['pullRequest', 'latestRound']);
  expect(view.responses['404']).toBeDefined();
});
