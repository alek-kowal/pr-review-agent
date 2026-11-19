// S-08-T3: earlier answers reach every later round (FR-035).
import { FIX_CHECK_ANSWERS_LINE, TEAM_ANSWERS_TITLE } from '@pra/agents';
import { FakeAgentRunner } from '@pra/agents/testing';
import {
  decideFindings,
  getRun,
  insertFindings,
  insertQuestions,
  insertRun,
  saveAnswers,
  schema,
  upsertPullRequest,
  type PullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import { aFinding, aPullRequest, aQuestion, aRun, seedTeamMember } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import { createGitFixture, isolatedGitExec, type GitFixture } from '@pra/integrations/testing';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { executeStage } from '../src/run/execute-stage.ts';
import { startRound, type StartRoundInput, type StartRoundResult } from '../src/run/start-round.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

let fixture: GitFixture;
let deps: TestWorkerDeps;
let repository: Repository;
let pullRequest: PullRequest;

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

beforeEach(async () => {
  repository = await connectRepository(deps.db);
  ({ pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
  ));
});

/**
 * A completed round 1 on the base commit that asked two questions; Kasia answered both (an option
 * and an own text) and decided its one finding Implement, so a fix push starts round 2.
 */
async function answeredRound(options: { answer?: boolean } = {}): Promise<Run> {
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
  const [finding] = await insertFindings(deps.db, [
    aFinding(round.id, pullRequest.id, 1, { title: 'Empty label shows nothing' }),
  ]);
  const [cache, admins] = await insertQuestions(deps.db, [
    aQuestion(round.id, 1, { text: 'Should the cache survive a restart?' }),
    aQuestion(round.id, 2, { text: 'Does the limit apply to admins?' }),
  ]);
  const kasia = await seedTeamMember(deps.db, { name: 'Kasia' });
  await decideFindings(deps.db, {
    pullRequestId: pullRequest.id,
    findingIds: [finding!.id],
    expectedVersions: { [finding!.id]: 0 },
    decision: 'implement',
    signedBy: kasia.id,
  });
  if (options.answer !== false) {
    const saved = await saveAnswers(deps.db, {
      pullRequestId: pullRequest.id,
      signedBy: kasia.id,
      answers: [
        { questionId: cache!.id, option: 1, ownText: null, expectedAnswerId: null },
        {
          questionId: admins!.id,
          option: null,
          ownText: 'Admins are exempt.',
          expectedAnswerId: null,
        },
      ],
    });
    expect(saved.ok).toBe(true);
  }
  return round;
}

type Started = Extract<StartRoundResult, { started: true }>;

async function start(input: Omit<StartRoundInput, 'pullRequestId'>): Promise<Started> {
  const started = await startRound(deps, { pullRequestId: pullRequest.id, ...input });
  if (!started.started) throw new Error(started.reason.code);
  return started;
}

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

/** Queues one reviewer answer and keeps what the session saw in `files` and its prompt. */
function captureReviewer(
  names: readonly string[],
  output: Record<string, unknown>,
): { prompt?: string; files: Record<string, string | null> } {
  const seen: { prompt?: string; files: Record<string, string | null> } = { files: {} };
  deps.agentRunner.enqueue(async (input) => {
    seen.prompt = input.prompt;
    for (const name of names) {
      seen.files[name] = await readFile(path.join(input.cwd, name), 'utf8').catch(() => null);
    }
    return new FakeAgentRunner([{ output }]).run(input);
  });
  return seen;
}

const NO_REVIEW = { summary: 's', risk: 'low', findings: [], questions: [], notChecked: [] };

describe('earlier answers', () => {
  test("round 2's fix check receives the round-1 answers", async () => {
    await answeredRound();
    const fix = await start({ trigger: 'own_fix', startedBy: { kind: 'bot' } });
    expect(fix.run.roundNo).toBe(2);
    const seen = captureReviewer(['answers.md'], { fixes: [] });

    expect((await runToEnd(fix)).status).toBe('completed');

    expect(seen.prompt).toContain(FIX_CHECK_ANSWERS_LINE);
    const answers = seen.files['answers.md']!;
    expect(answers).toContain('Q: Should the cache survive a restart?');
    expect(answers).toContain('A (Kasia): No');
    expect(answers).toContain('Q: Does the limit apply to admins?');
    expect(answers).toContain('A (Kasia): Admins are exempt.');
  });

  test("a new chain's round 1 reviewer receives the round-1 answers in its brief", async () => {
    await answeredRound();
    const started = await start({ trigger: 'manual', startedBy: { kind: 'hand' }, level: 1 });
    expect(started.run.roundNo).toBe(1);
    const seen = captureReviewer(['brief.md'], NO_REVIEW);

    expect((await runToEnd(started)).status).toBe('completed');

    const brief = seen.files['brief.md']!;
    expect(brief).toContain(`## ${TEAM_ANSWERS_TITLE}`);
    expect(brief).toContain('A (Kasia): No');
    expect(brief).toContain('A (Kasia): Admins are exempt.');
  });

  test('a PR without answers adds nothing', async () => {
    await answeredRound({ answer: false });
    const fix = await start({ trigger: 'own_fix', startedBy: { kind: 'bot' } });
    const seenFix = captureReviewer(['answers.md'], { fixes: [] });
    await runToEnd(fix);
    expect(seenFix.files['answers.md']).toBeNull();
    expect(seenFix.prompt).not.toContain(FIX_CHECK_ANSWERS_LINE);

    const next = await start({ trigger: 'manual', startedBy: { kind: 'hand' }, level: 1 });
    const seenReview = captureReviewer(['brief.md'], NO_REVIEW);
    await runToEnd(next);
    expect(seenReview.files['brief.md'] ?? '').not.toContain(TEAM_ANSWERS_TITLE);
  });
});
