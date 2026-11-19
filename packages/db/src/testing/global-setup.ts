// Vitest global setup for every project that touches Postgres: one migrated database per test
// run and project, dropped at the end. Tests read its URL with `testDatabaseUrl()`.
import type { TestProject } from 'vitest/node';
import './provided-context.ts';
import { createTestDatabase } from './test-database.ts';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = await createTestDatabase();
  project.provide('databaseUrl', database.url);
  return database.drop;
}
