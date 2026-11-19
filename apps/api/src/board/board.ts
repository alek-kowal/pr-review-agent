// The board: every PR in its lane, from core's state table.
import { actionNeededOrder, LANES, nextStep, type Lane } from '@pra/core';
import {
  activeAlertCountsByPr,
  boardPullRequestIds,
  listRepositories,
  loadPrStateInputs,
  type Executor,
} from '@pra/db';
import { z } from 'zod/v4';
import { ReasonSchema } from '../pr-view/round.ts';
import { AuthorSchema, authorView, NextStepSchema, nextStepView } from '../pr-view/state.ts';
import { cardBadges } from './card-badges.ts';

export const BoardCardSchema = z.object({
  repository: z.object({ slug: z.string() }),
  number: z.number().int(),
  title: z.string(),
  author: AuthorSchema,
  isDraft: z.boolean(),
  /** GitHub's open date; the web shows the age. */
  openedAt: z.iso.datetime({ offset: true }),
  nextStep: NextStepSchema,
  badges: z.array(ReasonSchema),
  /** Active alerts on this PR (S-18); the card shows one bell when it is above 0. */
  alertCount: z.number().int(),
});
export type BoardCard = z.output<typeof BoardCardSchema>;

const LaneSchema = z.object({ cards: z.array(BoardCardSchema) });

export const BoardResponse = z.object({
  lanes: z.object({
    /** Drafts are listed apart from the PRs never reviewed. */
    not_reviewed: LaneSchema.extend({ drafts: z.array(BoardCardSchema) }),
    agents_working: LaneSchema,
    action_needed: LaneSchema,
    ready_to_merge: LaneSchema,
  }),
  /** Merged or closed in the last 7 days. */
  mergedOrClosed: z.array(BoardCardSchema),
  /** Connected repositories; the web shows a card's repository only when there is more than one. */
  repositoryCount: z.number().int(),
});
export type Board = z.output<typeof BoardResponse>;

/**
 * Builds the board. Cards come most recently opened first; Action needed is sorted by what blocks
 * most (core `actionNeededOrder`), newest first inside each group.
 */
export async function buildBoard(db: Executor, now: Date = new Date()): Promise<Board> {
  const [ids, repositories] = await Promise.all([
    boardPullRequestIds(db, now),
    listRepositories(db),
  ]);
  const [loads, alertCounts] = await Promise.all([
    loadPrStateInputs(db, ids),
    activeAlertCountsByPr(db, ids),
  ]);

  const lanes = Object.fromEntries(LANES.map((lane) => [lane, [] as BoardCard[]])) as Record<
    Lane,
    BoardCard[]
  >;
  const drafts: BoardCard[] = [];
  const mergedOrClosed: BoardCard[] = [];

  for (const id of ids) {
    const load = loads.get(id);
    if (!load) continue;
    const step = nextStep(load.input);
    const card: BoardCard = {
      repository: { slug: load.repository.slug },
      number: load.pullRequest.number,
      title: load.pullRequest.title,
      author: authorView(load),
      isDraft: load.pullRequest.isDraft,
      openedAt: load.pullRequest.openedAt.toISOString(),
      nextStep: nextStepView(step),
      badges: cardBadges({ load, nextStep: step }),
      alertCount: alertCounts.get(load.pullRequest.id) ?? 0,
    };
    if (step.lane === null) mergedOrClosed.push(card);
    else if (step.state === 'draft') drafts.push(card);
    else lanes[step.lane].push(card);
  }

  // Array.prototype.sort is stable, so the newest-first order stays inside each group.
  lanes.action_needed.sort((a, b) => actionNeededOrder(a.nextStep.state, b.nextStep.state));

  return {
    lanes: {
      not_reviewed: { cards: lanes.not_reviewed, drafts },
      agents_working: { cards: lanes.agents_working },
      action_needed: { cards: lanes.action_needed },
      ready_to_merge: { cards: lanes.ready_to_merge },
    },
    mergedOrClosed,
    repositoryCount: repositories.length,
  };
}
