// P-27: the pure parts of `pnpm sandbox:bench` (arguments, repository names, memory readings, the
// report). The CLI (`src/cli/sandbox-bench.ts`) does the cloning, the runs and the printing.
import { parseArgs } from 'node:util';

export const BENCH_USAGE = `Usage: pnpm sandbox:bench --repo <path-or-git-url> [options]

Runs the repository's fetch and install commands in the sandbox the way the Checks stage does
(same limits from SANDBOX_* env, same shared store) and prints wall time and peak memory per step.

  --repo <path|url>      a checkout, a bare mirror (<DATA_DIR>/git/mirrors/<owner>/<repo>.git) or a URL
  --runtime runc|runsc   container runtime (default SANDBOX_RUNTIME, else auto)
  --slug <slug>          the connected repository whose settings to use (default: found by name)
  --ref <ref>            commit or branch to check out (default: the clone's HEAD)
  --fetch <command>      fetch command instead of the repository's setting
  --install <command>    install command instead of the repository's setting
  --check <command>      one more command after the install, no network (e.g. "pnpm typecheck")
  --fresh                start from an empty package cache (cold numbers)
  --keep                 keep the clone afterwards (its path is printed)
`;

export type BenchArgs = {
  repo: string;
  runtime: 'runc' | 'runsc' | null;
  slug: string | null;
  ref: string | null;
  fetch: string | null;
  install: string | null;
  check: string | null;
  fresh: boolean;
  keep: boolean;
};

export type Parsed<T> = { ok: true; args: T } | { ok: false; message: string };

export function parseBenchArgs(argv: string[]): Parsed<BenchArgs> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        repo: { type: 'string' },
        runtime: { type: 'string' },
        slug: { type: 'string' },
        ref: { type: 'string' },
        fetch: { type: 'string' },
        install: { type: 'string' },
        check: { type: 'string' },
        fresh: { type: 'boolean', default: false },
        keep: { type: 'boolean', default: false },
      },
    }));
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  if (!values.repo) return { ok: false, message: '--repo is required' };
  const runtime = values.runtime ?? null;
  if (runtime !== null && runtime !== 'runc' && runtime !== 'runsc') {
    return { ok: false, message: '--runtime must be runc or runsc' };
  }
  return {
    ok: true,
    args: {
      repo: values.repo,
      runtime,
      slug: values.slug ?? null,
      ref: values.ref ?? null,
      fetch: values.fetch ?? null,
      install: values.install ?? null,
      check: values.check ?? null,
      fresh: values.fresh,
      keep: values.keep,
    },
  };
}

/**
 * `owner/repo` from a GitHub URL (https, ssh, scp-like) or a mirror path
 * (`.../mirrors/<owner>/<repo>.git`); null when it names neither.
 */
export function githubFullNameOf(source: string): string | null {
  const url = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(source);
  if (url) return `${url[1]}/${url[2]}`;
  const mirror = /mirrors\/([\w.-]+)\/([\w.-]+?)\.git\/?$/.exec(source);
  return mirror ? `${mirror[1]}/${mirror[2]}` : null;
}

const UNITS: Record<string, number> = {
  B: 1,
  KB: 1e3,
  KIB: 1024,
  MB: 1e6,
  MIB: 1024 ** 2,
  GB: 1e9,
  GIB: 1024 ** 3,
};

/** Bytes used from a `docker stats` MemUsage value such as `812.4MiB / 2GiB`; null if unreadable. */
export function memUsageBytes(value: string): number | null {
  const match = /^\s*([\d.]+)\s*([KMG]?i?B)\b/i.exec(value);
  if (!match) return null;
  const unit = UNITS[match[2]!.toUpperCase()];
  const amount = Number(match[1]);
  return unit && Number.isFinite(amount) ? Math.round(amount * unit) : null;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '-';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MiB`;
  return `${Math.round(bytes / 1024)} KiB`;
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
}

export type BenchStep = {
  name: string;
  /** Null for a step without a container (the host's store linking) or one killed at its limit. */
  exitCode: number | null;
  timedOut: boolean;
  wallMs: number;
  /** Highest memory `docker stats` reported (sampled about once a second); null if none. */
  peakBytes: number | null;
};

export type BenchReport = {
  header: string;
  steps: BenchStep[];
  /** Free disk before minus after the steps: what the install really costs on disk. */
  diskBytes: number | null;
};

export function formatReport(report: BenchReport): string {
  const rows = [
    ['step', 'exit', 'wall time', 'peak memory'],
    ...report.steps.map((step) => [
      step.name,
      step.timedOut ? 'timeout' : step.exitCode === null ? '-' : String(step.exitCode),
      formatDuration(step.wallMs),
      formatBytes(step.peakBytes),
    ]),
  ];
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  const lines = rows.map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths[column]!))
      .join('  ')
      .trimEnd(),
  );
  const disk = report.diskBytes === null ? 'unknown' : formatBytes(Math.max(0, report.diskBytes));
  return [report.header, '', ...lines, '', `disk used by fetch and install: ${disk}`, ''].join(
    '\n',
  );
}

/** Failed when a container step exited non-zero or hit its limit. */
export function benchFailed(steps: BenchStep[]): boolean {
  return steps.some((step) => step.timedOut || (step.exitCode !== null && step.exitCode !== 0));
}
