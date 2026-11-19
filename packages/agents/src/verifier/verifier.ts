import type { Evidence, Remedy, VerifierInput } from '@pra/core';
import { z } from 'zod/v4';
import { renderPrompt, withSessionDir } from '../prompt.ts';
import type { AgentProgress, AgentRunner, AgentRunResult } from '../runner.ts';

/** Version 1 of `prompt-verifier.md` and `verify-rules.md`, as stored. */
export type VerifierInstructions = { prompt: string; rules: string };

export type VerifyFindingInput = {
  /** From the frozen level (core `modelFor`), default `claude-sonnet-5-5`. */
  model: string;
  /** The run's worktree at the PR head; the session only reads it. */
  worktree: string;
  /** The claim only (core `verifierInput`). Built field by field, so a suggestion never leaks. */
  finding: VerifierInput;
  diff: string;
  /** The ClickUp task text, or null when the PR has none. */
  task: string | null;
  instructions: VerifierInstructions;
  /** False for a fork PR: no reproduction will be run, so the verifier relies on quotes. */
  runScripts?: boolean;
  maxTurns: number;
  maxCostUsd: number;
  /** From the frozen level (`settings.stageTimeoutMinutes`); the session is stopped past it. */
  stageTimeoutMinutes: number;
  signal?: AbortSignal;
  onProgress?: (progress: AgentProgress) => void;
};

export type RepairReproductionInput = VerifyFindingInput & {
  /** The reproduction that broke (exit code other than 0 or 3) and what it printed. */
  script: string;
  output: string;
};

export type VerifierOutput = {
  verdict: 'confirmed' | 'refuted' | 'not_proven';
  reason: string;
  /** Quotes the Verify stage checks word for word against the worktree. */
  evidence: Evidence[];
  /** `.mjs` source that exits 0 when the bug shows and 3 when it does not; run by the stage. */
  reproduction: string | null;
  /** Whether the fix needs a person; meaningful only for a confirmed finding. */
  remedy: { kind: Remedy; why: string } | null;
};

/** The answer in the v1 instruction vocabulary; the schema the session must follow. */
export const VerifierAnswerSchema = z.object({
  verdict: z.enum(['confirmed', 'refuted', 'unverified']),
  reason: z.string().min(1).describe('Two or three sentences: why this verdict.'),
  evidence: z.array(
    z.object({
      file: z.string().min(1).describe('Path relative to the repository folder.'),
      line: z.number().int().nullable(),
      quote: z.string().min(1).describe('A verbatim excerpt of that file, a few lines at most.'),
    }),
  ),
  script: z
    .string()
    .optional()
    .describe('Optional: the whole .mjs script that reproduces the bug (see verify-rules.md).'),
  remedy: z.object({
    kind: z.enum(['obvious', 'decision']),
    why: z.string().describe('One sentence: the one fix, or the decision someone must make.'),
  }),
});
type VerifierAnswer = z.output<typeof VerifierAnswerSchema>;

/** What the adapter adds to the v1 prompt when it applies. */
export const VERIFY_ADDENDA = {
  fork: 'This PR comes from a fork: no script will be run, rely on quotes.',
  repair:
    'Your previous script did not run: fix it. It is in script.mjs and its output in output.txt.',
} as const;

const RULES_DIR = 'instructions';

/** One verifier session for one finding. */
export function verifyFinding(
  runner: AgentRunner,
  input: VerifyFindingInput,
): Promise<AgentRunResult<VerifierOutput>> {
  return session(runner, input, {});
}

/** The one repair attempt for a reproduction that broke: the same session plus the script. */
export function repairReproduction(
  runner: AgentRunner,
  input: RepairReproductionInput,
): Promise<AgentRunResult<VerifierOutput>> {
  return session(runner, input, { 'script.mjs': input.script, 'output.txt': input.output });
}

async function session(
  runner: AgentRunner,
  input: VerifyFindingInput,
  repairFiles: Record<string, string>,
): Promise<AgentRunResult<VerifierOutput>> {
  const repairing = 'script.mjs' in repairFiles;
  const files: Record<string, string> = {
    [`${RULES_DIR}/verify-rules.md`]: input.instructions.rules,
    'finding.json': findingJson(input.finding),
    'diff.patch': input.diff,
    ...(input.task ? { 'task.md': input.task } : {}),
    ...repairFiles,
  };

  return withSessionDir(files, async (dir) => {
    const prompt = [
      renderPrompt(input.instructions.prompt, {
        knowledgeDir: `${dir}/${RULES_DIR}`,
        repoDir: input.worktree,
      }),
      input.runScripts === false ? VERIFY_ADDENDA.fork : '',
      repairing ? VERIFY_ADDENDA.repair : '',
    ]
      .filter(Boolean)
      .join(' ');

    const result = await runner.run({
      role: 'verifier',
      model: input.model,
      cwd: dir,
      readDirs: [input.worktree],
      prompt,
      outputSchema: VerifierAnswerSchema,
      maxTurns: input.maxTurns,
      maxCostUsd: input.maxCostUsd,
      timeoutMs: input.stageTimeoutMinutes * 60_000,
      signal: input.signal,
      onProgress: input.onProgress,
    });
    return { ...result, output: result.output ? toOutput(result.output) : null };
  });
}

/** The claim and nothing else: never the suggestion or a patch, whatever `finding` carries. */
function findingJson(finding: VerifierInput): string {
  const { title, file, line, scenario } = finding;
  return `${JSON.stringify({ title, file, line, scenario }, null, 2)}\n`;
}

function toOutput(answer: VerifierAnswer): VerifierOutput {
  return {
    verdict: answer.verdict === 'unverified' ? 'not_proven' : answer.verdict,
    reason: answer.reason,
    evidence: answer.evidence.map(({ file, line, quote }) => ({ file, line, quote })),
    reproduction: answer.script?.trim() ? answer.script : null,
    remedy: {
      kind: answer.remedy.kind === 'obvious' ? 'obvious' : 'needs_decision',
      why: answer.remedy.why,
    },
  };
}
