// S-04-T5: the Change type stage with a `FakeJudge`, and Review cut to the change type's limits.
import { FakeAgentRunner, type FakeJudgeStep } from '@pra/agents/testing';
import { DEFAULT_CHANGE_TYPE_RULES, type ChangeType, type RepositoryConfig } from '@pra/core';
import {
  and,
  asc,
  eq,
  importInstructionV1,
  insertRun,
  schema,
  setForcedChangeType,
  upsertPullRequest,
  type Run,
} from '@pra/db';
import { aPullRequest, aRun } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import { createGitFixture, isolatedGitExec, type GitFixture } from '@pra/integrations/testing';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { executeStage } from '../src/run/execute-stage.ts';
import { type ChangeTypeOutput } from '../src/stages/change-type.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

let fixture: GitFixture;
let deps: TestWorkerDeps;

beforeAll(async () => {
  fixture = await createGitFixture();
  deps = await createTestWorkerDeps();
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
});

afterAll(async () => {
  await deps.close();
  await fixture.remove();
});

type Options = {
  rules?: Partial<RepositoryConfig['changeTypeRules']>;
  largePrLines?: number;
  forced?: ChangeType;
  instructions?: boolean;
};

/** A level-2 run whose Checks and Task stages already ran; returns the run. */
async function readyForChangeType(options: Options = {}): Promise<Run> {
  const repository = await connectRepository(deps.db, {
    changeTypeRules: { ...DEFAULT_CHANGE_TYPE_RULES, ...options.rules },
    ...(options.largePrLines ? { largePrLines: options.largePrLines } : {}),
  });
  if (options.instructions !== false) {
    for (const [fileKey, content] of [
      ['prompt-classifier.md', 'Classify the task. Rules: {{knowledgeDir}}/classify-rules.md'],
      ['classify-rules.md', '# Tiers\n\ncomposes, extends, one-way.'],
    ]) {
      await importInstructionV1(deps.db, {
        scope: 'repository',
        repositoryId: repository.id,
        fileKey: fileKey!,
        content: content!,
      });
    }
  }
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
  );
  if (options.forced) await setForcedChangeType(deps.db, pullRequest.id, options.forced);
  const run = await insertRun(
    deps.db,
    aRun(pullRequest.id, { levelNumber: 2, headSha: fixture.headSha }),
  );
  expect(await executeStage(deps, run.id, 'checks')).toBe('succeeded');
  expect(await executeStage(deps, run.id, 'task')).toBe('succeeded');
  return run;
}

async function changeType(run: Run, ...judge: FakeJudgeStep[]) {
  deps.judge.enqueue(...judge);
  const calls = deps.judge.calls.length;
  const outcome = await executeStage(deps, run.id, 'change_type');
  const row = await stageRow(run.id, 'change_type');
  return {
    outcome,
    output: row.output as ChangeTypeOutput,
    judgeCalls: deps.judge.calls.slice(calls),
  };
}

async function stageRow(runId: number, stage: string) {
  const [row] = await deps.db
    .select()
    .from(schema.stageExecutions)
    .where(and(eq(schema.stageExecutions.runId, runId), eq(schema.stageExecutions.stage, stage)));
  return row!;
}

