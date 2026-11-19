// S-01-T9: the review stage with `FakeAgentRunner` and a local git repository.
import type { AgentRunInput } from '@pra/agents';
import type { FakeAgentStep } from '@pra/agents/testing';
import { freezeLevel, resolveLevel, type LevelNumber } from '@pra/core';
import {
  importInstructionV1,
  insertRun,
  upsertPullRequest,
  type PullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import { aPullRequest, aRun, uniqueId } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import { createGitFixture, isolatedGitExec, type GitFixture } from '@pra/integrations/testing';
import { access, constants, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildBrief, documentsFor } from '../src/stages/review/brief.ts';
import {
  BUILT_IN_REVIEWER_PROMPT,
  effectiveInstructions,
  renderReviewerPrompt,
} from '../src/stages/review/prompt.ts';
import { reviewStage } from '../src/stages/review/index.ts';
import type { StageResult } from '../src/stages/stage.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

const SECRETS = {
  ANTHROPIC_API_KEY: 'sk-ant-test-never-in-a-prompt-0123456789',
  GITHUB_WEBHOOK_SECRET: 'whsec-never-in-a-brief-0123456789',
  CLICKUP_API_KEY: 'pk_never_in_a_brief_0123456789',
};

let fixture: GitFixture;
let deps: TestWorkerDeps;
let repository: Repository;
let pullRequest: PullRequest;

beforeAll(async () => {
  Object.assign(process.env, SECRETS);
  fixture = await createGitFixture();
  deps = await createTestWorkerDeps();
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
});

afterAll(async () => {
  for (const key of Object.keys(SECRETS)) delete process.env[key];
  await deps.close();
  await fixture.remove();
});

beforeEach(async () => {
  repository = await connectRepository(deps.db, {
    sensitivePatterns: [{ pattern: 'packages/sdk/src/index.ts', reason: 'Public SDK entry' }],
  });
  ({ pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, {
      title: 'Add edge label editing',
      body: 'Lets users rename an edge label inline.',
      headSha: fixture.headSha,
      baseSha: fixture.baseSha,
    }),
  ));
});

async function review(
  step: FakeAgentStep,
  level: LevelNumber = 1,
): Promise<{ result: StageResult; run: Run; call: AgentRunInput<unknown> }> {
  const run = await insertRun(
    deps.db,
    aRun(pullRequest.id, { levelNumber: level, headSha: fixture.headSha }),
  );
  deps.agentRunner.enqueue(step);
  const result = await reviewStage.run({
    deps,
    run,
    pullRequest,
    repository,
    level: run.level,
    attempt: 1,
    signal: new AbortController().signal,
  });
  return { result, run, call: deps.agentRunner.calls.at(-1)! };
}

const finding = (severity: 'blocker' | 'should' | 'nit', n: number) => ({
  title: `${severity} ${n}`,
  severity,
  file: 'apps/demo/src/edges.ts',
  line: n,
  scenario: 'When the label is empty, the edge shows nothing.',
  suggestion: 'Fall back to the edge id.',
});

const answer = (patch: Record<string, unknown> = {}) => ({
  summary: 'Adds inline renaming.',
  risk: 'low',
  findings: [],
  questions: [],
  notChecked: ['Keyboard focus'],
  ...patch,
});

