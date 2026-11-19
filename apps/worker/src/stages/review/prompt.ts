// The reviewer's knowledge directory and launch prompt, after P's `src/prompt.ts`.
import type { InstructionVersion } from '@pra/db';
import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export const REVIEWER_PROMPT_FILE = 'prompt-reviewer.md';

type Placeholder = 'knowledgeDir' | 'repoDir' | 'runDir';

/** Placeholders the reviewer cannot work without; a template missing one is not used. */
const REQUIRED: readonly Placeholder[] = ['knowledgeDir', 'repoDir'];

/** Used when the instruction is missing, empty or lacks a required placeholder. */
export const BUILT_IN_REVIEWER_PROMPT = [
  'Review the pull request. First read the rules: {{knowledgeDir}}/review-rules.md.',
  'Then read brief.md and diff.patch in the current directory.',
  'The repository at the PR head: {{repoDir}}. The knowledge directory: {{knowledgeDir}}.',
].join(' ');

/** Why a template is not used; null when it is fine. */
export function promptProblem(
  template: string | undefined,
): 'prompt_missing' | 'prompt_placeholder_missing' | null {
  if (!template?.trim()) return 'prompt_missing';
  return REQUIRED.every((name) => template.includes(`{{${name}}}`))
    ? null
    : 'prompt_placeholder_missing';
}

/** The template when usable, the built-in prompt otherwise, with placeholders filled. */
export function renderReviewerPrompt(
  template: string | undefined,
  values: Partial<Record<Placeholder, string>>,
): string {
  const usable = promptProblem(template) ? BUILT_IN_REVIEWER_PROMPT : template!;
  return usable
    .trim()
    .replace(/\{\{(\w+)\}\}/g, (whole, name: string) => values[name as Placeholder] ?? whole);
}

/**
 * The files a review reads, by file key: global ones, then the repository's, which win over a
 * global file with the same key.
 */
export function effectiveInstructions(
  versions: readonly InstructionVersion[],
): Map<string, string> {
  const files = new Map<string, string>();
  for (const scope of ['global', 'repository'] as const) {
    for (const version of versions) {
      if (version.scope === scope) files.set(version.fileKey, version.content);
    }
  }
  return files;
}

/**
 * Writes the files into `dir` and makes them and their directories read-only, so the agent
 * cannot change the rules it reviews by. A key that leaves `dir` is skipped.
 */
export async function materialiseInstructions(
  dir: string,
  files: ReadonlyMap<string, string>,
): Promise<void> {
  const root = path.resolve(dir);
  await mkdir(root, { recursive: true });
  for (const [key, content] of files) {
    const full = path.resolve(root, key);
    if (!full.startsWith(`${root}${path.sep}`)) continue;
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, { mode: 0o444 });
  }
  await setTreeMode(root, { dir: 0o555, file: 0o444 });
}

/** Removes a directory that may hold read-only parts (a materialised knowledge directory). */
export async function removeTree(dir: string): Promise<void> {
  try {
    await setTreeMode(dir, { dir: 0o755, file: 0o644 });
  } catch {
    // Missing already, or partly removed: `rm` with `force` handles the rest.
  }
  await rm(dir, { recursive: true, force: true });
}

async function setTreeMode(dir: string, modes: { dir: number; file: number }): Promise<void> {
  // Writable first, so the children can be changed; read-only last, from the leaves up.
  if (modes.dir & 0o200) await chmod(dir, modes.dir);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await setTreeMode(full, modes);
    else if (entry.isFile()) await chmod(full, modes.file);
  }
  if (!(modes.dir & 0o200)) await chmod(dir, modes.dir);
}
