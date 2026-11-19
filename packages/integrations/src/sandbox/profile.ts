import { IntegrationError } from '../errors.ts';
import {
  SANDBOX_CANCELLED,
  type Sandbox,
  type SandboxLimits,
  type SandboxResult,
  type SandboxRunSpec,
} from './sandbox.ts';

/** The limits of each kind of sandbox run. The worker reads them from env once at start. */
export type SandboxProfile = {
  /** The fetch step: network to the registry, no PR code. */
  fetch: SandboxLimits;
  /** The install step: the PR's scripts, no network. */
  install: SandboxLimits;
  /** One reproduction script (Verify, fix-check, a patch's check). */
  repro: SandboxLimits;
  /** Hardlink the repository's pnpm store into the install step (`installDependencies`). */
  sharedStore: boolean;
};

const MINUTE = 60_000;

/** Sized for a small VPS (1 vCPU, 4 GB): one CPU and 2 GB per container. */
export const DEFAULT_SANDBOX_PROFILE: Readonly<SandboxProfile> = {
  fetch: { cpus: 1, memoryMb: 2048, pids: 1024, timeoutMs: 10 * MINUTE },
  install: { cpus: 1, memoryMb: 2048, pids: 1024, timeoutMs: 15 * MINUTE },
  repro: { cpus: 1, memoryMb: 2048, pids: 1024, timeoutMs: 5 * MINUTE },
  sharedStore: true,
};

/** The env names `sandboxProfileFromEnv` reads (documented in `.env.example`). */
export const SANDBOX_PROFILE_ENV = [
  'SANDBOX_CPUS',
  'SANDBOX_MEMORY_MB',
  'SANDBOX_PIDS',
  'SANDBOX_FETCH_TIMEOUT_MINUTES',
  'SANDBOX_INSTALL_TIMEOUT_MINUTES',
  'SANDBOX_REPRO_TIMEOUT_MINUTES',
  'SANDBOX_SHARED_STORE',
] as const;

/** A set env value that is not valid; the message names the variable, never the value. */
export class ConfigValueError extends Error {
  readonly variable: string;

  constructor(variable: string, expected: string) {
    super(`${variable} must be ${expected}`);
    this.name = 'ConfigValueError';
    this.variable = variable;
  }
}

/** A positive number from env, or `fallback` when unset or empty. */
export function positiveNumberFrom(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  options: { integer?: boolean; max?: number } = {},
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  const valid = Number.isFinite(value) && value > 0 && value <= max;
  if (!valid || (options.integer && !Number.isInteger(value))) {
    throw new ConfigValueError(
      name,
      `a positive ${options.integer ? 'integer' : 'number'} up to ${max}`,
    );
  }
  return value;
}

/** A boolean from env (`true`/`1`/`on`, `false`/`0`/`off`), or `fallback` when unset. */
export function booleanFrom(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['true', '1', 'on', 'yes'].includes(raw)) return true;
  if (['false', '0', 'off', 'no'].includes(raw)) return false;
  throw new ConfigValueError(name, 'true or false');
}

/**
 * The sandbox limits from env: `SANDBOX_CPUS`, `SANDBOX_MEMORY_MB` and `SANDBOX_PIDS` apply to
 * every container; each kind of run has its own timeout. Throws `ConfigValueError` on a bad value.
 */
export function sandboxProfileFromEnv(env: NodeJS.ProcessEnv = process.env): SandboxProfile {
  const base = DEFAULT_SANDBOX_PROFILE;
  const shared = {
    cpus: positiveNumberFrom(env, 'SANDBOX_CPUS', base.install.cpus, { max: 64 }),
    memoryMb: positiveNumberFrom(env, 'SANDBOX_MEMORY_MB', base.install.memoryMb, {
      integer: true,
      max: 1_048_576,
    }),
    pids: positiveNumberFrom(env, 'SANDBOX_PIDS', base.install.pids, {
      integer: true,
      max: 65_536,
    }),
  };
  const minutes = (name: string, fallbackMs: number) =>
    positiveNumberFrom(env, name, fallbackMs / MINUTE, { max: 24 * 60 }) * MINUTE;
  return {
    fetch: { ...shared, timeoutMs: minutes('SANDBOX_FETCH_TIMEOUT_MINUTES', base.fetch.timeoutMs) },
    install: {
      ...shared,
      timeoutMs: minutes('SANDBOX_INSTALL_TIMEOUT_MINUTES', base.install.timeoutMs),
    },
    repro: { ...shared, timeoutMs: minutes('SANDBOX_REPRO_TIMEOUT_MINUTES', base.repro.timeoutMs) },
    sharedStore: booleanFrom(env, 'SANDBOX_SHARED_STORE', base.sharedStore),
  };
}

/**
 * A `Sandbox` that runs at most `limit` containers at once; the others wait in order. One
 * instance is shared by every caller in the worker (fetch, install, reproductions), so a 1-CPU
 * host never runs two heavy containers side by side. A waiting run whose signal aborts (cancel,
 * stage timeout) leaves the line with `sandbox_cancelled` and starts nothing.
 */
export class LimitedSandbox implements Sandbox {
  readonly #inner: Sandbox;
  readonly #limit: number;
  #running = 0;
  readonly #waiting: Array<() => void> = [];

  constructor(inner: Sandbox, limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be at least 1');
    this.#inner = inner;
    this.#limit = limit;
  }

  /** Containers running and runs waiting for a turn (for logs and tests). */
  get load(): { running: number; waiting: number } {
    return { running: this.#running, waiting: this.#waiting.length };
  }

  async run(spec: SandboxRunSpec): Promise<SandboxResult> {
    await this.#acquire(spec.signal);
    try {
      return await this.#inner.run(spec);
    } finally {
      this.#release();
    }
  }

  #acquire(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) return Promise.reject(new IntegrationError(SANDBOX_CANCELLED));
    if (this.#running < this.#limit) {
      this.#running += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        const index = this.#waiting.indexOf(grant);
        if (index >= 0) this.#waiting.splice(index, 1);
        reject(new IntegrationError(SANDBOX_CANCELLED));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#waiting.push(grant);
    });
  }

  /** Hands the place to the next waiting run, or frees it. */
  #release(): void {
    const next = this.#waiting.shift();
    if (next) next();
    else this.#running -= 1;
  }
}
