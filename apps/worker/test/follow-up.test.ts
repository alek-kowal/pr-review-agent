// S-06-T5: a ClickUp follow-up task per finding deferred to ClickUp.
import type { RepositoryConfig } from '@pra/core';
import {
  decideFindings,
  followUpsOf,
  insertFindings,
  insertRun,
  timelineOf,
  undoDecisionBatch,
  upsertPullRequest,
  upsertTaskLink,
  type FindingRow,
  type PullRequest,
} from '@pra/db';
import { aFinding, aPullRequest, aRun, seedTeamMember } from '@pra/db/testing';
import { IntegrationError, type ClickUpTask } from '@pra/integrations';
import { FakeClickUpGateway } from '@pra/integrations/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createFollowUps,
  followUpDescription,
  resendLostFollowUps,
} from '../src/handlers/clickup-follow-up.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

const CLICKUP: RepositoryConfig['clickup'] = {
  workspaceId: '9012',
  spaceId: null,
  followUpListId: 'list-follow-ups',
  taskIdPattern: 'WB-\\d+',
};

const LINKED: ClickUpTask = {
  id: '86c1abc',
  customId: 'WB-12',
  name: 'Rename edge labels inline',
  description: '',
  url: 'https://app.clickup.com/t/86c1abc',
  status: 'in progress',
  listId: 'list-of-the-task',
};

let deps: TestWorkerDeps;
let signer: string;
beforeAll(async () => {
  deps = await createTestWorkerDeps();
  signer = (await seedTeamMember(deps.db, { name: 'Kasia' })).id;
});
afterAll(() => deps.close());

beforeEach(() => {
  deps.clickup = new FakeClickUpGateway({ tasks: [LINKED] });
});

type Setup = { pullRequest: PullRequest; findings: FindingRow[]; fullName: string };

async function reviewedPr(clickup: RepositoryConfig['clickup'] = CLICKUP): Promise<Setup> {
  const repository = await connectRepository(deps.db, { clickup });
  const { pullRequest } = await upsertPullRequest(deps.db, aPullRequest(repository.id));
  const run = await insertRun(deps.db, aRun(pullRequest.id));
  const findings = await insertFindings(deps.db, [
    aFinding(run.id, pullRequest.id, 1, { title: 'Empty label hides the edge', line: 14 }),
    aFinding(run.id, pullRequest.id, 2),
  ]);
  return { pullRequest, findings, fullName: repository.githubFullName };
}

async function defer(setup: Setup, findings: FindingRow[] = setup.findings.slice(0, 1)) {
  const result = await decideFindings(deps.db, {
    pullRequestId: setup.pullRequest.id,
    findingIds: findings.map((f) => f.id),
    expectedVersions: Object.fromEntries(findings.map((f) => [f.id, f.version])),
    decision: 'defer',
    signedBy: signer,
  });
  if (!result.ok) throw new Error(`defer failed: ${result.reason}`);
  return result.batch.id;
}

const followUp = async (batchId: number, findingId: number) =>
  (await followUpsOf(deps.db, [{ batchId, findingId }])).get(`${batchId}:${findingId}`);

