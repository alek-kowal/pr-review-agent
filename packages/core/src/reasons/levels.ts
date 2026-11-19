import type { LevelNumber } from '../vocabulary.ts';

declare module '../reason.ts' {
  interface ReasonParams {
    /** The stage is off at this level; it turns on from level `onFrom`. */
    off_at_level: { stage: string; level: LevelNumber; onFrom: LevelNumber };
    /** The run's model for a role fails the model-name check; the run fails before any spend. */
    model_invalid: { role: string; model: string };
  }
}
