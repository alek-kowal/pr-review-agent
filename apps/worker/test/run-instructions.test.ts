// S-22-T3: runs read the instruction versions they froze when they started, and record them.
import type { LevelNumber } from '@pra/core';
import {
  activateInstructionVersion,
  eq,
  getRun,
  importInstructionV1,
  insertRun,
  schema,
  upsertPullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import { aPullRequest, aRun, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import { createGitFixture, isolatedGitExec, type GitFixture } from '@pra/integrations/testing';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { executeStage } from '../src/run/execute-stage.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

let database: TestDatabase;
let fixture: GitFixture;
let deps: TestWorkerDeps;
let wb: Repository;
let other: Repository;

const ANSWER = { summary: 'Fine.', risk: 'low', findings: [], questions: [], notChecked: [] };
const template = (marker: string) => `${marker}: rules in {{knowledgeDir}}, code in {{repoDir}}.`;

beforeAll(async () => {
  // Its own database: the test owns the global files.
  [database, fixture] = await Promise.all([createTestDatabase(), createGitFixture()]);
  deps = await createTestWorkerDeps({ url: database.url });
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
  wb = await connectRepository(deps.db);
  other = await connectRepository(deps.db);
  await importInstructionV1(deps.db, {
    scope: 'global',
    fileKey: 'prompt-reviewer.md',
    content: template('GLOBAL v1'),
  });
  await importInstructionV1(deps.db, {
    scope: 'repository',
    repositoryId: wb.id,
    fileKey: 'prompt-reviewer.md',
    content: template('WB v1'),
  });
}, 30_000);

afterAll(async () => {
  await deps?.close();
  await Promise.all([database?.drop(), fixture?.remove()]);
});

async function queuedRun(repository: Repository, level: LevelNumber = 1): Promise<Run> {
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
  );
  return insertRun(
    deps.db,
    aRun(pullRequest.id, { levelNumber: level, headSha: fixture.headSha, status: 'queued' }),
  );
}

/** Runs the review stage and returns the prompt the reviewer got. */
async function review(run: Run): Promise<string> {
  deps.agentRunner.enqueue({ output: ANSWER });
  expect(await executeStage(deps, run.id, 'review')).toBe('succeeded');
  return deps.agentRunner.calls.at(-1)!.prompt;
}

const recordedIds = async (runId: number) =>
  (
    await deps.db
      .select({ id: schema.runInstructionVersions.versionId })
      .from(schema.runInstructionVersions)
      .where(eq(schema.runInstructionVersions.runId, runId))
  ).map((row) => row.id);

describe('runs read instructions from versions', () => {
  test("a WB run gets the WB copy, and another repository's run gets the global one", async () => {
    expect(await review(await queuedRun(wb))).toMatch(/^WB v1:/);
    expect(await review(await queuedRun(other))).toMatch(/^GLOBAL v1:/);
  });

  test("activating version 2 changes the next run's prompt, but not a running one", async () => {
    const [v1] = await deps.db
      .select()
      .from(schema.instructionVersions)
      .innerJoin(
        schema.instructionFiles,
        eq(schema.instructionFiles.id, schema.instructionVersions.fileId),
      )
      .where(eq(schema.instructionFiles.repositoryId, wb.id));
    // Level 2 starts with Checks, so the run is running (and frozen) before its review.
    const running = await queuedRun(wb, 2);
    expect(await executeStage(deps, running.id, 'checks')).toBe('succeeded');
    expect((await getRun(deps.db, running.id))!.status).toBe('running');

    const [v2] = await deps.db
      .insert(schema.instructionVersions)
      .values({
        fileId: v1!.instruction_files.id,
        version: 2,
        status: 'draft',
        content: template('WB v2'),
      })
      .returning();
    await activateInstructionVersion(deps.db, v2!.id, null);

    expect(await executeStage(deps, running.id, 'task')).toBe('succeeded');
    expect(await executeStage(deps, running.id, 'change_type')).toBe('succeeded');
    expect(await review(running)).toMatch(/^WB v1:/);
    expect(await review(await queuedRun(wb))).toMatch(/^WB v2:/);
  });

  test('each run records the version ids it used', async () => {
    const run = await queuedRun(other);
    await review(run);
    const stored = (await getRun(deps.db, run.id))!;
    const ids = await recordedIds(run.id);
    expect(ids).toHaveLength(1);
    expect(stored.instructionVersions).toEqual([
      expect.objectContaining({
        id: ids[0],
        scope: 'global',
        fileKey: 'prompt-reviewer.md',
        version: 1,
      }),
    ]);
  });
});
