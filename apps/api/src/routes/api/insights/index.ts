// S-19: Insights. Read-only: the five pilot metrics over finished PRs (Overview), real spend
// (Cost), verdict and decision rates (Quality) and each repository's level (Trust ladder). Every
// number carries its sample size; nothing compares periods.
import {
  INSTRUCTION_KINDS,
  LEVEL_NUMBERS,
  STAGE_ON_FROM,
  pilotMetrics,
  prMetrics,
  qualityRates,
  type FindingOutcome,
  type Metric,
} from '@pra/core';
import {
  averageRoundCost,
  finishedPrHistories,
  getAppSettings,
  getRepositoryBySlug,
  instructionVersionLabels,
  qualityInputs,
  repositoryLevels,
  SHADOW_DECISIONS,
  shadowByRepository,
  spendRows,
  spentToday,
  type Db,
  type QualityRun,
} from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { ReasonSchema } from '../../../pr-view/round.ts';
import { startOfUtcDay } from '../status/index.ts';

const DAY_MS = 86_400_000;
const timestamp = z.iso.datetime({ offset: true });

/** 14 or 30 days back from now (30 when not given). */
const RangeSchema = z
  .enum(['14', '30'])
  .default('30')
  .transform((value) => Number(value) as 14 | 30);

const SampleSchema = { sampleSize: z.number().int(), tooFew: z.boolean() };
const LanesSchema = z.object({
  agentsWorking: z.number(),
  actionNeeded: z.number(),
  readyToMerge: z.number(),
});

export const OverviewResponse = z.object({
  range: z.union([z.literal(14), z.literal(30)]),
  since: timestamp,
  /** PR authors with a PR finished in the range (the repository filter applied). */
  authors: z.array(z.string()),
  metrics: z.object({
    /** 1. Median agent work per PR, in milliseconds. */
    agentWork: z.object({ valueMs: z.number().nullable(), ...SampleSchema }),
    /** 2. Median ready → merge over merged PRs, and the summed lane split (milliseconds). */
    readyToMerge: z.object({ valueMs: z.number().nullable(), ...SampleSchema, lanes: LanesSchema }),
    /** 3. Median cost per PR; trials and the analyst apart. */
    cost: z.object({
      valueUsd: z.number().nullable(),
      ...SampleSchema,
      tokens: z.number(),
      trialCostUsd: z.number(),
      analystCostUsd: z.number(),
    }),
    /** 4. PRs where a chain used 3 of 3 with a fix open; PRs with more than 3 rounds. */
    roundsUsedUp: z.object({
      count: z.number().int(),
      ...SampleSchema,
      overThreeRounds: z.number(),
    }),
    /** 5. Merged PRs changed by a person after Ready to merge (a lower bound). */
    changedAfterReady: z.object({
      count: z.number().int(),
      ...SampleSchema,
      ignoredBaseMerges: z.number().int(),
    }),
  }),
  prs: z.array(
    z.object({
      repository: z.string(),
      number: z.number().int(),
      title: z.string(),
      author: z.string(),
      outcome: z.enum(['merged', 'closed']),
      finishedAt: timestamp,
      readyToMergeMs: z.number().nullable(),
      lanes: LanesSchema.nullable(),
      agentWorkMs: z.number(),
      costUsd: z.number(),
      rounds: z.number().int(),
      chainUsedUp: z.boolean(),
      changedAfterReady: z.boolean().nullable(),
      ignoredBaseMerges: z.number().int(),
    }),
  ),
});

const Amount = z.number();
export const CostResponse = z.object({
  range: z.union([z.literal(14), z.literal(30)]),
  since: timestamp,
  /** Spend on PR work (rounds and implementer runs) in the range. */
  totalUsd: Amount,
  /** Every UTC day of the range, oldest first, zero when nothing was spent. */
  byDay: z.array(z.object({ day: z.string(), costUsd: Amount })),
  byRepository: z.array(z.object({ repository: z.string(), costUsd: Amount })),
  byRole: z.array(z.object({ role: z.string(), costUsd: Amount })),
  byLevel: z.array(z.object({ level: z.number().int(), costUsd: Amount })),
  /** Trials and the analyst, kept out of every figure above; zero when there are none. */
  separate: z.object({ trial: Amount, analyst: Amount }),
  /** Real spend today (every run kind) and the daily budget, if one is set. */
  today: z.object({ spentUsd: Amount, budgetUsd: z.number().nullable() }),
  averageRoundUsd: z.number().nullable(),
});

