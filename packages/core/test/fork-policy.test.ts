// S-16-T1: the read-only run policy for fork PRs, built into the run plan.
import { describe, expect, test } from 'vitest';
import { planRun, runPolicy, stepOff } from '../src/index.ts';

const FORK_READ_ONLY = { code: 'fork_read_only', params: {} };

describe('runPolicy', () => {
  test('a fork refuses auto-start, install, scripts, implement, push and autofix', () => {
    expect(runPolicy({ fork: true })).toEqual({
      autoStart: false,
      install: false,
      scripts: false,
      implement: false,
      push: false,
      autofix: false,
    });
  });

  test('a PR from the repository itself allows all of them', () => {
    expect(Object.values(runPolicy({ fork: false })).every(Boolean)).toBe(true);
  });
});

describe('planRun on a fork', () => {
  test('a full round marks install (Checks) and reproductions (Verify) off with fork_read_only', () => {
    const plan = planRun({ kind: 'round', level: 3, fork: true });

    expect(plan.offSteps).toEqual([
      { stage: 'checks', step: 'install', reason: FORK_READ_ONLY },
      { stage: 'verify', step: 'reproductions', reason: FORK_READ_ONLY },
    ]);
    expect(stepOff(plan, 'checks', 'install')).toEqual(FORK_READ_ONLY);
    expect(stepOff(plan, 'verify', 'reproductions')).toEqual(FORK_READ_ONLY);
  });

  test('the stages themselves stay on: Checks still reads CI status, Verify judges from quotes', () => {
    const plan = planRun({ kind: 'round', level: 3, fork: true });
    const own = planRun({ kind: 'round', level: 3 });

    expect(plan.stages).toEqual(own.stages);
  });

  test('a stage the level turns off carries no off step', () => {
    const plan = planRun({ kind: 'round', level: 2, fork: true });

    expect(plan.stages.find((s) => s.key === 'verify')).toMatchObject({ status: 'off' });
    expect(plan.offSteps.map((off) => off.stage)).toEqual(['checks']);
  });

  test('a fix check turns its Reproductions stage off with fork_read_only', () => {
    const plan = planRun({ kind: 'round', level: 3, roundKind: 'fix_check', fork: true });

    expect(plan.stages.find((s) => s.key === 'reproductions')).toMatchObject({
      status: 'off',
      offReason: FORK_READ_ONLY,
    });
    expect(plan.offSteps).toEqual([{ stage: 'checks', step: 'install', reason: FORK_READ_ONLY }]);
  });

  test('a non-fork plan is unchanged: no off steps', () => {
    for (const roundKind of ['full', 'fix_check'] as const) {
      const plan = planRun({ kind: 'round', level: 4, roundKind });
      expect(plan.offSteps).toEqual([]);
      expect(planRun({ kind: 'round', level: 4, roundKind, fork: false })).toEqual(plan);
      expect(stepOff(plan, 'checks', 'install')).toBeNull();
    }
  });
});
