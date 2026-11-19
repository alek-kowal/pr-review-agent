// Round fixtures for the stepper and round line tests: running, failed, finished and level 1.
import type { PrView, RoundProgressView, RoundStepView, RoundView } from '@/lib/api-types.ts';
import { aPrView, aRound } from '@/test/fixtures.ts';

export const aStep = (over: Partial<RoundStepView> & { key: string }): RoundStepView => ({
  status: 'queued',
  costUsd: 0,
  errorCode: null,
  offReason: null,
  startedAt: null,
  finishedAt: null,
  ...over,
});

const label = (over: Record<string, unknown> = {}) => ({
  code: 'round_label',
  params: {
    roundNumber: 1,
    max: 3,
    trigger: 'manual',
    startedBy: { kind: 'hand' },
    fixSha: null,
    newChain: false,
    ...over,
  },
});

const at = (minute: number) => `2026-11-19T14:${String(minute).padStart(2, '0')}:00.000Z`;

export function roundFixture(
  kind: 'running' | 'failed' | 'finished' | 'level1',
  over: { costUsd?: number; current?: string } = {},
): PrView {
  const level2: RoundStepView[] = [
    aStep({ key: 'checks', status: 'done', startedAt: at(0), finishedAt: at(1) }),
    aStep({ key: 'task', status: 'done', costUsd: 0.02, startedAt: at(1), finishedAt: at(1) }),
    aStep({ key: 'change_type', status: 'done', startedAt: at(1), finishedAt: at(2) }),
    aStep({ key: 'review', status: 'queued' }),
    aStep({
      key: 'verify',
      status: 'off',
      offReason: { code: 'off_at_level', params: { level: 2 } },
    }),
  ];
  let round: Partial<RoundView>;
  let progress: Partial<RoundProgressView>;
  switch (kind) {
    case 'running': {
      const current = over.current ?? 'review';
      const costUsd = over.costUsd ?? 0.42;
      const steps = level2.map((s) =>
        s.key === current
          ? { ...s, status: 'running' as const, startedAt: at(2), costUsd: costUsd - 0.02 }
          : s,
      );
      round = { status: 'running', finishedAt: null, level: { number: 2, key: 'context' } };
      progress = { steps, current, costUsd };
      break;
    }
    case 'failed': {
      const steps = level2.map((s) =>
        s.key === 'review'
          ? { ...s, status: 'failed' as const, errorCode: 'stage_timeout', costUsd: 1.1 }
          : s,
      );
      round = {
        status: 'failed',
        finishedAt: at(32),
        level: { number: 2, key: 'context' },
        error: { stage: 'review', code: 'stage_timeout' },
      };
      progress = { steps, current: null, costUsd: 1.12 };
      break;
    }
    case 'finished': {
      const steps = level2.map((s) =>
        s.key === 'review'
          ? { ...s, status: 'done' as const, costUsd: 1.82, startedAt: at(2), finishedAt: at(9) }
          : s,
      );
      round = { status: 'completed', finishedAt: at(10), level: { number: 2, key: 'context' } };
      progress = { steps, current: null, costUsd: 1.84 };
      break;
    }
    case 'level1': {
      const off = (key: string) =>
        aStep({ key, status: 'off', offReason: { code: 'off_at_level', params: { level: 1 } } });
      const steps = [
        off('checks'),
        off('task'),
        off('change_type'),
        aStep({ key: 'review', status: 'running', startedAt: at(0), costUsd: 0.1 }),
        off('verify'),
      ];
      round = { status: 'running', finishedAt: null, level: { number: 1, key: 'review' } };
      progress = { steps, current: 'review', costUsd: 0.1 };
      break;
    }
  }
  return aPrView({
    round: aRound({ id: 31, ...round }),
    roundProgress: {
      runId: 31,
      label: label(),
      steps: [],
      current: null,
      costUsd: 0,
      ...progress,
    },
  });
}