/** Quality rates of a group of findings; every rate is null below 5 findings (`tooFew`). */
const RatesSchema = {
  findings: z.number().int(),
  decided: z.number().int(),
  /** Levels 1–2 do not verify: Confirmed and Refuted say "Unchecked". */
  unchecked: z.boolean(),
  tooFew: z.boolean(),
  confirmedRate: z.number().nullable(),
  refutedRate: z.number().nullable(),
  /** The share of decided findings marked Implement. */
  implementShare: z.number().nullable(),
};

export const QualityResponse = z.object({
  range: z.union([z.literal(14), z.literal(30)]),
  since: timestamp,
  /** Levels 1 to 6, each with its rounds in the range. */
  levels: z.array(
    z.object({
      level: z.number().int(),
      rounds: z.number().int(),
      ...RatesSchema,
      averageRoundUsd: z.number().nullable(),
    }),
  ),
  /** Per instruction version runs recorded; `instruction` null groups runs with none recorded. */
  versions: z.array(
    z.object({
      instruction: z
        .object({
          id: z.number().int(),
          scope: z.enum(['global', 'repository', 'level']),
          repository: z.string().nullable(),
          fileKey: z.string(),
          /** Instruction (prompts and rules) or document (reference context). */
          kind: z.enum(INSTRUCTION_KINDS),
          version: z.number().int(),
          active: z.boolean(),
        })
        .nullable(),
      runs: z.number().int(),
      ...RatesSchema,
      averageCostUsd: z.number().nullable(),
    }),
  ),
});

export const TrustResponse = z.object({
  /** One row per repository, by slug. */
  repositories: z.array(
    z.object({
      repositoryId: z.number().int(),
      repository: z.string(),
      level: z.number().int(),
      /** When the current level was set, and whole days since. */
      since: timestamp,
      days: z.number().int(),
      /** Rounds of this repository at its current level, and their findings' rates. */
      rounds: z.number().int(),
      ...RatesSchema,
      /**
       * The level 5 shadow log over the last `days`: the latest entry of each PR written at level
       * 3 or above. Below `needed` PRs there is not enough data for a summary.
       */
      shadow: z.object({
        days: z.number().int(),
        eligible: z.number().int(),
        needed: z.number().int(),
        /** PRs whose latest entry would have started or pushed a fix. */
        wouldFix: z.number().int(),
        /** Newest first. */
        prs: z.array(
          z.object({
            number: z.number().int(),
            decision: z.enum(SHADOW_DECISIONS),
            reason: ReasonSchema.nullable(),
            fixed: z.number().int(),
            total: z.number().int(),
            at: timestamp,
          }),
        ),
      }),
    }),
  ),
});

const SHADOW_DAYS = 14;
const SHADOW_NEEDED = 5;
/** The shadow log needs verified findings, so it starts at level 3. */
const SHADOW_FROM_LEVEL = 3;

const ScopeQuery = z.object({
  range: RangeSchema,
  repo: z.string().min(1).optional(),
});

/** The repository a `repo` filter names; `undefined` for no filter, null when unknown. */
async function repositoryFilter(db: Db, slug: string | undefined) {
  if (!slug) return undefined;
  return (await getRepositoryBySlug(db, slug)) ?? null;
}

const sinceOf = (range: number, now: Date) => new Date(now.getTime() - range * DAY_MS);

const sample = <T>(m: Metric<T>) => ({ sampleSize: m.sampleSize, tooFew: m.tooFew });

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** The findings of these runs as core counts them. */
function outcomesOf(
  runs: readonly QualityRun[],
  findings: Awaited<ReturnType<typeof qualityInputs>>['findings'],
): FindingOutcome[] {
  const verifyRan = new Map(runs.map((run) => [run.id, run.verifyRan]));
  return findings
    .filter((f) => verifyRan.has(f.runId))
    .map((f) => ({ verdict: f.verdict, decision: f.decision, verifyRan: verifyRan.get(f.runId)! }));
}

