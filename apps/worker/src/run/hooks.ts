// Run lifecycle hooks (P-05 extension point): P-05's after-round comment, and later the
// timeline (P-10), chains (P-11), questions (P-14), alerts (P-20) and push (P-22). Hooks run after
// the run's transaction commits; one that throws is logged and the others still run.
import type { PullRequest, Repository, Run } from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import { enqueueAfterRoundComment } from '../handlers/github-comment.ts';
import type { SessionRecord } from '../stages/stage.ts';
import { chainsOnRunCompleted } from './chains.ts';
import {
  timelineOnRunCancelled,
  timelineOnRunCompleted,
  timelineOnRunFailed,
} from './timeline-hooks.ts';

export type RunHookContext = {
  deps: WorkerDeps;
  /** The run row after the change. */
  run: Run;
  pullRequest: PullRequest;
  repository: Repository;
};

export type RunHook = (context: RunHookContext) => Promise<void>;

export type SessionCostContext = RunHookContext & {
  stage: string;
  session: SessionRecord;
  /** The stored `agent_sessions` row id. */
  sessionId: number;
};

export type SessionCostHook = (context: SessionCostContext) => Promise<void>;

export type RunHooks = {
  runCompleted: RunHook[];
  runFailed: RunHook[];
  runCancelled: RunHook[];
  sessionCostRecorded: SessionCostHook[];
};

/** Register a hook by adding it to its list. */
export const RUN_HOOKS: RunHooks = {
  runCompleted: [chainsOnRunCompleted, timelineOnRunCompleted, enqueueAfterRoundComment],
  runFailed: [timelineOnRunFailed],
  runCancelled: [timelineOnRunCancelled],
  sessionCostRecorded: [],
};

/** Runs every hook of a list; a failure is logged, not thrown. */
export async function fireHooks<C extends RunHookContext>(
  hooks: readonly ((context: C) => Promise<void>)[],
  context: C,
  name: string,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook(context);
    } catch (error) {
      context.deps.logger.error(
        { err: error, runId: context.run.id, hook: name },
        'run hook failed',
      );
    }
  }
}
