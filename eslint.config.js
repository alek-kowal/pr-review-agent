import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

// Files allowed to import test doubles from `@pra/*/testing`.
const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx', '**/test/**', 'e2e/**'];

// Package boundaries (roadmap F-01-T6), as `no-restricted-imports` patterns.
const TESTING_ONLY_IN_TESTS = [
  {
    regex: '^@pra/[^/]+/testing(/|$)',
    message: 'Test doubles from @pra/*/testing are for *.test.ts(x), test/ and e2e/ only.',
  },
];
const CORE_STAYS_PURE = [
  { regex: '^node:', message: 'packages/core is pure domain code: no Node APIs.' },
  {
    regex: `^(${builtinModules.filter((name) => !name.includes(':')).join('|')})(/|$)`,
    message: 'packages/core is pure domain code: no Node APIs.',
  },
  { regex: '^(pg|drizzle-orm)(/|$)', message: 'packages/core does not touch the database.' },
  {
    regex: '^@pra/(db|integrations|agents)(/|$)',
    message: 'packages/core depends on no db, integrations or agents package.',
  },
];
const WEB_ONLY_CORE = [
  {
    regex: '^@pra/(?!core(/|$))',
    message: 'apps/web imports no server package; @pra/core is the only one allowed.',
  },
];

// Rule options do not merge across config objects (the last match wins),
// so each object lists every restriction that applies to its files.
const restrict = (...groups) => ['error', { patterns: groups.flat() }];
const inTests = (dir) => TEST_FILES.map((pattern) => [`${dir}/**`, pattern]);

export default defineConfig([
  globalIgnores([
    '**/dist/',
    '**/coverage/',
    'test-results/',
    'playwright-report/',
    'prototype/',
    'docs/',
    'context/',
    'apps/web/src/routeTree.gen.ts',
  ]),
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    // File routes export `Route` and keep their page component local; the TanStack
    // Router plugin (autoCodeSplitting) splits the component out and handles its HMR.
    files: ['apps/web/src/routes/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  { rules: { 'no-restricted-imports': restrict(TESTING_ONLY_IN_TESTS) } },
  {
    files: ['packages/core/**'],
    rules: { 'no-restricted-imports': restrict(CORE_STAYS_PURE, TESTING_ONLY_IN_TESTS) },
  },
  {
    files: ['apps/web/**'],
    rules: { 'no-restricted-imports': restrict(WEB_ONLY_CORE, TESTING_ONLY_IN_TESTS) },
  },
  { files: TEST_FILES, rules: { 'no-restricted-imports': 'off' } },
  {
    files: inTests('packages/core'),
    rules: { 'no-restricted-imports': restrict(CORE_STAYS_PURE) },
  },
  { files: inTests('apps/web'), rules: { 'no-restricted-imports': restrict(WEB_ONLY_CORE) } },
]);
