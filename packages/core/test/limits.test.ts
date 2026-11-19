import { describe, expect, it } from 'vitest';
import {
  CHANGE_TYPE_LIMITS,
  enforce,
  limitsFor,
  matchGlob,
  matchSensitiveFiles,
  skipVerification,
  type Severity,
} from '../src/index.ts';
import { WB_SENSITIVE_PATTERNS } from './fixtures/wb-config.ts';

const f = (id: string, severity: Severity) => ({ id, severity });
const ALL: Severity[] = ['blocking', 'worth_fixing', 'nit'];

describe('review limits', () => {
  it('drops the severities the limits disallow and counts them (P classify.test.ts:136)', () => {
    const out = enforce(
      { findings: [f('a', 'nit'), f('b', 'blocking'), f('c', 'nit')], questions: [] },
      { maxFindings: 7, maxQuestions: 3, severities: ['blocking', 'worth_fixing'] },
    );
    expect(out.findings.map((x) => x.id)).toEqual(['b']);
    expect(out.dropped).toEqual({ severity: 2, overLimit: 0, questions: 0 });
    expect(out.reasons).toEqual([
      { code: 'severity_not_allowed', params: { severity: 'nit', dropped: 2 } },
    ]);
  });

  it('cuts to maxFindings from the least severe end, keeping the reviewer order (P classify.test.ts:144)', () => {
    const findings = [
      f('n1', 'nit'),
      f('w1', 'worth_fixing'),
      f('b1', 'blocking'),
      f('w2', 'worth_fixing'),
      f('b2', 'blocking'),
    ];
    const out = enforce(
      { findings, questions: [] },
      { maxFindings: 3, maxQuestions: 0, severities: ALL },
    );
    expect(out.findings.map((x) => x.id)).toEqual(['w1', 'b1', 'b2']);
    expect(out.dropped.overLimit).toBe(2);
    expect(out.reasons).toEqual([{ code: 'over_max_findings', params: { max: 3, dropped: 2 } }]);
  });

  it('drops the questions the limits disallow (P classify.test.ts:152)', () => {
    const none = enforce(
      { findings: [], questions: ['q1', 'q2'] },
      { maxFindings: 4, maxQuestions: 0, severities: ALL },
    );
    expect(none.questions).toEqual([]);
    expect(none.reasons).toEqual([{ code: 'questions_not_allowed', params: { dropped: 2 } }]);

    const one = enforce(
      { findings: [], questions: ['q1', 'q2', 'q3'] },
      { maxFindings: 4, maxQuestions: 1, severities: ALL },
    );
    expect(one.questions).toEqual(['q1']);
    expect(one.reasons).toEqual([{ code: 'over_max_questions', params: { max: 1, dropped: 2 } }]);
  });

  it('skips verification where the change type turns it off (P classify.test.ts:159)', () => {
    expect(skipVerification('uses_existing', CHANGE_TYPE_LIMITS.uses_existing)).toEqual({
      skip: true,
      reason: { code: 'verify_off_for_change_type', params: { changeType: 'uses_existing' } },
    });
    expect(skipVerification('one_way_door', CHANGE_TYPE_LIMITS.one_way_door).skip).toBe(false);
    expect(skipVerification(null, CHANGE_TYPE_LIMITS.none).reason.code).toBe('verify_on');
  });

  it('matches sensitive files against the repository patterns (P review.test.ts:72)', () => {
    const files = [
      'packages/sdk/src/index.ts',
      'packages/sdk/src/edges/edge.ts',
      'packages/ui/package.json',
      'apps/backend/drizzle/0007_add_runs.sql',
      '.claude/commands/review.md',
      'docs/CLAUDE.md',
    ];
    expect(matchSensitiveFiles(files, WB_SENSITIVE_PATTERNS)).toEqual([
      {
        path: 'packages/sdk/src/index.ts',
        pattern: 'packages/(sdk|ui|temporal)/src/index.ts',
        reason: 'Public exports: the published API of a package.',
      },
      {
        path: 'packages/ui/package.json',
        pattern: 'packages/*/package.json',
        reason: 'Package manifests of published packages.',
      },
      {
        path: 'apps/backend/drizzle/0007_add_runs.sql',
        pattern: 'apps/backend/drizzle/',
        reason: 'Database migrations cannot be undone after deploy.',
      },
      {
        path: '.claude/commands/review.md',
        pattern: '.claude/',
        reason: 'Agent commands and settings.',
      },
      {
        path: 'docs/CLAUDE.md',
        pattern: 'CLAUDE.md',
        reason: 'Instructions that agents follow in this repository.',
      },
    ]);
  });

  it('a level narrows only the fields it sets (P levels.test.ts:83)', () => {
    expect(limitsFor({ maxFindings: 4, maxQuestions: 0 }, 'changes_behaviour')).toEqual({
      maxFindings: 4,
      maxQuestions: 0,
      severities: ALL,
      verify: true,
    });
    // The level sets nothing: the change type's caps stand.
    expect(limitsFor({}, 'uses_existing')).toEqual(CHANGE_TYPE_LIMITS.uses_existing);
    // A level never widens the change type's caps.
    expect(limitsFor({ maxFindings: 7 }, 'uses_existing').maxFindings).toBe(3);
    expect(limitsFor({ severities: ['blocking'] }, 'uses_existing').severities).toEqual([
      'blocking',
    ]);
  });

  it('clamps maxFindings: 9 to 7', () => {
    const findings = Array.from({ length: 9 }, (_, i) => f(`w${i}`, 'worth_fixing'));
    const out = enforce(
      { findings, questions: [] },
      { maxFindings: 9, maxQuestions: 3, severities: ALL },
    );
    expect(out.findings).toHaveLength(7);
    expect(out.reasons).toEqual([
      { code: 'max_findings_clamped', params: { requested: 9, max: 7 } },
      { code: 'over_max_findings', params: { max: 7, dropped: 2 } },
    ]);
  });
});

describe('glob patterns', () => {
  it.each([
    ['apps/docs/**', 'apps/docs/guide/a.md', true],
    ['apps/docs/**', 'apps/web/docs/a.md', false],
    ['**/*.md', 'README.md', true],
    ['**/*.md', 'a/b/c.md', true],
    ['**/*.test.{ts,tsx}', 'src/a.test.tsx', true],
    ['**/*.test.{ts,tsx}', 'src/a.test.js', false],
    ['packages/*/src/index.ts', 'packages/ui/src/index.ts', true],
    ['packages/*/src/index.ts', 'packages/ui/src/a/index.ts', false],
    ['deploy/', 'deploy/app.yaml', true],
    ['deploy/', 'apps/x/deploy/app.yaml', true],
    ['deploy/', 'deployment.md', false],
    ['/deploy/', 'apps/x/deploy/app.yaml', false],
    ['CLAUDE.md', 'CLAUDE.md', true],
    ['CLAUDE.md', 'NOT_CLAUDE.md', false],
    ['src/*.ts', 'src/a.ts', true],
    ['src/?.ts', 'src/ab.ts', false],
  ])('%s against %s is %s', (pattern, path, expected) => {
    expect(matchGlob(path, pattern)).toBe(expected);
  });
});
