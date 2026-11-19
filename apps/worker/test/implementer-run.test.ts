// S-13-T3: an implementer run through the worker (`executeStage` per stage) with AgentRunner and
// Sandbox doubles and the real `CliGitMirror` on a git fixture. Own database, so the cancel
// listener hears only this file's runs.
import { createClaudeAgentRunner, type AgentRunInput, type AgentRunResult } from '@pra/agents';
import { member } from '@pra/core';
import {
  decideFindings,
  editPatchFile,
  eq,
  getPatch,
  getRun,
  importInstructionV1,
  insertFindings,
  insertRun,
  latestPatch,
  requestRunCancel,
  schema,
  startImplementer,
  timelineOf,
  upsertPullRequest,
  type ChangeListener,
  type Run,
} from '@pra/db';
import {
  aFinding,
  aPullRequest,
  aRun,
  createTestDatabase,
  seedTeamMember,
  type TestDatabase,
} from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import {
  createGitFixture,
  FakeSandbox,
  fixturePullRequest,
  isolatedGitExec,
  type GitFixture,
} from '@pra/integrations/testing';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { listenForCancels } from '../src/run/cancel.ts';
import { executeStage } from '../src/run/execute-stage.ts';
import { handlePatchCheck, storePatchOnCompleted } from '../src/run/patches.ts';
import { resendLostJobs } from '../src/run/recover.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

let database: TestDatabase;
let fixture: GitFixture;
let deps: TestWorkerDeps;
let listener: ChangeListener;
let signer: string;

beforeAll(async () => {
  [database, fixture] = await Promise.all([createTestDatabase(), createGitFixture()]);
  deps = await createTestWorkerDeps({ url: database.url });
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
  listener = listenForCancels(deps);
  await listener.ready;
  signer = (await seedTeamMember(deps.db, { name: 'Kasia' })).id;
}, 30_000);

afterAll(async () => {
  await listener?.close();
  await deps?.close();
  await Promise.all([database?.drop(), fixture?.remove()]);
});

const FILE_A = 'apps/demo/src/edges.ts';
const FILE_B = 'packages/sdk/src/store.ts';
const STAGES = ['worktree', 'implement', 'reproductions'] as const;

const usage = { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** A level 4 PR whose completed round has two Confirmed findings decided Implement. */
async function decidedPr() {
  const repository = await connectRepository(deps.db);
  deps.github.installations.set(repository.githubFullName, 1);
  for (const [fileKey, content] of [
    ['prompt-implementer.md', 'Fix the findings in the worktree.'],
    ['implement-rules.md', '# Rules\n\nKeep the change small.'],
  ] as const) {
    await importInstructionV1(deps.db, {
      scope: 'repository',
      repositoryId: repository.id,
      fileKey,
      content,
    });
  }
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha, level: 4 }),
  );
  deps.github.addPullRequest({
    ...fixturePullRequest('pull_request.opened'),
    fullName: repository.githubFullName,
    number: pullRequest.number,
    headSha: fixture.headSha,
    isFork: false,
  });
  const round = await insertRun(
    deps.db,
    aRun(pullRequest.id, { status: 'completed', levelNumber: 4, headSha: fixture.headSha }),
  );
  const findings = await insertFindings(deps.db, [
    aFinding(round.id, pullRequest.id, 1, { file: FILE_A, verdict: 'confirmed' }),
    aFinding(round.id, pullRequest.id, 2, { file: FILE_B, verdict: 'confirmed' }),
  ]);
  await deps.db.insert(schema.findingVerifications).values(
    findings.map((finding) => ({
      findingId: finding.id,
      runId: round.id,
      verdict: 'confirmed' as const,
      reason: { code: 'reproduced', params: {} },
      script: `echo finding ${finding.id}; exit 0`,
    })),
  );
  const decided = await decideFindings(deps.db, {
    pullRequestId: pullRequest.id,
    findingIds: findings.map((f) => f.id),
    expectedVersions: Object.fromEntries(findings.map((f) => [f.id, f.version])),
    decision: 'implement',
    signedBy: signer,
  });
  if (!decided.ok) throw new Error(`implement decision failed: ${decided.reason}`);
  return { pullRequest, findings };
}

