import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { prKeys } from '@/features/pr/queries.ts';
import type { PrView } from '@/lib/api-types.ts';

/** One `event: change` message of `GET /api/live`: a row of `table` was inserted or updated. */
export type LiveChange = {
  table: string;
  id: number | null;
  prId: number | null;
  runId: number | null;
};

type FamilyContext = {
  /** The id of the PR shown under `['pr', repo, number]`, when its view is loaded. */
  prIdOf: (repo: unknown, number: unknown) => number | undefined;
};

type QueryFamily = (key: QueryKey, change: LiveChange, context: FamilyContext) => boolean;

const isPrKey = (key: QueryKey) => key[0] === 'pr' && key.length >= 3;

/** A PR query belongs to the change's PR; unknown when its view is not loaded, so it matches. */
const samePr = (key: QueryKey, change: LiveChange, { prIdOf }: FamilyContext) => {
  if (change.prId === null) return true;
  const id = prIdOf(key[1], key[2]);
  return id === undefined || id === change.prId;
};

/** Query families by their key's first element. */
export const QUERY_FAMILIES = {
  board: (key) => key[0] === 'board',
  activity: (key) => key[0] === 'activity',
  status: (key) => key[0] === 'status',
  run: (key, change) => key[0] === 'run' && (change.runId === null || key[1] === change.runId),
  /** Trials and their Compare pages: a trial's status and buckets follow its two runs. */
  trials: (key) => key[0] === 'trials',
  /** Settings → Learning: candidates an analysis created or merged. */
  learning: (key) => key[0] === 'learning',
  prView: (key, change, context) =>
    isPrKey(key) && key.length === 3 && samePr(key, change, context),
  prFindings: (key, change, context) =>
    isPrKey(key) && key[3] === 'findings' && samePr(key, change, context),
  prTimeline: (key, change, context) =>
    isPrKey(key) && key[3] === 'timeline' && samePr(key, change, context),
  /** Every query of the change's PR. */
  pr: (key, change, context) => isPrKey(key) && samePr(key, change, context),
} satisfies Record<string, QueryFamily>;

export type QueryFamilyKey = keyof typeof QUERY_FAMILIES;

/**
 * Which queries a change of each watched table invalidates (extension point: a package whose
 * table gets the `pra_notify_change` trigger adds one line). A table without an entry
 * invalidates every query of its PR and the board.
 */
export const LIVE_TARGETS: Record<string, readonly QueryFamilyKey[]> = {
  pull_requests: ['board', 'prView', 'activity'],
  runs: ['run', 'prView', 'board', 'activity', 'trials'],
  stage_executions: ['run', 'prView', 'activity'],
  agent_sessions: ['run', 'prView', 'activity', 'status'],
  findings: ['prFindings', 'prView', 'board'],
  decision_batches: ['prFindings', 'prView', 'board'],
  finding_decisions: ['prFindings'],
  timeline_entries: ['prTimeline'],
  pr_state_changes: ['prView', 'prTimeline', 'board'],
  answers: ['prFindings', 'prView', 'board'],
  opinions: ['prFindings', 'prView'],
  reviews: ['prView'],
  // S-10: pause, budget and slots, and why a run waits.
  app_settings: ['status', 'board', 'prView', 'activity'],
  run_waits: ['prView', 'board', 'activity', 'status'],
  // S-23: the PR page's learning line and Settings → Learning.
  analyses: ['prView', 'learning'],
  lesson_candidates: ['learning'],
  // S-18: alerts (the Activity lists sit under `activity`), the card bell, the banner line, the chip.
  alerts: ['activity', 'board', 'prView', 'status'],
};

const DEFAULT_TARGETS: readonly QueryFamilyKey[] = ['pr', 'board'];

export const targetsOf = (table: string): readonly QueryFamilyKey[] =>
  LIVE_TARGETS[table] ?? DEFAULT_TARGETS;

/** Whether a query with `key` shows data that `change` may have changed. */
export function isAffected(key: QueryKey, change: LiveChange, context: FamilyContext): boolean {
  return targetsOf(change.table).some((family) => QUERY_FAMILIES[family](key, change, context));
}

/** Invalidates, in one call, every query any of `changes` affects; mounted ones refetch. */
export function invalidateForChanges(queryClient: QueryClient, changes: readonly LiveChange[]) {
  if (changes.length === 0) return Promise.resolve();
  const context: FamilyContext = {
    prIdOf: (repo, number) =>
      typeof repo === 'string' && typeof number === 'string'
        ? queryClient.getQueryData<PrView>(prKeys.view(repo, number))?.pullRequest.id
        : undefined,
  };
  return queryClient.invalidateQueries({
    predicate: (query) => changes.some((change) => isAffected(query.queryKey, change, context)),
  });
}

/** Parses an `event: change` data line; null when it is not a change. */
export function parseChange(data: unknown): LiveChange | null {
  if (typeof data !== 'string') return null;
  try {
    const value = JSON.parse(data) as Partial<Record<keyof LiveChange, unknown>>;
    if (typeof value.table !== 'string') return null;
    const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
    return {
      table: value.table,
      id: int(value.id),
      prId: int(value.prId),
      runId: int(value.runId),
    };
  } catch {
    return null;
  }
}
