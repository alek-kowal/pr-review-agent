import Anthropic, { APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import type { Decision, PrComment, Severity, Verdict } from '@pra/core';
import { z } from 'zod/v4';
import {
  agentError as error,
  agentResult,
  detailOf,
  issuesOf,
  jsonSchemaOf,
  toUsage,
} from '../agent-result.ts';
import type { MessagesClient } from '../judge/judge.ts';
import { costOf } from '../prices.ts';
import { renderPrompt } from '../prompt.ts';
import type { AgentRunResult } from '../runner.ts';

/**
 * Reads what happened on a closed PR and proposes at most 5 lesson candidates for the reviewer.
 * One Messages API call with structured output, no tools: the analyst never reads code and never
 * changes anything; a person accepts every lesson (S-23-T2).
 */
export interface Analyst {
  analyse(input: AnalystInput): Promise<AgentRunResult<AnalystOutput>>;
}

/** A finding of the closed PR with its verdict, decision and the team's opinions. */
export type AnalystFinding = {
  severity: Severity;
  title: string;
  file: string;
  line: number | null;
  verdict: Verdict;
  /** The current decision; null when nobody decided it. */
  decision: Decision | null;
  reason: string | null;
  opinions: { by: string; value: string; comment: string | null }[];
};

export type AnalystAnswer = { question: string; answer: string; by: string };

export type AnalystInput = {
  /** The run's analyst model (Settings → Models or the level override, frozen on the run). */
  model: string;
  /** `prompt-analyst.md` and `analyst-rules.md` as the run froze them. */
  instructions: { prompt: string; rules: string };
  pr: { repo: string; number: number; title: string; state: 'merged' | 'closed' };
  findings: AnalystFinding[];
  answers: AnalystAnswer[];
  /** GitHub review comments with the PR author's own already removed (core `buildCases`). */
  comments: PrComment[];
  /** The repository's active `lessons.md`; empty when it has none. */
  lessons: string;
  /** Open candidates of the repository; a proposal that repeats one names its id. */
  openCandidates: { id: string; title: string }[];
  signal?: AbortSignal;
};

export const MAX_ANALYST_CANDIDATES = 5;

/** What the API is asked to follow: no length limits, which structured output may refuse. */
const CandidateWire = z.object({
  title: z.string().describe('The lesson in one line.'),
  lesson: z.string().describe('The rule for the reviewer, as it would read in lessons.md.'),
  evidence: z.string().describe('What in this PR shows it: finding, decision or comment.'),
  duplicateOf: z
    .string()
    .nullable()
    .describe('The id from candidates.json this repeats (the rules may call it sameAs), or null.'),
});
const AnalystAnswerWire = z.object({
  candidates: z.array(CandidateWire).describe('At most 5; empty when the PR teaches nothing.'),
  summary: z.string().describe('One or two sentences on what the PR teaches, or that it does not.'),
});

/** The answer as the adapter accepts it: at most 5 candidates, each with a title. */
export const AnalystAnswerSchema = z.object({
  candidates: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        lesson: z.string().trim().min(1),
        evidence: z.string().trim().default(''),
        duplicateOf: z.string().nullish(),
      }),
    )
    .max(MAX_ANALYST_CANDIDATES),
  summary: z.string().default(''),
});

export type AnalystCandidate = {
  title: string;
  lesson: string;
  evidence: string;
  duplicateOf: string | null;
};
export type AnalystOutput = { candidates: AnalystCandidate[]; summary: string };

export type AnthropicAnalystOptions = {
  /** `ANTHROPIC_API_KEY`; without it every call fails with `model_access_not_configured`. */
  apiKey: string | undefined;
  client?: MessagesClient;
  now?: () => number;
};

const MAX_TOKENS = 4096;
/** Where the v1 prompt expects its files; here they travel inline under these names. */
const KNOWLEDGE_DIR = 'instructions';

/** `Analyst` on the Anthropic Messages API (`@anthropic-ai/sdk`). */
export class AnthropicAnalyst implements Analyst {
  readonly #client: MessagesClient | null;
  readonly #now: () => number;

  constructor(options: AnthropicAnalystOptions) {
    const apiKey = options.apiKey || undefined;
    this.#client = apiKey ? (options.client ?? new Anthropic({ apiKey })) : null;
    this.#now = options.now ?? Date.now;
  }

  async analyse(input: AnalystInput): Promise<AgentRunResult<AnalystOutput>> {
    const startedAt = this.#now();
    if (!this.#client)
      return result({ status: 'failed', error: error('model_access_not_configured') });
    if (input.signal?.aborted) return result({ status: 'cancelled', error: error('cancelled') });

    const request = analystRequest(input);
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
      output: {
        candidates: answer.data.candidates.map((c) => ({
          title: c.title,
          lesson: c.lesson,
          evidence: c.evidence,
          duplicateOf: c.duplicateOf ?? null,
        })),
        summary: answer.data.summary,
      },
    });
  }
}

/** `AnthropicAnalyst` with the key from `ANTHROPIC_API_KEY`. */
export function createAnthropicAnalyst(env: NodeJS.ProcessEnv = process.env): AnthropicAnalyst {
  return new AnthropicAnalyst({ apiKey: env.ANTHROPIC_API_KEY });
}

/** What happened on the PR, as `cases.json` holds it for the v1 prompt. */
export function analystCases(input: AnalystInput) {
  return {
    pr: input.pr,
    findings: input.findings,
    questions: input.answers,
    humanComments: input.comments.map((c) => ({
      author: c.author,
      body: c.body,
      path: c.path,
      line: c.line,
    })),
  };
}

/**
 * The request: the v1 prompt names its files (`analyst-rules.md`, `cases.json`, `candidates.json`,
 * `lessons.md`); they follow it inline under those names. PR text and comments are data inside
 * their own blocks.
 */
export function analystRequest(input: AnalystInput): Anthropic.MessageCreateParamsNonStreaming {
  const prompt = renderPrompt(input.instructions.prompt, { knowledgeDir: KNOWLEDGE_DIR });
  const files = [
    file(`${KNOWLEDGE_DIR}/analyst-rules.md`, input.instructions.rules),
    file('cases.json', JSON.stringify(analystCases(input), null, 2)),
    file('candidates.json', JSON.stringify(input.openCandidates, null, 2)),
    file(`${KNOWLEDGE_DIR}/lessons.md`, input.lessons),
  ];
  return {
    model: input.model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: [prompt, ...files].join('\n\n') }],
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: jsonSchemaOf(AnalystAnswerWire) },
    },
  };
}

function file(name: string, content: string): string {
  return `<file name="${name}">\n${content.replaceAll('</file>', '<\\/file>')}\n</file>`;
}

type Parsed =
  | { success: true; data: z.output<typeof AnalystAnswerSchema> }
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
  const parsed = AnalystAnswerSchema.safeParse(json);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, issues: issuesOf(parsed.error) };
}

const result = agentResult<AnalystOutput>;
