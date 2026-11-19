// Values the @pra/integrations global setup hands to tests through Vitest's `provide`/`inject`.
declare module 'vitest' {
  export interface ProvidedContext {
    /** This test run's id; every sandbox test container carries it (`sandboxTestLabels`). */
    sandboxTestSession: string;
    /** The Vitest process of this test run, `host:pid`: its containers outlive it only if killed. */
    sandboxTestOwner: string;
  }
}

export {};
