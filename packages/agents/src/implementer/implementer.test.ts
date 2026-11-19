import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type {
  HookCallback,
  Options,
  PreToolUseHookInput,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { DEFAULT_MODELS } from '@pra/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod/v4';
import { ClaudeAgentRunner, type QueryFn } from '../claude-agent-runner.ts';
import { costOf } from '../prices.ts';
import { FakeAgentRunner } from '../testing/fake-agent-runner.ts';
import {
  runImplementer,
  type ImplementerFinding,
  type RunImplementerInput,
} from './implementer.ts';

let root: string;
let worktree: string;
let outside: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pra-impl-'));
  worktree = path.join(root, 'worktree');
  outside = path.join(root, 'outside');
  await mkdir(path.join(worktree, 'src'), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(worktree, 'src', 'save.ts'), 'export const save = 1;\n');
  await writeFile(path.join(outside, 'app-key.pem'), 'SECRET');
  // A symlink inside the worktree that points out of it.
  await symlink(path.join(outside, 'app-key.pem'), path.join(worktree, 'src', 'key-link.ts'));
  await symlink(outside, path.join(worktree, 'linked-dir'));
  // Dangling symlinks: their targets do not exist yet, so a write would create them outside.
  await symlink(path.join(outside, 'not-yet.ts'), path.join(worktree, 'src', 'dangling.ts'));
  await symlink(path.join(outside, 'no-dir'), path.join(worktree, 'dangling-dir'));
  // A symlink that stays inside the worktree.
  await symlink(path.join(worktree, 'src', 'save.ts'), path.join(worktree, 'src', 'inner-link.ts'));
});
afterAll(() => rm(root, { recursive: true, force: true }));

const finding: ImplementerFinding = {
  id: 'f1',
  severity: 'blocking',
  title: 'Race when two saves overlap',
  file: 'src/save.ts',
  line: 1,
  scenario: 'Two saves overwrite each other.',
  suggestion: 'Serialise saves.',
  verifierReason: 'Confirmed by script.',
  remedy: 'obvious',
  evidence: [{ file: 'src/save.ts', line: 1, quote: 'export const save' }],
  reproduction: 'process.exit(0);',
  note: 'Keep it small.',
};

const input = (overrides: Partial<RunImplementerInput> = {}): RunImplementerInput => ({
  model: DEFAULT_MODELS.implementer,
  worktree,
  findings: [finding],
  answers: [{ question: 'Must saves stay ordered?', answer: 'Yes.' }],
  instructions: {
    prompt: 'Read {{knowledgeDir}}/implement-rules.md. Findings: {{runDir}}/findings.json.',
    rules: '# Implement rules',
  },
  maxTurns: 40,
  maxCostUsd: 3,
  ...overrides,
});

const answer = {
  decisions: [
    { id: 'f1', action: 'fixed', why: 'Saves now queue.' },
    { id: 'f2', action: 'declined', why: 'Needs a product decision (src/a.ts:3).' },
  ],
  commitMessage: 'fix(sdk): serialise overlapping saves',
  summary: 'Saves queue now.',
  notChecked: ['Behaviour under real network latency.'],
};

function success(structured: unknown): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 50,
    num_turns: 4,
    total_cost_usd: 0.8,
    usage: { input_tokens: 1000, output_tokens: 200 },
    structured_output: structured,
  } as unknown as SDKMessage;
}

/** A fake SDK `query` that records the options and yields `messages`, then waits for an abort. */
function fakeQuery(messages: SDKMessage[], options: { waitForAbort?: boolean } = {}) {
  const calls: Options[] = [];
  const query: QueryFn = (params) => {
    calls.push(params.options);
    const signal = params.options.abortController!.signal;
    return (async function* () {
      for (const message of messages) yield message;
      if (options.waitForAbort) {
        if (signal.aborted) throw new Error('AbortError');
        await new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('AbortError'))),
        );
      }
    })();
  };
  return { query, calls };
}

async function sessionOptions(): Promise<Options> {
  const { query, calls } = fakeQuery([success(answer)]);
  await runImplementer(new ClaudeAgentRunner({ apiKey: 'sk-test', query }), input());
  return calls[0]!;
}

const preToolUse = (toolName: string, toolInput: Record<string, unknown>): PreToolUseHookInput =>
  ({
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 't1',
    session_id: 's1',
    transcript_path: '',
    cwd: worktree,
  }) as PreToolUseHookInput;

