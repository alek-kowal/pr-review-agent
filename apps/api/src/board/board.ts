// The board: every PR in its lane, from core's state table.
import {
  byUrgency,
  LANES,
  LEVEL_NUMBERS,
  MAX_CHAIN_ROUNDS,
  nextStep,
  type Lane,
  type LevelNumber,
} from '@pra/core';
import {
  boardPullRequestIds,
  listRepositories,
  loadPrStateInputs,
  readRepositoryConfig,
  type Executor,
} from '@pra/db';
import { z } from 'zod/v4';
import { ReasonSchema } from '../pr-view/round.ts';
import { AuthorSchema, authorView, NextStepSchema, nextStepView } from '../pr-view/state.ts';
import { cardBadges } from './card-badges.ts';

const Level = z.union(LEVEL_NUMBERS.map((n) => z.literal(n)));

export const BoardCardSchema = z.object({
  repository: z.object({ slug: z.string() }),
  number: z.number().int(),
  title: z.string(),
  author: AuthorSchema,
  isDraft: z.boolean(),
  isFork: z.boolean(),
  /** GitHub's open date; the web shows the age. */
  openedAt: z.iso.datetime({ offset: true }),
  /** The level the next round starts at; the card shows it only when it is not the default. */
  level: z.object({ number: Level, repositoryDefault: Level }),
  /** Completed rounds of the current chain; the card shows them from round 2 on. */
  round: z.object({ number: z.number().int().nonnegative(), max: z.number().int() }),
  nextStep: NextStepSchema,
  badges: z.array(ReasonSchema),
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

const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * The board filters (S-17-T3), the same names as the web's page address. `person` is a Team
 * member's GitHub login: the PRs they authored or signed anything on.
 */
export const BoardQuery = z.object({
  person: z.string().regex(GITHUB_LOGIN).optional(),
  repo: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  forks: z.enum(['hide', 'only']).optional(),
  level: z
    .enum(LEVEL_NUMBERS.map(String) as [string, ...string[]])
    .transform((n) => Number(n) as LevelNumber)
    .optional(),
  drafts: z.literal('hide').optional(),
});
export type BoardQuery = z.output<typeof BoardQuery>;

/**
 * Builds the board. Cards come most recently opened first; Action needed is sorted by urgency
 * (core `byUrgency`: FR-008 order, then the longest waiting first).
 */
export async function buildBoard(
  db: Executor,
  now: Date = new Date(),
  query: BoardQuery = {},
): Promise<Board> {
  const { level, ...filter } = query;
  const [ids, repositories] = await Promise.all([
    boardPullRequestIds(db, now, filter),
    listRepositories(db),
  ]);
  const loads = await loadPrStateInputs(db, ids);

  const lanes = Object.fromEntries(LANES.map((lane) => [lane, [] as BoardCard[]])) as Record<
    Lane,
    BoardCard[]
  >;
  const drafts: BoardCard[] = [];
  const mergedOrClosed: BoardCard[] = [];

  for (const id of ids) {
    const load = loads.get(id);
    if (!load) continue;
    // The level a PR shows is the one its next round starts at, so the filter reads the same.
    if (level !== undefined && load.input.level !== level) continue;
    const step = nextStep(load.input);
    const card: BoardCard = {
      repository: { slug: load.repository.slug },
      number: load.pullRequest.number,
      title: load.pullRequest.title,
      author: authorView(load),
      isDraft: load.pullRequest.isDraft,
      isFork: load.pullRequest.isFork,
      openedAt: load.pullRequest.openedAt.toISOString(),
      level: {
        number: load.input.level as LevelNumber,
        repositoryDefault: readRepositoryConfig(load.repository).value.defaultLevel,
      },
      round: { number: load.input.chainRounds, max: MAX_CHAIN_ROUNDS },
      nextStep: nextStepView(step),
      badges: cardBadges({ load, nextStep: step }),
    };
    if (step.lane === null) mergedOrClosed.push(card);
    else if (step.state === 'draft') drafts.push(card);
    else lanes[step.lane].push(card);
  }

  lanes.action_needed.sort((a, b) =>
    byUrgency(
      { state: a.nextStep.state, openedAt: a.openedAt },
      { state: b.nextStep.state, openedAt: b.openedAt },
    ),
  );

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