describe('createFollowUps', () => {
  it('one deferred finding gives one task in the follow-up list, stored on the decision', async () => {
    const setup = await reviewedPr();
    const finding = setup.findings[0]!;
    const batchId = await defer(setup);

    const outcomes = await createFollowUps(deps, batchId);

    const calls = deps.clickup.callsOf('createTask');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      listId: 'list-follow-ups',
      name: 'Empty label hides the edge',
      parentId: null,
    });
    const prUrl = `https://github.com/${setup.fullName}/pull/${setup.pullRequest.number}`;
    expect(calls[0]!.description).toContain('`src/index.ts:14`');
    expect(calls[0]!.description).toContain(finding.scenario);
    expect(calls[0]!.description).toContain(finding.suggestion);
    expect(calls[0]!.description).toContain(prUrl);
    expect(outcomes).toEqual([
      { findingId: finding.id, result: 'created', taskId: expect.any(String) },
    ]);
    expect(await followUp(batchId, finding.id)).toMatchObject({
      status: 'created',
      taskId: expect.any(String),
      url: expect.stringContaining('clickup'),
      error: null,
    });
    const entries = await timelineOf(deps.db, setup.pullRequest.id);
    expect(entries.filter((e) => e.kind === 'follow_up_created')).toMatchObject([
      { actor: 'bot', params: { findingId: finding.id, title: 'Empty label hides the edge' } },
    ]);
  });

  it('running the job twice still creates one task', async () => {
    const setup = await reviewedPr();
    const batchId = await defer(setup);

    await createFollowUps(deps, batchId);
    const second = await createFollowUps(deps, batchId);

    expect(deps.clickup.callsOf('createTask')).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it('an undone decision creates none', async () => {
    const setup = await reviewedPr();
    const batchId = await defer(setup);
    expect((await undoDecisionBatch(deps.db, batchId)).ok).toBe(true);

    expect(await createFollowUps(deps, batchId)).toEqual([]);

    expect(deps.clickup.callsOf('createTask')).toEqual([]);
    expect(await followUp(batchId, setup.findings[0]!.id)).toMatchObject({ status: null });
  });

  it('ClickUp off stores clickup_not_configured on the decision', async () => {
    const setup = await reviewedPr(null);
    const batchId = await defer(setup);

    await createFollowUps(deps, batchId);

    expect(deps.clickup.callsOf('createTask')).toEqual([]);
    expect(await followUp(batchId, setup.findings[0]!.id)).toMatchObject({
      status: 'failed',
      error: { code: 'clickup_not_configured' },
    });
  });

  it('a server without a ClickUp key also stores clickup_not_configured', async () => {
    deps.clickup = new FakeClickUpGateway({ unconfigured: true });
    const setup = await reviewedPr();
    const batchId = await defer(setup);

    await createFollowUps(deps, batchId);

    expect(await followUp(batchId, setup.findings[0]!.id)).toMatchObject({
      status: 'failed',
      error: { code: 'clickup_not_configured' },
    });
  });

  it('uses the linked task’s list, one task per deferred finding', async () => {
    const setup = await reviewedPr();
    await upsertTaskLink(deps.db, {
      pullRequestId: setup.pullRequest.id,
      taskId: 'WB-12',
      url: LINKED.url,
      name: LINKED.name,
      how: 'branch',
      linkedBy: 'bot',
      linkedByMemberId: null,
    });
    const batchId = await defer(setup, setup.findings);

    await createFollowUps(deps, batchId);

    expect(deps.clickup.callsOf('createTask').map((call) => call.listId)).toEqual([
      'list-of-the-task',
      'list-of-the-task',
    ]);
  });

  it('a ClickUp failure is stored, rethrown for a retry, and the retry creates the task', async () => {
    const setup = await reviewedPr();
    const batchId = await defer(setup);
    deps.clickup.failNext('createTask', new IntegrationError('clickup_error', { status: 503 }));

    await expect(createFollowUps(deps, batchId)).rejects.toThrow('clickup_error');
    expect(await followUp(batchId, setup.findings[0]!.id)).toMatchObject({
      status: 'failed',
      error: { code: 'clickup_error', params: { status: 503 } },
    });

    await createFollowUps(deps, batchId);
    expect(await followUp(batchId, setup.findings[0]!.id)).toMatchObject({ status: 'created' });
  });

  it('no list to create in is stored as follow_up_list_missing', async () => {
    const setup = await reviewedPr({ ...CLICKUP!, followUpListId: null });
    const batchId = await defer(setup);

    await createFollowUps(deps, batchId);

    expect(await followUp(batchId, setup.findings[0]!.id)).toMatchObject({
      status: 'failed',
      error: { code: 'follow_up_list_missing' },
    });
  });
});

describe('resendLostFollowUps', () => {
  it('resends a Defer batch whose job never ran, after the Undo window', async () => {
    const setup = await reviewedPr();
    const batchId = await defer(setup);

    expect(await resendLostFollowUps(deps, new Date())).not.toContain(batchId);
    const later = new Date(Date.now() + 5 * 60_000);
    expect(await resendLostFollowUps(deps, later)).toContain(batchId);

    await createFollowUps(deps, batchId);
    expect(await resendLostFollowUps(deps, later)).not.toContain(batchId);
  });
});

describe('followUpDescription', () => {
  it('leaves out the line when the finding has none', () => {
    const text = followUpDescription(
      {
        findingId: 1,
        title: 't',
        file: 'a.ts',
        line: null,
        scenario: 's',
        suggestion: 'g',
        status: null,
      },
      'https://github.com/acme/x/pull/1',
    );
    expect(text).toContain('`a.ts`');
  });
});