describe('the implementer session on the Agent SDK', () => {
  test('1. the allowed tools include no Bash or other shell tool, and nothing is pre-approved', async () => {
    const options = await sessionOptions();
    expect(options.tools).toEqual(['Read', 'Glob', 'Grep', 'Edit', 'Write']);
    for (const shell of ['Bash', 'BashOutput', 'KillShell', 'Task', 'WebFetch']) {
      expect(options.tools).not.toContain(shell);
    }
    expect(options.allowedTools).toEqual([]);
    expect(options.permissionMode).toBe('default');
    expect(options.cwd).toBe(worktree);
    expect(options.mcpServers).toEqual({});
    expect(options.settingSources).toEqual([]);
    expect(options.maxTurns).toBe(40);
    expect(options.maxBudgetUsd).toBe(3);
  });

  test('2. an Edit outside the worktree is denied, through ../ and through a symlink', async () => {
    const options = await sessionOptions();
    const canUseTool = options.canUseTool!;
    const hook = options.hooks!.PreToolUse![0]!.hooks[0]! as HookCallback;
    const signal = new AbortController().signal;
    const ask = (tool: string, toolInput: Record<string, unknown>) =>
      canUseTool(tool, toolInput, { signal, toolUseID: 't1' } as never);
    const edit = (file: string) => ({ file_path: file, old_string: 'a', new_string: 'b' });

    expect(await ask('Edit', edit('../outside.ts'))).toMatchObject({ behavior: 'deny' });
    expect(await ask('Edit', edit('src/key-link.ts'))).toMatchObject({ behavior: 'deny' });
    expect(await ask('Write', { file_path: 'linked-dir/new.ts', content: 'x' })).toMatchObject({
      behavior: 'deny',
    });
    expect(await ask('Read', { file_path: path.join(outside, 'app-key.pem') })).toMatchObject({
      behavior: 'deny',
    });
    expect(await ask('Glob', { pattern: '../outside/*' })).toMatchObject({ behavior: 'deny' });
    expect(await ask('Bash', { command: 'cat /etc/passwd' })).toMatchObject({ behavior: 'deny' });
    // Dangling symlinks, as a file and as a folder on the way.
    expect(await ask('Write', { file_path: 'src/dangling.ts', content: 'x' })).toMatchObject({
      behavior: 'deny',
    });
    expect(await ask('Edit', edit('src/dangling.ts'))).toMatchObject({ behavior: 'deny' });
    expect(await ask('Write', { file_path: 'dangling-dir/new.ts', content: 'x' })).toMatchObject({
      behavior: 'deny',
    });
    // A write through a symlink is denied even when it points inside; a read may follow it.
    expect(await ask('Edit', edit('src/inner-link.ts'))).toMatchObject({ behavior: 'deny' });
    expect(await ask('Read', { file_path: 'src/inner-link.ts' })).toMatchObject({
      behavior: 'allow',
    });

    expect(await ask('Edit', edit('src/save.ts'))).toMatchObject({ behavior: 'allow' });
    expect(await ask('Write', { file_path: 'src/new/file.ts', content: 'x' })).toMatchObject({
      behavior: 'allow',
    });
    expect(await ask('Grep', { pattern: 'save' })).toMatchObject({ behavior: 'allow' });

    // The same guard runs as a PreToolUse hook, which wins over any pre-approval.
    expect(await hook(preToolUse('Edit', edit('../outside.ts')), 't1', { signal })).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    });
    expect(await hook(preToolUse('Edit', edit('src/key-link.ts')), 't1', { signal })).toMatchObject(
      { hookSpecificOutput: { permissionDecision: 'deny' } },
    );
    expect(await hook(preToolUse('Edit', edit('src/save.ts')), 't1', { signal })).toEqual({});
  });

  test('3. the session env has no GITHUB_*, CLICKUP_* or DATABASE_URL', async () => {
    const planted = {
      GITHUB_APP_ID: '1',
      GITHUB_APP_PRIVATE_KEY_PATH: '/keys/app.pem',
      CLICKUP_API_KEY: 'pk_x',
      DATABASE_URL: 'postgres://u:p@db/pra',
    };
    Object.assign(process.env, planted);
    try {
      const env = (await sessionOptions()).env!;
      expect(Object.keys(env).sort()).toEqual(['ANTHROPIC_API_KEY', 'HOME', 'PATH']);
      for (const name of Object.keys(env)) {
        expect(name).not.toMatch(/^(GITHUB_|CLICKUP_)|^DATABASE_URL$/);
      }
      expect(env.HOME).not.toBe(process.env.HOME);
    } finally {
      for (const name of Object.keys(planted)) delete process.env[name];
    }
  });

  test('4. a missing key fails with model_access_not_configured', async () => {
    const { query, calls } = fakeQuery([success(answer)]);
    const result = await runImplementer(
      new ClaudeAgentRunner({ apiKey: undefined, query }),
      input(),
    );
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'model_access_not_configured' },
    });
    expect(calls).toHaveLength(0);
  });

  test('5. a cancelled session records its cost up to the cancel', async () => {
    const usage = { input_tokens: 4000, output_tokens: 600 };
    const assistant = {
      type: 'assistant',
      message: { id: 'm1', usage },
      parent_tool_use_id: null,
      uuid: 'u1',
      session_id: 's1',
    } as unknown as SDKMessage;
    const { query } = fakeQuery([assistant], { waitForAbort: true });
    const controller = new AbortController();

    const result = await runImplementer(new ClaudeAgentRunner({ apiKey: 'sk-test', query }), {
      ...input(),
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });

    expect(result).toMatchObject({ status: 'cancelled', costSource: 'computed', turns: 1 });
    expect(result.costUsd).toBeCloseTo(
      costOf('claude-opus-5-5', {
        inputTokens: 4000,
        outputTokens: 600,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
      10,
    );
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.transcript).toHaveLength(1);
  });
});

