// The instruction files a stage reads (S-22-T3): the versions its run froze when it started,
// resolved global → repository → level copy. Broken JSON fields fall back and are logged.
import { runInstructions } from '@pra/db';
import type { StageContext } from './stage.ts';

export async function stageInstructions(
  context: Pick<StageContext, 'deps' | 'run' | 'repository'>,
): Promise<Map<string, string>> {
  const { deps, run, repository } = context;
  const { files, warnings } = await runInstructions(deps.db, run, repository.id);
  for (const warning of warnings) {
    deps.logger.warn({ runId: run.id, reason: warning }, 'instruction file fell back');
  }
  return files;
}
