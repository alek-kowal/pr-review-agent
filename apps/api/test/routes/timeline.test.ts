// S-03-T7: the Timeline tab's API: the time summary and every entry with its actor and cost.
import { closeDb, createDb, insertRun, recordTimelineEntry, schema, type Db } from '@pra/db';
import { aRun, seedPullRequest, seedTeamMember, testDatabaseUrl } from '@pra/db/testing';
import { afterAll, expect, test } from 'vitest';
import { TimelineResponse } from '../../src/pr-view/timeline.ts';
import { build } from '../helper.ts';

const writer = createDb(testDatabaseUrl(), { max: 2 });
const readOnlyUrl = new URL(testDatabaseUrl());
readOnlyUrl.searchParams.set('options', '-c default_transaction_read_only=on');
const reader: Db = createDb(readOnlyUrl.toString(), { max: 2 });
afterAll(async () => {
  await closeDb(writer);
  await closeDb(reader);
});

const HOUR = 3_600_000;
const at = (hours: number) => new Date(Date.UTC(2026, 10, 18, 8) + hours * HOUR);

test('the timeline has the time summary by lane and every entry with actor and cost', async () => {
  const { repository, pullRequest } = await seedPullRequest(writer);
  const prId = pullRequest.id;
  const run = await insertRun(writer, aRun(prId, { status: 'completed', costUsd: 1.25 }));
  await insertRun(writer, aRun(prId, { status: 'failed', costUsd: 0.5 }));
  // A trial is not the PR's spend.
  await insertRun(writer, aRun(prId, { kind: 'trial', status: 'completed', costUsd: 9 }));
  await writer.insert(schema.prStateChanges).values(
    (
      [
        ['queued', 'agents_working', 0],
        ['round_running', 'agents_working', 0.5],
        ['findings_to_decide', 'action_needed', 2],
        ['ready_to_merge', 'ready_to_merge', 3],
        ['merged', null, 4],
      ] as const
    ).map(([state, lane, hours]) => ({
      pullRequestId: prId,
      state,
      lane,
      reason: { code: 'test', params: {} },
      headSha: pullRequest.headSha,
      at: at(hours),
    })),
  );
  const ola = await seedTeamMember(writer, { name: 'Ola' });
  await recordTimelineEntry(writer, {
    pullRequestId: prId,
    actor: { kind: 'hand' },
    kind: 'pr_ready',
    params: { via: 'github' },
    at: at(0),
    sourceKey: 'github_event:1:ready',
  });
  await recordTimelineEntry(writer, {
    pullRequestId: prId,
    actor: { kind: 'bot' },
    kind: 'run_finished',
    params: { runKind: 'round', roundNumber: 1 },
    runId: run.id,
    costUsd: 1.25,
    at: at(2),
    sourceKey: `run:${run.id}:ended`,
  });
  await recordTimelineEntry(writer, {
    pullRequestId: prId,
    actor: { kind: 'member', memberId: ola.id },
    kind: 'findings_decided',
    params: { decision: 'reject', count: 1 },
    at: at(3),
    sourceKey: 'decision_batch:1',
  });

  const api = await build({ db: reader });
  const response = await api.inject({
    method: 'GET',
    url: `/api/prs/${repository.slug}/${pullRequest.number}/timeline`,
  });
  expect(response.statusCode).toBe(200);
  const body = TimelineResponse.parse(response.json());

  expect(body.summary).toEqual({
    readyAt: at(0).toISOString(),
    outcome: 'merged',
    totalMs: 4 * HOUR,
    agentsWorkedMs: 2 * HOUR,
    waitingMs: 2 * HOUR,
    byLane: {
      not_reviewed: 0,
      agents_working: 2 * HOUR,
      action_needed: 1 * HOUR,
      ready_to_merge: 1 * HOUR,
    },
    costUsd: 1.75,
  });
  expect(
    body.entries.map(({ kind, actor, memberName, costUsd, runId }) => ({
      kind,
      actor,
      memberName,
      costUsd,
      runId,
    })),
  ).toEqual([
    { kind: 'pr_ready', actor: { kind: 'hand' }, memberName: null, costUsd: null, runId: null },
    {
      kind: 'run_finished',
      actor: { kind: 'bot' },
      memberName: null,
      costUsd: 1.25,
      runId: run.id,
    },
    {
      kind: 'findings_decided',
      actor: { kind: 'member', memberId: ola.id },
      memberName: 'Ola',
      costUsd: null,
      runId: null,
    },
  ]);
});

test('an unknown PR is 404', async () => {
  const api = await build({ db: reader });
  const response = await api.inject({ method: 'GET', url: '/api/prs/nope/1/timeline' });
  expect(response.statusCode).toBe(404);
  expect(response.json()).toMatchObject({ error: { code: 'pr_not_found' } });
});
