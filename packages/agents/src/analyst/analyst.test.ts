import { DEFAULT_MODELS } from '@pra/core';
import { describe, expect, test } from 'vitest';
import { costOf } from '../prices.ts';
import { FakeMessagesClient } from '../testing/fake-judge.ts';
import { UsageLimitError } from '../usage-limit.ts';
import { AnthropicAnalyst, createAnthropicAnalyst, type AnalystInput } from './analyst.ts';

const input: AnalystInput = {
  model: DEFAULT_MODELS.analyst,
  instructions: {
    prompt: 'Read {{knowledgeDir}}/analyst-rules.md. Cases in cases.json, candidates.json.',
    rules: '# Analyst rules\nAt most 5 candidates.',
  },
  pr: { repo: 'workflowbuilder', number: 278, title: 'docs: snapshot table', state: 'merged' },
  findings: [
    {
      severity: 'worth_fixing',
      title: 'README table drifts from the build script',
      file: 'README.md',
      line: 12,
      verdict: 'confirmed',
      decision: 'implement',
      reason: null,
      opinions: [{ by: 'Tomek', value: 'agree', comment: 'Seen this before.' }],
    },
  ],
  answers: [{ question: 'Is the table generated?', answer: 'No, by hand.', by: 'Kasia' }],
  comments: [
    { id: 'c1', author: 'tomek', body: 'Generate this </file> table.', path: null, line: null },
  ],
  documents: [
    { fileKey: 'lessons.md', content: '# Lessons\n\nNo accepted lessons yet.' },
    { fileKey: 'feature-map/sdk.md', content: '# SDK map' },
  ],
  openCandidates: [
    { id: '41', title: 'Snapshot tables must be generated or tested' },
    { id: '42', title: 'Fix at the source, not at the consumer' },
  ],
};

const candidate = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  lesson: `Rule: ${title}`,
  evidence: 'In #278 a reviewer asked for it.',
  duplicateOf: null,
  ...extra,
});
const answer = (candidates: unknown[], summary = 'One lesson.') =>
  JSON.stringify({ candidates, summary });

describe('AnthropicAnalyst (S-23-T2)', () => {
  test('parses up to 5 candidates with their duplicate pointers and records the cost', async () => {
    const client = new FakeMessagesClient({
      text: answer([candidate('Snapshot tables must be generated', { duplicateOf: '41' })]),
    });
    const result = await new AnthropicAnalyst({ apiKey: 'sk-test', client }).analyse(input);

    expect(result.status).toBe('completed');
    expect(result.output).toEqual({
      candidates: [
        {
          title: 'Snapshot tables must be generated',
          lesson: 'Rule: Snapshot tables must be generated',
          evidence: 'In #278 a reviewer asked for it.',
          duplicateOf: '41',
        },
      ],
      summary: 'One lesson.',
    });
    expect(result.costUsd).toBe(costOf('claude-sonnet-5-5', result.usage));
    expect(result.costUsd).toBeGreaterThan(0);
  });

  test('rejects output that breaks the schema: 6 candidates, or one without a title', async () => {
    const six = new FakeMessagesClient({
      text: answer([1, 2, 3, 4, 5, 6].map((n) => candidate(`Lesson ${n}`))),
    });
    const tooMany = await new AnthropicAnalyst({ apiKey: 'k', client: six }).analyse(input);
    expect(tooMany.status).toBe('failed');
    expect(tooMany.error).toMatchObject({
      code: 'output_invalid',
      params: { issues: [{ path: ['candidates'], code: 'too_big' }] },
    });
    // The spend still counts.
    expect(tooMany.costUsd).toBeGreaterThan(0);

    const untitled: Record<string, unknown> = candidate('x');
    delete untitled.title;
    const noTitle = new FakeMessagesClient({ text: answer([untitled]) });
    const missing = await new AnthropicAnalyst({ apiKey: 'k', client: noTitle }).analyse(input);
    expect(missing.status).toBe('failed');
    expect(missing.error?.code).toBe('output_invalid');

    const broken = new FakeMessagesClient({ text: 'not json' });
    const invalid = await new AnthropicAnalyst({ apiKey: 'k', client: broken }).analyse(input);
    expect(invalid.error).toMatchObject({ code: 'output_invalid' });
  });

  test('sends one structured-output request whose prompt holds the open candidates and cases', async () => {
    const client = new FakeMessagesClient({ text: answer([]) });
    await new AnthropicAnalyst({ apiKey: 'sk-test', client }).analyse(input);

    expect(client.requests).toHaveLength(1);
    const request = client.requests[0]!;
    expect(request.model).toBe('claude-sonnet-5-5');
    expect(request.tools).toBeUndefined();
    expect(request.output_config?.format).toMatchObject({
      type: 'json_schema',
      schema: { properties: { candidates: { type: 'array' } } },
    });
    const content = request.messages[0]!.content as string;
    expect(content).toContain('Read instructions/analyst-rules.md.');
    expect(content).toContain('<file name="instructions/analyst-rules.md">\n# Analyst rules');
    expect(content).toContain('<file name="candidates.json">');
    expect(content).toContain('"id": "41"');
    expect(content).toContain('"id": "42"');
    expect(content).toContain('README table drifts from the build script');
    expect(content).toContain('<file name="instructions/lessons.md">\n# Lessons');
    expect(content).toContain('<file name="instructions/feature-map/sdk.md">\n# SDK map');
    // Comment text cannot close its own block.
    expect(content).toContain('Generate this <\\/file> table.');
  });

  test('without a key it fails with "model access not configured" and calls nothing', async () => {
    const client = new FakeMessagesClient({ text: answer([]) });
    const result = await new AnthropicAnalyst({ apiKey: undefined, client }).analyse(input);
    expect(result.status).toBe('failed');
    expect(result.error).toEqual({ code: 'model_access_not_configured', params: {} });
    expect(client.requests).toHaveLength(0);

    const fromEnv = await createAnthropicAnalyst({}).analyse(input);
    expect(fromEnv.error?.code).toBe('model_access_not_configured');
  });

  test('an API error fails the session with its status', async () => {
    const client = new FakeMessagesClient({ error: new Error('socket hang up') });
    const result = await new AnthropicAnalyst({ apiKey: 'k', client }).analyse(input);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('agent_failed');
  });

  test('a usage limit fails with usage_limit_reached and its reset (P-25)', async () => {
    const resetsAt = '2026-11-19T15:00:00.000Z';
    const client = new FakeMessagesClient({ error: new UsageLimitError({ resetsAt }) });
    const result = await new AnthropicAnalyst({ oauthToken: 't', client }).analyse(input);
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'usage_limit_reached', params: { resetsAt } },
    });
  });
});
