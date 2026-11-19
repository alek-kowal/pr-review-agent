import { randomUUID } from 'node:crypto';
import { execa } from 'execa';
import { IntegrationError, IntegrationNotConfiguredError } from '../errors.ts';
import { isSecretName } from '../logging.ts';
import {
  SANDBOX_CANCELLED,
  SANDBOX_FAILED,
  SANDBOX_LABEL,
  SANDBOX_NOT_CONFIGURED,
  SANDBOX_OUTPUT_LIMIT,
  SANDBOX_OUTPUT_TAIL,
  type Sandbox,
  type SandboxResult,
  type SandboxRunSpec,
} from './sandbox.ts';

export type DockerSandboxOptions = {
  /** `SANDBOX_DOCKER_HOST`, e.g. a rootless daemon's socket; unset = the local default. */
  dockerHost?: string;
  /** The docker CLI; default `docker` on `PATH`. */
  docker?: string;
  /** The container user; default the worker's own uid:gid (never root). */
  user?: string;
  now?: () => number;
};

const PROBE_TIMEOUT_MS = 15_000;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * `Sandbox` on Docker through its CLI. Each run is `docker create` (labelled, no network unless
 * asked, read-only root, no capabilities, resource limits) then `docker start -a`; a time limit
 * or an aborted signal removes the container, and every run removes it at the end (no `--rm`, so
 * the removal is awaited, not raced). gVisor (`runsc`) is used when the daemon has it.
 */
export class DockerSandbox implements Sandbox {
  readonly #dockerHost: string | undefined;
  readonly #docker: string;
  readonly #user: string;
  readonly #now: () => number;
  #runtime: Promise<string | null> | undefined;

  constructor(options: DockerSandboxOptions = {}) {
    this.#dockerHost = options.dockerHost || undefined;
    this.#docker = options.docker ?? 'docker';
    this.#user = options.user ?? defaultUser();
    this.#now = options.now ?? Date.now;
  }

  async run(spec: SandboxRunSpec): Promise<SandboxResult> {
    if (spec.signal?.aborted) throw new IntegrationError(SANDBOX_CANCELLED);
    const runtime = await this.#probe();
    const name = `pra-sbx-${randomUUID()}`;
    const startedAt = this.#now();

    const created = await this.#cli(dockerCreateArgs(spec, { name, runtime, user: this.#user }));
    if (created.exitCode !== 0) {
      await this.#remove(name);
      throw new IntegrationError(SANDBOX_FAILED, {
        step: 'create',
        detail: tail(created.all, 500),
      });
    }

    let timedOut = false;
    let aborted = false;
    let stopping: Promise<void> | undefined;
    const stop = () => {
      stopping ??= this.#remove(name);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, spec.limits.timeoutMs);
    const onAbort = () => {
      aborted = true;
      stop();
    };
    spec.signal?.addEventListener('abort', onAbort, { once: true });
    if (spec.signal?.aborted) onAbort();

    const output = new OutputBuffer(SANDBOX_OUTPUT_LIMIT);
    try {
      const started = execa(this.#docker, ['start', '--attach', name], {
        env: this.#cliEnv(),
        extendEnv: false,
        all: true,
        buffer: false,
        reject: false,
        stdin: 'ignore',
      });
      started.all?.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
      const result = await started;
      if (aborted) throw new IntegrationError(SANDBOX_CANCELLED);
      const text = output.text();
      return {
        exitCode: timedOut ? null : (result.exitCode ?? null),
        output: text,
        outputTail: text.slice(-SANDBOX_OUTPUT_TAIL),
        timedOut,
        durationMs: this.#now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
      spec.signal?.removeEventListener('abort', onAbort);
      // One removal at a time: `docker rm -f` returns early while another removal is running.
      await stopping;
      await this.#remove(name);
    }
  }

  /** Checks the daemon once and finds out whether it has gVisor. A failed probe is retried. */
  #probe(): Promise<string | null> {
    this.#runtime ??= (async () => {
      const info = await this.#cli(['info', '--format', '{{json .Runtimes}}'], PROBE_TIMEOUT_MS);
      if (info.exitCode !== 0) {
        throw new IntegrationNotConfiguredError(SANDBOX_NOT_CONFIGURED, ['SANDBOX_DOCKER_HOST']);
      }
      return hasRuntime(info.stdout, 'runsc') ? 'runsc' : null;
    })().catch((error: unknown) => {
      this.#runtime = undefined;
      throw error;
    });
    return this.#runtime;
  }

  async #cli(args: string[], timeout?: number) {
    try {
      return await execa(this.#docker, args, {
        env: this.#cliEnv(),
        extendEnv: false,
        all: true,
        reject: false,
        stdin: 'ignore',
        ...(timeout ? { timeout } : {}),
      });
    } catch {
      // The CLI itself is missing or cannot start.
      throw new IntegrationNotConfiguredError(SANDBOX_NOT_CONFIGURED, ['SANDBOX_DOCKER_HOST']);
    }
  }

  /** Removes the container if it exists; a missing one is fine. */
  async #remove(name: string): Promise<void> {
    await execa(this.#docker, ['rm', '--force', name], {
      env: this.#cliEnv(),
      extendEnv: false,
      reject: false,
      stdin: 'ignore',
    }).catch(() => undefined);
  }

  #cliEnv(): Record<string, string> {
    return dockerCliEnv(process.env, this.#dockerHost);
  }
}

