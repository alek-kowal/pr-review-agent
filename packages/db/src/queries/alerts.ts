// S-18-T2: alert storage and config. Every alert is one row; a key that was ever stored never fires
// again (core `reconcileAlerts` reads every key it is about to fire, plus the active ones).
import {
  AlertConfigSchema,
  type ClickUpSettings,
  DEFAULT_ALERT_CONFIG,
  type AlertConfig,
  type AlertEndNote,
  type AlertKind,
  type AlertNextStep,
  type AlertTitle,
  type KnownAlert,
} from '@pra/core';
import { and, count, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import {
  alertConfig,
  alerts,
  type AlertDeliveryStatus,
  type AlertEnder,
} from '../schema/alerts.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { runs } from '../schema/runs.ts';
import { readRepositoryConfig } from './repositories.ts';
import type { Run } from './runs.ts';

export type AlertRow = typeof alerts.$inferSelect;

/** An alert with its PR's repository and number, for lists and links. */
export type AlertView = AlertRow & {
  pr: { id: number; number: number; title: string; repo: string } | null;
};

const CONFIG_ROW = 1;

/** Inserts the defaults row when there is none (the migration does this too). */
export async function ensureAlertConfig(db: Executor): Promise<void> {
  await db.insert(alertConfig).values({ id: CONFIG_ROW }).onConflictDoNothing();
}

function toConfig(row: typeof alertConfig.$inferSelect | undefined): AlertConfig {
  if (!row) return DEFAULT_ALERT_CONFIG;
  const parsed = AlertConfigSchema.safeParse({
    failedOn: row.failedOn,
    roundsOn: row.roundsOn,
    costOn: row.costOn,
    costMaxUsd: row.costMaxUsd,
    budgetOn: row.budgetOn,
    budgetPercent: row.budgetPercent,
    generalTaskId: row.generalTaskId,
  });
  return parsed.success ? parsed.data : DEFAULT_ALERT_CONFIG;
}

/** The alert config; a missing row reads as the defaults ($5, 80%, all on, no general task). */
export async function getAlertConfig(db: Executor): Promise<AlertConfig> {
  const [row] = await db.select().from(alertConfig).where(eq(alertConfig.id, CONFIG_ROW));
  return toConfig(row);
}

/** The alert config, locked until the transaction ends (the row is created first if missing). */
export async function lockAlertConfig(db: Executor): Promise<AlertConfig> {
  await ensureAlertConfig(db);
  const [row] = await db
    .select()
    .from(alertConfig)
    .where(eq(alertConfig.id, CONFIG_ROW))
    .for('update');
  return toConfig(row);
}

/** Replaces the alert config (parsed: every field must be valid). */
export async function writeAlertConfig(db: Executor, config: AlertConfig): Promise<AlertConfig> {
  const value = AlertConfigSchema.parse(config);
  await ensureAlertConfig(db);
  await db
    .update(alertConfig)
    .set({ ...value, updatedAt: sql`now()` })
    .where(eq(alertConfig.id, CONFIG_ROW));
  return value;
}

export type NewAlert = {
  kind: AlertKind;
  key: string;
  pullRequestId: number | null;
  runId?: number | null;
  title: AlertTitle;
  nextStep: AlertNextStep;
  clickupTaskId: string | null;
  toGeneralTask: boolean;
  /** `not_configured` when there is no ClickUp key or no target task. */
  deliveryStatus?: AlertDeliveryStatus;
};

/** Stores a new alert; a key that exists already does nothing. Returns the new row or null. */
export async function insertAlert(db: Executor, alert: NewAlert): Promise<AlertRow | null> {
  const [row] = await db
    .insert(alerts)
    .values({ ...alert, deliveryStatus: alert.deliveryStatus ?? 'pending' })
    .onConflictDoNothing({ target: alerts.key })
    .returning();
  return row ?? null;
}

export async function getAlert(db: Executor, id: number): Promise<AlertRow | null> {
  const [row] = await db.select().from(alerts).where(eq(alerts.id, id));
  return row ?? null;
}

/** What core `reconcileAlerts` needs: the active alerts and any alert with one of `keys`. */
export async function knownAlerts(db: Executor, keys: readonly string[]): Promise<KnownAlert[]> {
  const rows = await db
    .select({
      key: alerts.key,
      kind: alerts.kind,
      pullRequestId: alerts.pullRequestId,
      status: alerts.status,
    })
    .from(alerts)
    .where(
      keys.length
        ? or(eq(alerts.status, 'active'), inArray(alerts.key, [...keys]))
        : eq(alerts.status, 'active'),
    );
  return rows.map((r) => ({
    key: r.key,
    kind: r.kind,
    prId: r.pullRequestId == null ? null : String(r.pullRequestId),
    status: r.status,
  }));
}

/** Ends active alerts as the bot (their problem is gone). Returns the rows that changed. */
export async function resolveAlerts(
  db: Executor,
  ends: readonly { key: string; note: AlertEndNote }[],
): Promise<AlertRow[]> {
  const out: AlertRow[] = [];
  for (const end of ends) {
    const [row] = await db
      .update(alerts)
      .set({ status: 'resolved', endedAt: sql`now()`, endedBy: 'bot', endNote: end.note })
      .where(and(eq(alerts.key, end.key), eq(alerts.status, 'active')))
      .returning();
    if (row) out.push(row);
  }
  return out;
}

/** A person hides an active alert (unsigned, "by hand"). Null when it is not active. */
export async function dismissAlert(
  db: Executor,
  id: number,
  by: AlertEnder = 'hand',
): Promise<AlertRow | null> {
  const [row] = await db
    .update(alerts)
    .set({ status: 'dismissed', endedAt: sql`now()`, endedBy: by, endNote: null })
    .where(and(eq(alerts.id, id), eq(alerts.status, 'active')))
    .returning();
  return row ?? null;
}

/** Records how the ClickUp comment went. */
export async function setAlertDelivery(
  db: Executor,
  id: number,
  delivery: {
    status: AlertDeliveryStatus;
    commentId?: string | null;
    clickupTaskId?: string | null;
    toGeneralTask?: boolean;
  },
): Promise<void> {
  await db
    .update(alerts)
    .set({
      deliveryStatus: delivery.status,
      ...(delivery.commentId !== undefined ? { commentId: delivery.commentId } : {}),
      ...(delivery.clickupTaskId !== undefined ? { clickupTaskId: delivery.clickupTaskId } : {}),
      ...(delivery.toGeneralTask !== undefined ? { toGeneralTask: delivery.toGeneralTask } : {}),
      ...(delivery.status === 'sent' ? { postedAt: sql`now()` } : {}),
    })
    .where(eq(alerts.id, id));
}

const viewColumns = {
  alert: alerts,
  prId: pullRequests.id,
  prNumber: pullRequests.number,
  prTitle: pullRequests.title,
  repo: repositories.slug,
};

type ViewRow = {
  alert: AlertRow;
  prId: number | null;
  prNumber: number | null;
  prTitle: string | null;
  repo: string | null;
};

const toView = (r: ViewRow): AlertView => ({
  ...r.alert,
  pr:
    r.prId != null && r.prNumber != null && r.repo != null
      ? { id: r.prId, number: r.prNumber, title: r.prTitle ?? '', repo: r.repo }
      : null,
});

function viewQuery(db: Executor) {
  return db
    .select(viewColumns)
    .from(alerts)
    .leftJoin(pullRequests, eq(pullRequests.id, alerts.pullRequestId))
    .leftJoin(repositories, eq(repositories.id, pullRequests.repositoryId));
}

/** Active alerts, newest first. */
export async function listActiveAlerts(db: Executor): Promise<AlertView[]> {
  const rows = await viewQuery(db)
    .where(eq(alerts.status, 'active'))
    .orderBy(desc(alerts.createdAt), desc(alerts.id));
  return rows.map(toView);
}

/** Resolved and dismissed alerts, the most recently ended first. */
export async function listPastAlerts(db: Executor, limit = 100): Promise<AlertView[]> {
  const rows = await viewQuery(db)
    .where(ne(alerts.status, 'active'))
    .orderBy(desc(alerts.endedAt), desc(alerts.id))
    .limit(limit);
  return rows.map(toView);
}

export async function countPastAlerts(db: Executor): Promise<number> {
  const [row] = await db.select({ n: count() }).from(alerts).where(ne(alerts.status, 'active'));
  return row?.n ?? 0;
}

/** The PR's active alerts, newest first. */
export async function activeAlertsForPr(db: Executor, pullRequestId: number): Promise<AlertView[]> {
  const rows = await viewQuery(db)
    .where(and(eq(alerts.pullRequestId, pullRequestId), eq(alerts.status, 'active')))
    .orderBy(desc(alerts.createdAt), desc(alerts.id));
  return rows.map(toView);
}

/** Active alert count per PR (PRs without one are left out). */
export async function activeAlertCountsByPr(
  db: Executor,
  pullRequestIds?: readonly number[],
): Promise<Map<number, number>> {
  if (pullRequestIds && pullRequestIds.length === 0) return new Map();
  const rows = await db
    .select({ prId: alerts.pullRequestId, n: count() })
    .from(alerts)
    .where(
      and(
        eq(alerts.status, 'active'),
        isNotNull(alerts.pullRequestId),
        pullRequestIds ? inArray(alerts.pullRequestId, [...pullRequestIds]) : undefined,
      ),
    )
    .groupBy(alerts.pullRequestId);
  return new Map(rows.map((r) => [r.prId!, r.n]));
}

export async function countActiveAlerts(db: Executor): Promise<number> {
  const [row] = await db.select({ n: count() }).from(alerts).where(eq(alerts.status, 'active'));
  return row?.n ?? 0;
}

// ---- What the evaluation reads ----

/** Every open PR, the ones the alert rules check. */
export async function openPullRequestIds(db: Executor): Promise<number[]> {
  const rows = await db
    .select({ id: pullRequests.id })
    .from(pullRequests)
    .where(eq(pullRequests.state, 'open'))
    .orderBy(pullRequests.id);
  return rows.map((r) => r.id);
}

/** The newest run of kind `round` of each PR: the failure it ended in, and its chain. */
export async function latestRoundRuns(
  db: Executor,
  pullRequestIds: readonly number[],
): Promise<Map<number, Pick<Run, 'id' | 'chainId' | 'status'>>> {
  if (pullRequestIds.length === 0) return new Map();
  const rows = await db
    .select({
      prId: runs.pullRequestId,
      id: runs.id,
      chainId: runs.chainId,
      status: runs.status,
    })
    .from(runs)
    .where(and(inArray(runs.pullRequestId, [...pullRequestIds]), eq(runs.kind, 'round')))
    .orderBy(desc(runs.createdAt), desc(runs.id));
  const latest = new Map<number, Pick<Run, 'id' | 'chainId' | 'status'>>();
  for (const { prId, ...run } of rows) if (!latest.has(prId)) latest.set(prId, run);
  return latest;
}

/** Run kinds that are real PR work; trials and the analyst do not count towards a PR's cost. */
const REAL_SPEND_KINDS = ['round', 'implementer'] as const;

/** Each PR's real spend in USD: every round, fix and retry; PRs without spend are left out. */
export async function realSpendByPr(
  db: Executor,
  pullRequestIds: readonly number[],
): Promise<Map<number, number>> {
  if (pullRequestIds.length === 0) return new Map();
  const rows = await db
    .select({
      prId: runs.pullRequestId,
      usd: sql<string>`coalesce(sum(${runs.costUsd}), 0)`,
    })
    .from(runs)
    .where(
      and(
        inArray(runs.pullRequestId, [...pullRequestIds]),
        inArray(runs.kind, [...REAL_SPEND_KINDS]),
      ),
    )
    .groupBy(runs.pullRequestId);
  return new Map(rows.map((r) => [r.prId, Number(r.usd)]));
}

/**
 * The ClickUp settings a comment on the general alerts task uses when the alert has no PR (the
 * daily budget): the first connected repository with ClickUp set up. Null when none is.
 */
export async function anyClickUpSettings(db: Executor): Promise<ClickUpSettings | null> {
  const rows = await db.select().from(repositories).orderBy(repositories.id);
  for (const repository of rows) {
    const clickup = readRepositoryConfig(repository).value.clickup;
    if (clickup) return clickup;
  }
  return null;
}
