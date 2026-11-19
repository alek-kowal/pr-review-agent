import { describe, expect, it } from 'vitest';
import { stepperModel, type StageRow } from '../src/index.ts';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 19, 10, minute));
const row = (stage: string, overrides: Partial<StageRow> = {}): StageRow => ({
  stage,
  attempt: 1,
  status: 'succeeded',
  costUsd: 0,
  errorCode: null,
  startedAt: at(0),
  finishedAt: at(1),
  ...overrides,
});

describe('stepperModel', () => {
  it('at level 1 lists Checks, Task, Change type and Verify as off', () => {
    const model = stepperModel([row('review', { status: 'running', costUsd: 0.4 })], 1, 'full');
    expect(model.steps.map((s) => [s.key, s.status])).toEqual([
      ['checks', 'off'],
      ['task', 'off'],
      ['change_type', 'off'],
      ['review', 'running'],
      ['verify', 'off'],
    ]);
    expect(model.steps[0]!.offReason).toEqual({
      code: 'off_at_level',
      params: { stage: 'checks', level: 1, onFrom: 2 },
    });
    expect(model.current).toBe('review');
    expect(model.costUsd).toBe(0.4);
  });

  it('maps stored attempts to done, running, failed and queued, with cost per stage', () => {
    const model = stepperModel(
      [
        row('checks', { costUsd: 0 }),
        row('task', { costUsd: 0.1 }),
        row('change_type', { status: 'failed', errorCode: 'stage_timeout', costUsd: 0.2 }),
      ],
      3,
      'full',
    );
    expect(model.steps.map((s) => [s.key, s.status, s.costUsd])).toEqual([
      ['checks', 'done', 0],
      ['task', 'done', 0.1],
      ['change_type', 'failed', 0.2],
      ['review', 'queued', 0],
      ['verify', 'queued', 0],
    ]);
    expect(model.steps[2]!.errorCode).toBe('stage_timeout');
    expect(model.current).toBeNull();
  });

  it('shows the latest attempt and the cost of every attempt', () => {
    const model = stepperModel(
      [
        row('review', { attempt: 1, status: 'failed', errorCode: 'stage_timeout', costUsd: 0.3 }),
        row('review', { attempt: 2, status: 'running', costUsd: 0.05, finishedAt: null }),
      ],
      1,
      'full',
    );
    const review = model.steps.find((s) => s.key === 'review')!;
    expect(review).toMatchObject({ status: 'running', attempt: 2, errorCode: null, costUsd: 0.35 });
  });

  it('shows stages only from the run plan: a row for a stage the worker did not plan is not shown', () => {
    const model = stepperModel(
      [row('review'), row('implement'), row('verify', { status: 'succeeded' })],
      1,
      'full',
    );
    expect(model.steps.map((s) => s.key)).not.toContain('implement');
    expect(model.steps.find((s) => s.key === 'verify')!.status).toBe('off');
  });

  it('a fix check has its own stages', () => {
    const model = stepperModel([], 3, 'fix_check');
    expect(model.steps.every((s) => s.status === 'queued' || s.status === 'off')).toBe(true);
    expect(model.steps.map((s) => s.key)).not.toContain('task');
  });
});
