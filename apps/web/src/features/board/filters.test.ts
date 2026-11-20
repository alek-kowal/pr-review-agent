// FORKS: the board hides fork PRs unless the address says otherwise.
import { expect, test } from 'vitest';
import {
  activeCount,
  boardApiQuery,
  FILTER_KEYS,
  parseBoardSearch,
  setFilters,
} from './filters.ts';

test('a missing `forks` is the default: hidden, and nothing in the address', () => {
  const filters = parseBoardSearch({});
  expect(filters.forks).toBeUndefined();
  expect(setFilters(filters)).toEqual({});
  expect(boardApiQuery(filters)).toBe('?forks=hide');
});

test('`forks=all` shows every PR: the API gets no `forks`, its own default', () => {
  const filters = parseBoardSearch({ forks: 'all' });
  expect(filters.forks).toBe('all');
  expect(boardApiQuery(filters)).toBe('');
});

test('`forks=only` is kept and sent', () => {
  const filters = parseBoardSearch({ forks: 'only' });
  expect(filters.forks).toBe('only');
  expect(boardApiQuery(filters)).toBe('?forks=only');
});

test.each(['hide', 'maybe', '', 1, null, ['all']])('a bad `forks` (%j) is the default', (forks) => {
  const filters = parseBoardSearch({ forks });
  expect(filters.forks).toBeUndefined();
  expect(boardApiQuery(filters)).toBe('?forks=hide');
});

test('the other filters keep their place around `forks`', () => {
  const search = { person: 'kasia', repo: 'docs', level: '3', drafts: 'hide' };
  expect(boardApiQuery(parseBoardSearch(search))).toBe(
    '?person=kasia&repo=docs&forks=hide&level=3&drafts=hide',
  );
  expect(boardApiQuery(parseBoardSearch({ ...search, forks: 'all' }))).toBe(
    '?person=kasia&repo=docs&level=3&drafts=hide',
  );
});

test('the default does not count as a set filter; `all` and `only` do', () => {
  expect(activeCount(parseBoardSearch({}), FILTER_KEYS)).toBe(0);
  expect(activeCount(parseBoardSearch({ forks: 'hide' }), FILTER_KEYS)).toBe(0);
  expect(activeCount(parseBoardSearch({ forks: 'all' }), FILTER_KEYS)).toBe(1);
  expect(activeCount(parseBoardSearch({ forks: 'only', level: 2 }), FILTER_KEYS)).toBe(2);
});