describe('review stage', () => {
  test('9 findings are cut to level 1’s 4, most severe first', async () => {
    const findings = [
      finding('nit', 1),
      finding('should', 2),
      finding('nit', 3),
      finding('blocker', 4),
      finding('should', 5),
      finding('nit', 6),
      finding('should', 7),
      finding('blocker', 8),
      finding('nit', 9),
    ];
    const question = { question: 'Keep?', options: ['Yes', 'No'], recommended: 0, why: 'Simpler.' };

    const { result } = await review({
      output: answer({ findings, questions: [question] }),
      costUsd: 0.42,
    });

    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') return;
    expect(result.findings.map((f) => [f.severity, f.title])).toEqual([
      ['blocking', 'blocker 4'],
      ['blocking', 'blocker 8'],
      ['worth_fixing', 'should 2'],
      ['worth_fixing', 'should 5'],
    ]);
    // Level 1 asks no questions.
    expect(result.questions).toEqual([]);
    expect(result.notChecked).toEqual(['Keyboard focus']);
    expect(result.output).toMatchObject({
      summary: 'Adds inline renaming.',
      dropped: { severity: 0, overLimit: 5, questions: 1 },
    });
    expect(result.sessions).toEqual([
      expect.objectContaining({ role: 'reviewer', model: 'claude-opus-5-5' }),
    ]);
    expect(result.sessions[0]!.result.costUsd).toBe(0.42);
  });

  test('level 2 keeps 7 findings and its questions', async () => {
    const findings = Array.from({ length: 9 }, (_, i) => finding('should', i + 1));
    const question = { question: 'Keep?', options: ['Yes', 'No'], recommended: 1, why: 'Safer.' };

    const { result } = await review({ output: answer({ findings, questions: [question] }) }, 2);

    if (result.status !== 'succeeded') throw new Error(result.status);
    expect(result.findings).toHaveLength(7);
    expect(result.questions).toEqual([
      { text: 'Keep?', options: ['Yes', 'No'], recommended: 1, why: 'Safer.' },
    ]);
  });

  test('malformed output fails with review_output_invalid and keeps the session', async () => {
    const { result } = await review({ output: { summary: 'no findings field' }, costUsd: 0.1 });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'review_output_invalid' },
    });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.result.costUsd).toBe(0.1);
  });

  test('a runner error keeps its code', async () => {
    const { result } = await review({ fail: 'model_access_not_configured' });
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'model_access_not_configured' },
    });
  });

  test('the reviewer works in the session dir and reads the worktree and knowledge', async () => {
    const { call, run } = await review({ output: answer() });

    const sessionDir = path.join(deps.dataDir, 'sessions', `run-${run.id}`, 'review-1');
    expect(call).toMatchObject({
      role: 'reviewer',
      cwd: sessionDir,
      readDirs: [
        path.join(deps.dataDir, 'git', 'worktrees', `run-${run.id}`),
        path.join(sessionDir, 'knowledge'),
      ],
      maxTurns: 100,
      maxCostUsd: 10,
    });
    const diff = await readFile(path.join(sessionDir, 'diff.patch'), 'utf8');
    expect(diff).toContain('edge.name.trim()');
    const worktreeFile = path.join(call.readDirs![0]!, 'packages/sdk/src/edges.ts');
    await expect(readFile(worktreeFile, 'utf8')).resolves.toContain('EdgeLabel');
  });

  test('the brief holds the PR, changed files, sensitive paths, limits and documents', async () => {
    const { call } = await review({ output: answer() });

    const brief = await readFile(path.join(call.cwd, 'brief.md'), 'utf8');
    expect(brief).toContain('# Review brief: PR #');
    expect(brief).toContain('- Title: Add edge label editing');
    expect(brief).toContain('Lets users rename an edge label inline.');
    expect(brief).toContain(`- Commit: ${fixture.headSha}`);
    expect(brief).toContain('`apps/demo/src/edges.ts`: modified, +2 -1');
    expect(brief).toContain('`packages/sdk/src/edges.ts`: added, +1 -0');
    expect(brief).toContain('`packages/sdk/src/index.ts` (Public SDK entry)');
    expect(brief).toContain('- Report at most 4 findings, the most severe first.');
    expect(brief).toContain('- Do not ask the team questions.');
    expect(brief).toMatch(
      /## Documents[^\n]*\n\n- apps\/demo\/README.md\n- packages\/sdk\/CLAUDE.md\n/,
    );
    expect(brief).not.toContain('## Review level');
    expect(brief).not.toContain('## Change risk');
  });

  test('the rendered prompt and the brief contain no env values', async () => {
    const { call } = await review({ output: answer() });

    const brief = await readFile(path.join(call.cwd, 'brief.md'), 'utf8');
    const secrets = Object.entries(process.env)
      .filter(([name, value]) => /KEY|SECRET|TOKEN|PASSWORD|DSN/.test(name) && value)
      .map(([, value]) => value!);
    expect(secrets).toEqual(expect.arrayContaining(Object.values(SECRETS)));
    for (const secret of secrets) {
      expect(call.prompt).not.toContain(secret);
      expect(brief).not.toContain(secret);
    }
  });
});

