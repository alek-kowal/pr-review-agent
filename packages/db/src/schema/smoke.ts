import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Proves the migration tooling and the worker's `smoke` job (F-02). Product tables arrive with the
// slices that use them, each in its own file under `src/schema/`.
export const smoke = pgTable('smoke', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  note: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
