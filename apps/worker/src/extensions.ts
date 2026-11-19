// The worker's extension points (work-packages.md "Extension points", P-05). Each registry lives
// in its own file; a later package adds a file and one line there, not here.
import { GITHUB_EVENT_HANDLERS, type GitHubEventHandlers } from './github-events/index.ts';
import { PR_EVENT_HOOKS, type PrEventHooks } from './github-events/pr-hooks.ts';

export type Extensions = {
  /** Handlers by `X-GitHub-Event` type. */
  githubEvents: GitHubEventHandlers;
  /** Hooks after a `pull_request` event: ready, head changed, closed, merged. */
  prEventHooks: PrEventHooks;
};

export const DEFAULT_EXTENSIONS: Extensions = {
  githubEvents: GITHUB_EVENT_HANDLERS,
  prEventHooks: PR_EVENT_HOOKS,
};
