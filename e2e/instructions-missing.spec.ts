// INSTR: a round whose required instruction files are missing stops before its first stage,
// before any agent session, and says which files are missing and where to add them.
// `NO_VERIFIER_REPOSITORY` (level 3) holds empty repository copies of the verifier's files.
import { expect, test } from '@playwright/test';
import { bannerTitle, onPrPage, sql } from './support/api.ts';
import { NO_VERIFIER_PRS, NO_VERIFIER_REPOSITORY } from './support/env.ts';
import { deliverPullRequest } from './support/github.ts';

const { slug } = NO_VERIFIER_REPOSITORY;
const MISSING = 'prompt-verifier.md and verify-rules.md are missing';

/** Agent sessions recorded for PR `number`: none means no agent was called. */
async function agentSessions(number: number): Promise<number> {
  const [row] = await sql<{ n: number }>(
    `select count(*)::int as n from agent_sessions s
       join stage_executions e on e.id = s.stage_execution_id
       join runs r on r.id = e.run_id
       join pull_requests p on p.id = r.pull_request_id
       join repositories repo on repo.id = p.repository_id
     where repo.slug = $1 and p.number = $2`,
    [slug, number],
  );
  return row!.n;
}

test('missing verifier files fail the round at its start, before any agent session', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const number = NO_VERIFIER_PRS.from + testInfo.retry;
  await deliverPullRequest(
    request,
    'ready_for_review',
    number,
    `No verifier ${number}`,
    NO_VERIFIER_REPOSITORY,
  );

  await onPrPage(
    page,
    number,
    async () => {
      await expect(bannerTitle(page)).toContainText('Round 1 failed at Checks', {
        timeout: 5_000,
      });
    },
    slug,
  );
  await expect(bannerTitle(page)).toContainText(MISSING);
  await expect(bannerTitle(page)).toContainText('Settings → Instructions');
  const progress = page.getByTestId('round-progress');
  await expect(progress).toHaveAttribute('data-round-status', 'failed');
  await expect(progress).toContainText(MISSING);
  expect(await agentSessions(number)).toBe(0);
});
