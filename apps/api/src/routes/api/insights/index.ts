// S-19: Insights. Read-only: the five pilot metrics over finished PRs (Overview) and real spend
// (Cost). Every number carries its sample size; nothing compares periods.
import { pilotMetrics, prMetrics, type Metric } from '@pra/core';
import {
  averageRoundCost,
  finishedPrHistories,
  getAppSettings,
  getRepositoryBySlug,
  spendRows,
  spendSince,
  type Db,
} from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
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
      const [rows, averageRoundUsd, spentToday, settings] = await Promise.all([
        spendRows(db, scope),
        averageRoundCost(db, scope),
        spendSince(db, startOfUtcDay(now)),
        getAppSettings(db),
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
        today: { spentUsd: spentToday, budgetUsd: settings.value.dailyBudgetUsd },
        averageRoundUsd,
      };
    },
  );
};

export default insights;
