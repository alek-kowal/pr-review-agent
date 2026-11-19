import { buildSections, sectionsSchema, type PrViewContext } from './section.ts';
import { alertsSection } from './sections/alerts.ts';
import { checksSection } from './sections/checks.ts';
import { headSection } from './sections/head.ts';
import { latestRoundSection } from './sections/latest-round.ts';
import { learningSection } from './sections/learning.ts';
import { authorSection, checklistSection, nextStepSection } from './sections/next-step.ts';
import { pullRequestSection } from './sections/pull-request.ts';
import { roundProgressSection } from './sections/round-progress.ts';
import { sensitiveSection } from './sections/sensitive.ts';
import { taskSection } from './sections/task.ts';

/** The sections of `GET /api/prs/:repo/:number`. Add a section here (one line per package). */
export const PR_VIEW_SECTIONS = [
  pullRequestSection,
  latestRoundSection,
  nextStepSection,
  checklistSection,
  authorSection,
  headSection,
  sensitiveSection,
  roundProgressSection,
  taskSection,
  checksSection,
  learningSection,
  alertsSection,
] as const;

export const PrViewSchema = sectionsSchema(PR_VIEW_SECTIONS);

export const buildPrView = (context: PrViewContext) => buildSections(PR_VIEW_SECTIONS, context);

export { defineSection, type PrViewContext, type PrViewSection } from './section.ts';
