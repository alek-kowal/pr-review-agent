// P-26: `pnpm judge:compare` replays stored judge calls on several models and compares them.
// Everything here is pure; `src/cli/judge-compare.ts` reads the database and calls the models.
import type { Judge, JudgeMessageInput } from '@pra/agents';
import { raiseChangeType, validModelNameFor, type ChangeType } from '@pra/core';
import type { JudgeSample } from '@pra/db';
import { parseArgs } from 'node:util';

export const USAGE =
  'Usage: pnpm judge:compare --models <a>,<b> [--limit N] [--yes]\n' +
  '  --models  judge models, e.g. claude-haiku-5-5,openrouter/typesafe/jev-router\n' +
  '  --limit   at most N stored PRs (default 20)\n' +
  '  --yes     make the calls (they cost money); without it only the count is printed\n';

export const DEFAULT_LIMIT = 20;

export type CompareArgs = { models: string[]; limit: number; yes: boolean };

export function parseCompareArgs(
  argv: string[],
): { ok: true; args: CompareArgs } | { ok: false; message: string } {
  let values: { models?: string; limit?: string; yes?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        models: { type: 'string' },
        limit: { type: 'string' },
        yes: { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  const models = [
    ...new Set(
      (values.models ?? '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
    ),
  ];
  if (models.length === 0) return { ok: false, message: '--models needs at least one model' };
  const invalid = models.filter((m) => !validModelNameFor('judge', m));
  if (invalid.length > 0) return { ok: false, message: `not a judge model: ${invalid.join(', ')}` };
  const limit = values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1) {
    return { ok: false, message: '--limit must be a positive whole number' };
  }
  return { ok: true, args: { models, limit, yes: values.yes ?? false } };
}

/** A stored call ready to replay: its PR, reference and the message it sent. */
export type LoadedSample = JudgeSample & { message: JudgeMessageInput };

/** What `--yes` would do. */
export function planText(samples: JudgeSample[], models: string[]): string {
  const forced = samples.filter((s) => s.forced).length;
  const calls = samples.length * models.length;
  return (
    `${samples.length} stored PR${samples.length === 1 ? '' : 's'} with a judge call ` +
    `(${forced} with a forced type) × ${models.length} model${models.length === 1 ? '' : 's'} = ` +
    `${calls} judge call${calls === 1 ? '' : 's'}.\n`
  );
}

export type CompareCall = {
  pullRequestId: number;
  model: string;
  status: 'completed' | 'failed' | 'cancelled';
  /** The judge's own answer. */
  judged: ChangeType | null;
  /** The type the stage would set: the run's rules floor raised by the answer. */
  final: ChangeType | null;
  costUsd: number;
  durationMs: number;
  answeredModel: string | null;
  error: string | null;
};

/** Every model on every sample, one call at a time, no retries and no fallback. */
export async function runComparison(input: {
  samples: LoadedSample[];
  models: string[];
  judgeFor: (model: string) => Judge;
  onCall?: (call: CompareCall, done: number, total: number) => void;
}): Promise<CompareCall[]> {
  const calls: CompareCall[] = [];
  const total = input.samples.length * input.models.length;
  for (const sample of input.samples) {
    for (const model of input.models) {
      const result = await input.judgeFor(model).judge({ ...sample.message, model });
      const judged = result.status === 'completed' ? (result.output?.changeType ?? null) : null;
      const call: CompareCall = {
        pullRequestId: sample.pullRequestId,
        model,
        status: result.status,
        judged,
        final:
          judged && sample.floor ? raiseChangeType(sample.floor, judged, null).changeType : judged,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        answeredModel: result.answeredModel ?? null,
        error: result.error ? String(result.error.params.reason ?? result.error.code) : null,
      };
      calls.push(call);
      input.onCall?.(call, calls.length, total);
    }
  }
  return calls;
}

export type ModelSummary = {
  model: string;
  calls: number;
  completed: number;
  /** Completed calls on PRs with a forced type, and how many of those matched it. */
  scored: number;
  correct: number;
  accuracy: number | null;
  costUsd: number;
  meanLatencyMs: number | null;
  /** The models that answered, with counts (a router picks one per call). */
  answeredBy: Record<string, number>;
  errors: Record<string, number>;
};

export type Agreement = { a: string; b: string; both: number; same: number; rate: number | null };

export function summarize(
  samples: JudgeSample[],
  models: string[],
  calls: CompareCall[],
): { models: ModelSummary[]; agreement: Agreement[] } {
  const forcedOf = new Map(samples.map((s) => [s.pullRequestId, s.forced]));
  const summaries = models.map((model): ModelSummary => {
    const own = calls.filter((c) => c.model === model);
    const completed = own.filter((c) => c.status === 'completed');
    const scored = completed.filter((c) => forcedOf.get(c.pullRequestId));
    const correct = scored.filter((c) => c.final === forcedOf.get(c.pullRequestId)).length;
    return {
      model,
      calls: own.length,
      completed: completed.length,
      scored: scored.length,
      correct,
      accuracy: scored.length ? correct / scored.length : null,
      costUsd: own.reduce((sum, c) => sum + c.costUsd, 0),
      meanLatencyMs: own.length ? own.reduce((sum, c) => sum + c.durationMs, 0) / own.length : null,
      answeredBy: countBy(completed.map((c) => c.answeredModel ?? model)),
      errors: countBy(own.flatMap((c) => (c.error ? [c.error] : []))),
    };
  });

  const agreement: Agreement[] = [];
  for (const [i, a] of models.entries()) {
    for (const b of models.slice(i + 1)) {
      let both = 0;
      let same = 0;
      for (const sample of samples) {
        const x = calls.find((c) => c.model === a && c.pullRequestId === sample.pullRequestId);
        const y = calls.find((c) => c.model === b && c.pullRequestId === sample.pullRequestId);
        if (!x?.judged || !y?.judged) continue;
        both += 1;
        if (x.judged === y.judged) same += 1;
      }
      agreement.push({ a, b, both, same, rate: both ? same / both : null });
    }
  }
  return { models: summaries, agreement };
}

export function formatReport(summary: ReturnType<typeof summarize>): string {
  const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);
  const lines = ['', 'Per model'];
  for (const m of summary.models) {
    lines.push(
      `  ${m.model}`,
      `    answered    ${m.completed} of ${m.calls}` +
        (Object.keys(m.errors).length ? ` (failed: ${entries(m.errors)})` : ''),
      `    accuracy    ${pct(m.accuracy)} (${m.correct} of ${m.scored} PRs with a forced type)`,
      `    cost        $${m.costUsd.toFixed(4)} total, $${(m.calls ? m.costUsd / m.calls : 0).toFixed(5)} per call`,
      `    latency     ${m.meanLatencyMs === null ? '—' : `${Math.round(m.meanLatencyMs)} ms`} mean`,
      `    answered by ${entries(m.answeredBy) || '—'}`,
    );
  }
  if (summary.agreement.length > 0) {
    lines.push('', 'Agreement (same judge answer, PRs both answered)');
    for (const g of summary.agreement) {
      lines.push(`  ${g.a} vs ${g.b}: ${pct(g.rate)} (${g.same} of ${g.both})`);
    }
  }
  lines.push(
    '',
    'Accuracy compares the type the stage would set (rules floor raised by the answer) with the',
    'type a person forced. Cost: OpenRouter reports real spend; a Claude subscription shows the',
    'API-equivalent price.',
    '',
  );
  return lines.join('\n');
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

const entries = (counts: Record<string, number>) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => `${key} ×${n}`)
    .join(', ');
