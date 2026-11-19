// `pnpm sandbox:bench --repo <path-or-git-url> [--runtime runc|runsc]` (P-27): runs a repository's
// fetch and install commands through `installDependencies` with the worker's sandbox limits
// (`SANDBOX_*` env) and prints wall time and peak memory per step, to size the limits on a host.
// The clone and its package cache live under `<DATA_DIR>/bench`, on the same disk as the worker's
// worktrees and caches, so the shared store links as it does for the worker.
import { closeDb, createDb, listRepositories, readRepositoryConfig } from '@pra/db';
import {
  DockerSandbox,
  installDependencies,
  installShell,
  INSTALL_ENV,
  sandboxRuntimeFrom,
  type InstallCommands,
  type Sandbox,
  type SandboxResult,
  type SandboxRunSpec,
} from '@pra/integrations';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, statfs } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  BENCH_USAGE,
  benchFailed,
  formatReport,
  githubFullNameOf,
  memUsageBytes,
  parseBenchArgs,
  type BenchStep,
} from '../bench/bench.ts';
import { workerLimitsFromEnv } from '../limits.ts';

const exec = promisify(execFile);
const write = (text: string) => process.stdout.write(text);
const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const parsed = parseBenchArgs(process.argv.slice(2));
if (!parsed.ok) fail(`${parsed.message}\n\n${BENCH_USAGE}`);
const args = parsed.ok ? parsed.args : fail('unreachable');

let limits;
let runtime;
try {
  limits = workerLimitsFromEnv(process.env);
  runtime = args.runtime ?? sandboxRuntimeFrom(process.env.SANDBOX_RUNTIME);
} catch (error) {
  fail((error as Error).message);
}
const profile = limits!.sandbox;

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const dataDir = path.resolve(repoRoot, process.env.DATA_DIR || '.data');
const benchRoot = path.join(dataDir, 'bench');
// Only what the docker CLI needs: never the worker's keys.
const dockerEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ...(process.env.DOCKER_CONFIG ? { DOCKER_CONFIG: process.env.DOCKER_CONFIG } : {}),
  ...(process.env.SANDBOX_DOCKER_HOST ? { DOCKER_HOST: process.env.SANDBOX_DOCKER_HOST } : {}),
};

const { name, commands } = await resolveCommands();
if (!commands.installCommand) fail(`${name} has no install command: nothing to run.`);

const clone = path.join(benchRoot, `clone-${Date.now()}`);
const cacheDir = path.join(benchRoot, 'cache', name.replace(/[^\w.-]+/g, '-'));
if (args.fresh) await rm(cacheDir, { recursive: true, force: true });
await mkdir(benchRoot, { recursive: true });
await exec('git', ['clone', '--quiet', args.repo, clone]);
if (args.ref) await exec('git', ['-C', clone, 'checkout', '--quiet', '--detach', args.ref]);
const sha = (await exec('git', ['-C', clone, 'rev-parse', '--short', 'HEAD'])).stdout.trim();

const docker = new DockerSandbox({ dockerHost: process.env.SANDBOX_DOCKER_HOST, runtime });
const measured = new MeasuringSandbox(docker);
const used = await docker.runtime().catch((error: unknown) => fail((error as Error).message));
const { cpus, memoryMb, pids } = profile.install;
write(`Benchmarking ${name} @ ${sha} in ${clone}\n`);

const steps: BenchStep[] = [];
let diskBytes: number | null = null;
try {
  const before = await freeBytes(benchRoot);
  const started = Date.now();
  measured.names = ['fetch', 'install'];
  const result = await installDependencies(measured, {
    worktree: clone,
    config: commands,
    cacheDir,
    fetchLimits: profile.fetch,
    installLimits: profile.install,
    sharedStore: profile.sharedStore,
  });
  const total = Date.now() - started;
  const after = await freeBytes(benchRoot);
  diskBytes = before !== null && after !== null ? before - after : null;
  steps.push(...measured.steps);
  if (profile.sharedStore && result.install) {
    const host = total - measured.steps.reduce((sum, step) => sum + step.wallMs, 0);
    steps.push({
      name: 'store links (host)',
      exitCode: null,
      timedOut: false,
      wallMs: host,
      peakBytes: null,
    });
  }
  if (args.check && result.status === 'ok') {
    measured.names = ['check'];
    measured.steps = [];
    await measured.run({
      image: 'node:24-slim',
      command: installShell(args.check),
      workdir: '/work',
      mounts: [
        { hostPath: clone, containerPath: '/work', writable: true },
        { hostPath: cacheDir, containerPath: '/cache' },
      ],
      env: { ...INSTALL_ENV },
      network: 'none',
      limits: profile.install,
    });
    steps.push(...measured.steps);
  }
  const header = [
    `Runtime ${used ?? 'daemon default (runc)'}; per container ${cpus} CPU, ${memoryMb} MB, ${pids} pids;`,
    `shared store ${profile.sharedStore ? 'on' : 'off'}; package cache ${cacheDir}`,
  ].join('\n');
  write(`\n${formatReport({ header, steps, diskBytes })}`);
  for (const step of measured.lastFailed) write(`\n## ${step.name} output (tail)\n${step.tail}\n`);
} finally {
  if (args.keep) write(`Clone kept: ${clone}\n`);
  else await rm(clone, { recursive: true, force: true });
}
process.exit(benchFailed(steps) ? 1 : 0);

