// The reviewer's brief (`brief.md`), after P's `src/brief.ts`. Paths only for documents: the
// reviewer reads them in the worktree.
import type { ChangeType, FrozenLevel, ReviewLimits, SensitiveMatch } from '@pra/core';
import type { PullRequest } from '@pra/db';
import type { ChangedFile } from '@pra/integrations';

/** A section a reviewer context provider adds (task, answers, ...). */
export type BriefSection = { title: string; body: string };

export type BriefInput = {
  pullRequest: Pick<PullRequest, 'number' | 'title' | 'body' | 'authorLogin' | 'headSha'>;
  files: readonly ChangedFile[];
  sensitive: readonly SensitiveMatch[];
  documents: readonly string[];
  level: Pick<FrozenLevel, 'number' | 'key' | 'settings'>;
  limits: Pick<ReviewLimits, 'maxFindings' | 'maxQuestions' | 'severities'>;
  /** Known from the Change type stage (P-09); without it the brief has no "Change risk". */
  changeType?: { type: ChangeType; reason: string } | null;
  sections?: readonly BriefSection[];
};

const WORKSPACE = /^(apps|packages)\/[^/]+\//;
const DOCUMENT = /(README|CLAUDE|AGENTS)\.md$|\.decision-log\.md$/;

/** The workspaces (`apps/<name>/`, `packages/<name>/`) the changed files touch. */
export function touchedWorkspaces(files: readonly string[]): string[] {
  const found = files.map((file) => WORKSPACE.exec(file)?.[0]).filter((w) => w !== undefined);
  return [...new Set(found)];
}

/** READMEs, agent instructions and decision logs of every workspace the PR touches. */
export function documentsFor(files: readonly string[], tracked: readonly string[]): string[] {
  const workspaces = touchedWorkspaces(files);
  return tracked.filter(
    (file) => DOCUMENT.test(file) && workspaces.some((workspace) => file.startsWith(workspace)),
  );
}

const list = (items: readonly string[], empty: string): string =>
  items.length ? items.map((item) => `- ${item}`).join('\n') : empty;

function fileLine(file: ChangedFile): string {
  const counts = file.additions === null ? 'binary' : `+${file.additions} -${file.deletions ?? 0}`;
  const renamed = file.previousPath ? ` (from \`${file.previousPath}\`)` : '';
  return `\`${file.path}\`${renamed}: ${file.status}, ${counts}`;
}

function limitLines(limits: BriefInput['limits']): string[] {
  return [
    `Report at most ${limits.maxFindings} findings, the most severe first.`,
    `Allowed severities: ${limits.severities.map((s) => SEVERITY_WORDS[s]).join(', ')}.`,
    limits.maxQuestions === 0
      ? 'Do not ask the team questions.'
      : `Ask the team at most ${limits.maxQuestions} questions, only when the code cannot answer them.`,
  ];
}

const SEVERITY_WORDS = { blocking: 'blocker', worth_fixing: 'should', nit: 'nit' } as const;

const CHANGE_TYPE_WORDS: Record<ChangeType, string> = {
  uses_existing: 'Uses what exists',
  changes_behaviour: 'Changes behaviour',
  one_way_door: 'One-way door',
};

export function buildBrief(input: BriefInput): string {
  const { pullRequest: pr, files, sensitive, documents, level, limits, changeType } = input;
  const parts: string[] = [
    `# Review brief: PR #${pr.number}`,
    [
      '## Pull request',
      '',
      `- Title: ${pr.title}`,
      `- Author: ${pr.authorLogin}`,
      `- Commit: ${pr.headSha}`,
    ].join('\n'),
    `### Description from the author\n\n${pr.body.trim() || 'The author added no description.'}`,
    `## Paths that need a person's decision\n\n${list(
      sensitive.map(({ path, reason }) => `\`${path}\` (${reason})`),
      'The PR touches none of them.',
    )}`,
  ];
  if (level.settings.brief) {
    parts.push(`## Review level\n\n**Level ${level.number}.** ${level.settings.brief}`);
  }
  if (changeType) {
    parts.push(`## Change risk\n\n**${CHANGE_TYPE_WORDS[changeType.type]}.** ${changeType.reason}`);
  }
  parts.push(
    `## Limits\n\n${list(limitLines(limits), '')}`,
    `## Changed files\n\n${list(files.map(fileLine), 'None.')}`,
    `## Documents of the touched areas (in the repository directory)\n\n${list(documents, 'None.')}`,
  );
  for (const section of input.sections ?? []) {
    parts.push(`## ${section.title}\n\n${section.body.trim()}`);
  }
  return `${parts.join('\n\n')}\n`;
}
