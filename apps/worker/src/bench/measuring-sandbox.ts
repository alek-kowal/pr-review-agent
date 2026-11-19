// P-27: the sandbox wrapper `pnpm sandbox:bench` measures each container with.
import type { Sandbox, SandboxResult, SandboxRunSpec } from '@pra/integrations';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { memUsageBytes, type BenchStep } from './bench.ts';

const exec = promisify(execFile);
// Terminal control sequences `docker stats` redraws with (ESC [ ... letter).
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/**
 * Runs each container through the real sandbox, timing it and sampling its memory with
 * `docker stats` about once a second (found by a label of its own).
 */
export class MeasuringSandbox implements Sandbox {
  names: string[] = [];
  steps: BenchStep[] = [];
  lastFailed: Array<{ name: string; tail: string }> = [];
  readonly #inner: Sandbox;
  readonly #dockerEnv: NodeJS.ProcessEnv;

  /** `dockerEnv`: only what the docker CLI needs, never the worker's keys. */
  constructor(inner: Sandbox, dockerEnv: NodeJS.ProcessEnv) {
    this.#inner = inner;
    this.#dockerEnv = dockerEnv;
  }

  async run(spec: SandboxRunSpec): Promise<SandboxResult> {
    const name = this.names[this.steps.length] ?? `step ${this.steps.length + 1}`;
    const label = randomUUID();
    const sampler = sampleMemory(label, this.#dockerEnv);
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

function sampleMemory(
  label: string,
  env: NodeJS.ProcessEnv,
): { peak: () => number | null; stop: () => void } {
  let peak: number | null = null;
  let stopped = false;
  let stats: ReturnType<typeof spawn> | undefined;
  const find = async () => {
    while (!stopped && !stats) {
      const { stdout } = await exec(
        'docker',
        ['ps', '--quiet', '--filter', `label=pra.bench=${label}`],
        { env },
      ).catch(() => ({ stdout: '' }));
      const id = stdout.trim().split('\n')[0];
      if (id && !stopped) {
        stats = spawn('docker', ['stats', '--format', '{{.MemUsage}}', id], {
          env,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        stats.stdout?.on('data', (chunk: Buffer) => {
          // The stream redraws the screen; each value sits on its own line.
          for (const line of chunk.toString('utf8').split(/[\r\n]+/)) {
            const bytes = memUsageBytes(line.replace(ANSI_ESCAPE, ''));
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
