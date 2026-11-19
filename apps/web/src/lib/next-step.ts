// Turns core's Next step (reason codes) into copy, for the board and the PR page.
import { copy } from '@/copy/index.ts';
import type { StepContext } from '@/copy/nextStep.ts';
import type { AuthorView, NextStepView, ReasonView } from './api-types.ts';
import { reasonText, stageName } from './reasons.ts';

/** The author's Team name, else their GitHub login. */
export const authorName = (author: AuthorView): string => author.name ?? author.login;

/** A core actor by name; members are named from `names` (member id → name) when given. */
export function actorName(actor: unknown, names?: ReadonlyMap<string, string>): string {
  const a = actor as { kind?: string; memberId?: string } | null | undefined;
  if (a?.kind === 'bot') return copy.nextStep.bot;
  if (a?.kind === 'hand') return copy.nextStep.hand;
  if (a?.kind === 'member' && a.memberId) {
    return names?.get(a.memberId) ?? copy.nextStep.someone;
  }
  return copy.nextStep.someone;
}

export function stepContext(author: AuthorView, names?: ReadonlyMap<string, string>): StepContext {
  return {
    author: authorName(author),
    actor: (actor) => actorName(actor, names),
    stage: stageName,
    reason: reasonText,
  };
}

const line = (
  table: Record<string, ((p: Record<string, unknown>, c: StepContext) => string) | undefined>,
  reason: ReasonView,
  context: StepContext,
): string | undefined => table[reason.code]?.(reason.params, context);

/** The banner title ("Decide 3 findings"). */
export const bannerText = (step: NextStepView, context: StepContext): string =>
  line(copy.nextStep.banner, step.banner, context) ?? copy.nextStep.unknown(step.banner.code);

/** The board card's next step line: shorter than the banner where the banner is long. */
export const shortText = (step: NextStepView, context: StepContext): string =>
  line(copy.nextStep.short, step.banner, context) ?? bannerText(step, context);

/** Who usually acts ("usually Kasia (author)"); empty when nobody does. */
export const whoText = (step: NextStepView, context: StepContext): string =>
  line(copy.nextStep.who, step.who, context) ?? '';
