// P-27: how much the worker does at once, from env, read once at start. Stages mostly wait for
// Claude, so several run side by side; sandbox containers need the CPU, so they take turns.
import { positiveNumberFrom, sandboxProfileFromEnv, type SandboxProfile } from '@pra/integrations';

export type WorkerLimits = {
  /**
   * `WORKER_AGENT_CONCURRENCY`: stage jobs this process runs at once (pg-boss `localConcurrency`
   * of `run.stage`). Keep it at least Settings' agent slots, or admitted runs wait for a worker.
   */
  agentConcurrency: number;
  /** `WORKER_SANDBOX_CONCURRENCY`: sandbox containers at once, from every caller. */
  sandboxConcurrency: number;
  /** `SANDBOX_*`: caps and timeouts per container. */
  sandbox: SandboxProfile;
};

export const DEFAULT_AGENT_CONCURRENCY = 3;
export const DEFAULT_SANDBOX_CONCURRENCY = 1;
const MAX_CONCURRENCY = 20;

/** Throws `ConfigValueError` (naming the variable) when a value is set but not valid. */
export function workerLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerLimits {
  const count = (name: string, fallback: number) =>
    positiveNumberFrom(env, name, fallback, { integer: true, max: MAX_CONCURRENCY });
  return {
    agentConcurrency: count('WORKER_AGENT_CONCURRENCY', DEFAULT_AGENT_CONCURRENCY),
    sandboxConcurrency: count('WORKER_SANDBOX_CONCURRENCY', DEFAULT_SANDBOX_CONCURRENCY),
    sandbox: sandboxProfileFromEnv(env),
  };
}
