import type { Evidence, Remedy, Severity } from '@pra/core';
import { z } from 'zod/v4';
import { renderPrompt, withSessionDir } from '../prompt.ts';
import type { AgentProgress, AgentRunner, AgentRunResult } from '../runner.ts';

/** A finding decided as Implement, with what the verifier found. */
export type ImplementerFinding = {
  id: string;
  severity: Severity;
  title: string;
  file: string;
  line: number | null;
  scenario: string;
  /** The reviewer's proposed fix: the implementer may use it (unlike the verifier). */
  suggestion: string;
  verifierReason: string | null;
  remedy: Remedy | null;
  evidence: Evidence[];
  /** The verifier's `.mjs` reproduction, if any. */
  reproduction: string | null;
  /** The person's note on the decision. */
  note: string | null;
};

/** An earlier question on the PR and the person's answer. */
export type ImplementerAnswer = { question: string; answer: string };

export type RunImplementerInput = {
  /** From the frozen level (core `modelFor`), default `claude-opus-5-5`. */
  model: string;
  /** The run's own throwaway worktree: the only folder the session may write. */
  worktree: string;
  findings: ImplementerFinding[];
  answers: ImplementerAnswer[];
  /** Version 1 of `prompt-implementer.md` and `implement-rules.md`, as stored. */
  instructions: { prompt: string; rules: string };
  /** A revise run: what a person asked to change in the earlier patch the worktree holds. */
  reviseNote?: string | null;
  maxTurns: number;
  maxCostUsd: number;
  /** From the frozen level (`settings.stageTimeoutMinutes`); the session is stopped past it. */
  stageTimeoutMinutes: number;
  signal?: AbortSignal;
  onProgress?: (progress: AgentProgress) => void;
};

export type ImplementerOutput = {
  /** The ids it claims to have fixed; the Implement stage checks the patch, not this claim. */
  fixedFindingIds: string[];
  declined: { id: string; reason: string }[];
  summary: string;
  /** One Conventional Commits line for the patch commit. */
  commitMessage: string;
  /** What could not be checked without running code. */
  notChecked: string[];
};

/** The answer in the v1 instruction vocabulary; the schema the session must follow. */
export const ImplementerAnswerSchema = z.object({
  decisions: z.array(
    z.object({
      id: z.string().min(1),
      action: z.enum(['fixed', 'declined']),
      why: z.string().min(1),
    }),
  ),
  commitMessage: z.string().min(1),
  summary: z.string().min(1),
  notChecked: z.array(z.string()).max(5),
});
type ImplementerAnswerOutput = z.output<typeof ImplementerAnswerSchema>;

const RULES_DIR = 'instructions';

/**
 * One implementer session in the run's worktree. Its inputs (findings, answers, rules) sit in a
 * separate read-only session folder; the runner's path guard keeps every write in the worktree.
 */
export function runImplementer(
  runner: AgentRunner,
  input: RunImplementerInput,
): Promise<AgentRunResult<ImplementerOutput>> {
  const files = {
    [`${RULES_DIR}/implement-rules.md`]: input.instructions.rules,
    'findings.json': `${JSON.stringify(input.findings.map(findingForSession), null, 2)}\n`,
    'answers.json': `${JSON.stringify(input.answers, null, 2)}\n`,
    ...(input.reviseNote ? { 'revise-note.md': `${input.reviseNote}\n` } : {}),
  };
  return withSessionDir(files, async (dir) => {
    const prompt = renderPrompt(input.instructions.prompt, {
      knowledgeDir: `${dir}/${RULES_DIR}`,
      runDir: dir,
    });
    const answersLine = input.answers.length
      ? ` The PR's earlier questions and answers are in ${dir}/answers.json.`
      : '';
    const reviseLine = input.reviseNote
      ? ` The worktree already holds your earlier patch; a person asked for this change to it: ${dir}/revise-note.md.`
      : '';
    const result = await runner.run({
      role: 'implementer',
      model: input.model,
      cwd: input.worktree,
      readDirs: [dir],
      prompt: `${prompt}${answersLine}${reviseLine}`,
      outputSchema: ImplementerAnswerSchema,
      maxTurns: input.maxTurns,
      maxCostUsd: input.maxCostUsd,
      timeoutMs: input.stageTimeoutMinutes * 60_000,
      signal: input.signal,
      onProgress: input.onProgress,
    });
    return { ...result, output: result.output ? toOutput(result.output) : null };
  });
}

/** The fields the implementer reads, named as v1's `findings.json` named them. */
function findingForSession(finding: ImplementerFinding) {
  const { id, severity, title, file, line, scenario, suggestion, evidence, reproduction } = finding;
  return {
    id,
    severity,
    title,
    file,
    line,
    scenario,
    suggestion,
    verifier: finding.verifierReason,
    remedy: finding.remedy,
    human: finding.note,
    evidence,
    reproduction,
  };
}

function toOutput(answer: ImplementerAnswerOutput): ImplementerOutput {
  return {
    fixedFindingIds: answer.decisions.filter((d) => d.action === 'fixed').map((d) => d.id),
    declined: answer.decisions
      .filter((d) => d.action === 'declined')
      .map((d) => ({ id: d.id, reason: d.why })),
    summary: answer.summary,
    commitMessage: answer.commitMessage,
    notChecked: answer.notChecked,
  };
}
