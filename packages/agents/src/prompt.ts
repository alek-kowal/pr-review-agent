import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

/** Fills `{{name}}` placeholders of a stored instruction prompt; unknown names stay as they are. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => vars[name] ?? match);
}

/**
 * Runs `fn` in a fresh session folder holding `files` (relative path → content), then removes
 * the folder. Agents that must not write to the worktree get this folder as their `cwd`.
 */
export async function withSessionDir<T>(
  files: Record<string, string>,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pra-session-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(dir, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
