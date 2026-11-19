import { describe, expect, test } from 'vitest';
import {
  FakeGitHubGateway,
  fixturePullRequest,
  GITHUB_FIXTURES,
  githubFixture,
  signWebhook,
} from './index.ts';

describe('GitHub fixtures', () => {
  test.each(GITHUB_FIXTURES)('%s parses and names its event', (name) => {
    const fixture = githubFixture(name);
    expect(fixture.event).toBe(name === 'ping' ? 'ping' : 'pull_request');
    expect(JSON.parse(fixture.body)).toEqual(fixture.payload);
  });

  test('the variants differ where the worker looks', () => {
    expect(fixturePullRequest('pull_request.opened')).toMatchObject({ isDraft: false });
    expect(fixturePullRequest('pull_request.opened-draft')).toMatchObject({ isDraft: true });
    expect(fixturePullRequest('pull_request.opened-fork')).toMatchObject({ isFork: true });
    expect(fixturePullRequest('pull_request.closed')).toMatchObject({ state: 'closed' });
    const before = fixturePullRequest('pull_request.ready_for_review');
    const after = fixturePullRequest('pull_request.synchronize');
    expect(after.headSha).not.toBe(before.headSha);
    expect(after.commitsCount).toBe(before.commitsCount + 1);
  });
});

describe('FakeGitHubGateway', () => {
  test('verifies signWebhook signatures over its secret and records the call', async () => {
    const github = new FakeGitHubGateway({ webhookSecret: 's3cret' });
    const { body } = githubFixture('ping');

    expect(await github.verifyWebhook(body, signWebhook(body, 's3cret'))).toBe(true);
    expect(await github.verifyWebhook(body, signWebhook(body, 'other'))).toBe(false);
    expect(github.callsOf('verifyWebhook')).toHaveLength(2);
  });

  test('records comments on installed repositories and fails once when told to', async () => {
    const github = new FakeGitHubGateway({
      installations: { 'synergycodes/workflowbuilder': 1 },
    });
    github.failNext('postIssueComment', new Error('GitHub is down'));

    await expect(
      github.postIssueComment('synergycodes/workflowbuilder', 312, 'hi'),
    ).rejects.toThrow('GitHub is down');
    await github.postIssueComment('synergycodes/workflowbuilder', 312, 'hi');
    await expect(github.postIssueComment('other/repo', 1, 'hi')).rejects.toMatchObject({
      code: 'github_app_not_installed',
    });

    expect(github.comments).toEqual([
      { fullName: 'synergycodes/workflowbuilder', number: 312, body: 'hi', id: 1 },
    ]);
  });

  test('serves the PRs it was given', async () => {
    const pr = fixturePullRequest('pull_request.opened');
    const github = new FakeGitHubGateway().addPullRequest(pr);

    expect(await github.getPullRequest(pr.fullName, pr.number)).toBe(pr);
    await expect(github.getPullRequest(pr.fullName, 999)).rejects.toMatchObject({ status: 404 });
  });
});
