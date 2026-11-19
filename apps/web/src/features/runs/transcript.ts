// Turns a stored session log (Agent SDK messages) into rows the Transcript tab lists.

export type TranscriptRow = {
  kind: 'text' | 'tool' | 'result' | 'error';
  /** The tool name, for tool calls. */
  tool: string | null;
  text: string;
};

const MAX_TEXT = 600;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A tool call's main target, the first of these input fields (as the api's summary does). */
const TARGET_FIELDS = ['file_path', 'path', 'pattern', 'command', 'url', 'query'];

function toolTarget(input: unknown): string {
  if (!isRecord(input)) return '';
  for (const field of TARGET_FIELDS) {
    if (typeof input[field] === 'string') return input[field];
  }
  return JSON.stringify(input);
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('\n');
  }
  return '';
}

const cut = (text: string) => (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text);

/** The rows of a transcript: what the agent said, each tool call, and each tool result. */
export function transcriptRows(messages: unknown): TranscriptRow[] {
  if (!Array.isArray(messages)) return [];
  const rows: TranscriptRow[] = [];
  for (const message of messages) {
    if (!isRecord(message) || !isRecord(message.message)) continue;
    const content = message.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        rows.push({ kind: 'text', tool: null, text: cut(block.text) });
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        rows.push({ kind: 'tool', tool: block.name, text: cut(toolTarget(block.input)) });
      } else if (block.type === 'tool_result') {
        rows.push({
          kind: block.is_error === true ? 'error' : 'result',
          tool: null,
          text: cut(resultText(block.content)),
        });
      }
    }
  }
  return rows;
}
