// S-05-T2: the Verify stage with verifier (`FakeAgentRunner`) and `FakeSandbox` doubles.
import {
  asc,
  eq,
  importInstructionV1,
  insertFindings,
  insertRun,
  schema,
  upsertPullRequest,
  verificationsOfRun,
  type Run,
} from '@pra/db';
import { aFinding, aPullRequest, aRun } from '@pra/db/testing';
import { CliGitMirror, type SandboxResult } from '@pra/integrations';
import {
  createGitFixture,
  FakeSandbox,
  isolatedGitExec,
  type GitFixture,
} from '@pra/integrations/testing';
import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { executeStage } from '../src/run/execute-stage.ts';
import { runStateOf } from '../src/run/state.ts';
import type { VerifyOutput } from '../src/stages/verify.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

let fixture: GitFixture;
let deps: TestWorkerDeps;

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

const FILE = 'apps/demo/src/edges.ts';
/** In `FILE` at the PR head. */
const FOUND = 'export const label = (edge: { name: string }) => edge.name.trim();';
const ABSENT = 'return edge.label ?? edge.id;';

const reviewAnswer = (count: number) => ({
  summary: 's',
  risk: 'low',
  findings: Array.from({ length: count }, (_, i) => ({
    title: `Finding ${i + 1}`,
    severity: 'blocker',
    file: FILE,
    line: 1,
    scenario: 'When the name is empty, the edge shows nothing.',
    suggestion: 'Fall back to the edge id.',
  })),
  questions: [],
  notChecked: [],
});

type Answer = {
  verdict?: 'confirmed' | 'refuted' | 'unverified';
  quotes?: string[];
  script?: string;
};
const verifierAnswer = ({ verdict = 'confirmed', quotes = [FOUND], script }: Answer = {}) => ({
  output: {
    verdict,
    reason: 'Read the code.',
    evidence: quotes.map((quote) => ({ file: FILE, line: 1, quote })),
    ...(script ? { script } : {}),
    remedy: { kind: 'obvious', why: 'Trim and fall back.' },
  },
});

/** A round at `level` through Review with `findings` Blocking findings; returns the run. */
async function reviewed(options: { level?: 2 | 3; findings?: number; fork?: boolean } = {}) {
  const { level = 3, findings = 1, fork = false } = options;
  const repository = await connectRepository(deps.db);
  for (const [fileKey, content] of [
    ['prompt-verifier.md', 'Try to refute the finding. Rules: {{knowledgeDir}}/verify-rules.md'],
    ['verify-rules.md', '# Script\n\nExit 0 when the bug shows, 3 when it does not.'],
  ]) {
    await importInstructionV1(deps.db, {
      scope: 'repository',
      repositoryId: repository.id,
      fileKey: fileKey!,
      content: content!,
    });
  }
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, {
      headSha: fixture.headSha,
      baseSha: fixture.baseSha,
      isFork: fork,
    }),
  );
  const run = await insertRun(
    deps.db,
    aRun(pullRequest.id, { levelNumber: level, headSha: fixture.headSha }),
  );
  for (const stage of ['checks', 'task', 'change_type']) {
    expect(await executeStage(deps, run.id, stage)).toBe('succeeded');
  }
  deps.agentRunner.enqueue({ output: reviewAnswer(findings) });
  expect(await executeStage(deps, run.id, 'review')).toBe('succeeded');
  return run;
}

