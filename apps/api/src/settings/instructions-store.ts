import { diffSummary, lineDiff } from '@pra/core';
import {
  activateInstructionVersion,
  findInstructionVersion,
  getInstructionFile,
  lockActiveInstructionVersion,
} from '@pra/db';
import type { SettingsStore } from './signed-change.ts';

/**
 * An instruction file's activation as the settings log records it: which version is active. The
 * stored `after` adds the diff summary against the version it replaced.
 */
export type InstructionActivation = {
  fileKey: string;
  version: number | null;
  added?: number;
  removed?: number;
};

/**
 * Instructions in Settings (S-22-T4): one entity per instruction file, keyed by its id, valued by
 * its active version number. Writing a version number activates it (a draft) or re-activates it
 * (a rollback) and archives the version that was active.
 */
export function instructionsStore(signerId: string | null): SettingsStore<InstructionActivation> {
  return {
    area: 'instructions',
    async read(tx, entity) {
      const file = await getInstructionFile(tx, Number(entity));
      if (!file) return null;
      const active = await lockActiveInstructionVersion(tx, file.id);
      return { fileKey: file.fileKey, version: active?.version ?? null };
    },
    async write(tx, entity, after) {
      if (after?.version == null) throw new Error('an instruction file cannot be deactivated');
      const fileId = Number(entity);
      const previous = await lockActiveInstructionVersion(tx, fileId);
      const target = await findInstructionVersion(tx, fileId, after.version);
      if (!target) throw new Error(`instruction file ${entity} has no version ${after.version}`);
      // A draft discarded since `findInstructionVersion` is gone: roll back, log nothing.
      const activated = await activateInstructionVersion(tx, target.id, signerId);
      if (!activated) throw new Error(`instruction version ${target.id} no longer exists`);
      const diff = diffSummary(lineDiff(previous?.content ?? '', target.content));
      return { entity, value: { fileKey: after.fileKey, version: target.version, ...diff } };
    },
  };
}
