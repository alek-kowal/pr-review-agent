import * as path from 'node:path';

/** The `GitMirror` worktree id of a run. */
export const worktreeKey = (runId: number): string => `run-${runId}`;

/** Every session directory of a run: `<dataDir>/sessions/run-<id>`. */
export const runSessionsDir = (dataDir: string, runId: number): string =>
  path.join(dataDir, 'sessions', `run-${runId}`);

/** One stage attempt's session directory: `<dataDir>/sessions/run-<id>/<stage>-<attempt>`. */
export const sessionDirFor = (
  dataDir: string,
  runId: number,
  stage: string,
  attempt: number,
): string => path.join(runSessionsDir(dataDir, runId), `${stage}-${attempt}`);
