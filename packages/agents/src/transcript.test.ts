import { describe, expect, it } from 'vitest';
import { summarizeTranscript } from './transcript.ts';

const assistant = (...content: unknown[]) => ({ type: 'assistant', message: { content } });
const tool = (name: string, input: Record<string, unknown>) => ({ type: 'tool_use', name, input });

describe('summarizeTranscript', () => {
  it('lists files read once each and every other tool call in order', () => {
    const summary = summarizeTranscript([
      { type: 'system', subtype: 'init' },
      assistant({ type: 'text', text: 'Looking.' }, tool('Read', { file_path: 'src/a.ts' })),
      { type: 'user', message: { content: [{ type: 'tool_result', content: '...' }] } },
      assistant(
        tool('Grep', { pattern: 'onRename', path: 'src' }),
        tool('Read', { file_path: 'src/b.ts' }),
        tool('Read', { file_path: 'src/a.ts' }),
      ),
      assistant(tool('Bash', { command: 'pnpm test' }), tool('TodoWrite', { todos: [] })),
      { type: 'result', subtype: 'success' },
    ]);
    expect(summary).toEqual({
      filesRead: ['src/a.ts', 'src/b.ts'],
      actions: [
        { tool: 'Grep', target: 'src' },
        { tool: 'Bash', target: 'pnpm test' },
        { tool: 'TodoWrite', target: null },
      ],
    });
  });

  it('skips what it does not recognise', () => {
    expect(summarizeTranscript([null, 3, 'x', { type: 'assistant' }, assistant('text')])).toEqual({
      filesRead: [],
      actions: [],
    });
  });
});
