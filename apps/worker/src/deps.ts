import { OpenRouterJudge, type AgentRunner, type Analyst, type Judge } from '@pra/agents';
import type { ModelAuthMode } from '@pra/core';
import type { Db, Queue } from '@pra/db';
import type {
  BlobStore,
  ClickUpGateway,
  GitHubGateway,
  GitMirror,
  Sandbox,
} from '@pra/integrations';
import type { Logger } from '@pra/integrations/logging';
import { DEFAULT_EXTENSIONS, type Extensions } from './extensions.ts';
import { RunCancellation } from './run/cancellation.ts';

/** What the worker needs from outside. `src/main.ts` builds it from env; tests pass doubles. */
export type WorkerDeps = {
  db: Db;
  queue: Queue;
  logger: Logger;
  blobStore: BlobStore;
  github: GitHubGateway;
  gitMirror: GitMirror;
  agentRunner: AgentRunner;
  /** The change-type judge (one Messages API call, no tools). */
  judge: Judge;
  /**
   * The judge for an `openrouter/...` model (P-26). When it fails, the stage falls back to
   * `judge` once. Without `OPENROUTER_API_KEY` every call fails `model_access_not_configured`.
   */
  openRouterJudge: Judge;
  /** The analyst after a PR closes (one Messages API call, no tools). */
  analyst: Analyst;
  /** Throwaway containers for the Checks install and Verify's reproductions. */
  sandbox: Sandbox;
  clickup: ClickUpGateway;
  /**
   * The address people open the app at (`APP_BASE_URL`); alert comments link to it. Without it
   * an alert is not posted ("Not sent: ClickUp not configured").
   */
  appBaseUrl?: string | null;
  /** How the agents reach the model (core `modelAuthModeOf`); a subscription labels costs. */
  modelAuth?: ModelAuthMode;
  /** Session files (brief, diff, instruction copies) live under `<dataDir>/sessions`. */
  dataDir: string;
  /** The registries later packages extend; `DEFAULT_EXTENSIONS` unless a test replaces some. */
  extensions: Extensions;
  /** The in-flight stage of each run in this process, for cancel (S-09-T3). */
  cancellation: RunCancellation;
};

export type WorkerDepsInput = Omit<
  WorkerDeps,
  'extensions' | 'cancellation' | 'openRouterJudge'
> & {
  extensions?: Partial<Extensions>;
  cancellation?: RunCancellation;
  openRouterJudge?: Judge;
};

export function withDefaults(input: WorkerDepsInput): WorkerDeps {
  return {
    ...input,
    openRouterJudge: input.openRouterJudge ?? new OpenRouterJudge({ client: null }),
    extensions: { ...DEFAULT_EXTENSIONS, ...input.extensions },
    cancellation: input.cancellation ?? new RunCancellation(),
  };
}