/** Runs Verify with the sandbox answering `exits` in turn. */
async function verify(run: Run, exits: (number | null)[] = []) {
  /** The reproduction files in the worktree during each sandbox call. */
  const seen: string[][] = [];
  const sandbox = new FakeSandbox((spec, call): Partial<SandboxResult> => {
    seen.push(
      readdirSync(spec.mounts[0]!.hostPath).filter((name) => name.startsWith('.pra-repro')),
    );
    const exitCode = exits[call] ?? 0;
    return { exitCode, timedOut: exitCode === null, output: `run ${call + 1}: exit ${exitCode}` };
  });
  deps.sandbox = sandbox;
  const outcome = await executeStage(deps, run.id, 'verify');
  const [stage] = await deps.db
    .select()
    .from(schema.stageExecutions)
    .where(eq(schema.stageExecutions.runId, run.id))
    .orderBy(asc(schema.stageExecutions.id))
    .then((rows) => rows.filter((row) => row.stage === 'verify'));
  const findings = await deps.db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.runId, run.id))
    .orderBy(asc(schema.findings.ordinal));
  return {
    outcome,
    output: stage?.output as VerifyOutput,
    findings,
    verifications: await verificationsOfRun(deps.db, run.id),
    sandbox,
    seen,
  };
}

describe('Verify stage', () => {
  test('exit 0 gives Confirmed even when the verifier said Refuted', async () => {
    const run = await reviewed();
    deps.agentRunner.enqueue(verifierAnswer({ verdict: 'refuted', script: 'process.exit(0)' }));

    const { outcome, findings, verifications } = await verify(run, [0]);

    expect(outcome).toBe('succeeded');
    expect(findings[0]).toMatchObject({
      verdict: 'confirmed',
      evidence: [{ file: FILE, line: 1, quote: FOUND }],
      version: 1,
    });
    expect(verifications[0]).toMatchObject({
      verdict: 'confirmed',
      verifierVerdict: 'refuted',
      reason: { code: 'repro_reproduced', params: { exitCode: 0, agentVerdict: 'refuted' } },
      script: 'process.exit(0)',
      exitCode: 0,
      outputTail: 'run 1: exit 0',
      repaired: false,
      sandboxRuns: 1,
      remedy: { kind: 'obvious', why: 'Trim and fall back.' },
    });
    // The whole output is in BlobStore.
    const blob = await deps.blobStore.get(verifications[0]!.outputBlobKey!);
    expect(Buffer.from(blob!.body).toString()).toBe('run 1: exit 0');
  });

  test('the reproduction runs offline, read-only, for 5 minutes, from the repository root', async () => {
    const run = await reviewed();
    deps.agentRunner.enqueue(verifierAnswer({ script: 'process.exit(0)' }));

    const { sandbox, seen } = await verify(run, [0]);

    expect(sandbox.calls).toHaveLength(1);
    const [spec] = sandbox.calls;
    expect(spec).toMatchObject({
      network: 'none',
      workdir: '/work',
      limits: { timeoutMs: 5 * 60_000 },
    });
    expect(spec!.mounts).toHaveLength(1);
    expect(spec!.mounts[0]!.containerPath).toBe('/work');
    expect(spec!.mounts[0]!.writable).toBeFalsy();
    expect(spec!.command[0]).toBe('node');
    expect(spec!.command[1]).toMatch(/^\/work\/\.pra-repro-\d+-1-[0-9a-f-]{36}\.mjs$/);
    // The script sits in the worktree's root for the run only.
    expect(seen).toEqual([[path.basename(spec!.command[1]!)]]);
  });

  test('exit 3 gives Refuted', async () => {
    const run = await reviewed();
    deps.agentRunner.enqueue(verifierAnswer({ verdict: 'confirmed', script: 'process.exit(3)' }));

    const { findings, verifications } = await verify(run, [3]);

    expect(findings[0]!.verdict).toBe('refuted');
    expect(verifications[0]).toMatchObject({
      reason: { code: 'repro_not_reproduced' },
      exitCode: 3,
      sandboxRuns: 1,
    });
  });

  test('exit 1 then a repaired exit 0 gives Confirmed after exactly 2 sandbox runs', async () => {
    const run = await reviewed();
    deps.agentRunner.enqueue(
      verifierAnswer({ verdict: 'refuted', script: 'throw new Error()' }),
      verifierAnswer({ verdict: 'confirmed', script: 'process.exit(0)' }),
    );
    const calls = deps.agentRunner.calls.length;

    const { findings, verifications, output, sandbox, seen } = await verify(run, [1, 0]);

    expect(sandbox.calls).toHaveLength(2);
    // The broken script was removed before the repaired one ran.
    expect(seen.map((names) => names.map((name) => name.split('-')[3]))).toEqual([['1'], ['2']]);
    expect(findings[0]!.verdict).toBe('confirmed');
    expect(verifications[0]).toMatchObject({
      script: 'process.exit(0)',
      exitCode: 0,
      repaired: true,
      sandboxRuns: 2,
    });
    expect(output.findings[0]!.runs.map((r) => r.exitCode)).toEqual([1, 0]);
    // The repair session got the broken script and its output.
    const repair = deps.agentRunner.calls.slice(calls)[1]!;
    expect(repair.prompt).toContain('previous script did not run');
  });

  test('exit 1 twice gives Not proven', async () => {
    const run = await reviewed();
    deps.agentRunner.enqueue(
      verifierAnswer({ script: 'throw new Error()' }),
      verifierAnswer({ script: 'throw new Error("again")' }),
    );

    const { findings, verifications, sandbox } = await verify(run, [1, 1]);

    expect(sandbox.calls).toHaveLength(2);
    expect(findings[0]!.verdict).toBe('not_proven');
    expect(verifications[0]).toMatchObject({
      reason: { code: 'repro_broken', params: { exitCode: 1 } },
      repaired: true,
      sandboxRuns: 2,
    });
  });

  test('a quote absent from the file is dropped; none left gives Not proven', async () => {
    const run = await reviewed({ findings: 2 });
    deps.agentRunner.enqueue(
      verifierAnswer({ verdict: 'confirmed', quotes: [FOUND, ABSENT] }),
      verifierAnswer({ verdict: 'confirmed', quotes: [ABSENT] }),
    );

    const { findings, verifications, sandbox } = await verify(run);

    expect(sandbox.calls).toEqual([]);
    expect(findings.map((f) => f.verdict)).toEqual(['confirmed', 'not_proven']);
    expect(findings[0]!.evidence).toEqual([{ file: FILE, line: 1, quote: FOUND }]);
    expect(findings[1]!.evidence).toEqual([]);
    expect(verifications[0]).toMatchObject({
      reason: { code: 'quotes_found', params: { count: 1 } },
      droppedQuotes: [{ file: FILE, line: 1, quote: ABSENT }],
    });
    expect(verifications[1]).toMatchObject({ reason: { code: 'quote_missing' } });
  });

  test('earlier rounds’ findings are untouched', async () => {
    const run = await reviewed();
    const earlier = await insertRun(
      deps.db,
      aRun(run.pullRequestId, { levelNumber: 3, status: 'completed', headSha: fixture.baseSha }),
    );
    const [old] = await insertFindings(deps.db, [aFinding(earlier.id, run.pullRequestId, 1)]);
    deps.agentRunner.enqueue(verifierAnswer());

    const { findings } = await verify(run);

    expect(findings[0]!.verdict).toBe('confirmed');
    const [after] = await deps.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.id, old!.id));
    expect(after).toMatchObject({ verdict: 'unchecked', version: 0, evidence: [] });
    expect(await verificationsOfRun(deps.db, earlier.id)).toEqual([]);
  });

  test('a fork PR’s script is not run: the quotes decide', async () => {
    const run = await reviewed({ fork: true });
    deps.agentRunner.enqueue(verifierAnswer({ verdict: 'refuted', script: 'process.exit(0)' }));

    const { findings, output, sandbox } = await verify(run);

    expect(sandbox.calls).toEqual([]);
    expect(output.runScripts).toBe(false);
    expect(findings[0]!.verdict).toBe('refuted');
  });

  test('a level-2 run plans no Verify stage', async () => {
    const run = await reviewed({ level: 2 });
    const stored = await deps.db.select().from(schema.runs).where(eq(schema.runs.id, run.id));
    const state = runStateOf(stored[0]!, []);

    expect(state.stages.find((s) => s.key === 'verify')).toMatchObject({ status: 'off' });
    expect(stored[0]!.status).toBe('completed');
  });
});
