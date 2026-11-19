// S-11-T1: a completed round adds the PR's changed files that match a sensitive pattern as
// pending; core's state and checklist read them; the next push turns sent back into pending.
import { checklist, nextStep } from '@pra/core';
import {
  decideFindings,
  eq,
  getPullRequest,
  insertFindings,
  loadPrStateInput,
  schema,
  sensitiveFilesOf,
  settleSensitiveFiles,
  type PullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import { aFinding, seedTeamMember } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import {
  createGitFixture,
  DEFAULT_FEATURE_FILES,
  isolatedGitExec,
  type GitHubFixtureName,
} from '@pra/integrations/testing';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { executeStage } from '../src/run/execute-stage.ts';
import { sensitiveFilesGate } from '../src/run/sensitive-files.ts';
import { startRound } from '../src/run/start-round.ts';
import { connectRepository, createTestWorkerDeps, storeGithubEvent } from './support.ts';

const MIGRATION = 'db/migrations/0001_edge_labels.sql';
const PATTERNS = [{ pattern: 'db/migrations/**', reason: 'Migrations run once on production.' }];

const fixture = await createGitFixture({
  feature: { ...DEFAULT_FEATURE_FILES, [MIGRATION]: 'alter table edges add column label text;\n' },
  // After the review: the approved migration is rewritten, then an unrelated file changes.
  fixes: [{ [MIGRATION]: 'drop table edges;\n' }, { 'README.md': 'Docs.\n' }],
});
const deps = await createTestWorkerDeps();
deps.gitMirror = new CliGitMirror({
  rootDir: path.join(deps.dataDir, 'git'),
  remoteUrl: () => fixture.dir,
  exec: isolatedGitExec,
});
let repository: Repository;
let clock = Date.parse('2026-11-19T10:00:00Z');

beforeEach(async () => {
  repository = await connectRepository(deps.db, { sensitivePatterns: PATTERNS });
  await deps.gitMirror.fetch(repository.githubFullName);
});

afterAll(async () => {
  await deps.close();
  await fixture.remove();
});

/** Each delivery is newer than the last, so none is stale. */
async function deliver(name: GitHubFixtureName, headSha: string): Promise<string> {
  clock += 60_000;
  const event = await storeGithubEvent(deps, name, {
    fullName: repository.githubFullName,
    headSha,
    pullRequest: { updated_at: new Date(clock).toISOString() },
  });
  return processGithubEvent(deps, event.id);
}

async function pr(): Promise<PullRequest> {
  return (await getPullRequest(deps.db, repository.id, 312))!;
}

/** Round 1 from a ready event on the fixture's feature commit, scanned at its start, completed. */
async function reviewedRound(): Promise<{ run: Run; pullRequest: PullRequest }> {
  await deliver('pull_request.ready_for_review', fixture.headSha);
  // The fixture payload's base is not in the git fixture.
  const [pullRequest] = await deps.db
    .update(schema.pullRequests)
    .set({ baseSha: fixture.baseSha })
    .where(eq(schema.pullRequests.id, (await pr()).id))
    .returning();
  const [run] = await deps.db
    .update(schema.runs)
    .set({ status: 'completed', finishedAt: new Date() })
    .where(eq(schema.runs.pullRequestId, pullRequest!.id))
    .returning();
  await sensitiveFilesGate({
    deps,
    run: run!,
    pullRequest: pullRequest!,
    repository,
    stage: 'review',
  });
  return { run: run!, pullRequest: pullRequest! };
}

async function files() {
  return (await sensitiveFilesOf(deps.db, [(await pr()).id])).get((await pr()).id) ?? [];
}

async function state() {
  const load = await loadPrStateInput(deps.db, (await pr()).id);
  const row = checklist(load!.input).items.find((i) => i.item === 'sensitive_files_approved');
  return { input: load!.input, step: nextStep(load!.input), row };
}

/** Rejects the round's one finding, so only the sensitive file waits. */
async function decideAll(run: Run, pullRequest: PullRequest): Promise<void> {
  const [finding] = await insertFindings(deps.db, [aFinding(run.id, pullRequest.id, 1)]);
  const kasia = await seedTeamMember(deps.db);
  const decided = await decideFindings(deps.db, {
    pullRequestId: pullRequest.id,
    findingIds: [finding!.id],
    expectedVersions: { [finding!.id]: 0 },
    decision: 'reject',
    reason: 'Not in this PR.',
    signedBy: kasia.id,
  });
  expect(decided.ok).toBe(true);
}

describe('sensitive files', () => {
  test('a round on a PR touching one sensitive path adds one pending file', async () => {
    const { run, pullRequest } = await reviewedRound();
    expect(await files()).toEqual([
      expect.objectContaining({
        path: MIGRATION,
        pattern: 'db/migrations/**',
        reason: 'Migrations run once on production.',
        status: 'pending',
        headSha: fixture.headSha,
      }),
    ]);
    expect((await pr()).sensitiveVersion).toBe(1);

    // The same round again adds nothing and keeps the version.
    await sensitiveFilesGate({ deps, run, pullRequest, repository, stage: 'review' });
    expect(await files()).toHaveLength(1);
    expect((await pr()).sensitiveVersion).toBe(1);
  });

  test('a repository without sensitive patterns gets no file', async () => {
    repository = await connectRepository(deps.db, { sensitivePatterns: [] });
    await reviewedRound();
    expect(await files()).toEqual([]);
    expect((await state()).input.sensitive).toBeNull();
  });

  test('once findings are decided the state is sensitive_files; approval passes the row', async () => {
    const { run, pullRequest } = await reviewedRound();
    await decideAll(run, pullRequest);

    let now = await state();
    expect(now.input.sensitive).toEqual({
      status: 'pending',
      files: [MIGRATION],
      sentBackBy: null,
    });
    expect(now.step.state).toBe('sensitive_files');
    expect(now.step.banner).toEqual({ code: 'state_sensitive_files', params: { count: 1 } });
    expect(now.row).toMatchObject({ ok: false, reason: { code: 'checklist_sensitive_pending' } });

    expect(
      await settleSensitiveFiles(deps.db, {
        pullRequestId: pullRequest.id,
        version: 0,
        action: 'approve',
      }),
    ).toEqual({ ok: false, reason: 'stale', version: 1 });
    const approved = await settleSensitiveFiles(deps.db, {
      pullRequestId: pullRequest.id,
      version: 1,
      action: 'approve',
    });
    expect(approved).toMatchObject({ ok: true, version: 2 });

    now = await state();
    expect(now.row).toMatchObject({
      ok: true,
      reason: { code: 'checklist_sensitive_approved', params: { count: 1 } },
    });
    expect(now.step.state).toBe('ready_to_merge');
    expect(await files()).toEqual([expect.objectContaining({ status: 'approved', actor: 'hand' })]);
  });

  test('sent back plus a push gives pending', async () => {
    const { run, pullRequest } = await reviewedRound();
    await decideAll(run, pullRequest);
    const tomek = await seedTeamMember(deps.db, { name: 'Tomek' });
    const sent = await settleSensitiveFiles(deps.db, {
      pullRequestId: pullRequest.id,
      version: 1,
      action: 'send_back',
      memberId: tomek.id,
      comment: 'Split the migration from the rename.',
    });
    expect(sent.ok).toBe(true);
    const back = await state();
    expect(back.input.sensitive).toEqual({
      status: 'sent_back',
      files: [MIGRATION],
      sentBackBy: { kind: 'member', memberId: tomek.id },
    });
    expect(back.step.banner.code).toBe('state_sensitive_sent_back');

    // The author pushes: the file waits for a person again.
    await deliver('pull_request.synchronize', 'b'.repeat(40));
    expect(await files()).toEqual([
      expect.objectContaining({ status: 'pending', comment: null, memberId: null }),
    ]);
    expect((await pr()).sensitiveVersion).toBe(3);
    // New commits come first in the state order; the file still waits for a person.
    const after = await state();
    expect(after.step.state).toBe('new_commits');
    expect(after.input.sensitive).toEqual({
      status: 'pending',
      files: [MIGRATION],
      sentBackBy: null,
    });
    expect(after.row).toMatchObject({ ok: false, reason: { code: 'checklist_sensitive_pending' } });
  });

  test('a round whose scan fails stays queued: it never completes unscanned', async () => {
    await deliver('pull_request.ready_for_review', fixture.headSha);
    const [run] = await deps.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.pullRequestId, (await pr()).id));
    const diff = deps.gitMirror.diff.bind(deps.gitMirror);
    deps.gitMirror.diff = () => Promise.reject(new Error('git failed'));
    try {
      await expect(executeStage(deps, run!.id, 'review')).rejects.toThrow('git failed');
    } finally {
      deps.gitMirror.diff = diff;
    }
    const [after] = await deps.db.select().from(schema.runs).where(eq(schema.runs.id, run!.id));
    expect(after!.status).toBe('queued');
    expect(await files()).toEqual([]);
  });

  test('a file renamed out of a sensitive path still needs a person', async () => {
    const OLD = 'db/migrations/0000_init.sql';
    const renamed = await createGitFixture({
      base: { ...DEFAULT_FEATURE_FILES, [OLD]: 'create table edges (id int);\n' },
      feature: { [OLD]: null, 'archive/0000_init.sql': 'create table edges (id int);\n' },
    });
    const mirror = deps.gitMirror;
    deps.gitMirror = new CliGitMirror({
      rootDir: path.join(deps.dataDir, 'git-renamed'),
      remoteUrl: () => renamed.dir,
      exec: isolatedGitExec,
    });
    try {
      await deps.gitMirror.fetch(repository.githubFullName);
      await deliver('pull_request.ready_for_review', renamed.headSha);
      const [pullRequest] = await deps.db
        .update(schema.pullRequests)
        .set({ baseSha: renamed.baseSha })
        .where(eq(schema.pullRequests.id, (await pr()).id))
        .returning();
      const [run] = await deps.db
        .select()
        .from(schema.runs)
        .where(eq(schema.runs.pullRequestId, pullRequest!.id));
      await sensitiveFilesGate({
        deps,
        run: run!,
        pullRequest: pullRequest!,
        repository,
        stage: 'review',
      });
      expect(await files()).toEqual([expect.objectContaining({ path: OLD, status: 'pending' })]);
    } finally {
      deps.gitMirror = mirror;
      await renamed.remove();
    }
  });

  test('an approval sent from a page loaded before a push is stale', async () => {
    const { pullRequest } = await reviewedRound();
    expect((await pr()).sensitiveVersion).toBe(1);
    // The person opened the page at version 1; the author then pushes.
    await deliver('pull_request.synchronize', 'b'.repeat(40));
    expect(
      await settleSensitiveFiles(deps.db, {
        pullRequestId: pullRequest.id,
        version: 1,
        action: 'approve',
      }),
    ).toEqual({ ok: false, reason: 'stale', version: 2 });
    expect(await files()).toEqual([expect.objectContaining({ status: 'pending' })]);
  });

  test('an approved file a later commit changes needs a person again', async () => {
    const { run, pullRequest } = await reviewedRound();
    await decideAll(run, pullRequest);
    await settleSensitiveFiles(deps.db, {
      pullRequestId: pullRequest.id,
      version: 1,
      action: 'approve',
    });

    /** A push, then a review started by hand on it, scanned at its start. */
    const reviewAt = async (head: string) => {
      await deliver('pull_request.synchronize', head);
      const [moved] = await deps.db
        .update(schema.pullRequests)
        .set({ baseSha: fixture.baseSha })
        .where(eq(schema.pullRequests.id, pullRequest.id))
        .returning();
      const started = await startRound(deps, {
        pullRequestId: pullRequest.id,
        trigger: 'manual',
        startedBy: { kind: 'hand' },
      });
      if (!started.started) throw new Error(started.reason.code);
      await sensitiveFilesGate({
        deps,
        run: started.run,
        pullRequest: moved!,
        repository,
        stage: 'review',
      });
      await deps.db
        .update(schema.runs)
        .set({ status: 'completed', finishedAt: new Date() })
        .where(eq(schema.runs.id, started.run.id));
    };

    await reviewAt(fixture.fixShas[0]!);
    expect(await files()).toEqual([
      expect.objectContaining({ status: 'pending', actor: null, headSha: fixture.fixShas[0] }),
    ]);
    expect((await state()).input.sensitive?.status).toBe('pending');

    // Approved on the rewrite, a commit that does not touch it leaves the approval.
    await settleSensitiveFiles(deps.db, {
      pullRequestId: pullRequest.id,
      version: (await pr()).sensitiveVersion,
      action: 'approve',
    });
    await reviewAt(fixture.fixShas[1]!);
    expect(await files()).toEqual([expect.objectContaining({ status: 'approved' })]);
  });
});
