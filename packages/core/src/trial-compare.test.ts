// S-22-T6: the trial's compare rule.
import { describe, expect, test } from 'vitest';
import { compareFindings, normaliseTitle, planRun, sameFinding } from './index.ts';

const f = (file: string, line: number | null, title: string) => ({ file, line, title });

describe('compareFindings', () => {
  test('splits findings into only in A, only in B and in both', () => {
    const a = [
      f('src/a.ts', 10, 'Null check missing'),
      f('src/b.ts', 5, 'Unused import'),
      f('src/c.ts', 1, 'Wrong type'),
    ];
    const b = [f('src/a.ts', 12, 'null check missing.'), f('src/d.ts', 3, 'Public API renamed')];

    const result = compareFindings(a, b);

    expect(result.both).toEqual([{ a: a[0], b: b[0] }]);
    expect(result.onlyA).toEqual([a[1], a[2]]);
    expect(result.onlyB).toEqual([b[1]]);
  });

  test('two findings match on file, overlapping lines and normalised title', () => {
    expect(sameFinding(f('x.ts', 10, 'Race on save'), f('x.ts', 13, '  race ON save!'))).toBe(true);
    expect(sameFinding(f('x.ts', 10, 'Race on save'), f('y.ts', 10, 'Race on save'))).toBe(false);
    expect(sameFinding(f('x.ts', 10, 'Race on save'), f('x.ts', 40, 'Race on save'))).toBe(false);
    expect(sameFinding(f('x.ts', 10, 'Race on save'), f('x.ts', 10, 'Race on load'))).toBe(false);
    // A finding about the whole file overlaps any line of it.
    expect(sameFinding(f('x.ts', null, 'Race on save'), f('x.ts', 99, 'Race on save'))).toBe(true);
    expect(normaliseTitle('Café  name — API')).toBe('cafe name api');
  });

  test('each finding matches at most one, the closest line first', () => {
    const a = [f('x.ts', 10, 'Leak'), f('x.ts', 12, 'Leak')];
    const b = [f('x.ts', 12, 'Leak')];

    const result = compareFindings(a, b);

    expect(result.both).toEqual([{ a: a[1], b: b[0] }]);
    expect(result.onlyA).toEqual([a[0]]);
    expect(result.onlyB).toEqual([]);
  });
});

describe('a trial run plan', () => {
  test('turns Checks and Task off, since a trial never calls GitHub or ClickUp', () => {
    const plan = planRun({ kind: 'trial', level: 3 });
    expect(plan.stages.map((s) => [s.key, s.status, s.offReason?.code ?? null])).toEqual([
      ['checks', 'off', 'off_in_trial'],
      ['task', 'off', 'off_in_trial'],
      ['change_type', 'pending', null],
      ['review', 'pending', null],
      ['verify', 'pending', null],
    ]);
  });
});
