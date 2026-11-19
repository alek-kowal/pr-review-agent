// S-07-T3: rounds 2 and 3 check only the fixes; a new chain's round 1 also reports on them.
import { FIX_CHECK_PROMPT } from '@pra/agents';
import { FakeAgentRunner } from '@pra/agents/testing';
import {
  decideFindings,
  eq,
  fixChecksOfRun,
  getPullRequest,
  getRun,
  insertFindings,
  insertRun,
  loadPrStateInput,
  saveVerifications,
  schema,
  upsertPullRequest,
  type FindingRow,
  type PullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import { aFinding, aPullRequest, aRun, seedTeamMember } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import { createGitFixture, isolatedGitExec, type GitFixture } from '@pra/integrations/testing';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { executeStage } from '../src/run/execute-stage.ts';
import { startRound, type StartRoundInput, type StartRoundResult } from '../src/run/start-round.ts';
import { STILL_REPRODUCES_REASON } from '../src/stages/fix-check.ts';
import { EARLIER_FIXES_TITLE, earlierFixesProvider } from '../src/stages/review/earlier-fixes.ts';
import type { StageContext } from '../src/stages/stage.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

let fixture: GitFixture;
let deps: TestWorkerDeps;
let repository: Repository;
let pullRequest: PullRequest;

beforeAll(async () => {
  // One more fix on top of the feature commit, for round 3.
  fixture = await createGitFixture({
    fixes: [{ 'apps/demo/src/label.ts': 'export const trim = true;\n' }],
  });
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

beforeEach(async () => {
  repository = await connectRepository(deps.db);
  ({ pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
  ));
});

/** A completed round 1 on the base commit with two findings: the first decided Implement. */
async function reviewedRound(): Promise<{ round: Run; implement: FindingRow; reject: FindingRow }> {
  const chainId = randomUUID();
  await deps.db
    .insert(schema.roundChains)
    .values({ id: chainId, pullRequestId: pullRequest.id, expectedHeadSha: fixture.headSha });
  const round = await insertRun(
    deps.db,
    aRun(pullRequest.id, {
      chainId,
      headSha: fixture.baseSha,
      status: 'completed',
      finishedAt: new Date(),
    }),
  );
  const [implement, reject] = await insertFindings(deps.db, [
    aFinding(round.id, pullRequest.id, 1, { title: 'Empty label shows nothing' }),
    aFinding(round.id, pullRequest.id, 2, { title: 'Label is not trimmed' }),
  ]);
  const kasia = await seedTeamMember(deps.db);
  for (const [finding, decision] of [
    [implement!, 'implement'],
    [reject!, 'reject'],
  ] as const) {
    await decideFindings(deps.db, {
      pullRequestId: pullRequest.id,
      findingIds: [finding.id],
      expectedVersions: { [finding.id]: 0 },
      decision,
      reason: decision === 'reject' ? 'Not needed.' : null,
      signedBy: kasia.id,
    });
  }
  return { round, implement: implement!, reject: reject! };
}

/** Runs every stage of the run in order with the real stage handler. */
async function runToEnd({ run: { id }, firstStage }: Started): Promise<Run> {
  let stage = firstStage;
  for (let i = 0; i < 10; i += 1) {
    expect(await executeStage(deps, id, stage)).toBe('succeeded');
    const run = (await getRun(deps.db, id))!;
    if (run.status !== 'running') return run;
    stage = run.currentStage!;
  }
  throw new Error('run did not finish');
}

async function findingsOf(runId: number) {
  return deps.db.select().from(schema.findings).where(eq(schema.findings.runId, runId));
}

type Started = Extract<StartRoundResult, { started: true }>;

async function start(input: Omit<StartRoundInput, 'pullRequestId'>): Promise<Started> {
  const started = await startRound(deps, { pullRequestId: pullRequest.id, ...input });
  if (!started.started) throw new Error(started.reason.code);
  return started;
}

async function fixRound(round: Run): Promise<Started> {
  const started = await start({ trigger: 'own_fix', startedBy: { kind: 'bot' } });
  expect(started.run).toMatchObject({ chainId: round.chainId, roundNo: 2 });
  return started;
}

describe('fix check', () => {
  test('round 2 checks only the Implement findings on the diff since round 1', async () => {
    const { round, implement } = await reviewedRound();
    const fix = await fixRound(round);
    const seen: { findings?: unknown; diff?: string; prompt?: string } = {};
    deps.agentRunner.enqueue(async (input) => {
      seen.findings = JSON.parse(await readFile(path.join(input.cwd, 'findings.json'), 'utf8'));
      seen.diff = await readFile(path.join(input.cwd, 'diff.patch'), 'utf8');
      seen.prompt = input.prompt;
      return new FakeAgentRunner([
        {
          output: {
            fixes: [{ findingId: implement.id, resolved: true, reason: 'Falls back to the id.' }],
          },
        },
      ]).run(input);
    });

    const done = await runToEnd(fix);

    expect(done.status).toBe('completed');
    expect(deps.agentRunner.calls.at(-1)!.role).toBe('reviewer');
    expect(seen.prompt).toContain(FIX_CHECK_PROMPT.slice(0, 40));
    expect(seen.prompt).toContain(fixture.baseSha);
    expect(seen.findings).toEqual([expect.objectContaining({ id: implement.id })]);
    expect(seen.diff).toContain('apps/demo/src/edges.ts');
    expect(await findingsOf(fix.run.id)).toEqual([]);
    expect(await fixChecksOfRun(deps.db, fix.run.id)).toEqual([
      expect.objectContaining({ findingId: implement.id, resolved: true }),
    ]);
    const load = await loadPrStateInput(deps.db, pullRequest.id);
    expect(load!.findingsRound!.id).toBe(round.id);
    expect(load!.input.findings.map((f) => [f.title, f.resolved])).toEqual([
      ['Empty label shows nothing', true],
      ['Label is not trimmed', null],
    ]);
  });

  test("round 3 checks the diff since round 2's head, not since round 1", async () => {
    const { round, implement } = await reviewedRound();
    const answer = (input: Parameters<FakeAgentRunner['run']>[0]) =>
      new FakeAgentRunner([
        {
          output: { fixes: [{ findingId: implement.id, resolved: false, reason: 'Still empty.' }] },
        },
      ]).run(input);
    deps.agentRunner.enqueue(answer);
    await runToEnd(await fixRound(round));

    const fixSha = fixture.fixShas[0]!;
    await deps.db
      .update(schema.pullRequests)
      .set({ headSha: fixSha })
      .where(eq(schema.pullRequests.id, pullRequest.id));
    await deps.db
      .update(schema.roundChains)
      .set({ expectedHeadSha: fixSha })
      .where(eq(schema.roundChains.id, round.chainId!));
    pullRequest = (await getPullRequest(deps.db, repository.id, pullRequest.number))!;
    const third = await start({ trigger: 'own_fix', startedBy: { kind: 'bot' } });
    expect(third.run).toMatchObject({ roundNo: 3, headSha: fixSha });
    const seen: { diff?: string; prompt?: string } = {};
    deps.agentRunner.enqueue(async (input) => {
      seen.diff = await readFile(path.join(input.cwd, 'diff.patch'), 'utf8');
      seen.prompt = input.prompt;
      return answer(input);
    });

    expect((await runToEnd(third)).status).toBe('completed');
    expect(seen.prompt).toContain(fixture.headSha);
    expect(seen.diff).toContain('apps/demo/src/label.ts');
    expect(seen.diff).not.toContain('apps/demo/src/edges.ts');
  });

  test('a finding the fix check does not answer is Not resolved', async () => {
    const { round, implement } = await reviewedRound();
    const fix = await fixRound(round);
    deps.agentRunner.enqueue({ output: { fixes: [] } });
    await runToEnd(fix);
    expect(await fixChecksOfRun(deps.db, fix.run.id)).toEqual([
      expect.objectContaining({ findingId: implement.id, resolved: false }),
    ]);
  });

  test("a kept reproduction that still shows the bug beats the reviewer's Resolved", async () => {
    const { round, implement } = await reviewedRound();
    await saveVerificationScript(round, implement);
    const fix = await fixRound(round);
    deps.agentRunner.enqueue({
      output: { fixes: [{ findingId: implement.id, resolved: true, reason: 'Looks fixed.' }] },
    });
    await runToEnd(fix);
    expect(await fixChecksOfRun(deps.db, fix.run.id)).toEqual([
      expect.objectContaining({
        findingId: implement.id,
        resolved: false,
        reason: STILL_REPRODUCES_REASON,
      }),
    ]);
  });

  test("a new chain's round 1 stores new findings and fix statuses", async () => {
    const { implement } = await reviewedRound();
    const started = await start({ trigger: 'manual', startedBy: { kind: 'hand' }, level: 1 });
    const next = started.run;
    expect(next.roundNo).toBe(1);

    const context = { deps, run: next } as unknown as StageContext;
    const [section] = await earlierFixesProvider.sections(context);
    expect(section!.title).toBe(EARLIER_FIXES_TITLE);
    expect(section!.body).toContain(`id ${implement.id}: Empty label shows nothing`);
    expect(section!.body).not.toContain('Label is not trimmed');

    deps.agentRunner.enqueue({
      output: {
        summary: 'Adds inline renaming.',
        risk: 'low',
        findings: [
          {
            title: 'Label editor loses focus',
            severity: 'should',
            file: 'apps/demo/src/edges.ts',
            line: 1,
            scenario: 'After a rename the focus jumps to the body.',
            suggestion: 'Keep focus on the input.',
          },
        ],
        questions: [],
        notChecked: [],
        fixes: [
          { findingId: implement.id, resolved: false, reason: 'Still shows nothing.' },
          { findingId: 999_999, resolved: true, reason: 'Not a listed finding.' },
        ],
      },
    });
    const done = await runToEnd(started);

    expect(done.status).toBe('completed');
    expect((await findingsOf(next.id)).map((f) => f.title)).toEqual(['Label editor loses focus']);
    expect(await fixChecksOfRun(deps.db, next.id)).toEqual([
      expect.objectContaining({ findingId: implement.id, resolved: false }),
    ]);
  });
});

async function saveVerificationScript(round: Run, finding: FindingRow): Promise<void> {
  await deps.db.update(schema.runs).set({ status: 'running' }).where(eq(schema.runs.id, round.id));
  await saveVerifications(deps.db, round.id, [
    {
      findingId: finding.id,
      verdict: 'confirmed',
      reason: { code: 'repro_reproduced', params: {} },
      evidence: [],
      script: 'process.exit(0);',
      exitCode: 0,
    },
  ]);
  await deps.db
    .update(schema.runs)
    .set({ status: 'completed' })
    .where(eq(schema.runs.id, round.id));
}
