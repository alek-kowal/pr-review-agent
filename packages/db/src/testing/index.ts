import { inject } from 'vitest';
import './provided-context.ts';

export {
  createTestDatabase,
  LOCAL_DATABASE_URL,
  type TestDatabase,
  withDatabase,
} from './test-database.ts';

/** This test run's own migrated database (needs the `@pra/db/testing/global-setup` global setup). */
export function testDatabaseUrl(): string {
  return inject('databaseUrl');
}
