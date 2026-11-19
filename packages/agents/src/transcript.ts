// S-03-T6: what Run detail shows of a session: the files it read and the actions it took, from
// the stored transcript (every SDK message, in order). Pure and SDK-free, so the api can import
// it (`@pra/agents/transcript`) without loading the agent SDK.

export type TranscriptAction = {
  /** The tool's name, for example `Grep`, `Bash` or `Edit`. */
  tool: string;
  /** What it acted on: a path, a pattern, a command or a URL; null when the input has none. */
  target: string | null;
};

export type TranscriptSummary = {
  /** Paths the `Read` tool opened, first read first, each once. */
  filesRead: string[];
  /** Every other tool call, in order. */
  actions: TranscriptAction[];
};

const TARGET_FIELDS = ['file_path', 'notebook_path', 'path', 'pattern', 'command', 'url', 'query'];

type ToolUse = { name: string; input: Record<string, unknown> };

function toolUses(message: unknown): ToolUse[] {
  if (!message || typeof message !== 'object') return [];
  const { type, message: inner } = message as { type?: unknown; message?: unknown };
  if (type !== 'assistant' || !inner || typeof inner !== 'object') return [];
  const content = (inner as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block): ToolUse[] => {
    if (!block || typeof block !== 'object') return [];
    const { type: kind, name, input } = block as Record<string, unknown>;
    if (kind !== 'tool_use' || typeof name !== 'string') return [];
    return [{ name, input: input && typeof input === 'object' ? (input as ToolUse['input']) : {} }];
  });
}

function targetOf(input: Record<string, unknown>): string | null {
  for (const field of TARGET_FIELDS) {
    const value = input[field];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

/** Files read and actions taken in a session transcript; anything unrecognised is skipped. */
export function summarizeTranscript(transcript: readonly unknown[]): TranscriptSummary {
  const filesRead: string[] = [];
  const actions: TranscriptAction[] = [];
  for (const use of transcript.flatMap(toolUses)) {
    const target = targetOf(use.input);
    if (use.name === 'Read' && target) {
      if (!filesRead.includes(target)) filesRead.push(target);
      continue;
    }
    actions.push({ tool: use.name, target });
  }
  return { filesRead, actions };
}
