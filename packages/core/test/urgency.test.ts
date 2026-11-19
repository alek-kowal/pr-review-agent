import { describe, expect, it } from 'vitest';
import { actionNeededRank, byUrgency, PR_STATES, type PrState } from '../src/index.ts';

const FR_008_ORDER: PrState[] = [
  'stage_failed',
  'questions_waiting',
  'findings_to_decide',
  'sensitive_files',
  'patch_ready',
  'waiting_for_fix',
  'new_commits',
  'rounds_used',
];

describe('actionNeededRank', () => {
  it('ranks the Action needed states in the FR-008 order', () => {
    expect(FR_008_ORDER.map(actionNeededRank)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('ranks every other state after them', () => {
    for (const state of PR_STATES.filter((s) => !FR_008_ORDER.includes(s))) {
      expect(actionNeededRank(state)).toBe(FR_008_ORDER.length);
    }
  });
});

describe('byUrgency', () => {
  it('sorts a shuffled lane into the full order', () => {
    const at = '2026-11-01T10:00:00Z';
    const shuffled = [...FR_008_ORDER].reverse().map((state) => ({ state, openedAt: at }));
    expect(shuffled.sort(byUrgency).map((item) => item.state)).toEqual(FR_008_ORDER);
  });

  it('breaks a tie by age: the PR opened first comes first', () => {
    const lane = [
      { id: 'new', state: 'findings_to_decide' as const, openedAt: '2026-11-18T10:00:00Z' },
      { id: 'failed', state: 'stage_failed' as const, openedAt: '2026-11-19T10:00:00Z' },
      {
        id: 'old',
        state: 'findings_to_decide' as const,
        openedAt: new Date('2026-11-02T10:00:00Z'),
      },
    ];
    expect(lane.sort(byUrgency).map((item) => item.id)).toEqual(['failed', 'old', 'new']);
  });
});
