import type { RepositoryConfig } from '@pra/core';
import {
  insertRepository,
  lockRepository,
  readRepositoryConfig,
  updateRepositoryConfig,
} from '@pra/db';
import { NEW_ENTITY, type SettingsStore } from './signed-change.ts';

/**
 * Repositories in Settings: one entity per repository, keyed by its id, valued by its whole
 * config. A create connects the repository with the App installation that reaches it; slug and
 * full name never change after that. Disconnecting is not part of Settings yet.
 */
export function repositoryStore(
  options: { installationId?: number | null } = {},
): SettingsStore<RepositoryConfig> {
  return {
    area: 'repositories',
    async read(tx, entity) {
      if (entity === NEW_ENTITY) return null;
      const repository = await lockRepository(tx, Number(entity));
      return repository ? readRepositoryConfig(repository).value : null;
    },
    async write(tx, entity, after) {
      if (after === null) throw new Error('disconnecting a repository is not supported');
      const repository =
        entity === NEW_ENTITY
          ? await insertRepository(tx, after, options.installationId ?? null)
          : await updateRepositoryConfig(tx, Number(entity), after);
      if (!repository) throw new Error(`repository ${entity} not found`);
      return { entity: String(repository.id), value: readRepositoryConfig(repository).value };
    },
  };
}
