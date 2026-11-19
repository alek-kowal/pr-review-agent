import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { DEFAULT_MODELS, DEFAULT_STAGE_TIMEOUT_MINUTES, type Finding } from '@pra/core';
import { describe, expect, test } from 'vitest';
import { ClaudeAgentRunner, ROLE_TOOLS, type QueryFn } from '../claude-agent-runner.ts';
import type { AgentRunInput } from '../runner.ts';
import { FakeAgentRunner } from '../testing/fake-agent-runner.ts';
import {
  repairReproduction,
  VERIFY_ADDENDA,
  verifyFinding,
  type VerifyFindingInput,
} from './verifier.ts';

const SUGGESTION = 'Wrap the call in a mutex named SECRET_FIX_TOKEN';
const PATCH = 'diff --git a/fix-from-reviewer.ts';

/** A full finding as the reviewer stored it, suggestion included. */
const finding: Finding = {
  id: 'f1',
  severity: 'blocking',
  title: 'Race when two saves overlap',
  file: 'packages/sdk/src/save.ts',
  line: 42,
  scenario: 'Two saves start within 10 ms; the second overwrites the first.',
  suggestion: `${SUGGESTION}\n${PATCH}`,
  remedy: null,
  verdict: 'unchecked',
  evidence: [],
  decision: null,
  resolved: null,
};

const input = (overrides: Partial<VerifyFindingInput> = {}): VerifyFindingInput => ({
  model: DEFAULT_MODELS.verifier,
  worktree: '/runs/r1/worktree',
  // Passed as the whole finding: the adapter must still drop the suggestion.
  finding,
  diff: 'diff --git a/packages/sdk/src/save.ts b/packages/sdk/src/save.ts\n+ save()\n',
  task: 'Make saving reliable.',
  instructions: {
    prompt:
      'Read {{knowledgeDir}}/verify-rules.md, finding.json and diff.patch. Repo: {{repoDir}}.',
    rules: '# Verify rules',
  },
  maxTurns: 30,
  maxCostUsd: 2,
  stageTimeoutMinutes: DEFAULT_STAGE_TIMEOUT_MINUTES,
  ...overrides,
});

const answer = {
  verdict: 'unverified',
  reason: 'No proof either way.',
  evidence: [{ file: 'packages/sdk/src/save.ts', line: 42, quote: 'await save()' }],
  remedy: { kind: 'decision', why: 'Someone must pick the locking strategy.' },
};

