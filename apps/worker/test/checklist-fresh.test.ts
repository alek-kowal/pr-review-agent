// S-12-T3: CI and review webhooks keep the merge checklist fresh, and a push takes the PR out of
// Ready to merge at once (FR-056).
import { checklist, nextStep } from '@pra/core';
import {
  getPullRequest,
  insertRun,
  loadPrStateInput,
  storePrCi,
  upsertPullRequest,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aPullRequest, aRun } from '@pra/db/testing';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { connectRepository, createTestWorkerDeps, storeGithubEvent } from './support.ts';

const deps = await createTestWorkerDeps();
let repository: Repository;
let pr: PullRequest;
let clock = Date.parse('2026-11-19T10:00:00Z');

const HEAD = '4'.repeat(40);

afterAll(() => deps.close());

/** A reviewed PR at `HEAD` with nothing to decide: Ready to merge. */
beforeEach(async () => {
  repository = await connectRepository(deps.db);
  clock += 60_000;
  ({ pullRequest: pr } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: HEAD, commitsCount: 2, updatedAt: new Date(clock) }),
  ));
  await insertRun(
    deps.db,
    aRun(pr.id, { status: 'completed', headSha: HEAD, commitsCountAtStart: 2 }),
  );
});

async function state() {
  const load = (await loadPrStateInput(deps.db, pr.id))!;
  const rows = checklist(load.input);
  return {
    step: nextStep(load.input),
    row: (item: string) => rows.items.find((row) => row.item === item)!,
  };
}

const ci = (state: 'passed' | 'failed' | 'pending') => [
  { name: 'build', source: 'check_run' as const, state },
];

describe('fresh checklist', () => {
  test('a check_suite stores the head CI: green, then a failing suite turns the row red', async () => {
    deps.github.setCiChecks(repository.githubFullName, HEAD, ci('passed'));
    const suite = () =>
      storeGithubEvent(deps, 'check_suite.completed', {
        fullName: repository.githubFullName,
        payload: { check_suite: { head_sha: HEAD, conclusion: 'success' } },
      });
    expect(await processGithubEvent(deps, (await suite()).id)).toBe('ci_refreshed');
    expect((await state()).row('ci_green')).toMatchObject({
      ok: true,
      reason: { code: 'checklist_ci_green' },
    });

    deps.github.setCiChecks(repository.githubFullName, HEAD, ci('failed'));
    expect(await processGithubEvent(deps, (await suite()).id)).toBe('ci_refreshed');
    expect((await state()).row('ci_green')).toMatchObject({
      ok: false,
      reason: { code: 'checklist_ci_failing', params: { names: ['build'] } },
    });
  });

  test('a status for another commit touches no PR', async () => {
    const event = await storeGithubEvent(deps, 'status', {
      fullName: repository.githubFullName,
      payload: { sha: '9'.repeat(40) },
    });
    expect(await processGithubEvent(deps, event.id)).toBe('no_pull_request');
    expect(deps.github.callsOf('getCiStatus')).not.toContainEqual([
      repository.githubFullName,
      '9'.repeat(40),
    ]);
  });

  test('a CHANGES_REQUESTED review turns its row red; a later approval clears it', async () => {
    const review = async () =>
      processGithubEvent(
        deps,
        (
          await storeGithubEvent(deps, 'pull_request_review.submitted', {
            fullName: repository.githubFullName,
            pullRequest: { number: pr.number },
          })
        ).id,
      );
    deps.github.addReview(repository.githubFullName, pr.number, 'tomek', 'CHANGES_REQUESTED');
    expect(await review()).toBe('reviews_refreshed');
    expect((await state()).row('no_changes_requested')).toMatchObject({
      ok: false,
      reason: { code: 'checklist_changes_requested', params: { by: ['tomek'] } },
    });

    deps.github.addReview(repository.githubFullName, pr.number, 'tomek', 'APPROVED');
    await review();
    expect((await state()).row('no_changes_requested').ok).toBe(true);
  });

  test('a ready PR receiving a force push is New commits in Action needed at once', async () => {
    await storePrCi(deps.db, pr.id, {
      sha: HEAD,
      checks: [{ name: 'build', conclusion: 'success' }],
    });
    expect((await state()).step).toMatchObject({ state: 'ready_to_merge' });
    expect((await state()).row('ci_green').ok).toBe(true);

    clock += 60_000;
    const push = await storeGithubEvent(deps, 'pull_request.synchronize', {
      fullName: repository.githubFullName,
      headSha: '5'.repeat(40),
      // Same commit count: a force push.
      pullRequest: { number: pr.number, commits: 2, updated_at: new Date(clock).toISOString() },
    });
    await processGithubEvent(deps, push.id);

    expect((await getPullRequest(deps.db, repository.id, pr.number))!.headSha).toBe('5'.repeat(40));
    const { step, row } = await state();
    expect(step).toMatchObject({ state: 'new_commits', lane: 'action_needed' });
    // CI was reported for the old head; it no longer counts.
    expect(row('ci_green').reason.code).toBe('checklist_ci_none');
  });
});