describe('reviewer prompt', () => {
  test('without a prompt instruction the built-in prompt is rendered', async () => {
    const { call } = await review({ output: answer() });

    const knowledgeDir = path.join(call.cwd, 'knowledge');
    expect(call.prompt).toBe(
      BUILT_IN_REVIEWER_PROMPT.replaceAll('{{knowledgeDir}}', knowledgeDir).replaceAll(
        '{{repoDir}}',
        call.readDirs![0]!,
      ),
    );
  });

  test('the repository’s prompt-reviewer.md is rendered, and instructions are read-only', async () => {
    await importInstructionV1(deps.db, {
      scope: 'repository',
      repositoryId: repository.id,
      fileKey: 'prompt-reviewer.md',
      content:
        'Rules in {{knowledgeDir}}/review-rules.md, code in {{repoDir}}, files in {{runDir}}.',
    });
    await importInstructionV1(deps.db, {
      scope: 'repository',
      repositoryId: repository.id,
      fileKey: 'lessons/edges.md',
      content: 'Edges have ids.',
    });

    const { call } = await review({ output: answer() });

    const knowledgeDir = path.join(call.cwd, 'knowledge');
    expect(call.prompt).toBe(
      `Rules in ${knowledgeDir}/review-rules.md, code in ${call.readDirs![0]}, files in ${call.cwd}.`,
    );
    const lesson = path.join(knowledgeDir, 'lessons/edges.md');
    expect(await readFile(lesson, 'utf8')).toBe('Edges have ids.');
    await expect(access(lesson, constants.W_OK)).rejects.toThrow();
    await expect(writeFile(path.join(knowledgeDir, 'new.md'), 'x')).rejects.toThrow();
  });

  test('a template without {{repoDir}} or {{knowledgeDir}} falls back to the built-in prompt', () => {
    const values = { knowledgeDir: '/k', repoDir: '/r' };
    const builtIn = renderReviewerPrompt(undefined, values);

    expect(renderReviewerPrompt('Review {{knowledgeDir}} only.', values)).toBe(builtIn);
    expect(renderReviewerPrompt('Review {{repoDir}} only.', values)).toBe(builtIn);
    expect(renderReviewerPrompt('   ', values)).toBe(builtIn);
    expect(renderReviewerPrompt('Use {{knowledgeDir}} and {{repoDir}}.', values)).toBe(
      'Use /k and /r.',
    );
  });

  test('a repository file wins over a global one with the same key', () => {
    const key = `rules-${uniqueId()}.md`;
    const version = (scope: 'global' | 'repository', content: string) =>
      ({ scope, fileKey: key, content }) as Parameters<typeof effectiveInstructions>[0][number];

    const files = effectiveInstructions([
      version('repository', 'own'),
      version('global', 'shared'),
    ]);

    expect(files.get(key)).toBe('own');
  });
});

describe('brief sections (P review.test.ts 79, classify.test.ts 214)', () => {
  test('the brief points at documents of touched workspaces only', () => {
    const tracked = [
      'apps/e2e/README.md',
      'apps/backend/auth-port.decision-log.md',
      'apps/demo/CLAUDE.md',
      'README.md',
    ];

    expect(
      documentsFor(['apps/e2e/tests/a.spec.ts', 'apps/backend/src/x.ts', 'package.json'], tracked),
    ).toEqual(['apps/e2e/README.md', 'apps/backend/auth-port.decision-log.md']);
  });

  test('"Change risk" only with a change type, "Review level" only when the level has a brief', () => {
    const level = (n: LevelNumber, brief: string | null) => {
      const frozen = freezeLevel(resolveLevel(n));
      return { ...frozen, settings: { ...frozen.settings, brief } };
    };
    const input = {
      pullRequest: { number: 7, title: 't', body: '', authorLogin: 'a', headSha: 'sha' },
      files: [{ path: 'a.md', status: 'modified' as const, additions: 1, deletions: 0 }],
      sensitive: [],
      documents: [],
      level: level(1, null),
      limits: {
        maxFindings: 3,
        maxQuestions: 0,
        severities: ['blocking', 'worth_fixing'] as const,
      },
    };

    const plain = buildBrief(input);
    expect(plain).not.toMatch(/Change risk|Review level/);
    expect(plain).toContain('The author added no description.');
    expect(plain).toContain('## Changed files');

    const typed = buildBrief({
      ...input,
      changeType: { type: 'uses_existing', reason: 'Only composes existing parts.' },
    });
    expect(typed).toMatch(/## Change risk\n\n\*\*Uses what exists\.\*\* Only composes/);
    expect(typed).toContain('- Report at most 3 findings');
    expect(typed).toContain('- Allowed severities: blocker, should.');
    expect(typed).not.toContain('Review level');

    const leveled = buildBrief({ ...input, level: level(3, 'List your doubts.') });
    expect(leveled).toMatch(/## Review level\n\n\*\*Level 3\.\*\* List your doubts\./);
    expect(leveled).not.toContain('Change risk');
  });
});
