// S-05-T3: verdicts, quotes and the reproduction on the Findings tab, and Refuted findings
// leaving "to decide".
import { freezeLevel, resolveLevel } from '@pra/core';
import {
  closeDb,
  createDb,
  schema,
  upsertRepository,
  type FindingRow,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aRepositoryConfig, testDatabaseUrl } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PrViewSchema } from '../../src/pr-view/index.ts';
import { FindingsResponse } from '../../src/routes/api/prs/index.ts';
import { build } from '../helper.ts';
import { seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
afterAll(() => closeDb(db));

let app: FastifyInstance;
beforeEach(async () => {
  app = await build({ db });
});

let repository: Repository;
beforeAll(async () => {
  repository = await upsertRepository(db, aRepositoryConfig());
});

async function get(pr: PullRequest, path = '') {
  const response = await app.inject({
    url: `/api/prs/${repository.slug}/${pr.number}${path}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

const quote = { file: 'src/edges.ts', line: 3, quote: 'return edge.name.trim();' };

/** A level-3 round: a Confirmed and a Refuted Blocking finding, and a Not proven one. */
async function verifiedRound(): Promise<{ pr: PullRequest; findings: FindingRow[] }> {
  const pr = await seedPr(db, repository.id);
  const { run, findings } = await seedRound(db, pr, {
    run: { level: freezeLevel(resolveLevel(3)) },
    findings: [
      { severity: 'blocking', verdict: 'confirmed', evidence: [quote] },
      { severity: 'blocking', verdict: 'refuted' },
      { severity: 'worth_fixing', verdict: 'not_proven' },
    ],
  });
  const [confirmed, refuted, notProven] = findings as [FindingRow, FindingRow, FindingRow];
  await db.insert(schema.findingVerifications).values([
    {
      findingId: confirmed.id,
      runId: run.id,
      verdict: 'confirmed',
      reason: { code: 'repro_reproduced', params: { exitCode: 0 } },
      verifierVerdict: 'refuted',
      verifierReason: 'The name is trimmed before the check.',
      script: 'process.exit(0)',
      exitCode: 0,
      outputTail: 'label was empty',
      repaired: true,
      sandboxRuns: 2,
    },
    {
      findingId: refuted.id,
      runId: run.id,
      verdict: 'refuted',
      reason: { code: 'repro_not_reproduced', params: { exitCode: 3 } },
      verifierVerdict: 'refuted',
      verifierReason: 'The guard above returns early.',
      script: 'process.exit(3)',
      exitCode: 3,
      outputTail: '',
      sandboxRuns: 1,
    },
    {
      findingId: notProven.id,
      runId: run.id,
      verdict: 'not_proven',
      reason: { code: 'no_evidence', params: { findingId: notProven.id } },
      verifierVerdict: 'not_proven',
      verifierReason: 'Could not find the caller.',
    },
  ]);
  return { pr, findings };
}

describe('GET /api/prs/:repo/:number/findings with verdicts', () => {
  test('returns verdict, quotes and the reproduction; unchecked is null at level 3', async () => {
    const { pr } = await verifiedRound();
    const view = FindingsResponse.parse(await get(pr, '/findings'));
    expect(view.unchecked).toBeNull();
    const [confirmed, refuted, notProven] = view.findings;
    expect(confirmed).toMatchObject({
      verdict: 'confirmed',
      evidence: [quote],
      verification: {
        reason: { code: 'repro_reproduced' },
        verifierReason: 'The name is trimmed before the check.',
        reproduction: {
          exitCode: 0,
          timedOut: false,
          outputTail: 'label was empty',
          repaired: true,
        },
      },
      needsDecision: { needed: true },
    });
    expect(refuted).toMatchObject({
      verdict: 'refuted',
      verification: { reproduction: { exitCode: 3, repaired: false } },
      needsDecision: { needed: false, reason: { code: 'refuted' } },
    });
    expect(notProven).toMatchObject({
      verdict: 'not_proven',
      evidence: [],
      verification: { verifierReason: 'Could not find the caller.', reproduction: null },
    });
  });

  test('a Refuted Blocking finding is not counted in "Decide N findings"', async () => {
    const { pr } = await verifiedRound();
    const view = PrViewSchema.parse(await get(pr));
    expect(view.nextStep).toMatchObject({
      state: 'findings_to_decide',
      banner: { code: 'state_findings_to_decide', params: { count: 2 } },
    });
  });

  test('below level 3 every finding is unchecked and the count comes back', async () => {
    const pr = await seedPr(db, repository.id);
    await seedRound(db, pr, { findings: [{ severity: 'blocking' }, {}, {}] });
    const view = FindingsResponse.parse(await get(pr, '/findings'));
    expect(view.round?.level.number).toBe(1);
    expect(view.unchecked).toBe(3);
    expect(view.findings.every((f) => f.verdict === 'unchecked' && f.verification === null)).toBe(
      true,
    );
  });
});
