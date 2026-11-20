// STAGEFILES: a run freezes the files each stage reads when it starts, and the stages read the
// files assigned to them (reviewer prompt, rules and documents; Verify's rules; the pre-check).
import { FakeAgentRunner } from '@pra/agents/testing';
import type { LevelNumber } from '@pra/core';
import {
  asc,
  eq,
  getRun,
  importInstructionV1,
  insertRun,
  schema,
  upsertPullRequest,
  writeStageFileChoice,
  type Repository,
  type Run,
} from '@pra/db';
import { aPullRequest, aRun, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import {
  createGitFixture,
  FakeSandbox,
  isolatedGitExec,
  type GitFixture,
} from '@pra/integrations/testing';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { executeStage } from '../src/run/execute-stage.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

let database: TestDatabase;
let fixture: GitFixture;
let deps: TestWorkerDeps;

const template = (marker: string) => `${marker}: rules in {{knowledgeDir}}, code in {{repoDir}}.`;
const FILE = 'apps/demo/src/edges.ts';
/** In `FILE` at the PR head. */
const FOUND = 'export const label = (edge: { name: string }) => edge.name.trim();';
const reviewAnswer = (findings: number) => ({
  summary: 's',
  risk: 'low',
  findings: Array.from({ length: findings }, (_, i) => ({
    title: `Finding ${i + 1}`,
    severity: 'blocker',
    file: FILE,
    line: 1,
    scenario: 'When the name is empty, the edge shows nothing.',
    suggestion: 'Fall back to the edge id.',
  })),
  questions: [],
  notChecked: [],
});

const GLOBAL_FILES: Record<string, string> = {
  'prompt-reviewer.md': template('DEFAULT'),
  'prompt-reviewer-b.md': template('B'),
  'review-rules.md': 'rules A',
  'review-b-rules.md': 'rules B',
  'lessons/edges.md': 'Edges have ids.',
  'extra.md': 'Extra.',
  'review-levels.json': '{}',
  'prompt-verifier.md': 'Refute it. Rules: {{knowledgeDir}}/verify-rules.md',
  'verify-rules.md': 'verify rules A',
  'verify-b-rules.md': 'verify rules B',
};

beforeAll(async () => {
  // Its own database: the test owns the global files.
  [database, fixture] = await Promise.all([createTestDatabase(), createGitFixture()]);
  deps = await createTestWorkerDeps({ url: database.url });
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
  for (const [fileKey, content] of Object.entries(GLOBAL_FILES)) {
    await importInstructionV1(deps.db, { scope: 'global', fileKey, content });
  }
}, 30_000);

afterAll(async () => {
  await deps?.close();
  await Promise.all([database?.drop(), fixture?.remove()]);
});

async function queuedRun(repository: Repository, level: LevelNumber): Promise<Run> {
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
  );
  return insertRun(
    deps.db,
    aRun(pullRequest.id, { levelNumber: level, headSha: fixture.headSha, status: 'queued' }),
  );
}

/** Runs the stages before Review, then Review; returns its prompt and knowledge files. */
async function review(run: Run, before: string[], findings = 0) {
  for (const stage of before) expect(await executeStage(deps, run.id, stage)).toBe('succeeded');
  // The run's files are removed when it ends: read the knowledge folder during the call.
  const knowledge = new Map<string, string>();
  deps.agentRunner.enqueue((input) => {
    const dir = path.join(input.cwd, 'knowledge');
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const full = path.join(entry.parentPath, entry.name);
      knowledge.set(path.relative(dir, full), readFileSync(full, 'utf8'));
    }
    return new FakeAgentRunner([{ output: reviewAnswer(findings) }]).run(input);
  });
  expect(await executeStage(deps, run.id, 'review')).toBe('succeeded');
  return { prompt: deps.agentRunner.calls.at(-1)!.prompt, knowledge };
}

const stagesOf = (runId: number) =>
  deps.db
    .select()
    .from(schema.stageExecutions)
    .where(eq(schema.stageExecutions.runId, runId))
    .orderBy(asc(schema.stageExecutions.id));

