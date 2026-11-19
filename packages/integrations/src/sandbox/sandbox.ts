/**
 * Runs one command in a throwaway, locked-down container. The worker calls it (Checks install,
 * reproduction scripts); it never runs inside an agent's session. Tests use `FakeSandbox`.
 */
export interface Sandbox {
  /**
   * Resolves when the command ends or hits its time limit (`timedOut`). Rejects with
   * `sandbox_cancelled` when `signal` aborts, and with `sandbox_not_configured` when no container
   * runtime is reachable. No container is left behind either way.
   */
  run(spec: SandboxRunSpec): Promise<SandboxResult>;
}

export type SandboxMount = {
  hostPath: string;
  containerPath: string;
  /** Read-only unless set. */
  writable?: boolean;
};

export type SandboxLimits = {
  cpus: number;
  memoryMb: number;
  pids: number;
  timeoutMs: number;
};

/**
 * `none`: no network at all (the default). `egress`: outbound network, only for steps that run no
 * PR code, such as fetching packages from a lockfile.
 */
export type SandboxNetwork = 'none' | 'egress';

export type SandboxRunSpec = {
  image: string;
  command: string[];
  workdir: string;
  mounts: SandboxMount[];
  /** The only variables the container gets besides the image's own. */
  env?: Record<string, string>;
  network?: SandboxNetwork;
  limits: SandboxLimits;
  /** Extra container labels, e.g. to find a test's containers. */
  labels?: Record<string, string>;
  signal?: AbortSignal;
};

export type SandboxResult = {
  /** `null` when the container was killed at the time limit. */
  exitCode: number | null;
  /** Combined stdout and stderr; the last `SANDBOX_OUTPUT_LIMIT` characters. */
  output: string;
  /** The last `SANDBOX_OUTPUT_TAIL` characters, for stage output. */
  outputTail: string;
  timedOut: boolean;
  durationMs: number;
};

/** Every sandbox container carries this label (`docker ps -a --filter label=pra.sandbox`). */
export const SANDBOX_LABEL = 'pra.sandbox';
export const SANDBOX_OUTPUT_LIMIT = 1_000_000;
export const SANDBOX_OUTPUT_TAIL = 4_000;
/** Node with corepack; the package manager comes from the repository's `packageManager` field. */
export const DEFAULT_SANDBOX_IMAGE = 'node:24-slim';

export const SANDBOX_NOT_CONFIGURED = 'sandbox_not_configured';
export const SANDBOX_CANCELLED = 'sandbox_cancelled';
export const SANDBOX_FAILED = 'sandbox_failed';