describe('runImplementer', () => {
  test('gives the findings, answers and rules in a read-only session folder', async () => {
    const files: Record<string, string> = {};
    const runner = new FakeAgentRunner([
      async (run) => {
        const dir = run.readDirs![0]!;
        for (const name of ['findings.json', 'answers.json', 'instructions/implement-rules.md']) {
          files[name] = await readFile(path.join(dir, name), 'utf8');
        }
        return new FakeAgentRunner([{ output: answer, costUsd: 0.6 }]).run(run);
      },
    ]);
    const result = await runImplementer(runner, input());

    const call = runner.calls[0]!;
    const dir = call.readDirs![0]!;
    expect(call).toMatchObject({ role: 'implementer', model: 'claude-opus-5-5', cwd: worktree });
    expect(call.prompt).toContain(`Read ${dir}/instructions/implement-rules.md.`);
    expect(call.prompt).toContain(`Findings: ${dir}/findings.json.`);
    expect(call.prompt).toContain(`${dir}/answers.json`);
    expect(JSON.parse(files['findings.json']!)).toEqual([
      {
        id: 'f1',
        severity: 'blocking',
        title: finding.title,
        file: 'src/save.ts',
        line: 1,
        scenario: finding.scenario,
        suggestion: 'Serialise saves.',
        verifier: 'Confirmed by script.',
        remedy: 'obvious',
        human: 'Keep it small.',
        evidence: finding.evidence,
        reproduction: 'process.exit(0);',
      },
    ]);
    expect(JSON.parse(files['answers.json']!)).toEqual(input().answers);
    expect(files['instructions/implement-rules.md']).toBe('# Implement rules');

    expect(result.output).toEqual({
      fixedFindingIds: ['f1'],
      declined: [{ id: 'f2', reason: 'Needs a product decision (src/a.ts:3).' }],
      summary: 'Saves queue now.',
      commitMessage: 'fix(sdk): serialise overlapping saves',
      notChecked: ['Behaviour under real network latency.'],
    });
    expect(result.costUsd).toBe(0.6);
  });

  test('malformed output is output_invalid', async () => {
    const runner = new FakeAgentRunner([{ output: { decisions: 'all fixed' }, costUsd: 0.4 }]);
    expect(await runImplementer(runner, input())).toMatchObject({
      status: 'failed',
      output: null,
      error: { code: 'output_invalid' },
      costUsd: 0.4,
    });
  });
});

describe('the read-only roles get the same path guard', () => {
  test('a reviewer hook denies reads outside cwd and read dirs, and every write', async () => {
    const { query, calls } = fakeQuery([success({ verdict: 'ok', notes: [] })]);
    await new ClaudeAgentRunner({ apiKey: 'sk-test', query }).run({
      role: 'reviewer',
      model: 'claude-sonnet-5-5',
      cwd: worktree,
      readDirs: [outside],
      prompt: 'Review.',
      outputSchema: z.object({ verdict: z.string(), notes: z.array(z.string()) }),
      maxTurns: 5,
      maxCostUsd: 1,
    });
    const options = calls[0]!;
    expect(options.permissionMode).toBe('dontAsk');
    expect(options.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
    const hook = options.hooks!.PreToolUse![0]!.hooks[0]! as HookCallback;
    const signal = new AbortController().signal;
    const decide = (tool: string, toolInput: Record<string, unknown>) =>
      hook(preToolUse(tool, toolInput), 't1', { signal });

    expect(await decide('Read', { file_path: path.join(outside, 'app-key.pem') })).toEqual({});
    expect(await decide('Read', { file_path: '/etc/hosts' })).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    });
    expect(await decide('Write', { file_path: path.join(outside, 'x.ts') })).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    });
  });
});
