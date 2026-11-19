import { describe, expect, it } from 'vitest';
import {
  HAND,
  canImplementWithAgent,
  member,
  nextStep,
  patchReproductions,
  prState,
  type ActiveRun,
  type Patch,
} from '../src/index.ts';
import { makeFinding, makePr } from './builders.ts';

const implementOpen = (id: string) => makeFinding({ id, decision: 'implement' });
const running = (overrides: Partial<ActiveRun> = {}): ActiveRun => ({
  kind: 'implementer',
  status: 'running',
  roundKind: null,
  trigger: 'manual',
  startedBy: member('kasia'),
  roundNumber: null,
  fixSha: null,
  retryFrom: null,
  queue: null,
  ...overrides,
});

describe('canImplementWithAgent', () => {
  it('allows level 4 with open Implement findings, and lists them', () => {
    const findings = [implementOpen('a'), makeFinding({ id: 'b', decision: 'reject' })];
    expect(canImplementWithAgent(makePr({ level: 4 }), findings)).toEqual({
      allowed: true,
      findingIds: ['a'],
    });
  });

  it('refuses below level 4 with implement_below_level', () => {
    const gate = canImplementWithAgent(makePr({ level: 3 }), [implementOpen('a')]);
    expect(gate).toEqual({
      allowed: false,
      reason: { code: 'implement_below_level', params: { level: 3, need: 4 } },
    });
  });

  it('refuses without open Implement decisions with no_implement_decisions', () => {
    const resolved = makeFinding({ id: 'a', decision: 'implement', resolved: true });
    const gate = canImplementWithAgent(makePr({ level: 4 }), [resolved]);
    expect(gate).toEqual({
      allowed: false,
      reason: { code: 'no_implement_decisions', params: {} },
    });
  });

  it('refuses while a run is active with run_active', () => {
    const pr = makePr({ level: 4, activeRun: running({ kind: 'round', status: 'queued' }) });
    expect(canImplementWithAgent(pr, [implementOpen('a')])).toEqual({
      allowed: false,
      reason: { code: 'run_active', params: { kind: 'round', status: 'queued' } },
    });
  });

  it('refuses a fork with fork_read_only, before the level', () => {
    const gate = canImplementWithAgent(makePr({ level: 2, fork: true }), [implementOpen('a')]);
    expect(gate).toEqual({ allowed: false, reason: { code: 'fork_read_only', params: {} } });
  });
});

describe('state table rows from implementer runs and patches', () => {
  it('a running implementer run gives Fixing', () => {
    const pr = makePr({ level: 4, findings: [implementOpen('a')], activeRun: running() });
    expect(prState(pr)).toBe('fixing');
    expect(nextStep(pr).banner).toEqual({
      code: 'state_fixing',
      params: { count: 1, startedBy: member('kasia') },
    });
  });

  const patch = (status: Patch['status']): Patch => ({
    status,
    fixed: 2,
    total: 2,
    reproductionsPass: true,
    waiting: null,
  });

  it('a ready patch gives Patch ready', () => {
    const pr = makePr({ level: 4, findings: [implementOpen('a')], patch: patch('ready') });
    expect(prState(pr)).toBe('patch_ready');
  });

  it('a superseded patch does not give Patch ready', () => {
    const pr = makePr({ level: 4, findings: [implementOpen('a')], patch: patch('superseded') });
    expect(prState(pr)).toBe('waiting_for_fix');
  });

  it('Waiting for the fix disables Implement with agent on a fork', () => {
    const pr = makePr({ fork: true, level: 4, findings: [implementOpen('a')] });
    expect(nextStep(pr).mainAction?.disabled).toEqual({ code: 'fork_read_only', params: {} });
  });

  it('a manual implementer run keeps its signer', () => {
    const pr = makePr({
      level: 4,
      findings: [implementOpen('a')],
      activeRun: running({ startedBy: HAND }),
    });
    expect(prState(pr)).toBe('fixing');
  });
});

describe('patchReproductions', () => {
  it('fails on any fail, passes on any pass, else not run', () => {
    expect(patchReproductions(['pass', 'fail'])).toBe('fail');
    expect(patchReproductions(['pass', 'not_run'])).toBe('pass');
    expect(patchReproductions(['not_run'])).toBe('not_run');
    expect(patchReproductions([])).toBe('not_run');
  });
});
