// S-07-T2: a push counts new commits and only the fix PR Review Agent pushed starts a round.
import { nextStep } from '@pra/core';
import {
  decideFindings,
  eq,
  getPullRequest,
  insertFindings,
  loadPrStateInput,
  schema,
  setChainExpectedHead,
  type PullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import { aFinding, seedTeamMember } from '@pra/db/testing';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { chainsOnRunCompleted, expectOwnFix, startFixCheckOnPush } from '../src/run/chains.ts';
import { startRound } from '../src/run/start-round.ts';
import { connectRepository, createTestWorkerDeps, storeGithubEvent } from './support.ts';
import type { GitHubFixtureName } from '@pra/integrations/testing';

const deps = await createTestWorkerDeps();
let repository: Repository;
let clock = Date.parse('2026-11-19T10:00:00Z');

beforeEach(async () => {
  repository = await connectRepository(deps.db);
});

afterAll(() => deps.close());

const sha = (c: string) => c.repeat(40);

/** Each delivery is newer than the last, so none is stale. */
async function deliver(
  name: GitHubFixtureName,
  headSha?: string,
  fields: Record<string, unknown> = {},
): Promise<string> {
  clock += 60_000;
  const event = await storeGithubEvent(deps, name, {
    fullName: repository.githubFullName,
    ...(headSha ? { headSha } : {}),
    pullRequest: { updated_at: new Date(clock).toISOString(), ...fields },
  });
  return processGithubEvent(deps, event.id);
}

async function pr(): Promise<PullRequest> {
  return (await getPullRequest(deps.db, repository.id, 312))!;
}

async function runsOfPr(): Promise<Run[]> {
  return deps.db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.pullRequestId, (await pr()).id))
    .orderBy(schema.runs.id);
}

async function complete(run: Run): Promise<Run> {
  const [row] = await deps.db
    .update(schema.runs)
    .set({ status: 'completed', finishedAt: new Date() })
    .where(eq(schema.runs.id, run.id))
    .returning();
  return row!;
}

/** Round 1 from a ready event, completed. */
async function reviewedRound(): Promise<Run> {
  await deliver('pull_request.ready_for_review', sha('a'));
  const [run] = await runsOfPr();
  return complete(run!);
}

