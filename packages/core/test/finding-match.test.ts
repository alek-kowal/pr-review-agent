import { describe, expect, it } from 'vitest';
import {
  findingSimilarity,
  matchFinding,
  matchFindings,
  normaliseFindingText,
} from '../src/index.ts';

const undo = {
  file: 'src/editor/undo.ts',
  line: 42,
  title: 'Undo loses the group',
  scenario:
    'Group two nodes, move the group, press Ctrl+Z: the nodes move back but the group is gone.',
};

describe('matchFinding', () => {
  it('matches the same finding on a moved line', () => {
    expect(matchFinding(undo, { ...undo, line: 57 })).toBe(true);
  });

  it('ignores case, punctuation and inline code marks', () => {
    const restyled = {
      ...undo,
      title: '`Undo` loses the group.',
      scenario:
        'group two nodes; move the group, press ctrl+z - the nodes move back, but the group is gone',
    };
    expect(matchFinding(undo, restyled)).toBe(true);
  });

  it('matches a light rewording', () => {
    const reworded = {
      ...undo,
      scenario:
        'Group two nodes, move the group, then press Ctrl+Z: the nodes move back but the group is lost.',
    };
    expect(matchFinding(undo, reworded)).toBe(true);
  });

  it('does not match the same content in another file', () => {
    expect(matchFinding(undo, { ...undo, file: 'src/editor/redo.ts' })).toBe(false);
  });

  it('does not match a finding reworded beyond the threshold', () => {
    const other = {
      ...undo,
      title: 'Undo stack grows without limit',
      scenario:
        'Every drag pushes a full snapshot of the canvas, so long sessions run out of memory.',
    };
    expect(findingSimilarity(undo, other)).toBeLessThan(0.75);
    expect(matchFinding(undo, other)).toBe(false);
  });
});

describe('matchFindings', () => {
  it('pairs each finding at most once, most alike first', () => {
    const exact = { ...undo, line: 60 };
    const close = { ...undo, title: 'Undo loses the whole group' };
    const pairs = matchFindings([undo], [close, exact]);
    expect(pairs).toEqual([[undo, exact]]);
  });
});

describe('normaliseFindingText', () => {
  it('keeps file-like words and numbers', () => {
    expect(normaliseFindingText('`config.ts` breaks on v2!')).toBe('config.ts breaks on v2');
  });
});
