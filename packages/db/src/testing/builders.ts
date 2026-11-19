// Rows for tests. Test files share one database per run, so names and numbers are unique.
import { randomBytes, randomUUID } from 'node:crypto';
import { freezeLevel, resolveLevel, type LevelNumber, type RepositoryConfig } from '@pra/core';
import type { Db } from '../client.ts';
import { upsertPullRequest, upsertRepository } from '../queries/repositories.ts';
import type { PullRequest, PullRequestSnapshot, Repository } from '../queries/repositories.ts';
import type { NewFinding, NewQuestion, NewRun } from '../queries/runs.ts';

export const uniqueId = (): string => randomBytes(4).toString('hex');

export function aRepositoryConfig(
  patch: Partial<RepositoryConfig> = {},
): Partial<RepositoryConfig> {
  const slug = patch.slug ?? `repo-${uniqueId()}`;
  return { slug, githubFullName: `acme/${slug}`, ...patch };
}

let nextNumber = 1;
export function aPullRequest(
  repositoryId: number,
  patch: Partial<PullRequestSnapshot> = {},
): PullRequestSnapshot {
  return {
    repositoryId,
    number: nextNumber++,
    title: 'feat: add the thing',
    body: '',
    authorLogin: 'octocat',
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    headRef: 'feature',
    baseRef: 'main',
    isDraft: false,
    isFork: false,
    state: 'open',
    commitsCount: 1,
    openedAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...patch,
  };
}

export function aRun(
  pullRequestId: number,
  patch: Partial<NewRun> & { levelNumber?: LevelNumber } = {},
): NewRun {
  const { levelNumber = 1, ...rest } = patch;
  return {
    pullRequestId,
    kind: 'round',
    roundNo: 1,
    chainId: randomUUID(),
    level: freezeLevel(resolveLevel(levelNumber)),
    headSha: 'a'.repeat(40),
    commitsCountAtStart: 1,
    status: 'queued',
    startedBy: 'bot',
    trigger: 'ready_for_review',
    ...rest,
  };
}

export function aFinding(
  runId: number,
  pullRequestId: number,
  ordinal: number,
  patch: Partial<NewFinding> = {},
): NewFinding {
  return {
    runId,
    pullRequestId,
    ordinal,
    severity: 'worth_fixing',
    title: `Finding ${ordinal}`,
    file: 'src/index.ts',
    line: 10 + ordinal,
    scenario: 'When the list is empty, the page crashes.',
    suggestion: 'Return early on an empty list.',
    ...patch,
  };
}

export function aQuestion(
  runId: number,
  ordinal: number,
  patch: Partial<NewQuestion> = {},
): NewQuestion {
  return {
    runId,
    ordinal,
    text: 'Should the cache survive a restart?',
    options: ['Yes', 'No'],
    recommended: 0,
    why: 'Restarts are frequent.',
    ...patch,
  };
}

/** A connected repository with one open PR. */
export async function seedPullRequest(
  db: Db,
  options: {
    repository?: Partial<RepositoryConfig>;
    pullRequest?: Partial<PullRequestSnapshot>;
  } = {},
): Promise<{ repository: Repository; pullRequest: PullRequest }> {
  const repository = await upsertRepository(db, aRepositoryConfig(options.repository));
  const { pullRequest } = await upsertPullRequest(
    db,
    aPullRequest(repository.id, options.pullRequest),
  );
  return { repository, pullRequest };
}
