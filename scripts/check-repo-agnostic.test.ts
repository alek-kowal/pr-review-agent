import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { findRepositoryNames } from './check-repo-agnostic.ts';

const SCRIPT = fileURLToPath(new URL('./check-repo-agnostic.ts', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Runs the script as `pnpm lint` does, over another root. */
async function runScript(root: string): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await promisify(execFile)(process.execPath, [SCRIPT, '--root', root]);
    return { code: 0, stderr };
  } catch (error) {
    const failed = error as { code: number; stderr: string };
    return { code: failed.code, stderr: failed.stderr };
  }
}

async function put(root: string, file: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}

describe('check-repo-agnostic', () => {
  // A copy of the repository's layout in a temporary folder: the real tree is never touched, so
  // `pnpm lint` running next to this test never sees the planted names.
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pra-agnostic-'));
    await put(root, 'apps/worker/src/handlers/github-event.ts', 'export const handle = () => 1;\n');
    await put(root, 'packages/core/src/levels.ts', '// Task ids look like WB-123.\n');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('passes on this repository', async () => {
    expect(await findRepositoryNames(REPO_ROOT)).toEqual([]);
  });

  test('passes on a tree without repository names (bare WB task ids are fine)', async () => {
    expect(await runScript(root)).toEqual({ code: 0, stderr: '' });
  });

  test('fails when a WB name is added under apps/worker/src', async () => {
    await put(
      root,
      'apps/worker/src/handlers/github-event.ts',
      "export const handle = () => 1;\nconst repo = 'synergycodes/workflowbuilder';\n",
    );

    const result = await runScript(root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'apps/worker/src/handlers/github-event.ts:2: repository-specific name "synergycodes"',
    );
    expect(result.stderr).toContain(
      'apps/worker/src/handlers/github-event.ts:2: repository-specific name "workflowbuilder"',
    );
  });

  test.each([
    ['Workflow Builder', 'apps/web/src/copy/board.ts'],
    ['wb-factory', 'packages/agents/src/reviewer/prompt.md'],
  ])('finds "%s" in %s', async (name, file) => {
    await put(root, file, `// Ported from ${name}.\n`);

    expect(await findRepositoryNames(root)).toEqual([{ file, line: 1, name }]);
  });

  test.each([
    'apps/worker/src/handlers/github-event.test.ts',
    'apps/web/src/features/board/Board.test.tsx',
    'apps/worker/test/round.ts',
    'packages/db/src/testing/fixtures/workflowbuilder.json',
    'packages/integrations/src/testing/github.ts',
    'packages/core/test/fixtures/wb-config.ts',
    'apps/web/node_modules/pkg/index.js',
    'apps/web/dist/index.js',
  ])('skips tests, fixtures and tool output: %s', async (file) => {
    await put(root, file, '{ "githubFullName": "synergycodes/workflowbuilder" }\n');

    expect(await runScript(root)).toEqual({ code: 0, stderr: '' });
  });
});
