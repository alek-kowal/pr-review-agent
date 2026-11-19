// S-15-T3: autofix attempts and level 5 shadow entries appear in the PR timeline, in time order,
// with the bot as actor. Their writers add the Timeline entries, so the route needs no join.
import { reason } from '@pra/core';
import {
  closeDb,
  createDb,
  insertRun,
  recordAutofixAttempt,
  recordShadow,
  recordTimelineEntry,
  type Db,
} from '@pra/db';
import { aRun, seedPullRequest, testDatabaseUrl } from '@pra/db/testing';
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

const MINUTE = 60_000;
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 19, 9) + minutes * MINUTE);

async function timelineOf(slug: string, number: number) {
  const api = await build({ db: reader });
  const response = await api.inject({ method: 'GET', url: `/api/prs/${slug}/${number}/timeline` });
  expect(response.statusCode).toBe(200);
  return TimelineResponse.parse(response.json()).entries;
}

test('level 5: started, pushed and waiting rows in time order, by the bot', async () => {
  const { repository, pullRequest } = await seedPullRequest(writer);
  const prId = pullRequest.id;
  const round = await insertRun(writer, aRun(prId, { status: 'completed' }));
  const implementer = await insertRun(writer, aRun(prId, { kind: 'implementer' }));
  const sensitive = reason('patch_touches_sensitive', {
    path: 'db/migrations/0001.sql',
    pattern: 'db/migrations/**',
  });

  // Written out of order: the route sorts by time, not by insertion.
  await recordAutofixAttempt(writer, {
    pullRequestId: prId,
    chainId: null,
    roundRunId: round.id,
    implementerRunId: implementer.id,
    patchId: null,
    point: 'push',
    outcome: 'waiting',
    reasons: [sensitive],
    at: at(30),
  });
  await recordAutofixAttempt(writer, {
    pullRequestId: prId,
    chainId: null,
    roundRunId: round.id,
    implementerRunId: implementer.id,
    point: 'start',
    outcome: 'started',
    reasons: [reason('autofix_conditions_met', { count: 2 })],
    at: at(10),
  });
  // The push job writes this one with the patch row update.
  await recordTimelineEntry(writer, {
    pullRequestId: prId,
    actor: { kind: 'bot' },
    kind: 'autofix_pushed',
    params: { sha: 'abc1234def', branch: pullRequest.headRef, patchId: 1 },
    at: at(20),
    sourceKey: 'patch:1:pushed',
  });
  // A `pushed` attempt adds no second row: `autofix_pushed` is already there.
  await recordAutofixAttempt(writer, {
    pullRequestId: prId,
    chainId: null,
    implementerRunId: implementer.id,
    point: 'push',
    outcome: 'pushed',
    reasons: [reason('push_conditions_met', {})],
    sha: 'abc1234def',
    at: at(20),
  });

  const entries = await timelineOf(repository.slug, pullRequest.number);
  expect(entries.map(({ kind, actor, at: when }) => ({ kind, actor, at: when }))).toEqual([
    { kind: 'autofix_started', actor: { kind: 'bot' }, at: at(10).toISOString() },
    { kind: 'autofix_pushed', actor: { kind: 'bot' }, at: at(20).toISOString() },
    { kind: 'autofix_waiting', actor: { kind: 'bot' }, at: at(30).toISOString() },
  ]);
  expect(entries[2]!.params).toMatchObject({ point: 'push', reason: sensitive });
  expect(entries[0]!.runId).toBe(implementer.id);
});

test('below level 5: shadow rows say what level 5 would have done, by the bot', async () => {
  const { repository, pullRequest } = await seedPullRequest(writer);
  const prId = pullRequest.id;
  const round = await insertRun(writer, aRun(prId, { status: 'completed' }));
  const questions = reason('open_questions', { count: 1 });

  await recordShadow(writer, {
    pullRequestId: prId,
    repositoryId: repository.id,
    runId: null,
    level: 3,
    point: 'push',
    decision: 'would_wait',
    reasons: [questions],
    fixed: 1,
    total: 2,
    at: at(40),
  });
  await recordShadow(writer, {
    pullRequestId: prId,
    repositoryId: repository.id,
    runId: round.id,
    level: 3,
    point: 'start',
    decision: 'would_start',
    reasons: [reason('autofix_conditions_met', { count: 2 })],
    fixed: 2,
    total: 2,
    at: at(5),
  });

  const entries = await timelineOf(repository.slug, pullRequest.number);
  expect(entries.map(({ kind, actor }) => ({ kind, actor }))).toEqual([
    { kind: 'autofix_shadow', actor: { kind: 'bot' } },
    { kind: 'autofix_shadow', actor: { kind: 'bot' } },
  ]);
  expect(entries[0]).toMatchObject({
    at: at(5).toISOString(),
    runId: round.id,
    params: { point: 'start', decision: 'would_start', fixed: 2, total: 2, level: 3 },
  });
  expect(entries[1]).toMatchObject({
    at: at(40).toISOString(),
    params: { point: 'push', decision: 'would_wait', reason: questions, level: 3 },
  });
});
