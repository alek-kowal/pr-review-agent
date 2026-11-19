import type { GithubEvent } from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import {
  handleCheckRunEvent,
  handleCheckSuiteEvent,
  handlePullRequestReviewEvent,
  handleStatusEvent,
} from './checks.ts';
import { handlePullRequestEvent } from './pull-request.ts';

export type GitHubEventContext = {
  deps: WorkerDeps;
  event: GithubEvent;
  /** The stored payload, parsed. */
  payload: Record<string, unknown>;
};

/** Handles one event type; returns the outcome code recorded on the event row. */
export type GitHubEventHandler = (context: GitHubEventContext) => Promise<string>;

export type GitHubEventHandlers = Record<string, GitHubEventHandler>;

/** By `X-GitHub-Event`. Other types are recorded with outcome `event_ignored`. */
export const GITHUB_EVENT_HANDLERS: GitHubEventHandlers = {
  pull_request: handlePullRequestEvent,
  check_suite: handleCheckSuiteEvent,
  check_run: handleCheckRunEvent,
  status: handleStatusEvent,
  pull_request_review: handlePullRequestReviewEvent,
  ping: async () => 'ping',
};
