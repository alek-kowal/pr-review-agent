import { describe, expect, test } from 'vitest';
import { isValidGlob, matchGlob } from './glob.ts';

describe('isValidGlob', () => {
  test.each([
    'CLAUDE.md',
    'deploy/',
    '**/*.md',
    'packages/(sdk|ui|temporal)/src/index.ts',
    'apps/{web,api}/**',
    '/db/migrations/**',
  ])('%s is valid', (pattern) => {
    expect(isValidGlob(pattern)).toBe(true);
  });

  test.each([
    '',
    '   ',
    'src/[ab].ts',
    'src\\*.ts',
    '../secrets/**',
    'apps/{web',
    'apps/(a|b',
    'a}b',
    '({)}',
  ])('%j is not valid', (pattern) => {
    expect(isValidGlob(pattern)).toBe(false);
  });

  test('a valid pattern still matches as before', () => {
    expect(matchGlob('packages/ui/src/index.ts', 'packages/(sdk|ui|temporal)/src/index.ts')).toBe(
      true,
    );
  });
});