async function started(pullRequestId: number, revise?: { patchId: number; note: string }) {
  const result = await startImplementer(deps, {
    pullRequestId,
    startedBy: member(signer),
    revise,
  });
  if (!result.started) throw new Error(`implementer refused: ${result.reason.code}`);
  return result.run;
}

/** An implementer session that writes `files` under its cwd and claims `fixed`. */
const editing =
  (files: Record<string, string>, fixed: number[], costUsd = 0.04) =>
  async (input: AgentRunInput<unknown>): Promise<AgentRunResult<unknown>> => {
    for (const [file, content] of Object.entries(files)) {
      await writeFile(path.join(input.cwd!, file), content);
    }
    return {
      status: 'completed',
      output: input.outputSchema.parse({
        decisions: fixed.map((id) => ({ id: String(id), action: 'fixed', why: 'Fixed it.' })),
        commitMessage: 'Fix the findings',
        summary: `Fixed ${fixed.length}`,
        notChecked: [],
      }),
      error: null,
      usage,
      costUsd,
      costSource: 'computed',
      turns: 3,
      durationMs: 1_000,
      transcript: [],
    };
  };

/** Runs every stage of the implementer run in order; the outcomes by stage. */
async function runAll(run: Run) {
  const outcomes: string[] = [];
  for (const stage of STAGES) {
    const outcome = await executeStage(deps, run.id, stage);
    outcomes.push(outcome);
    if (outcome !== 'succeeded') break;
  }
  return outcomes;
}

/** The cost of each agent session of a run. */
const sessionCosts = async (runId: number) =>
  (
    await deps.db
      .select({ costUsd: schema.agentSessions.costUsd })
      .from(schema.agentSessions)
      .innerJoin(
        schema.stageExecutions,
        eq(schema.stageExecutions.id, schema.agentSessions.stageExecutionId),
      )
      .where(eq(schema.stageExecutions.runId, runId))
  ).map((row) => row.costUsd);

const patchesOf = (pullRequestId: number) =>
  deps.db.select().from(schema.patches).where(eq(schema.patches.pullRequestId, pullRequestId));

/** The text stored under a blob key. */
async function blob(key: string | null) {
  const stored = key ? await deps.blobStore.get(key) : null;
  return stored ? Buffer.from(stored.body).toString('utf8') : null;
}

