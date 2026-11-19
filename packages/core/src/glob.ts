/**
 * Path patterns from repository settings, with gitignore-style anchoring:
 * - `*` matches within one path segment, `?` one character, `**` any number of segments;
 * - `{a,b}` and `(a|b)` are alternatives;
 * - a pattern with a `/` at the start or in the middle is anchored at the repository root, a
 *   pattern without one (`CLAUDE.md`, `deploy/`) matches at any depth;
 * - a trailing `/` matches everything under that directory, and any pattern also matches the
 *   files under a directory it names.
 */
const escape = (c: string) => c.replace(/[.+^$|\\[\]{}()*?]/g, '\\$&');

function closing(p: string, open: number, close: string): number {
  let depth = 0;
  for (let i = open; i < p.length; i++) {
    if (p[i] === p[open]) depth++;
    else if (p[i] === close && --depth === 0) return i;
  }
  return -1;
}

function splitTop(body: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '{' || c === '(') depth++;
    else if (c === '}' || c === ')') depth--;
    else if (c === sep && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  return [...parts, body.slice(start)];
}

function convert(p: string): string {
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*' && p[i + 1] === '*') {
      i++;
      if (p[i + 1] === '/') {
        i++;
        re += '(?:[^/]*/)*';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{' || c === '(') {
      const close = c === '{' ? '}' : ')';
      const end = closing(p, i, close);
      if (end < 0) {
        re += escape(c);
        continue;
      }
      const alts = splitTop(p.slice(i + 1, end), c === '{' ? ',' : '|');
      re += `(?:${alts.map(convert).join('|')})`;
      i = end;
    } else re += escape(c);
  }
  return re;
}

const cache = new Map<string, RegExp>();

export function globToRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;
  let p = pattern.trim();
  const dir = p.endsWith('/');
  if (dir) p = p.slice(0, -1);
  const anchored = p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  const re = new RegExp(`^${anchored ? '' : '(?:.*/)?'}${convert(p)}${dir ? '/.*' : '(?:/.*)?'}$`);
  cache.set(pattern, re);
  return re;
}

export const matchGlob = (path: string, pattern: string): boolean =>
  globToRegExp(pattern).test(path.replace(/^\.?\//, ''));

/** The first pattern that matches the path, or null. */
export const firstMatch = (path: string, patterns: readonly string[]): string | null =>
  patterns.find((pattern) => matchGlob(path, pattern)) ?? null;
