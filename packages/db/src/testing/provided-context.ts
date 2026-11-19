// Values the db global setup hands to tests through Vitest's `provide`/`inject`.
declare module 'vitest' {
  export interface ProvidedContext {
    /** URL of this test run's own, migrated database. */
    databaseUrl: string;
  }
}

export {};
