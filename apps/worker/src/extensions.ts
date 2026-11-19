// The worker's extension points (work-packages.md "Extension points", P-05). Each registry lives
// in its own file; a later package adds a file and one line there, not here.
import { GITHUB_EVENT_HANDLERS, type GitHubEventHandlers } from './github-events/index.ts';
import { PR_EVENT_HOOKS, type PrEventHooks } from './github-events/pr-hooks.ts';
import { RUN_GATES, type RunGates } from './run/gates.ts';
import { RUN_HOOKS, type RunHooks } from './run/hooks.ts';
import { STAGE_EXECUTORS, type StageExecutors } from './stages/index.ts';
import {
  REVIEWER_CONTEXT_PROVIDERS,
  type ReviewerContextProvider,
} from './stages/review/context.ts';

export type Extensions = {
  /** Handlers by `X-GitHub-Event` type. */
  githubEvents: GitHubEventHandlers;
  /** Hooks after a `pull_request` event: ready, head changed, closed, merged. */
  prEventHooks: PrEventHooks;
  /** Brief sections for the reviewer (task, answers, ...). */
  reviewerContext: readonly ReviewerContextProvider[];
  /** Executors by stage key. */
  stageExecutors: StageExecutors;
  /** Run lifecycle hooks: completed, failed, cancelled, session cost recorded. */
  runHooks: RunHooks;
  /** `beforeRoundStart` and `beforeSession` gates. */
  runGates: RunGates;
};

export const DEFAULT_EXTENSIONS: Extensions = {
  githubEvents: GITHUB_EVENT_HANDLERS,
  prEventHooks: PR_EVENT_HOOKS,
  reviewerContext: REVIEWER_CONTEXT_PROVIDERS,
  stageExecutors: STAGE_EXECUTORS,
  runHooks: RUN_HOOKS,
  runGates: RUN_GATES,
};
