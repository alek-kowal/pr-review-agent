import { buildSections, sectionsSchema, type PrViewContext } from './section.ts';
import { latestRoundSection } from './sections/latest-round.ts';
import { pullRequestSection } from './sections/pull-request.ts';

/** The sections of `GET /api/prs/:repo/:number`. Add a section here (one line per package). */
export const PR_VIEW_SECTIONS = [pullRequestSection, latestRoundSection] as const;

export const PrViewSchema = sectionsSchema(PR_VIEW_SECTIONS);

export const buildPrView = (context: PrViewContext) => buildSections(PR_VIEW_SECTIONS, context);

export { defineSection, type PrViewContext, type PrViewSection } from './section.ts';
