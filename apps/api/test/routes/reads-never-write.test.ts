// S-03-T7, NFR "Reads never write": every registered GET route, called against seeded data,
// leaves every table exactly as it was. Own database, so other files' writes do not count.
import {
  closeDb,
  createDb,
  createQueue,
  decideFindings,
  insertAgentSession,
  insertFindings,
  insertQuestions,
  insertRun,
  insertStageExecution,
  recordStateChange,
  recordTimelineEntry,
  sql,
  type Db,
} from '@pra/db';
import {
  aFinding,
  aQuestion,
  aRun,
  createTestDatabase,
  seedPullRequest,
  seedTeamMember,
  type TestDatabase,
} from '@pra/db/testing';
import Fastify, { type RouteOptions } from 'fastify';
import { afterAll, beforeAll, expect, test } from 'vitest';
import app from '../../src/app.ts';
import { testDoubles } from '../helper.ts';

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 2 });
}, 30_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await database?.drop();
});

/** Routes that never answer a plain request: the SSE stream stays open. */
const SKIP = new Set(['/api/live', '/api/live/']);

async function seed() {
  const { repository, pullRequest } = await seedPullRequest(db);
  const member = await seedTeamMember(db, { name: 'Ola' });
  const run = await insertRun(
    db,
    aRun(pullRequest.id, { status: 'completed', startedAt: new Date(), finishedAt: new Date() }),
  );
  const stage = await insertStageExecution(db, {
    runId: run.id,
    stage: 'review',
    attempt: 1,
    status: 'succeeded',
  });
  const session = await insertAgentSession(db, {
    stageExecutionId: stage.id,
    role: 'reviewer',
    model: 'claude-opus-5-5',
    costUsd: 0.2,
    costSource: 'reported',
    status: 'completed',
  });
  const findings = await insertFindings(db, [aFinding(run.id, pullRequest.id, 1)]);
  await insertQuestions(db, [aQuestion(run.id, 1)]);
  await decideFindings(db, {
    pullRequestId: pullRequest.id,
    findingIds: [findings[0]!.id],
    expectedVersions: { [findings[0]!.id]: findings[0]!.version },
    decision: 'defer',
    signedBy: member.id,
  });
  await recordTimelineEntry(db, {
    pullRequestId: pullRequest.id,
    actor: { kind: 'bot' },
    kind: 'run_finished',
    runId: run.id,
    costUsd: 0.2,
    sourceKey: `run:${run.id}:ended`,
  });
  await recordStateChange(db, pullRequest.id, { code: 'run_finished' });
  await insertRun(db, aRun(pullRequest.id, { status: 'running', currentStage: 'review' }));
  return {
    repo: repository.slug,
    number: String(pullRequest.number),
    id: String(run.id),
    sessionId: String(session.id),
    memberId: member.id,
  };
}

/** One md5 per table, over all its rows. */
async function checksums(): Promise<Record<string, string>> {
  const tables = await db.execute<{ name: string }>(sql`
    select format('%I.%I', table_schema, table_name) as name from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
    order by 1`);
  const sums: Record<string, string> = {};
  for (const { name } of tables.rows) {
    const result = await db.execute<{ sum: string }>(
      sql.raw(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as sum
        from ${name} t`),
    );
    sums[name] = result.rows[0]!.sum;
  }
  return sums;
}

// It calls every GET route in turn; under `pnpm verify`'s load that outlasts the default 5 s.
test('no GET route changes any table', { timeout: 30_000 }, async () => {
  const params = await seed();
  const routes: RouteOptions[] = [];
  const server = Fastify({ logger: false });
  server.addHook('onRoute', (route) => {
    routes.push(route);
  });
  const queue = createQueue(database.url);
  await server.register(app, { ...testDoubles(), db, queue });
  await server.ready();

  const gets = routes
    .filter((route) => [route.method].flat().includes('GET'))
    .map((route) => route.url)
    .filter((url) => !SKIP.has(url));
  // The routes this package added are among them.
  expect(gets).toEqual(
    expect.arrayContaining([
      '/api/runs/:id',
      '/api/runs/:id/sessions/:sessionId/transcript',
      '/api/prs/:repo/:number/timeline',
      '/api/activity/in-progress',
      '/api/status/',
      '/api/insights/overview',
      '/api/insights/cost',
      '/api/insights/quality',
      '/api/insights/trust',
      '/api/settings/models/',
      '/api/settings/levels/',
      '/api/settings/levels/:n',
      '/api/audit/',
      '/api/alerts/',
    ]),
  );

  const before = await checksums();
  expect(Object.keys(before)).toEqual(
    expect.arrayContaining(['public.timeline_entries', 'public.pr_state_changes', 'public.runs']),
  );
  const answered: Record<string, number> = {};
  try {
    for (const url of gets) {
      const path = url
        .replace(/:(\w+)/g, (_, name: string) => (params as Record<string, string>)[name] ?? '1')
        .replace('*', '');
      const response = await server.inject({ method: 'GET', url: path });
      answered[url] = response.statusCode;
    }
  } finally {
    await server.close();
  }

  // Every route answered without a server error...
  expect(Object.entries(answered).filter(([, status]) => status >= 500)).toEqual([]);
  // ...and the data routes found the seeded rows.
  expect(answered['/api/runs/:id']).toBe(200);
  expect(answered['/api/prs/:repo/:number/timeline']).toBe(200);
  expect(answered['/api/settings/levels/:n']).toBe(200);
  expect(await checksums()).toEqual(before);
});
