// Workflow Builder's settings, copied from `repos[WB]` in prototype/js/data.js. WB values live only
// here, never in src: a repository is configured, not coded.
import type { ChangeTypeRules, SensitivePattern } from '../../src/index.ts';

export const WB_CHANGE_TYPE_RULES: ChangeTypeRules = {
  usesExistingPaths: ['apps/docs/**', '**/*.md', '**/*.spec.{ts,tsx}', '**/*.test.{ts,tsx}'],
  oneWayPaths: ['apps/backend/drizzle/**', 'packages/*/src/index.ts', 'deploy/**'],
  sizeLines: 800,
};

export const WB_SENSITIVE_PATTERNS: SensitivePattern[] = [
  {
    pattern: 'packages/(sdk|ui|temporal)/src/index.ts',
    reason: 'Public exports: the published API of a package.',
  },
  { pattern: 'packages/*/package.json', reason: 'Package manifests of published packages.' },
  {
    pattern: 'packages/temporal/src/workflow/',
    reason: 'Temporal workflow code must replay older histories.',
  },
  {
    pattern: 'apps/backend/drizzle/',
    reason: 'Database migrations cannot be undone after deploy.',
  },
  { pattern: 'deploy/', reason: 'Production deployment files.' },
  { pattern: '.github/workflows/', reason: 'CI and release workflows.' },
  { pattern: 'CLAUDE.md', reason: 'Instructions that agents follow in this repository.' },
  { pattern: '.claude/', reason: 'Agent commands and settings.' },
];
