// S-11-T1: sensitive files per PR (FR-046). A completed round matches the files the PR changes up
// to its head against the repository's sensitive patterns and adds new matches as pending; the next
// push turns files sent back into pending again.
import { matchSensitiveFiles } from '@pra/core';
import { addSensitiveFiles, readRepositoryConfig, resetSentBackSensitiveFiles } from '@pra/db';
import type { PrEventHook } from '../github-events/pr-hooks.ts';
import type { RunHook } from './hooks.ts';

export const sensitiveOnRunCompleted: RunHook = async ({ deps, run, pullRequest, repository }) => {
  if (run.kind !== 'round') return;
  const patterns = readRepositoryConfig(repository).value.sensitivePatterns;
  if (patterns.length === 0) return;
  const diff = await deps.gitMirror.diff(
    repository.githubFullName,
    pullRequest.baseSha,
    run.headSha,
  );
  const matches = matchSensitiveFiles(
    diff.files.map((file) => file.path),
    patterns,
  );
  await addSensitiveFiles(deps.db, pullRequest.id, matches, run.headSha);
};

export const sensitiveOnHeadChanged: PrEventHook = async ({ deps, pullRequest }) => {
  await resetSentBackSensitiveFiles(deps.db, pullRequest.id, pullRequest.headSha);
};
