// The containers of Docker sandbox tests: finding them by label and removing them. Only ever
// `pra-sbx-*` containers (the names `DockerSandbox` gives); no vitest import, so the global setup
// can use it too.
import { hostname } from 'node:os';
import { execa } from 'execa';

/** Each test file's own label (`key=uuid`): its "no container left" checks see only its runs. */
export const SANDBOX_TEST_LABEL = 'pra.sandbox.test';
/** The test run's label (`key=uuid`, from the global setup): teardown removes all of its runs. */
export const SANDBOX_TEST_SESSION_LABEL = 'pra.sandbox.test.session';
/** The Vitest process that owns the test run (`host:pid`): once it is gone, so are its runs. */
export const SANDBOX_TEST_OWNER_LABEL = 'pra.sandbox.test.owner';
/** Older test containers belong to a run that was killed (the longest run limit is 15 min). */
export const STALE_TEST_CONTAINER_MS = 60 * 60_000;

const NAME_PREFIX = 'pra-sbx-';

type Container = { id: string; owner: string; createdAt: number };

/** The owner label of a test run in this process. */
export const ownerOfThisProcess = () => `${hostname()}:${process.pid}`;

/** The `pra-sbx-*` containers, running or not, that carry `label` (`key` or `key=value`). */
async function containersWith(label: string): Promise<Container[]> {
  const { stdout } = await execa('docker', [
    'ps',
    '--all',
    '--filter',
    `label=${label}`,
    '--filter',
    `name=${NAME_PREFIX}`,
    '--format',
    `{{.ID}}\t{{.Names}}\t{{.Label "${SANDBOX_TEST_OWNER_LABEL}"}}\t{{.CreatedAt}}`,
  ]);
  return stdout
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([id, name]) => id && name?.startsWith(NAME_PREFIX))
    .map(([id, , owner, createdAt]) => ({
      id: id!,
      owner: owner ?? '',
      createdAt: parseCreatedAt(createdAt ?? ''),
    }));
}

/** Ids of the `pra-sbx-*` containers, running or not, that carry `label` (`key=value`). */
export async function labelledContainers(label: string): Promise<string[]> {
  return (await containersWith(label)).map((c) => c.id);
}

/** Removes the `pra-sbx-*` containers with `label`, running or not. */
export async function removeLabelledContainers(label: string): Promise<void> {
  await removeContainers(await labelledContainers(label));
}

/**
 * Removes the test containers of runs that were interrupted or killed: Vitest exits on SIGINT and
 * SIGTERM without its global teardown. Their owner process is gone, or they are over an hour old.
 * A container whose owner runs on another host is judged by age only.
 */
export async function removeStaleTestContainers(now = Date.now()): Promise<void> {
  const stale = (await containersWith(SANDBOX_TEST_LABEL)).filter(
    (c) => ownerIsGone(c.owner) || now - c.createdAt > STALE_TEST_CONTAINER_MS,
  );
  await removeContainers(stale.map((c) => c.id));
}

/** Whether `host:pid` names a process of this host that no longer runs. */
export function ownerIsGone(owner: string): boolean {
  const separator = owner.lastIndexOf(':');
  const pid = Number(owner.slice(separator + 1));
  if (separator < 0 || owner.slice(0, separator) !== hostname() || !Number.isInteger(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // EPERM: it runs, under another user.
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

async function removeContainers(ids: string[]): Promise<void> {
  if (ids.length) await execa('docker', ['rm', '--force', ...ids], { reject: false });
}

/** `docker ps` CreatedAt, e.g. `2026-11-19 22:49:53 +0100 CET`; NaN (never stale) otherwise. */
export function parseCreatedAt(text: string): number {
  const [date, time, offset] = text.split(' ');
  if (!date || !time || !offset || !/^[+-]\d{4}$/.test(offset)) return Number.NaN;
  return Date.parse(`${date}T${time}${offset.slice(0, 3)}:${offset.slice(3)}`);
}
