// S-22-T9: the read-only pipeline descriptor. Its own database, since it writes the model and
// level settings and reads the global instruction files.
import { DEFAULT_MODELS } from '@pra/core';
import {
  activateInstructionVersion,
  closeDb,
  createDb,
  importInstructionV1,
  saveInstructionDraft,
  writeLevelSettings,
  writeRoleModels,
  type Db,
} from '@pra/db';
import { createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { PipelineResponse } from '../../src/routes/api/pipeline/index.ts';
import { build } from '../helper.ts';

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

async function pipeline() {
  const api = await build({ db });
  const response = await api.inject({ method: 'GET', url: '/api/pipeline' });
  expect(response.statusCode).toBe(200);
  const { stages } = PipelineResponse.parse(response.json());
  return Object.fromEntries(stages.map((s) => [s.key, s]));
}

test('lists the eight stages in order with the level where each turns on', async () => {
  const api = await build({ db });
  const { stages } = PipelineResponse.parse(
    (await api.inject({ method: 'GET', url: '/api/pipeline' })).json(),
  );
  expect(stages.map((s) => [s.key, s.onFrom])).toEqual([
    ['checks', 2],
    ['task', 2],
    ['change_type', 2],
    ['review', 1],
    ['verify', 3],
    ['implement', 4],
    ['fix_check', 4],
    ['analyst', 6],
  ]);
});

test('Review lists only read-only tools; Implement lists no shell', async () => {
  const stages = await pipeline();
  expect(stages.review!.tools).toEqual(['Read', 'Grep', 'Glob']);
  expect(stages.verify!.tools).toEqual(['Read', 'Grep', 'Glob']);
  expect(stages.implement!.tools).not.toContain('Bash');
  expect(stages.implement!.tools).toEqual(expect.arrayContaining(['Read', 'Edit']));
  // Code stages and the judge run no agent tools.
  expect(stages.checks!.tools).toEqual([]);
  expect(stages.change_type!.tools).toEqual([]);
});

// Settings → Models starts every role at its default (migration 0021), so each model's source is
// `settings` unless a level sets its own.
test('each model matches Settings → Models, which start at the defaults; code stages have none', async () => {
  await writeRoleModels(db, { reviewer: 'claude-fable-5-2', verifier: 'claude-haiku-5-5' });
  const stages = await pipeline();

  expect(stages.review!.model).toEqual({
    model: 'claude-fable-5-2',
    source: 'settings',
    level: null,
  });
  expect(stages.fix_check!.model?.model).toBe('claude-fable-5-2');
  expect(stages.verify!.model?.model).toBe('claude-haiku-5-5');
  expect(stages.implement!.model).toEqual({
    model: DEFAULT_MODELS.implementer,
    source: 'settings',
    level: null,
  });
  expect(stages.change_type!.model?.model).toBe(DEFAULT_MODELS.judge);
  expect(stages.analyst!.model?.model).toBe(DEFAULT_MODELS.analyst);
  expect(stages.checks!.model).toBeNull();
  expect(stages.task!.model).toBeNull();
});

test('the prompt lists the global instruction files with their active versions', async () => {
  const { version: v1 } = await importInstructionV1(db, {
    scope: 'global',
    fileKey: 'review-rules.md',
    content: 'v1\n',
  });
  const draft = await saveInstructionDraft(db, v1.fileId, { content: 'v2\n', note: null });
  await activateInstructionVersion(db, draft!.id, null);

  const { review, verify } = await pipeline();
  const rules = review!.files!.slots.find((s) => s.name === 'rules');
  expect(rules?.files).toEqual([
    {
      fileKey: 'review-rules.md',
      kind: 'instruction',
      fileId: v1.fileId,
      version: 2,
      scope: 'global',
    },
  ]);
  // A file the database does not have yet is listed without a version.
  expect(verify!.files!.slots.flatMap((s) => s.files)).toEqual([
    {
      fileKey: 'prompt-verifier.md',
      kind: 'instruction',
      fileId: null,
      version: null,
      scope: null,
    },
    { fileKey: 'verify-rules.md', kind: 'instruction', fileId: null, version: null, scope: null },
  ]);
});

test('timeout, attempts and output come from the level and the stage', async () => {
  const { review, verify } = await pipeline();
  expect(review!.timeoutMinutes).toBe(30);
  expect(review!.attempts).toBe(1);
  expect(review!.output.schema).toBe('ReviewOutput');
  expect(review!.output.fields).toContain('findings');
  expect(verify!.repairs).toBe(1);
  expect(verify!.output.fields).toEqual(expect.arrayContaining(['verdict', 'reason', 'evidence']));
});

// Last: it changes level 1, which every stage inherits.
test('a level that sets its own model or timeout wins, as in a new run (S-21)', async () => {
  await writeLevelSettings(db, 1, {
    stageTimeoutMinutes: 45,
    models: { judge: 'claude-opus-5-5' },
  });
  const { change_type, review } = await pipeline();
  expect(change_type!.model).toEqual({ model: 'claude-opus-5-5', source: 'level', level: 1 });
  expect(review!.timeoutMinutes).toBe(45);
});
