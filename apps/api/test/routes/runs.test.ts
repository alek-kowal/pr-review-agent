// S-03-T6: Run detail and the transcript route, against a seeded failed run. The api reads through
// a read-only session, so any write would fail the request.
import {
  closeDb,
  createDb,
  ensureInstructionFile,
  insertAgentSession,
  insertRun,
  insertStageExecution,
  schema,
  type Db,
} from '@pra/db';
import { aRun, seedPullRequest, testDatabaseUrl } from '@pra/db/testing';
import { LocalBlobStore } from '@pra/integrations';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { RunDetailResponse } from '../../src/routes/api/runs/index.ts';
import { build } from '../helper.ts';

const writer = createDb(testDatabaseUrl(), { max: 2 });
const readOnlyUrl = new URL(testDatabaseUrl());
readOnlyUrl.searchParams.set('options', '-c default_transaction_read_only=on');
const reader: Db = createDb(readOnlyUrl.toString(), { max: 2 });
const blobStore = new LocalBlobStore(mkdtempSync(path.join(tmpdir(), 'pra-runs-blobs-')));
afterAll(async () => {
  await closeDb(writer);
  await closeDb(reader);
});

const TRANSCRIPT = [
  { type: 'system', subtype: 'init' },
  {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: 'apps/demo/src/edges.ts' } },
        { type: 'tool_use', name: 'Grep', input: { pattern: 'onRename' } },
      ],
    },
  },
];

let seeded: { runId: number; slug: string; number: number; reviewSessionId: number };

beforeAll(async () => {
  const { repository, pullRequest } = await seedPullRequest(writer);
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 19, 10, minute));
  const run = await insertRun(
    writer,
    aRun(pullRequest.id, {
      levelNumber: 2,
      status: 'failed',
      startedAt: at(0),
      finishedAt: at(9),
      costUsd: 0.45,
      instructionVersions: [{ id: 7, scope: 'global', fileKey: 'review-rules.md', version: 3 }],
    }),
  );
  const stage = (key: string, status: 'succeeded' | 'failed' | 'off', minute: number) =>
    insertStageExecution(writer, {
      runId: run.id,
      stage: key,
      attempt: 1,
      status,
      startedAt: status === 'off' ? null : at(minute),
      finishedAt: status === 'off' ? null : at(minute + 1),
      errorCode: status === 'failed' ? 'stage_timeout' : null,
      output: status === 'succeeded' ? { summary: `${key} done` } : null,
    });
  await stage('verify', 'off', 0);
  await stage('checks', 'succeeded', 1);
  const task = await stage('task', 'succeeded', 2);
  const changeType = await stage('change_type', 'succeeded', 3);
  const review = await stage('review', 'failed', 4);

  const session = (
    stageExecutionId: number,
    role: 'judge' | 'reviewer',
    costUsd: number,
    key?: string,
  ) =>
    insertAgentSession(writer, {
      stageExecutionId,
      role,
      model: 'claude-sonnet-5-5',
      costUsd,
      costSource: 'reported',
      status: role === 'reviewer' ? 'failed' : 'completed',
      turns: 3,
      transcriptBlobKey: key ?? null,
    });
  await session(task.id, 'judge', 0.1);
  await session(changeType.id, 'judge', 0.05);
  const key = `runs/${run.id}/review-1/session-1/transcript.json`;
  await blobStore.put(key, JSON.stringify(TRANSCRIPT), { contentType: 'application/json' });
  const reviewSession = await session(review.id, 'reviewer', 0.3, key);

  seeded = {
    runId: run.id,
    slug: repository.slug,
    number: pullRequest.number,
    reviewSessionId: reviewSession.id,
  };
});

// `build` closes the app when the test ends, so each call builds one.
const get = async (url: string) =>
  (await build({ db: reader, blobStore })).inject({ method: 'GET', url });