describe('pushes', () => {
  test('an author push starts no run and stores 2 commits since', async () => {
    const round = await reviewedRound();
    deps.github.setComparison(repository.githubFullName, sha('a'), sha('b'), 2);
    expect(await deliver('pull_request.synchronize', sha('b'))).toBe('push_never_starts');

    const runs = await runsOfPr();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: round.id, commitsSince: 2, commitsSinceHead: sha('b') });
    const load = await loadPrStateInput(deps.db, (await pr()).id);
    expect(load!.input.commitsSinceReview).toBe(2);
    expect(nextStep(load!.input).state).toBe('new_commits');
  });

  test('a push on the expected head starts round 2 of the chain as a fix check', async () => {
    const round = await reviewedRound();
    await setChainExpectedHead(deps.db, round.chainId!, sha('c'));
    expect(await deliver('pull_request.synchronize', sha('c'))).toBe('round_started');

    const [, fix] = await runsOfPr();
    expect(fix).toMatchObject({
      roundNo: 2,
      trigger: 'own_fix',
      chainId: round.chainId,
      headSha: sha('c'),
      status: 'queued',
    });
  });

  test("a push on top of the agent's commit starts nothing", async () => {
    const round = await reviewedRound();
    await setChainExpectedHead(deps.db, round.chainId!, sha('c'));
    expect(await deliver('pull_request.synchronize', sha('d'))).toBe('push_never_starts');
    expect(await runsOfPr()).toHaveLength(1);

    // The agent's commit, then the author's on top once round 2 is done.
    await setChainExpectedHead(deps.db, round.chainId!, sha('e'));
    expect(await deliver('pull_request.synchronize', sha('e'))).toBe('round_started');
    await complete((await runsOfPr()).at(-1)!);
    expect(await deliver('pull_request.synchronize', sha('f'))).toBe('push_never_starts');
    expect(await runsOfPr()).toHaveLength(2);
  });

  test('after 3 completed rounds a matching push starts nothing: rounds used', async () => {
    const round = await reviewedRound();
    const { id: prId } = await pr();
    const [finding] = await insertFindings(deps.db, [aFinding(round.id, prId, 1)]);
    const kasia = await seedTeamMember(deps.db);
    await decideFindings(deps.db, {
      pullRequestId: prId,
      findingIds: [finding!.id],
      expectedVersions: { [finding!.id]: 0 },
      decision: 'implement',
      signedBy: kasia.id,
    });
    for (const head of ['c', 'd']) {
      await setChainExpectedHead(deps.db, round.chainId!, sha(head));
      expect(await deliver('pull_request.synchronize', sha(head))).toBe('round_started');
      await complete((await runsOfPr()).at(-1)!);
    }

    await setChainExpectedHead(deps.db, round.chainId!, sha('e'));
    expect(await deliver('pull_request.synchronize', sha('e'))).toBe('rounds_used');
    expect(await runsOfPr()).toHaveLength(3);
    const load = await loadPrStateInput(deps.db, prId);
    expect(load!.input.chainRounds).toBe(3);
    expect(nextStep(load!.input).state).toBe('rounds_used');

    // People then reject the finding: the bot's fix at the head was still never reviewed.
    const redecided = await decideFindings(deps.db, {
      pullRequestId: prId,
      findingIds: [finding!.id],
      expectedVersions: { [finding!.id]: 1 },
      decision: 'reject',
      reason: 'Not needed.',
      signedBy: kasia.id,
    });
    expect(redecided.ok).toBe(true);
    const after = await loadPrStateInput(deps.db, prId);
    expect(after!.input.ownFixUnchecked).toBe(true);
    expect(nextStep(after!.input).state).toBe('rounds_used');
  });

  test('a push during a running round leaves it running; its result stores 2 commits since', async () => {
    await deliver('pull_request.ready_for_review', sha('a'));
    const [running] = await runsOfPr();
    await deps.db
      .update(schema.runs)
      .set({ status: 'running' })
      .where(eq(schema.runs.id, running!.id));
    deps.github.setComparison(repository.githubFullName, sha('a'), sha('b'), 2);
    expect(await deliver('pull_request.synchronize', sha('b'))).toBe('push_never_starts');
    expect((await runsOfPr())[0]!.status).toBe('running');

    const done = await complete(running!);
    await chainsOnRunCompleted({ deps, run: done, pullRequest: await pr(), repository });
    expect((await runsOfPr())[0]).toMatchObject({ commitsSince: 2, commitsSinceHead: sha('b') });
  });

  test('a push during the last stage is measured against the new head, not the stage start', async () => {
    await deliver('pull_request.ready_for_review', sha('a'));
    const [running] = await runsOfPr();
    // The hook context's PR was read when the last stage started, before the push.
    const atStageStart = await pr();
    deps.github.setComparison(repository.githubFullName, sha('a'), sha('b'), 2);
    await deliver('pull_request.synchronize', sha('b'));

    const done = await complete(running!);
    await chainsOnRunCompleted({ deps, run: done, pullRequest: atStageStart, repository });
    expect((await runsOfPr())[0]).toMatchObject({ commitsSince: 2, commitsSinceHead: sha('b') });
  });

  test('a moved head is never 0 new commits, whatever the count says (force push)', async () => {
    const round = await reviewedRound();
    // An amended commit force-pushed: same commit count, and the compare fails (no comparison set).
    await deliver('pull_request.synchronize', sha('b'), { commits: round.commitsCountAtStart });
    expect((await runsOfPr())[0]).toMatchObject({ id: round.id, commitsSinceHead: sha('b') });
    const load = await loadPrStateInput(deps.db, (await pr()).id);
    expect(load!.input.commitsSinceReview).toBe(1);
    expect(nextStep(load!.input).state).toBe('new_commits');
  });

  test('the fix check starts when the push is recorded after its webhook was handled', async () => {
    const round = await reviewedRound();
    expect(await deliver('pull_request.synchronize', sha('c'))).toBe('push_never_starts');

    const started = await expectOwnFix(deps, round.chainId!, sha('c'));
    expect(started).toMatchObject({ started: true, roundNumber: 2 });
    const [, fix] = await runsOfPr();
    expect(fix).toMatchObject({ roundNo: 2, trigger: 'own_fix', chainId: round.chainId });
    // A retried push job records the same commit again: nothing more starts.
    expect(await expectOwnFix(deps, round.chainId!, sha('c'))).toBeNull();
    expect(await runsOfPr()).toHaveLength(2);
  });

  test('the fix push recorded before its webhook starts the round on the webhook', async () => {
    const round = await reviewedRound();
    expect(await expectOwnFix(deps, round.chainId!, sha('c'))).toBeNull();
    expect(await deliver('pull_request.synchronize', sha('c'))).toBe('round_started');
    expect(await runsOfPr()).toHaveLength(2);
  });

  test('two starts on the same fix push make one round', async () => {
    const round = await reviewedRound();
    await deliver('pull_request.synchronize', sha('c'));
    await setChainExpectedHead(deps.db, round.chainId!, sha('c'));
    const pullRequest = await pr();
    const both = await Promise.all([
      startFixCheckOnPush(deps, pullRequest, undefined),
      startFixCheckOnPush(deps, pullRequest, undefined),
    ]);
    expect(both.filter((r) => r?.started)).toHaveLength(1);
    expect(await runsOfPr()).toHaveLength(2);
  });

  test('a fix push while a run holds the PR starts nothing new', async () => {
    const round = await reviewedRound();
    await setChainExpectedHead(deps.db, round.chainId!, sha('c'));
    const manual = await startRound(deps, {
      pullRequestId: (await pr()).id,
      trigger: 'manual',
      startedBy: { kind: 'hand' },
    });
    expect(manual.started).toBe(true);
    expect(await deliver('pull_request.synchronize', sha('c'))).toBe('push_never_starts');
  });
});
