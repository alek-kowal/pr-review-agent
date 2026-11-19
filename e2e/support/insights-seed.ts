// S-19-T8: a finished-PR history for insights.spec.ts. Two repositories of their own, so the
// other specs' PRs never change the counts: 17 merged PRs in one (5 by ola, 12 by kuba) and 3 in
// the other. They finished 8 to 12 days ago: inside a 14-day range, outside the board's 7 days.
import { upsertRepository, type Db } from '@pra/db';
import { seedPrHistory, type SeededFinding } from '@pra/db/testing';
import { INSIGHTS_MAIN, INSIGHTS_SIDE } from './env.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const findings: SeededFinding[] = [
  { severity: 'blocking', verdict: 'confirmed', decision: 'implement' },
  { severity: 'worth_fixing', verdict: 'refuted', decision: 'reject' },
  { severity: 'nit', verdict: 'not_proven' },
];

export async function seedInsightsHistory(db: Db): Promise<void> {
  const main = await upsertRepository(db, {
    slug: INSIGHTS_MAIN.slug,
    githubFullName: INSIGHTS_MAIN.fullName,
    defaultLevel: 3,
  });
  const side = await upsertRepository(db, {
    slug: INSIGHTS_SIDE.slug,
    githubFullName: INSIGHTS_SIDE.fullName,
    defaultLevel: 1,
  });
  const start = Date.now() - 12 * DAY;
  const pr = async (repositoryId: number, i: number, author: string, levelNumber: 1 | 3) => {
    const readyMs = start + i * 6 * 60 * MINUTE;
    const at = (minutes: number) => new Date(readyMs + minutes * MINUTE);
    const first = repositoryId === main.id && i === 0;
    await seedPrHistory(db, {
      repositoryId,
      number: 9000 + repositoryId * 100 + i,
      title: `Insights: seeded change ${i + 1}`,
      authorLogin: author,
      readyAt: at(0),
      finishedAt: at(240),
      runs: [
        { levelNumber, startedAt: at(2), minutes: 12, costUsd: 0.4 + i * 0.05, findings },
        ...(first
          ? [
              { kind: 'trial' as const, levelNumber, startedAt: at(30), costUsd: 2 },
              { kind: 'analyst' as const, levelNumber, startedAt: at(241), costUsd: 1.5 },
            ]
          : []),
      ],
      states: [
        { state: 'queued', at: at(0) },
        { state: 'findings_to_decide', at: at(20) },
        { state: 'ready_to_merge', at: at(150) },
        { state: 'merged', at: at(240) },
      ],
    });
  };
  for (let i = 0; i < 17; i++) await pr(main.id, i, i < 5 ? 'ola' : 'kuba', 3);
  for (let i = 0; i < 3; i++) await pr(side.id, i, 'ola', 1);
}