test('Run detail lists succeeded and failed stages, sessions and the cost up to the failure', async () => {
  const response = await get(`/api/runs/${seeded.runId}`);
  expect(response.statusCode).toBe(200);
  const body = RunDetailResponse.parse(response.json());

  expect(body.run).toMatchObject({
    id: seeded.runId,
    status: 'failed',
    level: { number: 2 },
    startedBy: { kind: 'bot' },
    error: { stage: 'review', code: 'stage_timeout' },
    instructionVersions: [{ id: 7, scope: 'global', fileKey: 'review-rules.md', version: 3 }],
  });
  expect(body.pullRequest).toMatchObject({
    repository: { slug: seeded.slug },
    number: seeded.number,
  });
  expect(body.label).toMatchObject({
    code: 'round_label',
    params: { roundNumber: 1, max: 3, trigger: 'ready_for_review' },
  });
  expect(body.stages.map((s) => [s.key, s.status, s.costUsd])).toEqual([
    ['checks', 'done', 0],
    ['task', 'done', 0.1],
    ['change_type', 'done', 0.05],
    ['review', 'failed', 0.3],
    ['verify', 'off', 0],
  ]);
  expect(body.stages[1]!.output).toEqual({ summary: 'task done' });
  const review = body.stages[3]!;
  expect(review.errorCode).toBe('stage_timeout');
  expect(review.sessions).toEqual([
    expect.objectContaining({
      id: seeded.reviewSessionId,
      role: 'reviewer',
      costUsd: 0.3,
      filesRead: ['apps/demo/src/edges.ts'],
      actions: [{ tool: 'Grep', target: 'onRename' }],
      hasTranscript: true,
    }),
  ]);
  expect(body.stages[1]!.sessions[0]).toMatchObject({ filesRead: [], hasTranscript: false });
  expect(body.totalCostUsd).toBeCloseTo(0.45, 6);
});

test('Run detail gives every frozen file its kind (KINDS)', async () => {
  const { pullRequest } = await seedPullRequest(writer);
  // A document named like rules: only the stored file knows its kind.
  const file = await ensureInstructionFile(writer, {
    scope: 'global',
    fileKey: `kinds-${pullRequest.id}-rules.md`,
    kind: 'document',
  });
  const [stored] = await writer
    .insert(schema.instructionVersions)
    .values({ fileId: file.id, version: 1, status: 'active', content: '' })
    .returning();
  const run = await insertRun(
    writer,
    aRun(pullRequest.id, {
      status: 'failed',
      instructionVersions: [
        // No frozen kind (a run from before STAGEFILES): the file's kind.
        { id: stored!.id, scope: 'global', fileKey: file.fileKey, version: 1 },
        // No frozen kind and no stored version: the default for the name.
        { id: 999_999_001, scope: 'global', fileKey: 'feature-map/billing.md', version: 1 },
        { id: 999_999_002, scope: 'global', fileKey: 'prompt-verifier.md', version: 2 },
        // The frozen kind wins.
        {
          id: 999_999_003,
          scope: 'global',
          fileKey: 'lessons.md',
          version: 2,
          kind: 'instruction',
        },
      ],
    }),
  );
  const body = RunDetailResponse.parse((await get(`/api/runs/${run.id}`)).json());
  expect(body.run.instructionVersions.map((v) => [v.fileKey, v.kind])).toEqual([
    [file.fileKey, 'document'],
    ['feature-map/billing.md', 'document'],
    ['prompt-verifier.md', 'instruction'],
    ['lessons.md', 'instruction'],
  ]);
});

test('the transcript route sends the stored log', async () => {
  const response = await get(
    `/api/runs/${seeded.runId}/sessions/${seeded.reviewSessionId}/transcript`,
  );
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toMatch(/^application\/json/);
  expect(response.json()).toEqual(TRANSCRIPT);
});

test('unknown runs, sessions of another run and missing transcripts are 404', async () => {
  expect((await get('/api/runs/999999999')).json()).toMatchObject({
    error: { code: 'run_not_found' },
  });
  const other = await get(`/api/runs/999999999/sessions/${seeded.reviewSessionId}/transcript`);
  expect(other.statusCode).toBe(404);
  expect(other.json()).toMatchObject({ error: { code: 'session_not_found' } });
  const detail = RunDetailResponse.parse((await get(`/api/runs/${seeded.runId}`)).json());
  const judge = detail.stages[1]!.sessions[0]!;
  const missing = await get(`/api/runs/${seeded.runId}/sessions/${judge.id}/transcript`);
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toMatchObject({ error: { code: 'transcript_not_found' } });
});

// S-03-T9: the PR page's stepper reads the same steps and cost from the PR view.
test('the PR view carries the latest round progress: label, steps with cost, cost so far', async () => {
  const response = await get(`/api/prs/${seeded.slug}/${seeded.number}`);
  expect(response.statusCode).toBe(200);
  const { roundProgress } = response.json<{
    roundProgress: {
      runId: number;
      label: { code: string };
      steps: { key: string; status: string; costUsd: number }[];
      current: string | null;
      costUsd: number;
    };
  }>();
  expect(roundProgress.runId).toBe(seeded.runId);
  expect(roundProgress.label.code).toBe('round_label');
  expect(roundProgress.steps.map((s) => [s.key, s.status, s.costUsd])).toEqual([
    ['checks', 'done', 0],
    ['task', 'done', 0.1],
    ['change_type', 'done', 0.05],
    ['review', 'failed', 0.3],
    ['verify', 'off', 0],
  ]);
  expect(roundProgress.current).toBeNull();
  expect(roundProgress.costUsd).toBeCloseTo(0.45);
});
