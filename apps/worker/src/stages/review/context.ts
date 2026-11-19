// Reviewer context providers (P-05 extension point): each adds sections to the reviewer's brief.
// P-09 adds the ClickUp task, P-14 the team's answers from earlier rounds. Register a provider by
// adding it to the list.
import type { StageContext } from '../stage.ts';
import type { BriefSection } from './brief.ts';
import { taskContextProvider } from './task-context.ts';

export type ReviewerContextProvider = {
  key: string;
  sections: (context: StageContext) => Promise<BriefSection[]>;
};

export const REVIEWER_CONTEXT_PROVIDERS: readonly ReviewerContextProvider[] = [taskContextProvider];