/**
 * The docker CLI's whole env (it runs with `extendEnv: false`): the worker's env (the CLI's config
 * and context) without any secret, so `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` and the
 * other keys never reach it. The container gets only the env its spec names.
 */
export function dockerCliEnv(
  env: NodeJS.ProcessEnv,
  dockerHost: string | undefined,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !isSecretName(name)) kept[name] = value;
  }
  return dockerHost ? { ...kept, DOCKER_HOST: dockerHost } : kept;
}

/** `DockerSandbox` on the daemon at `SANDBOX_DOCKER_HOST` (unset = local Docker). */
export function createSandbox(env: NodeJS.ProcessEnv = process.env): DockerSandbox {
  return new DockerSandbox({ dockerHost: env.SANDBOX_DOCKER_HOST });
}

/** The `docker create` arguments for one run. Exported for tests. */
export function dockerCreateArgs(
  spec: SandboxRunSpec,
  options: { name: string; runtime: string | null; user: string },
): string[] {
  const { limits } = spec;
  const args = [
    'create',
    '--name',
    options.name,
    '--label',
    `${SANDBOX_LABEL}=1`,
    ...Object.entries(spec.labels ?? {}).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
    '--init',
    '--network',
    spec.network === 'egress' ? 'bridge' : 'none',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,size=512m',
    '--user',
    options.user,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--cpus',
    String(limits.cpus),
    '--memory',
    `${limits.memoryMb}m`,
    '--memory-swap',
    `${limits.memoryMb}m`,
    '--pids-limit',
    String(limits.pids),
    '--workdir',
    spec.workdir,
  ];
  if (options.runtime) args.push('--runtime', options.runtime);
  for (const mount of spec.mounts) {
    for (const value of [mount.hostPath, mount.containerPath]) {
      if (value.includes(',')) {
        throw new IntegrationError(SANDBOX_FAILED, { step: 'mount', detail: 'comma in path' });
      }
    }
    const readonly = mount.writable ? '' : ',readonly';
    args.push(
      '--mount',
      `type=bind,source=${mount.hostPath},target=${mount.containerPath}${readonly}`,
    );
  }
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    if (!ENV_NAME.test(key)) {
      throw new IntegrationError(SANDBOX_FAILED, { step: 'env', detail: `invalid name ${key}` });
    }
    args.push('--env', `${key}=${value}`);
  }
  args.push(spec.image, ...spec.command);
  return args;
}

function hasRuntime(runtimesJson: string, runtime: string): boolean {
  try {
    const runtimes = JSON.parse(runtimesJson) as unknown;
    return typeof runtimes === 'object' && runtimes !== null && runtime in runtimes;
  } catch {
    return false;
  }
}

function defaultUser(): string {
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  // Never root inside the container, even when the worker itself runs as root.
  return uid === 0 ? '1000:1000' : `${uid}:${gid}`;
}

function tail(text: unknown, length: number): string {
  return typeof text === 'string' ? text.slice(-length) : '';
}

/** Keeps the last `limit` characters of a stream. */
class OutputBuffer {
  readonly #limit: number;
  #chunks: string[] = [];
  #length = 0;

  constructor(limit: number) {
    this.#limit = limit;
  }

  push(chunk: string): void {
    this.#chunks.push(chunk);
    this.#length += chunk.length;
    while (this.#length - (this.#chunks[0]?.length ?? 0) >= this.#limit) {
      this.#length -= this.#chunks.shift()!.length;
    }
  }

  text(): string {
    return this.#chunks.join('').slice(-this.#limit);
  }
}