/** The commands: from the flags, else from the connected repository's settings. */
async function resolveCommands(): Promise<{ name: string; commands: InstallCommands }> {
  const fullName = githubFullNameOf(args.repo);
  if (args.install) {
    return {
      name: args.slug ?? fullName ?? path.basename(args.repo).replace(/\.git$/, ''),
      commands: { fetchCommand: args.fetch, installCommand: args.install },
    };
  }
  const url = process.env.DATABASE_URL;
  if (!url) return fail('DATABASE_URL is not set: pass --install (and --fetch) instead.');
  const db = createDb(url, { max: 1 });
  try {
    const repositories = await listRepositories(db);
    const repository = repositories.find((candidate) =>
      args.slug ? candidate.slug === args.slug : candidate.githubFullName === fullName,
    );
    if (!repository) {
      return fail(
        `No connected repository ${args.slug ?? fullName ?? args.repo}; pass --slug or --install.`,
      );
    }
    const config = readRepositoryConfig(repository).value;
    return {
      name: repository.slug,
      commands: {
        fetchCommand: args.fetch ?? config.fetchCommand,
        installCommand: config.installCommand,
      },
    };
  } finally {
    await closeDb(db);
  }
}

async function freeBytes(dir: string): Promise<number | null> {
  try {
    const stats = await statfs(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

/**
 * Runs each container through the real sandbox, timing it and sampling its memory with
 * `docker stats` about once a second (found by a label of its own).
 */
class MeasuringSandbox implements Sandbox {
  names: string[] = [];
  steps: BenchStep[] = [];
  lastFailed: Array<{ name: string; tail: string }> = [];
  readonly #inner: Sandbox;

  constructor(inner: Sandbox) {
    this.#inner = inner;
  }

  async run(spec: SandboxRunSpec): Promise<SandboxResult> {
    const name = this.names[this.steps.length] ?? `step ${this.steps.length + 1}`;
    const label = randomUUID();
    const sampler = sampleMemory(label);
    const started = Date.now();
    try {
      const result = await this.#inner.run({
        ...spec,
        labels: { ...spec.labels, 'pra.bench': label },
      });
      this.steps.push({
        name,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        wallMs: Date.now() - started,
        peakBytes: sampler.peak(),
      });
      if (result.exitCode !== 0) this.lastFailed.push({ name, tail: result.outputTail });
      return result;
    } finally {
      sampler.stop();
    }
  }
}

function sampleMemory(label: string): { peak: () => number | null; stop: () => void } {
  let peak: number | null = null;
  let stopped = false;
  let stats: ReturnType<typeof spawn> | undefined;
  const find = async () => {
    while (!stopped && !stats) {
      const { stdout } = await exec(
        'docker',
        ['ps', '--quiet', '--filter', `label=pra.bench=${label}`],
        { env: dockerEnv },
      ).catch(() => ({ stdout: '' }));
      const id = stdout.trim().split('\n')[0];
      if (id && !stopped) {
        stats = spawn('docker', ['stats', '--format', '{{.MemUsage}}', id], {
          env: dockerEnv,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        stats.stdout?.on('data', (chunk: Buffer) => {
          // The stream redraws the screen; each value sits on its own line.
          for (const line of chunk.toString('utf8').split(/[\r\n]+/)) {
            const bytes = memUsageBytes(line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''));
            if (bytes !== null) peak = Math.max(peak ?? 0, bytes);
          }
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };
  void find();
  return {
    peak: () => peak,
    stop: () => {
      stopped = true;
      stats?.kill();
    },
  };
}
