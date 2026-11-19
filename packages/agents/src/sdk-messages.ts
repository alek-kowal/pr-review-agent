import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { query as sdkQuery, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { sessionEnv, type QueryFn } from './claude-agent-runner.ts';
import type { MessagesClient } from './judge/judge.ts';
import { modelAccessOf, type ModelCredentials } from './model-access.ts';
import { UsageLimitError, usageLimitOf } from './usage-limit.ts';

export type MessagesClientOptions = ModelCredentials & {
  /** A test double; used only while some model access is configured. */
  client?: MessagesClient;
  /** The Agent SDK's `query()` in subscription mode, or a test double. */
  query?: QueryFn;
};

/**
 * The client for one structured call: through the Agent SDK on a subscription token, the Messages
 * API on an API key, none without either (the caller fails `model_access_not_configured`).
 */
export function messagesClientFor(options: MessagesClientOptions): MessagesClient | null {
  const access = modelAccessOf(options);
  if (access.mode === 'none') return null;
  if (options.client) return options.client;
  return access.mode === 'subscription'
    ? new AgentSdkMessages(access.env, options.query)
    : new Anthropic({ apiKey: access.secret });
}

/** Room for the structured-output answer and one retry of it; there are no tools to call. */
const MAX_TURNS = 3;

/**
 * The judge's and the analyst's one Messages API call, run as one Agent SDK query instead (P-25).
 * A subscription token (`CLAUDE_CODE_OAUTH_TOKEN`) works only through Claude Code, never through
 * `@anthropic-ai/sdk`. No tools, no settings, no MCP, a throwaway `HOME` as the working directory
 * and only the token in the env. The answer comes back shaped like a Messages API reply: its
 * structured output as the one text block, its usage as the reply's usage.
 */
export class AgentSdkMessages implements MessagesClient {
  readonly messages: MessagesClient['messages'];

  constructor(secretEnv: Record<string, string>, query: QueryFn = sdkQuery) {
    this.messages = { create: (body, options) => create(body, options?.signal, secretEnv, query) };
  }
}

async function create(
  body: Anthropic.MessageCreateParamsNonStreaming,
  signal: AbortSignal | undefined,
  secretEnv: Record<string, string>,
  query: QueryFn,
): Promise<Anthropic.Message> {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  if (signal?.aborted) throw new Error('aborted');
  signal?.addEventListener('abort', cancel, { once: true });
  const format = body.output_config?.format;
  let home: string | undefined;
  let final: SDKResultMessage | undefined;
  const transcript: unknown[] = [];
  try {
    home = await mkdtemp(path.join(tmpdir(), 'pra-call-'));
    const messages = query({
      prompt: promptOf(body),
      options: {
        model: body.model,
        cwd: home,
        tools: [],
        allowedTools: [],
        permissionMode: 'dontAsk',
        settingSources: [],
        mcpServers: {},
        strictMcpConfig: true,
        persistSession: false,
        env: sessionEnv(secretEnv, home),
        maxTurns: MAX_TURNS,
        abortController: abort,
        ...(format?.type === 'json_schema'
          ? { outputFormat: { type: 'json_schema', schema: format.schema } }
          : {}),
      },
    });
    for await (const message of messages) {
      transcript.push(message);
      if (message.type === 'result') final = message;
    }
  } catch (thrown) {
    const limit = signal?.aborted ? null : usageLimitOf(transcript, thrown);
    throw limit ? new UsageLimitError(limit) : thrown;
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (home) await rm(home, { recursive: true, force: true });
  }
  if (signal?.aborted) throw new Error('aborted');
  const limit = usageLimitOf(transcript);
  if (limit) throw new UsageLimitError(limit);
  if (!final) throw new Error('agent_sdk_no_result');
  if (final.subtype !== 'success' || final.is_error) {
    throw new Error(`agent_sdk_${final.subtype === 'success' ? 'error' : final.subtype}`);
  }
  const text =
    final.structured_output === undefined ? final.result : JSON.stringify(final.structured_output);
  return {
    id: final.uuid,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: final.usage,
  } as unknown as Anthropic.Message;
}

/** The request's user text (the judge and the analyst send one user message). */
function promptOf(body: Anthropic.MessageCreateParamsNonStreaming): string {
  return body.messages
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(''),
    )
    .join('\n\n');
}
