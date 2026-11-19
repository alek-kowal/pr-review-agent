import Anthropic, { APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import type { ChangeType } from '@pra/core';
import { z } from 'zod/v4';
import {
  agentError as error,
  agentResult,
  detailOf,
  issuesOf,
  jsonSchemaOf,
  toUsage,
} from '../agent-result.ts';
import { credentialsFrom } from '../model-access.ts';
import { costOf } from '../prices.ts';
import { messagesClientFor, type MessagesClientOptions } from '../sdk-messages.ts';
import { renderPrompt } from '../prompt.ts';
import type { AgentRunResult } from '../runner.ts';
import { UsageLimitError } from '../usage-limit.ts';

/**
 * Reads the task a PR implements and says how risky the change is. One Messages API call with
 * structured output, no tools: the judge never reads code. Its answer may only raise the floor the
 * paths gave (core `raiseChangeType`); this adapter just reports it.
 */
export interface Judge {
  judge(input: JudgeInput): Promise<AgentRunResult<JudgeOutput>>;
}

export type JudgeInput = {
  /** From the frozen level (core `modelFor`), default `claude-haiku-5-5`. */
  model: string;
  /** Version 1 of `prompt-classifier.md` and `classify-rules.md`, as stored. */
  instructions: { prompt: string; rules: string };
  /** The ClickUp task text (name and description); empty when the PR has no task. */
  task: string;
  changedFiles: string[];
  signal?: AbortSignal;
};

export type JudgeOutput = { changeType: ChangeType; reason: string };

/** The tiers as the v1 instruction files name them, mapped to core's change types. */
export const TIERS = {
  composes: 'uses_existing',
  extends: 'changes_behaviour',
  'one-way': 'one_way_door',
} as const satisfies Record<string, ChangeType>;

/** The answer's shape in the v1 vocabulary; the schema the model must follow. */
export const JudgeAnswerSchema = z.object({
  tier: z
    .enum(['composes', 'extends', 'one-way'])
    .describe(
      'composes: a small fix from existing parts. extends: changes existing behaviour. ' +
        'one-way: hard to undo (data, money, public contract, a new primitive).',
    ),
  reason: z.string().min(1).describe('One or two sentences: what in the task decides it.'),
});

/** The part of the Anthropic client the judge uses; tests pass a double. */
export type MessagesClient = {
  messages: {
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<Anthropic.Message>;
  };
};

/**
 * `oauthToken` (a Claude subscription: the call runs through the Agent SDK) or `apiKey` (the
 * Messages API); without either every call fails with `model_access_not_configured`.
 */
export type AnthropicJudgeOptions = MessagesClientOptions & { now?: () => number };

const MAX_TOKENS = 1024;
/** Where the v1 prompt expects its files; here they travel inline under these names. */
const KNOWLEDGE_DIR = 'instructions';

/** `Judge` on the Anthropic Messages API (`@anthropic-ai/sdk`). */
export class AnthropicJudge implements Judge {
  readonly #client: MessagesClient | null;
  readonly #now: () => number;

  constructor(options: AnthropicJudgeOptions) {
    this.#client = messagesClientFor(options);
    this.#now = options.now ?? Date.now;
  }

  async judge(input: JudgeInput): Promise<AgentRunResult<JudgeOutput>> {
    const startedAt = this.#now();
    if (!this.#client)
      return result({ status: 'failed', error: error('model_access_not_configured') });
    if (input.signal?.aborted) return result({ status: 'cancelled', error: error('cancelled') });

    const request = judgeRequest(input);
    const transcript: unknown[] = [{ type: 'request', request }];
    let response: Anthropic.Message;
    try {
      response = await this.#client.messages.create(request, { signal: input.signal });
    } catch (thrown) {
      const durationMs = this.#now() - startedAt;
      transcript.push({ type: 'error', detail: detailOf(thrown) });
      if (thrown instanceof APIUserAbortError || input.signal?.aborted) {
        return result({ status: 'cancelled', error: error('cancelled'), durationMs, transcript });
      }
      if (thrown instanceof UsageLimitError) {
        const params = { resetsAt: thrown.resetsAt };
        const failed = error('usage_limit_reached', params);
        return result({ status: 'failed', error: failed, durationMs, transcript });
      }
      const status = thrown instanceof APIError ? thrown.status : undefined;
      return result({
        status: 'failed',
        error: error('agent_failed', { detail: detailOf(thrown), ...(status ? { status } : {}) }),
        durationMs,
        transcript,
      });
    }

    transcript.push(response);
    const usage = toUsage(response.usage);
    const spent = {
      usage,
      costUsd: costOf(input.model, usage),
      costSource: 'computed' as const,
      turns: 1,
      durationMs: this.#now() - startedAt,
      transcript,
    };
    const answer = parseAnswer(response);
    if (!answer.success) {
      return result({
        ...spent,
        status: 'failed',
        error: error('output_invalid', { stopReason: response.stop_reason, issues: answer.issues }),
      });
    }
    return result({
      ...spent,
      status: 'completed',
      output: { changeType: TIERS[answer.data.tier], reason: answer.data.reason },
    });
  }
}

/** `AnthropicJudge` with `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` from `env`. */
export function createAnthropicJudge(env: NodeJS.ProcessEnv = process.env): AnthropicJudge {
  return new AnthropicJudge(credentialsFrom(env));
}

/**
 * The request: the v1 prompt names its files (`classify-rules.md`, `task.md`, `files.txt`); they
 * follow it inline under those names, so the copied instruction files work unchanged. Task text
 * and paths are data inside their own blocks.
 */
export function judgeRequest(input: JudgeInput): Anthropic.MessageCreateParamsNonStreaming {
  const prompt = renderPrompt(input.instructions.prompt, { knowledgeDir: KNOWLEDGE_DIR });
  const files = [
    file(`${KNOWLEDGE_DIR}/classify-rules.md`, input.instructions.rules),
    file('task.md', input.task),
    file('files.txt', input.changedFiles.join('\n')),
  ];
  return {
    model: input.model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: [prompt, ...files].join('\n\n') }],
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: jsonSchemaOf(JudgeAnswerSchema) },
    },
  };
}

function file(name: string, content: string): string {
  return `<file name="${name}">\n${content.replaceAll('</file>', '<\\/file>')}\n</file>`;
}

type Parsed =
  | { success: true; data: z.output<typeof JudgeAnswerSchema> }
  | { success: false; issues: { path: PropertyKey[]; code: string }[] };

function parseAnswer(response: Anthropic.Message): Parsed {
  const text = response.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { success: false, issues: [{ path: [], code: 'invalid_json' }] };
  }
  const parsed = JudgeAnswerSchema.safeParse(json);
  return parsed.success
    ? { success: true, data: parsed.data }
    : {
        success: false,
        issues: issuesOf(parsed.error),
      };
}

const result = agentResult<JudgeOutput>;
