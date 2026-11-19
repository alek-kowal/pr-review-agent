// S-22-T6: a trial's two runs review one commit and leave the PR untouched.
import { HAND, laneOf, nextStep, prState } from '@pra/core';
import {
  getRun,
  importInstructionV1,
  loadPrStateInput,
  saveInstructionDraft,
  startTrial,
  timelineOf,
  upsertPullRequest,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aPullRequest, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import { createGitFixture, isolatedGitExec, type GitFixture } from '@pra/integrations/testing';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { executeStage } from '../src/run/execute-stage.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

let database: TestDatabase;
let fixture: GitFixture;
let deps: TestWorkerDeps;
let repository: Repository;
let pullRequest: PullRequest;

const answer = (titles: string[]) => ({
  summary: 'Done.',
  risk: 'low',
  findings: titles.map((title) => ({
    severity: 'should',
    title,
    file: 'apps/demo/src/edges.ts',
    line: 1,
    scenario: 'When it runs.',
    suggestion: 'Fix it.',
  })),
  questions: [],
  notChecked: [],
});

beforeAll(async () => {
  // Its own database: the test owns the global files.
  [database, fixture] = await Promise.all([createTestDatabase(), createGitFixture()]);
  deps = await createTestWorkerDeps({ url: database.url });
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
  repository = await connectRepository(deps.db, { defaultLevel: 2 });
  ({ pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
  ));
}, 30_000);

afterAll(async () => {
  await deps?.close();
  await Promise.all([database?.drop(), fixture?.remove()]);
});

async function prView() {
  const load = (await loadPrStateInput(deps.db, pullRequest.id))!;
  const state = prState(load.input);
  return { state, lane: laneOf(state), nextStep: nextStep(load.input) };
}

describe('a trial', () => {
  test('runs A and B on one commit; B reads the draft; the PR is unchanged', async () => {
    const { version: active } = await importInstructionV1(deps.db, {
      scope: 'global',
      fileKey: 'prompt-reviewer.md',
      content: 'ACTIVE reviewer: {{knowledgeDir}} {{repoDir}}',
    });
    const draft = await deps.db.transaction((tx) =>
      saveInstructionDraft(tx, active.fileId, {
        content: 'DRAFT reviewer: {{knowledgeDir}} {{repoDir}}',
        note: 'Sharper prompt',
      }),
    );
    const before = await prView();

    const started = await startTrial(deps, {
      pullRequestId: pullRequest.id,
      draftVersionId: draft!.id,
      startedBy: HAND,
    });
    if (!started.started) throw new Error(started.reason.code);
    const { trial, runA, runB } = started;

    // Both runs use the same commit, and the trial records it.
    expect(trial).toMatchObject({ runAId: runA.id, runBId: runB.id, startedBy: 'hand' });
    expect([runA.headSha, runB.headSha, trial.headSha]).toEqual(Array(3).fill(fixture.headSha));
    expect([runA.kind, runB.kind]).toEqual(['trial', 'trial']);

    // Level 2: Checks and Task are off in a trial; Change type and Review run.
    for (const [run, titles] of [
      [runA, ['Null check missing']],
      [runB, ['Null check missing', 'Public API renamed']],
    ] as const) {
      expect(await executeStage(deps, run.id, 'change_type')).toBe('succeeded');
      deps.agentRunner.enqueue({ output: answer([...titles]) });
      expect(await executeStage(deps, run.id, 'review')).toBe('succeeded');
      expect((await getRun(deps.db, run.id))!.status).toBe('completed');
    }

    const prompts = deps.agentRunner.calls
      .filter((call) => call.role === 'reviewer')
      .map((call) => call.prompt);
    expect(prompts[0]).toMatch(/^ACTIVE reviewer:/);
    expect(prompts[1]).toMatch(/^DRAFT reviewer:/);
    expect((await getRun(deps.db, runB.id))!.instructionVersions).toEqual([
      expect.objectContaining({ id: draft!.id, version: 2 }),
    ]);

    // The PR's state and lane are unchanged; nothing reached GitHub, ClickUp or the timeline.
    expect(await prView()).toEqual(before);
    expect(deps.github.calls).toEqual([]);
    expect(deps.clickup.calls).toEqual([]);
    expect(await timelineOf(deps.db, pullRequest.id)).toEqual([]);
  });

  test('a draft a trial read is kept: saving again starts the next version', async () => {
    const { version: active } = await importInstructionV1(deps.db, {
      scope: 'global',
      fileKey: 'review-rules.md',
      content: 'Rules v1',
    });
    const draft = await deps.db.transaction((tx) =>
      saveInstructionDraft(tx, active.fileId, { content: 'Rules v2', note: null }),
    );
    await startTrial(deps, {
      pullRequestId: pullRequest.id,
      draftVersionId: draft!.id,
      startedBy: HAND,
    });

    const next = await deps.db.transaction((tx) =>
      saveInstructionDraft(tx, active.fileId, { content: 'Rules v3', note: null }),
    );

    expect(next).toMatchObject({ version: 3, status: 'draft', content: 'Rules v3' });
  });

  test('a trial needs a draft', async () => {
    const { version: active } = await importInstructionV1(deps.db, {
      scope: 'global',
      fileKey: 'lessons.md',
      content: '',
    });
    const refused = await startTrial(deps, {
      pullRequestId: pullRequest.id,
      draftVersionId: active.id,
      startedBy: HAND,
    });
    expect(refused).toEqual({
      started: false,
      reason: { code: 'trial_needs_draft', params: { versionId: active.id, status: 'active' } },
    });
  });
});
