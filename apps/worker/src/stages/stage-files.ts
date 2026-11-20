// The files one stage reads (STAGEFILES): the stage → files map its run froze when it started. A
// run started before that (`stage_files` null) reads the declared defaults over its files.
import { stageFilesFor } from '@pra/agents';
import {
  defaultKindOf,
  FILE_STAGE_OF_INSTRUCTION_STAGE,
  missingInstructions,
  REQUIRED_INSTRUCTION_FILES,
  type FileStageKey,
  type InstructionStage,
  type StageFiles,
} from '@pra/core';
import type { Run } from '@pra/db';

const NONE: StageFiles = { prompt: null, rules: null, documents: [] };

export function stageFilesOf(
  run: Pick<Run, 'stageFiles'>,
  stage: FileStageKey,
  /** The run's files (`stageInstructions`), for the defaults of an older run. */
  files: ReadonlyMap<string, string>,
): StageFiles {
  if (run.stageFiles) return run.stageFiles[stage] ?? NONE;
  const documentKeys = [...files.keys()].filter((key) => defaultKindOf(key) === 'document');
  return stageFilesFor({ global: {}, repository: {} }, documentKeys)[stage] ?? NONE;
}

/**
 * A required stage's assigned prompt and rules text, or the assigned keys that are missing or
 * empty (the `*_instructions_missing` params).
 */
export function requiredStageText(
  run: Pick<Run, 'stageFiles'>,
  stage: InstructionStage,
  files: ReadonlyMap<string, string>,
):
  | { ok: true; prompt: string; rules: string; stageFiles: StageFiles }
  | { ok: false; missing: string[] } {
  const fileStage = FILE_STAGE_OF_INSTRUCTION_STAGE[stage];
  const stageFiles = stageFilesOf(run, fileStage, files);
  const text = (key: string | null) => (key ? files.get(key)?.trim() : undefined);
  const prompt = text(stageFiles.prompt);
  const rules = text(stageFiles.rules);
  if (prompt && rules) return { ok: true, prompt, rules, stageFiles };
  const missing = missingInstructions(files, [stage], { [fileStage]: stageFiles })[0]?.missing;
  // A slot with no file assigned at all names its default key.
  return { ok: false, missing: missing?.length ? missing : [...REQUIRED_INSTRUCTION_FILES[stage]] };
}
