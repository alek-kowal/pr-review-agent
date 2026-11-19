// Workflow Builder's settings, from `repos[WB]` in prototype/js/data.js, with P's rules where they
// are stricter: the "uses existing" paths add P's `composesPaths` (src/classify.ts:46) and the
// sensitive patterns follow P's gate table (src/gates.ts). WB values live only here, never in src:
// a repository is configured, not coded.
import type { ChangeTypeRules, SensitivePattern } from '../../src/index.ts';

export const WB_CHANGE_TYPE_RULES: ChangeTypeRules = {
  usesExistingPaths: [
    'apps/docs/**',
    'apps/e2e/**',
    '.changeset/**',
    '**/*.{md,mdx}',
    '**/{test,tests,__tests__,e2e}/**',
    '**/*.{spec,test}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
  ],
  oneWayPaths: ['apps/backend/drizzle/**', 'packages/*/src/index.ts', '/deploy/**'],
  sizeLines: 800,
};

export const WB_SENSITIVE_PATTERNS: SensitivePattern[] = [
  {
    pattern: 'packages/(sdk|ui|temporal)/src/index.ts',
    reason: 'Public exports: the published API of a package.',
  },
  {
    pattern: 'packages/(sdk|ui|temporal)/package.json',
    reason: 'Package manifests of published packages.',
  },
  {
    pattern: 'packages/temporal/src/workflow/',
    reason: 'Temporal workflow code must replay older histories.',
  },
  {
    pattern: 'apps/backend/drizzle/',
    reason: 'Database migrations cannot be undone after deploy.',
  },
  { pattern: '/deploy/', reason: 'Production deployment files.' },
  { pattern: '.github/workflows/', reason: 'CI and release workflows.' },
  { pattern: 'CLAUDE.md', reason: 'Instructions that agents follow in this repository.' },
  { pattern: '/.claude/', reason: 'Agent commands and settings.' },
];

export const WB_REPOSITORY_CONFIG = {
  slug: 'workflowbuilder',
  githubFullName: 'synergycodes/workflowbuilder',
  defaultBranch: 'main',
  defaultLevel: 3,
  fetchCommand: 'pnpm fetch --frozen-lockfile --ignore-scripts --ignore-pnpmfile',
  installCommand: 'pnpm install --offline --frozen-lockfile',
  clickup: null,
  sensitivePatterns: WB_SENSITIVE_PATTERNS,
  changeTypeRules: WB_CHANGE_TYPE_RULES,
  largePrLines: 1500,
};
