// S-09-T3: one AbortController per run whose stage runs in this process (in `WorkerDeps`). Kept
// apart from `cancel.ts` so `deps.ts` imports nothing that imports the stage runner.

/** The abort reason a cancelled stage sees on its signal (core `STAGE_ERROR.cancelled`). */
export const CANCELLED = 'cancelled';

export class RunCancellation {
  private readonly controllers = new Map<number, AbortController>();

  /** Registers the run's in-flight stage; `release` it once the stage is stored. */
  register(runId: number): AbortController {
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    return controller;
  }

  release(runId: number, controller: AbortController): void {
    if (this.controllers.get(runId) === controller) this.controllers.delete(runId);
  }

  /** Aborts the run's in-flight stage; false when none runs in this process. */
  abort(runId: number): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    if (!controller.signal.aborted) controller.abort(new Error(CANCELLED));
    return true;
  }
}