describe('Change type stage', () => {
  test('a one-way path gives One-way door without a judge call', async () => {
    const run = await readyForChangeType({ rules: { oneWayPaths: ['packages/*/src/index.ts'] } });

    const { outcome, output, judgeCalls } = await changeType(run);

    expect(outcome).toBe('succeeded');
    expect(judgeCalls).toEqual([]);
    expect(output).toMatchObject({
      changeType: 'one_way_door',
      reason: { code: 'rules_floor' },
      rules: {
        changeType: 'one_way_door',
        reason: { code: 'path_one_way', params: { path: 'packages/sdk/src/index.ts' } },
      },
      judge: null,
      judgeSkipped: { code: 'floor_is_highest' },
      needsPerson: true,
    });
  });

  test('the judge raising Uses existing parts to Changes behaviour is applied', async () => {
    const run = await readyForChangeType({ rules: { usesExistingPaths: ['**'] } });

    const { output, judgeCalls } = await changeType(run, {
      changeType: 'changes_behaviour',
      reason: 'The task changes how labels render.',
    });

    expect(judgeCalls).toHaveLength(1);
    expect(judgeCalls[0]).toMatchObject({
      model: 'claude-haiku-5-5',
      changedFiles: expect.arrayContaining(['apps/demo/src/edges.ts']),
    });
    expect(output).toMatchObject({
      changeType: 'changes_behaviour',
      reason: {
        code: 'judge_raised',
        params: { from: 'uses_existing', to: 'changes_behaviour' },
      },
      rules: { changeType: 'uses_existing' },
      judge: { changeType: 'changes_behaviour', reason: 'The task changes how labels render.' },
    });
    // The judge's session is stored with its cost.
    const sessions = await deps.db
      .select()
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.stageExecutionId, (await stageRow(run.id, 'change_type')).id));
    expect(sessions).toEqual([expect.objectContaining({ role: 'judge', costUsd: 0.001 })]);
  });

  test('a lower judge answer is ignored', async () => {
    const run = await readyForChangeType({ rules: { usesExistingPaths: [] } });

    const { output } = await changeType(run, {
      changeType: 'uses_existing',
      reason: 'Small.',
    });

    expect(output).toMatchObject({
      changeType: 'changes_behaviour',
      reason: {
        code: 'judge_cannot_lower',
        params: { judged: 'uses_existing', kept: 'changes_behaviour' },
      },
    });
  });

  test('a type forced by a person wins and the judge is not called', async () => {
    const run = await readyForChangeType({
      rules: { oneWayPaths: ['packages/*/src/index.ts'] },
      forced: 'uses_existing',
    });

    const { output, judgeCalls } = await changeType(run);

    expect(judgeCalls).toEqual([]);
    expect(output).toMatchObject({
      changeType: 'uses_existing',
      reason: { code: 'forced_by_person', params: { forced: 'uses_existing', rules: 'one_way_door' } },
      forced: 'uses_existing',
      judgeSkipped: { code: 'forced' },
      // The files the rules flagged still go to a person.
      needsPerson: true,
    });
  });

  test('without the judge instructions the floor stands and the skip is recorded', async () => {
    const run = await readyForChangeType({ instructions: false });

    const { output, judgeCalls } = await changeType(run);

    expect(judgeCalls).toEqual([]);
    expect(output).toMatchObject({
      changeType: 'changes_behaviour',
      judgeSkipped: { code: 'judge_instructions_missing' },
    });
  });

  test('a judge failure fails the stage with its code', async () => {
    const run = await readyForChangeType();

    const { outcome } = await changeType(run, { fail: 'model_access_not_configured' });

    expect(outcome).toBe('failed');
    expect(await stageRow(run.id, 'change_type')).toMatchObject({
      status: 'failed',
      errorCode: 'model_access_not_configured',
    });
  });

  test('findings over the type’s limit are dropped after Review, with the count stored', async () => {
    const run = await readyForChangeType({ rules: { usesExistingPaths: ['**'] } });
    await changeType(run, { changeType: 'uses_existing', reason: 'Docs and tests only.' });
    const finding = (severity: 'blocker' | 'should' | 'nit', n: number) => ({
      title: `${severity} ${n}`,
      severity,
      file: 'apps/demo/src/edges.ts',
      line: n,
      scenario: 'When the label is empty, the edge shows nothing.',
      suggestion: 'Fall back to the edge id.',
    });
    let brief = '';
    const answer = {
      summary: 's',
      risk: 'low',
      findings: [
        finding('nit', 1),
        finding('should', 2),
        finding('blocker', 3),
        finding('should', 4),
        finding('should', 5),
      ],
      questions: [{ question: 'Trim?', options: ['Yes', 'No'], recommended: 0, why: 'UX' }],
      notChecked: [],
    };
    // The run completes after Review at level 2 and its files go: read the brief during the call.
    deps.agentRunner.enqueue(async (input) => {
      brief = await readFile(path.join(input.cwd, 'brief.md'), 'utf8');
      return new FakeAgentRunner([{ output: answer }]).run(input);
    });

    expect(await executeStage(deps, run.id, 'review')).toBe('succeeded');

    expect(brief).toContain('## Change risk\n\n**Uses existing parts.**');
    const findings = await deps.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.runId, run.id))
      .orderBy(asc(schema.findings.ordinal));
    // Uses existing parts: at most 3, Blocking and Worth fixing only, no questions.
    expect(findings.map((f) => f.severity)).toEqual(['blocking', 'worth_fixing', 'worth_fixing']);
    const review = await stageRow(run.id, 'review');
    expect(review.output).toMatchObject({
      changeType: 'uses_existing',
      dropped: { findings: 2, questions: 1 },
    });
  });

  test('large_pr is set above the line threshold only', async () => {
    const small = await readyForChangeType({ largePrLines: 1000 });
    const large = await readyForChangeType({ largePrLines: 3 });
    const judged = { changeType: 'changes_behaviour', reason: 'Behaviour.' } as const;

    const { output: smallOutput } = await changeType(small, judged);
    const { output: largeOutput } = await changeType(large, judged);

    expect(smallOutput).toMatchObject({ largePr: false, largePrLines: 1000 });
    expect(largeOutput).toMatchObject({ largePr: true, largePrLines: 3 });
    expect(largeOutput.lines).toBeGreaterThan(3);
    expect(largeOutput.lines).toBe(smallOutput.lines);
  });
});