describe('stage files', () => {
  test('a run freezes its stage files; a later choice does not change what it reads', async () => {
    const repository = await connectRepository(deps.db);
    await writeStageFileChoice(deps.db, repository.id, 'review', {
      prompt: 'prompt-reviewer-b.md',
      rules: 'review-b-rules.md',
      documents: ['extra.md'],
    });
    // Level 2 starts with Checks, so the run is running (and frozen) before its review.
    const running = await queuedRun(repository, 2);
    expect(await executeStage(deps, running.id, 'checks')).toBe('succeeded');
    expect((await getRun(deps.db, running.id))!.stageFiles?.review).toEqual({
      prompt: 'prompt-reviewer-b.md',
      rules: 'review-b-rules.md',
      documents: ['extra.md'],
    });
    await writeStageFileChoice(deps.db, repository.id, 'review', null);

    const frozen = await review(running, ['task', 'change_type']);
    expect(frozen.prompt).toMatch(/^B:/);
    // The rules under the name the prompts use, the assigned documents only.
    expect(Object.fromEntries(frozen.knowledge)).toEqual({
      'extra.md': 'Extra.',
      'review-rules.md': 'rules B',
    });

    // The next run reads the defaults: every Markdown document, no prompts, no JSON.
    const next = await review(await queuedRun(repository, 1), []);
    expect(next.prompt).toMatch(/^DEFAULT:/);
    expect(Object.fromEntries(next.knowledge)).toEqual({
      'extra.md': 'Extra.',
      'lessons/edges.md': 'Edges have ids.',
      'review-rules.md': 'rules A',
    });
  });

  test('the built-in choice gives the reviewer the built-in prompt', async () => {
    const repository = await connectRepository(deps.db);
    await writeStageFileChoice(deps.db, repository.id, 'review', { prompt: '@built-in' });
    const { prompt } = await review(await queuedRun(repository, 1), []);
    expect(prompt).not.toMatch(/^(DEFAULT|B):/);
  });

  test('the judge reads the prompt and rules assigned for the repository', async () => {
    await importInstructionV1(deps.db, {
      scope: 'global',
      fileKey: 'prompt-judge-b.md',
      content: 'Judge B. Rules: {{knowledgeDir}}/classify-rules.md',
    });
    await importInstructionV1(deps.db, {
      scope: 'global',
      fileKey: 'classify-b-rules.md',
      content: 'classify rules B',
    });
    const repository = await connectRepository(deps.db);
    await writeStageFileChoice(deps.db, repository.id, 'change_type', {
      prompt: 'prompt-judge-b.md',
      rules: 'classify-b-rules.md',
    });
    const run = await queuedRun(repository, 3);
    for (const stage of ['checks', 'task']) {
      expect(await executeStage(deps, run.id, stage)).toBe('succeeded');
    }
    deps.judge.enqueue({ changeType: 'changes_behaviour', reason: 'It changes labels.' });
    const calls = deps.judge.calls.length;

    expect(await executeStage(deps, run.id, 'change_type')).toBe('succeeded');
    expect(deps.judge.calls).toHaveLength(calls + 1);
    expect(deps.judge.calls.at(-1)!.instructions).toEqual({
      prompt: 'Judge B. Rules: {{knowledgeDir}}/classify-rules.md',
      rules: 'classify rules B',
    });
  });

  test('Verify reads the rules assigned for the repository', async () => {
    const repository = await connectRepository(deps.db);
    await writeStageFileChoice(deps.db, repository.id, 'verify', { rules: 'verify-b-rules.md' });
    const run = await queuedRun(repository, 3);
    await review(run, ['checks', 'task', 'change_type'], 1);

    let rules: string | null = null;
    const answer = new FakeAgentRunner([
      {
        output: {
          verdict: 'confirmed',
          reason: 'Read the code.',
          evidence: [{ file: FILE, line: 1, quote: FOUND }],
          script: 'process.exit(0)',
          remedy: { kind: 'obvious', why: 'Trim.' },
        },
      },
    ]);
    deps.agentRunner.enqueue((input) => {
      // The verifier's session folder is gone after the stage: read it during the call.
      const file = /Rules: (\S+\/verify-rules\.md)/.exec(input.prompt)![1]!;
      rules = readFileSync(file, 'utf8');
      return answer.run(input);
    });
    deps.sandbox = new FakeSandbox(() => ({ exitCode: 0, timedOut: false, output: 'ok' }));

    expect(await executeStage(deps, run.id, 'verify')).toBe('succeeded');
    expect(rules).toBe('verify rules B');
  });

  test('the pre-check names the assigned file that is missing', async () => {
    const repository = await connectRepository(deps.db);
    await writeStageFileChoice(deps.db, repository.id, 'verify', { rules: 'verify-rules-x.md' });
    const run = await queuedRun(repository, 3);

    expect(await executeStage(deps, run.id, 'checks')).toBe('failed');
    const [checks] = await stagesOf(run.id);
    expect(checks).toMatchObject({ stage: 'checks', errorCode: 'instructions_missing' });
    expect(JSON.parse(checks!.errorDetail!)).toMatchObject({
      stage: 'verify',
      missing: ['verify-rules-x.md'],
    });
  });
});