describe('implementer run', () => {
  test('a session that edits two files stores "2 of 2 fixed" with reproductions passing', async () => {
    const { pullRequest, findings } = await decidedPr();
    const run = await started(pullRequest.id);
    expect(run).toMatchObject({ kind: 'implementer', headSha: fixture.headSha });
    deps.sandbox = new FakeSandbox(() => ({ exitCode: 3 }));
    deps.agentRunner.enqueue(
      editing(
        {
          [FILE_A]: 'export const label = (e: { name: string }) => e.name.trim() || "?";\n',
          [FILE_B]: 'export const store = new Map<string, string>([]);\n',
        },
        findings.map((f) => f.id),
      ),
    );

    expect(await runAll(run)).toEqual(['succeeded', 'succeeded', 'succeeded']);

    expect(await getRun(deps.db, run.id)).toMatchObject({ status: 'completed' });
    const patch = await latestPatch(deps.db, pullRequest.id);
    expect(patch).toMatchObject({
      revision: 1,
      status: 'ready',
      baseSha: fixture.headSha,
      fixedFindingIds: findings.map((f) => f.id),
      reproductions: Object.fromEntries(findings.map((f) => [String(f.id), 'pass'])),
    });
    const files = (await getPatch(deps.db, patch!.id))!.files;
    expect(files.map((f) => f.path).sort()).toEqual([FILE_A, FILE_B].sort());
    const fileA = files.find((f) => f.path === FILE_A)!;
    expect(await blob(fileA.blobKey)).toContain('|| "?"');
    expect(await blob(fileA.baseBlobKey)).toContain('edge.name.trim()');

    // One reproduction per fixed finding, each with no network and a read-only worktree.
    const sandbox = deps.sandbox as FakeSandbox;
    expect(sandbox.calls).toHaveLength(2);
    for (const call of sandbox.calls) {
      expect(call.network).toBe('none');
      expect(call.mounts.every((mount) => !mount.writable)).toBe(true);
    }

    const entries = await timelineOf(deps.db, pullRequest.id);
    expect(entries.find((e) => e.kind === 'patch_ready')).toMatchObject({
      actor: 'bot',
      params: { revision: 1, fixed: 2, total: 2, reproductions: 'pass' },
    });
  });

  test('a cancelled run writes no patch and keeps the spend up to the cancel', async () => {
    const { pullRequest } = await decidedPr();
    const run = await started(pullRequest.id);
    expect(await executeStage(deps, run.id, 'worktree')).toBe('succeeded');

    deps.agentRunner.enqueue(async (input): Promise<AgentRunResult<unknown>> => {
      await writeFile(path.join(input.cwd!, FILE_A), 'half done\n');
      input.onProgress!({ usage, costUsd: 0.02, turns: 1 });
      await vi.waitFor(async () => expect(await sessionCosts(run.id)).toEqual([0.02]));
      await requestRunCancel(deps.db, run.id, { actor: member(signer), reason: 'by_hand' });
      await new Promise<void>((resolve) => {
        if (input.signal?.aborted) resolve();
        input.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return {
        status: 'cancelled',
        output: null,
        error: { code: 'cancelled', params: {} },
        usage,
        costUsd: 0.02,
        costSource: 'computed',
        turns: 1,
        durationMs: 500,
        transcript: [],
      };
    });

    expect(await executeStage(deps, run.id, 'implement')).toBe('cancelled');
    await vi.waitFor(async () =>
      expect(await getRun(deps.db, run.id)).toMatchObject({ status: 'cancelled', costUsd: 0.02 }),
    );
    expect(await patchesOf(pullRequest.id)).toEqual([]);
  });

  test('without ANTHROPIC_API_KEY the run fails with model_access_not_configured', async () => {
    const { pullRequest } = await decidedPr();
    const run = await started(pullRequest.id);
    const claude = createClaudeAgentRunner({});
    deps.agentRunner.enqueue((input) => claude.run(input));

    expect(await runAll(run)).toEqual(['succeeded', 'failed']);

    const [implement] = await deps.db
      .select()
      .from(schema.stageExecutions)
      .where(eq(schema.stageExecutions.runId, run.id))
      .then((rows) => rows.filter((row) => row.stage === 'implement'));
    expect(implement).toMatchObject({ errorCode: 'model_access_not_configured' });
    expect(await getRun(deps.db, run.id)).toMatchObject({ status: 'failed' });
    expect(await patchesOf(pullRequest.id)).toEqual([]);
  });

  test('a job delivered again after a restart produces exactly one patch', async () => {
    const { pullRequest, findings } = await decidedPr();
    const run = await started(pullRequest.id);
    deps.sandbox = new FakeSandbox(() => ({ exitCode: 3 }));
    deps.agentRunner.enqueue(
      editing({ [FILE_A]: 'export const label = () => "fixed";\n' }, [findings[0]!.id]),
    );
    expect(await runAll(run)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    const calls = deps.agentRunner.calls.length;

    // The last stage's job comes back after a restart, and the completion hook fires again.
    expect(await executeStage(deps, run.id, 'reproductions')).not.toBe('succeeded');
    const completed = (await getRun(deps.db, run.id))!;
    const found = await deps.db
      .select()
      .from(schema.pullRequests)
      .where(eq(schema.pullRequests.id, pullRequest.id));
    const [repository] = await deps.db
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.id, found[0]!.repositoryId));
    await storePatchOnCompleted({
      deps,
      run: completed,
      pullRequest: found[0]!,
      repository: repository!,
    });

    expect(deps.agentRunner.calls).toHaveLength(calls);
    const patches = await patchesOf(pullRequest.id);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ fixedFindingIds: [findings[0]!.id] });
  });

  test('a patch check after an edit reruns only the reproductions, on the edited files', async () => {
    const { pullRequest, findings } = await decidedPr();
    deps.sandbox = new FakeSandbox(() => ({ exitCode: 3 }));
    const run = await started(pullRequest.id);
    deps.agentRunner.enqueue(
      editing({ [FILE_A]: 'export const label = () => "fixed";\n' }, [findings[0]!.id]),
    );
    expect(await runAll(run)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    const patch = (await getPatch(deps.db, (await latestPatch(deps.db, pullRequest.id))!.id))!;
    const calls = deps.agentRunner.calls.length;

    await deps.blobStore.put('edits/a.txt', 'export const label = () => "edited";\n', {
      contentType: 'text/plain; charset=utf-8',
    });
    const edited = await editPatchFile(deps.db, {
      patchId: patch.id,
      revision: 1,
      path: FILE_A,
      expectedBlobKey: patch.files[0]!.blobKey,
      blobKey: 'edits/a.txt',
    });
    expect(edited).toMatchObject({ ok: true });
    // The api's send of the check was lost: the worker's periodic resend sends it again.
    expect((await resendLostJobs(deps)).patchChecks).toContain(patch.id);
    let seen = '';
    deps.sandbox = new FakeSandbox(async (spec) => {
      seen = await readFile(path.join(spec.mounts[0]!.hostPath, FILE_A), 'utf8');
      return { exitCode: 0 };
    });

    await handlePatchCheck(deps, patch.id);

    expect(seen).toContain('"edited"');
    expect(deps.agentRunner.calls).toHaveLength(calls);
    expect(await getPatch(deps.db, patch.id)).toMatchObject({
      checking: false,
      checkVersion: 1,
      reproductions: { [String(findings[0]!.id)]: 'fail' },
    });
  });

  test('revise with a note creates revision 2 from the current patch and supersedes revision 1', async () => {
    const { pullRequest, findings } = await decidedPr();
    deps.sandbox = new FakeSandbox(() => ({ exitCode: 3 }));
    const first = await started(pullRequest.id);
    deps.agentRunner.enqueue(
      editing({ [FILE_A]: 'export const label = () => "first";\n' }, [findings[0]!.id]),
    );
    expect(await runAll(first)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    const one = (await latestPatch(deps.db, pullRequest.id))!;

    const note = 'Also handle a missing name.';
    const revise = await started(pullRequest.id, { patchId: one.id, note });
    expect(revise).toMatchObject({ kind: 'implementer', trigger: 'revise' });
    let seenA = '';
    let prompt = '';
    deps.agentRunner.enqueue(async (input) => {
      // The worktree starts from the base plus revision 1's files.
      seenA = await readFile(path.join(input.cwd!, FILE_A), 'utf8');
      // The prompt names the note's file; the note itself stays out of the prompt text.
      const noteFile = /\S+revise-note\.md/.exec(input.prompt)?.[0];
      prompt = noteFile ? await readFile(noteFile, 'utf8') : '';
      return editing(
        {
          [FILE_A]: 'export const label = () => "second";\n',
          [FILE_B]: 'export const store = new Map();\n',
        },
        findings.map((f) => f.id),
      )(input);
    });
    expect(await runAll(revise)).toEqual(['succeeded', 'succeeded', 'succeeded']);

    expect(seenA).toContain('"first"');
    expect(prompt).toContain(note);
    const two = (await latestPatch(deps.db, pullRequest.id))!;
    expect(two).toMatchObject({ revision: 2, status: 'ready', reviseNote: note });
    expect((await getPatch(deps.db, one.id))!.status).toBe('superseded');
    const files = (await getPatch(deps.db, two.id))!.files;
    expect(files.map((f) => f.path).sort()).toEqual([FILE_A, FILE_B].sort());
    expect(await blob(files.find((f) => f.path === FILE_A)!.blobKey)).toContain('"second"');
  });
});
