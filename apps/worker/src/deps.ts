import type { AgentRunner, Judge } from '@pra/agents';
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
  /** Throwaway containers for the Checks install and Verify's reproductions. */
  sandbox: Sandbox;
  clickup: ClickUpGateway;
  /** Session files (brief, diff, instruction copies) live under `<dataDir>/sessions`. */
  dataDir: string;
  /** The registries later packages extend; `DEFAULT_EXTENSIONS` unless a test replaces some. */
  extensions: Extensions;
};

export type WorkerDepsInput = Omit<WorkerDeps, 'extensions'> & {
  extensions?: Partial<Extensions>;
};

export function withDefaults(input: WorkerDepsInput): WorkerDeps {
  return { ...input, extensions: { ...DEFAULT_EXTENSIONS, ...input.extensions } };
}
