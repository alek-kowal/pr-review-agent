import type { NoParams } from '../reason.ts';

declare module '../reason.ts' {
  interface ReasonParams {
    /** Token mode (no GitHub App): the app reads GitHub but never writes to it. */
    github_read_only: NoParams;
    /** GitHub's rate limit is used up until `resetAt` (ISO time); nothing is sent until then. */
    github_rate_limited: { resetAt: string };
    /** The poller runs only in token mode; with the GitHub App, webhooks bring the events. */
    github_poll_off: NoParams;
  }
}

export {};
