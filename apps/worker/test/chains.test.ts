// S-07-T1: chains and the one round-start service. Handlers run on the shared test database.
import {
  eq,
  getPullRequest,
  latestChainOf,
  loadPrStateInput,
  schema,
  setChainExpectedHead,
  setPullRequestLevel,
  type PullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { startRound } from '../src/run/start-round.ts';
import { connectRepository, createTestWorkerDeps, storeGithubEvent } from './support.ts';
import type { GitHubFixtureName } from '@pra/integrations/testing';

const deps = await createTestWorkerDeps();
let repository: Repository;

beforeEach(async () => {
  repository = await connectRepository(deps.db, { defaultLevel: 2 });
});

afterAll(() => deps.close());

async function deliver(name: GitHubFixtureName, updatedAt?: string): Promise<string> {
  const event = await storeGithubEvent(deps, name, {
    fullName: repository.githubFullName,
    ...(updatedAt ? { pullRequest: { updated_at: updatedAt } } : {}),
  });
  return processGithubEvent(deps, event.id);
}

async function pr(): Promise<PullRequest> {
  return (await getPullRequest(deps.db, repository.id, 312))!;
}

async function roundsOfPr(): Promise<Run[]> {
  const { id } = await pr();
  return deps.db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.pullRequestId, id))
    .orderBy(schema.runs.id);
}

async function finish(run: Run, status: Run['status']): Promise<void> {
  await deps.db
    .update(schema.runs)
    .set({ status, finishedAt: new Date() })
    .where(eq(schema.runs.id, run.id));
}

describe('chains', () => {
  test('a ready event starts round 1 of a new chain at the repository default level', async () => {
    expect(await deliver('pull_request.ready_for_review')).toBe('round_started');
    const [run] = await roundsOfPr();
    expect(run).toMatchObject({ roundNo: 1, trigger: 'ready_for_review', startedBy: 'bot' });
    expect(run!.level.number).toBe(2);
    const chain = await latestChainOf(deps.db, (await pr()).id);
    expect(chain?.id).toBe(run!.chainId);
  });

  test('draft and ready again starts a new chain', async () => {
    await deliver('pull_request.ready_for_review', '2026-11-19T10:00:00Z');
    const [first] = await roundsOfPr();
    await finish(first!, 'completed');
    await deliver('pull_request.opened-draft', '2026-11-19T10:05:00Z');
    expect(await deliver('pull_request.ready_for_review', '2026-11-19T10:10:00Z')).toBe(
      'round_started',
    );
    const [, second] = await roundsOfPr();
    expect(second).toMatchObject({ roundNo: 1, trigger: 'ready_for_review' });
    expect(second!.chainId).not.toBe(first!.chainId);
  });

  test('failed and cancelled rounds do not use up the chain', async () => {
    await deliver('pull_request.ready_for_review');
    const [first] = await roundsOfPr();
    await finish(first!, 'completed');
    const { id, headSha } = await pr();

    for (const ending of ['failed', 'cancelled'] as const) {
      // Starting a fix check consumes the expected head; S-14's next push sets it again.
      await setChainExpectedHead(deps.db, first!.chainId!, headSha);
      const started = await startRound(deps, {
        pullRequestId: id,
        trigger: 'own_fix',
        startedBy: { kind: 'bot' },
      });
      expect(started).toMatchObject({ started: true, roundNumber: 2 });
      if (!started.started) return;
      expect(started.run.chainId).toBe(first!.chainId);
      await finish(started.run, ending);
    }
    expect((await loadPrStateInput(deps.db, id))!.input.chainRounds).toBe(1);
  });

  test("a level change does not change the running run's level", async () => {
    await deliver('pull_request.ready_for_review');
    const { id } = await pr();
    await setPullRequestLevel(deps.db, id, 4);
    const [run] = await roundsOfPr();
    expect(run!.level.number).toBe(2);
    expect((await loadPrStateInput(deps.db, id))!.input.level).toBe(4);

    await finish(run!, 'completed');
    const next = await startRound(deps, {
      pullRequestId: id,
      trigger: 'manual',
      startedBy: { kind: 'hand' },
    });
    expect(next.started && next.run.level.number).toBe(4);
  });
});