/** Reads every file of the session folder while the session runs. */
async function sessionFiles(dir: string): Promise<Record<string, string>> {
  const names = await readdir(dir, { recursive: true, withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of names.filter((e) => e.isFile())) {
    const full = path.join(entry.parentPath, entry.name);
    files[path.relative(dir, full)] = await readFile(full, 'utf8');
  }
  return files;
}

describe('verifyFinding', () => {
  test('neither the prompt nor any session file holds the suggestion', async () => {
    let seen: { input: AgentRunInput<unknown>; files: Record<string, string> } | undefined;
    const runner = new FakeAgentRunner([
      async (run) => {
        seen = { input: run, files: await sessionFiles(run.cwd) };
        return new FakeAgentRunner([{ output: answer }]).run(run);
      },
    ]);

    const result = await verifyFinding(runner, input());
    expect(result.status).toBe('completed');

    const everything = [seen!.input.prompt, ...Object.values(seen!.files)].join('\n');
    expect(everything).not.toContain('SECRET_FIX_TOKEN');
    expect(everything).not.toContain('mutex');
    expect(everything).not.toContain('fix-from-reviewer');
    expect(Object.keys(seen!.files).sort()).toEqual([
      'diff.patch',
      'finding.json',
      'instructions/verify-rules.md',
      'task.md',
    ]);
    expect(JSON.parse(seen!.files['finding.json']!)).toEqual({
      title: finding.title,
      file: finding.file,
      line: 42,
      scenario: finding.scenario,
    });
  });

  test('runs as the verifier in its own session folder, reading the worktree', async () => {
    const runner = new FakeAgentRunner([{ output: answer, costUsd: 0.37, turns: 6 }]);
    const result = await verifyFinding(runner, input());

    const call = runner.calls[0]!;
    expect(call).toMatchObject({
      role: 'verifier',
      model: 'claude-sonnet-5-5',
      readDirs: ['/runs/r1/worktree'],
      maxTurns: 30,
      maxCostUsd: 2,
      timeoutMs: 30 * 60_000,
    });
    expect(call.cwd).not.toBe('/runs/r1/worktree');
    expect(call.prompt).toBe(
      `Read ${call.cwd}/instructions/verify-rules.md, finding.json and diff.patch. Repo: /runs/r1/worktree.`,
    );
    // The session folder is gone afterwards.
    expect(existsSync(call.cwd)).toBe(false);
    // The session is logged with its cost.
    expect(result).toMatchObject({ costUsd: 0.37, turns: 6, costSource: 'reported' });
  });

  test('maps the v1 answer to core vocabulary', async () => {
    const script = 'process.exit(0);\n';
    const runner = new FakeAgentRunner([
      { output: answer },
      {
        output: { ...answer, verdict: 'confirmed', script, remedy: { kind: 'obvious', why: 'x' } },
      },
    ]);
    expect((await verifyFinding(runner, input())).output).toEqual({
      verdict: 'not_proven',
      reason: 'No proof either way.',
      evidence: [{ file: 'packages/sdk/src/save.ts', line: 42, quote: 'await save()' }],
      reproduction: null,
      remedy: { kind: 'needs_decision', why: 'Someone must pick the locking strategy.' },
    });
    expect((await verifyFinding(runner, input())).output).toMatchObject({
      verdict: 'confirmed',
      reproduction: script,
      remedy: { kind: 'obvious' },
    });
  });

  test('malformed output is output_invalid, cost still recorded', async () => {
    const runner = new FakeAgentRunner([
      { output: { ...answer, verdict: 'maybe' }, costUsd: 0.2 },
      { output: { verdict: 'confirmed', reason: 'x' }, costUsd: 0.1 },
    ]);
    for (const costUsd of [0.2, 0.1]) {
      const result = await verifyFinding(runner, input());
      expect(result).toMatchObject({
        status: 'failed',
        output: null,
        error: { code: 'output_invalid' },
        costUsd,
      });
    }
  });

  test('a fork PR adds the quotes-only line; no task means no task.md', async () => {
    let files: Record<string, string> = {};
    const runner = new FakeAgentRunner([
      async (run) => {
        files = await sessionFiles(run.cwd);
        return new FakeAgentRunner([{ output: answer }]).run(run);
      },
    ]);
    await verifyFinding(runner, input({ runScripts: false, task: null }));
    expect(runner.calls[0]!.prompt).toContain(VERIFY_ADDENDA.fork);
    expect(files['task.md']).toBeUndefined();
  });
});

describe('repairReproduction', () => {
  test('hands the broken script and its output to the same kind of session', async () => {
    let files: Record<string, string> = {};
    const runner = new FakeAgentRunner([
      async (run) => {
        files = await sessionFiles(run.cwd);
        return new FakeAgentRunner([{ output: { ...answer, script: 'fixed' } }]).run(run);
      },
    ]);
    const result = await repairReproduction(runner, {
      ...input(),
      script: 'import x from "nope";',
      output: 'ERR_MODULE_NOT_FOUND',
    });
    expect(files['script.mjs']).toBe('import x from "nope";');
    expect(files['output.txt']).toBe('ERR_MODULE_NOT_FOUND');
    expect(runner.calls[0]!.prompt).toContain(VERIFY_ADDENDA.repair);
    expect(result.output?.reproduction).toBe('fixed');
    expect(Object.values(files).join('\n')).not.toContain('SECRET_FIX_TOKEN');
  });
});

describe('the verifier session on the Agent SDK', () => {
  test('the allowed tools are exactly Read, Grep and Glob, nothing pre-approved beyond them', async () => {
    expect(ROLE_TOOLS.verifier).toEqual(['Read', 'Grep', 'Glob']);

    const calls: Options[] = [];
    const query: QueryFn = (params) => {
      calls.push(params.options);
      return (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          duration_ms: 10,
          num_turns: 2,
          total_cost_usd: 0.05,
          usage: { input_tokens: 10, output_tokens: 5 },
          structured_output: answer,
        } as unknown as SDKMessage;
      })();
    };
    const runner = new ClaudeAgentRunner({ apiKey: 'sk-test', query });
    const result = await verifyFinding(runner, input());

    expect(result).toMatchObject({ status: 'completed', costUsd: 0.05 });
    const options = calls[0]!;
    expect(options.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(options.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
    expect(options.mcpServers).toEqual({});
    expect(options.settingSources).toEqual([]);
    expect(options.additionalDirectories).toEqual(['/runs/r1/worktree']);
  });
});
