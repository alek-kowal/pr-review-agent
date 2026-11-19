// The PR's state from core's state table: the Next step and the merge checklist. The board and the
// PR page both build them from `loadPrStateInput`.
import {
  CHECKLIST_ITEMS,
  LANES,
  PR_STATES,
  type Checklist,
  type MainActionCode,
  type NextStep,
} from '@pra/core';
import { loadPrStateInput, type PrStateLoad } from '@pra/db';
import { z } from 'zod/v4';
import { ReasonSchema } from './round.ts';
import type { PrViewContext } from './section.ts';

const MAIN_ACTIONS = [
  'start_review',
  'resume',
  'cancel',
  'retry',
  'answer',
  'decide',
  'approve_sensitive',
  'implement_with_agent',
  'push',
  'merge',
] as const satisfies readonly MainActionCode[];

export const NextStepSchema = z.object({
  state: z.enum(PR_STATES),
  /** null when the PR left the board (merged or closed). */
  lane: z.enum(LANES).nullable(),
  tone: z.enum(['neutral', 'working', 'action', 'failed', 'ready']),
  banner: ReasonSchema,
  /** Who usually acts next. */
  who: ReasonSchema,
  mainAction: z
    .object({
      action: z.enum(MAIN_ACTIONS),
      signed: z.boolean(),
      optional: z.boolean(),
      disabled: ReasonSchema.nullable(),
      stage: z.string().nullable(),
    })
    .nullable(),
});

export const ChecklistSchema = z.object({
  ok: z.boolean(),
  items: z.array(
    z.object({ item: z.enum(CHECKLIST_ITEMS), ok: z.boolean(), reason: ReasonSchema }),
  ),
});

/** The PR author, and the Team member with their GitHub login (for "Kasia (author)"). */
export const AuthorSchema = z.object({
  login: z.string(),
  memberId: z.string().nullable(),
  name: z.string().nullable(),
});

export const nextStepView = (step: NextStep): z.output<typeof NextStepSchema> => step;
export const checklistView = (list: Checklist): z.output<typeof ChecklistSchema> => list;

export function authorView(load: PrStateLoad): z.output<typeof AuthorSchema> {
  return {
    login: load.pullRequest.authorLogin,
    memberId: load.authorMember?.id ?? null,
    name: load.authorMember?.name ?? null,
  };
}

const loads = new WeakMap<PrViewContext, Promise<PrStateLoad>>();

/** The state input of the context's PR, loaded once per PR view however many sections read it. */
export function prStateOf(context: PrViewContext): Promise<PrStateLoad> {
  let load = loads.get(context);
  if (!load) {
    load = loadPrStateInput(context.db, context.pullRequest.id).then((loaded) => {
      if (!loaded) throw new Error(`pull request ${context.pullRequest.id} disappeared`);
      return loaded;
    });
    loads.set(context, load);
  }
  return load;
}
