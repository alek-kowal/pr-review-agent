import { checklist, nextStep } from '@pra/core';
import { defineSection } from '../section.ts';
import {
  AuthorSchema,
  authorView,
  ChecklistSchema,
  checklistView,
  NextStepSchema,
  nextStepView,
  prStateOf,
} from '../state.ts';

/** What is needed next, who usually does it, and the one main action (FR-057). */
export const nextStepSection = defineSection({
  key: 'nextStep',
  schema: NextStepSchema,
  async build(context) {
    return nextStepView(nextStep((await prStateOf(context)).input));
  },
});

/** The merge checklist: each item, whether it passes and why. */
export const checklistSection = defineSection({
  key: 'checklist',
  schema: ChecklistSchema,
  async build(context) {
    return checklistView(checklist((await prStateOf(context)).input));
  },
});

/** The PR author and the Team member with their GitHub login. */
export const authorSection = defineSection({
  key: 'author',
  schema: AuthorSchema,
  async build(context) {
    return authorView(await prStateOf(context));
  },
});