const insights: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.deps;

  fastify.get(
    '/overview',
    {
      schema: {
        querystring: ScopeQuery.extend({ author: z.string().min(1).optional() }),
        response: { 200: OverviewResponse, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const { range, repo, author } = request.query;
      const repository = await repositoryFilter(db, repo);
      if (repository === null) {
        return sendError(reply, 404, ApiErrorCode.RepositoryNotFound, { repo });
      }
      const since = sinceOf(range, new Date());
      const finished = await finishedPrHistories(db, { since, repositoryId: repository?.id });
      const prs = finished.filter((pr) => !author || pr.authorLogin === author);
      const rows = prs.map((pr) => ({ pr, metrics: prMetrics(pr.history) }));
      const m = pilotMetrics(rows.map((row) => row.metrics));
      return {
        range,
        since: since.toISOString(),
        authors: [...new Set(finished.map((pr) => pr.authorLogin))].sort(),
        metrics: {
          agentWork: { valueMs: m.agentWork.value, ...sample(m.agentWork) },
          readyToMerge: {
            valueMs: m.readyToMerge.value,
            ...sample(m.readyToMerge),
            lanes: m.readyToMerge.lanes,
          },
          cost: {
            valueUsd: m.cost.value,
            ...sample(m.cost),
            tokens: m.cost.tokens,
            trialCostUsd: m.cost.trialCostUsd,
            analystCostUsd: m.cost.analystCostUsd,
          },
          roundsUsedUp: {
            count: m.roundsUsedUp.value,
            ...sample(m.roundsUsedUp),
            overThreeRounds: m.roundsUsedUp.overThreeRounds,
          },
          changedAfterReady: {
            count: m.changedAfterReady.value,
            ...sample(m.changedAfterReady),
            ignoredBaseMerges: m.changedAfterReady.ignoredBaseMerges,
          },
        },
        prs: rows.map(({ pr, metrics }) => ({
          repository: pr.repositorySlug,
          number: pr.number,
          title: pr.title,
          author: pr.authorLogin,
          outcome: pr.outcome,
          finishedAt: pr.finishedAt.toISOString(),
          readyToMergeMs: metrics.readyToMergeMs,
          lanes: metrics.lanes,
          agentWorkMs: metrics.agentWorkMs,
          costUsd: metrics.costUsd,
          rounds: metrics.rounds,
          chainUsedUp: metrics.chainUsedUp,
          changedAfterReady: metrics.changedAfterReady,
          ignoredBaseMerges: metrics.ignoredBaseMerges,
        })),
      };
    },
  );

  fastify.get(
    '/cost',
    {
      schema: {
        querystring: ScopeQuery,
        response: { 200: CostResponse, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const { range, repo } = request.query;
      const repository = await repositoryFilter(db, repo);
      if (repository === null) {
        return sendError(reply, 404, ApiErrorCode.RepositoryNotFound, { repo });
      }
      const now = new Date();
      // Whole UTC days: the range's first day starts at midnight.
      const since = startOfUtcDay(sinceOf(range - 1, now));
      const scope = { since, repositoryId: repository?.id };
      const settings = await getAppSettings(db);
      const [rows, averageRoundUsd, today] = await Promise.all([
        spendRows(db, scope),
        averageRoundCost(db, scope),
        // The status chip's number: since local midnight in the configured time zone.
        spentToday(db, { timeZone: settings.value.timeZone, now }),
      ]);

      const work = rows.filter((row) => row.runKind === 'round' || row.runKind === 'implementer');
      const totals = <K extends string | number>(key: (row: (typeof rows)[number]) => K) => {
        const map = new Map<K, number>();
        for (const row of work) map.set(key(row), (map.get(key(row)) ?? 0) + row.costUsd);
        return map;
      };
      const desc = <K>(map: Map<K, number>) => [...map].sort((a, b) => b[1] - a[1]);
      const perDay = totals((row) => row.day);
      const byDay = Array.from({ length: range }, (_, i) => {
        const day = new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10);
        return { day, costUsd: perDay.get(day) ?? 0 };
      });
      const separate = (kind: string) =>
        rows.filter((row) => row.runKind === kind).reduce((sum, row) => sum + row.costUsd, 0);

      return {
        range,
        since: since.toISOString(),
        totalUsd: work.reduce((sum, row) => sum + row.costUsd, 0),
        byDay,
        byRepository: desc(totals((row) => row.repositorySlug)).map(([repository, costUsd]) => ({
          repository,
          costUsd,
        })),
        byRole: desc(totals((row) => row.role)).map(([role, costUsd]) => ({ role, costUsd })),
        byLevel: [...totals((row) => row.level)]
          .sort((a, b) => a[0] - b[0])
          .map(([level, costUsd]) => ({ level, costUsd })),
        separate: { trial: separate('trial'), analyst: separate('analyst') },
        today: { spentUsd: today.spentUsd, budgetUsd: settings.value.dailyBudgetUsd },
        averageRoundUsd,
      };
    },
  );

  fastify.get(
    '/quality',
    {
      schema: {
        querystring: ScopeQuery,
        response: { 200: QualityResponse, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const { range, repo } = request.query;
      const repository = await repositoryFilter(db, repo);
      if (repository === null) {
        return sendError(reply, 404, ApiErrorCode.RepositoryNotFound, { repo });
      }
      const since = sinceOf(range, new Date());
      const { runs, findings } = await qualityInputs(db, { since, repositoryId: repository?.id });

      const levels = LEVEL_NUMBERS.map((level) => {
        const rounds = runs.filter((run) => run.kind === 'round' && run.level === level);
        const rates = qualityRates(outcomesOf(rounds, findings));
        const unchecked = level < STAGE_ON_FROM.verify;
        return {
          level,
          rounds: rounds.length,
          ...rates,
          unchecked,
          ...(unchecked && { confirmedRate: null, refutedRate: null }),
          averageRoundUsd: mean(rounds.map((run) => run.costUsd)),
        };
      });

      const groups = new Map<number | null, QualityRun[]>();
      for (const run of runs) {
        const ids = run.instructionVersions.length
          ? [...new Set(run.instructionVersions.map((v) => v.id))]
          : [null];
        for (const id of ids) groups.set(id, [...(groups.get(id) ?? []), run]);
      }
      const labels = new Map(
        (
          await instructionVersionLabels(
            db,
            [...groups.keys()].filter((id): id is number => id !== null),
          )
        ).map((label) => [label.id, label]),
      );
      const versions = [...groups]
        .map(([id, groupRuns]) => {
          const label = id === null ? undefined : labels.get(id);
          return {
            instruction: label
              ? {
                  id: label.id,
                  scope: label.scope,
                  repository: label.repositorySlug,
                  fileKey: label.fileKey,
                  kind: label.kind,
                  version: label.version,
                  active: label.status === 'active',
                }
              : null,
            runs: groupRuns.length,
            ...qualityRates(outcomesOf(groupRuns, findings)),
            averageCostUsd: mean(groupRuns.map((run) => run.costUsd)),
          };
        })
        // By file, newest version first; runs with no recorded version last.
        .sort((a, b) =>
          !a.instruction || !b.instruction
            ? Number(!a.instruction) - Number(!b.instruction)
            : a.instruction.fileKey.localeCompare(b.instruction.fileKey) ||
              (a.instruction.repository ?? '').localeCompare(b.instruction.repository ?? '') ||
              b.instruction.version - a.instruction.version,
        );

      return { range, since: since.toISOString(), levels, versions };
    },
  );

  fastify.get(
    '/trust',
    {
      schema: {
        querystring: z.object({ repo: z.string().min(1).optional() }),
        response: { 200: TrustResponse, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const { repo } = request.query;
      const repository = await repositoryFilter(db, repo);
      if (repository === null) {
        return sendError(reply, 404, ApiErrorCode.RepositoryNotFound, { repo });
      }
      const now = Date.now();
      const [repositories, { runs, findings }, shadow] = await Promise.all([
        repositoryLevels(db, repository?.id),
        qualityInputs(db, { since: null, repositoryId: repository?.id }),
        shadowByRepository(db, {
          repositoryId: repository?.id,
          since: new Date(now - SHADOW_DAYS * DAY_MS),
          minLevel: SHADOW_FROM_LEVEL,
        }),
      ]);
      return {
        repositories: repositories.map((row) => {
          const rounds = runs.filter(
            (run) => run.repositoryId === row.id && run.kind === 'round' && run.level === row.level,
          );
          const prs = shadow.filter((entry) => entry.repositoryId === row.id);
          return {
            shadow: {
              days: SHADOW_DAYS,
              eligible: prs.length,
              needed: SHADOW_NEEDED,
              wouldFix: prs.filter((entry) => entry.decision !== 'would_wait').length,
              prs: prs.map((entry) => ({
                number: entry.number,
                decision: entry.decision,
                reason: entry.reasons[0] ?? null,
                fixed: entry.fixed,
                total: entry.total,
                at: entry.at.toISOString(),
              })),
            },
            repositoryId: row.id,
            repository: row.slug,
            level: row.level,
            since: row.since.toISOString(),
            days: Math.max(0, Math.floor((now - row.since.getTime()) / DAY_MS)),
            rounds: rounds.length,
            ...qualityRates(outcomesOf(rounds, findings)),
          };
        }),
      };
    },
  );
};

export default insights;
