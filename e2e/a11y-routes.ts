// Routes for the accessibility and layout checks (S-17-T9, `a11y-layout.spec.ts`): axe in both
// themes, a visible focus on every Tab stop, and the work start near the top. Each slice adds the
// routes it builds; paths resolve on the e2e stack without seeding anything first.
export type A11yRoute = {
  /** Shown in the test title. */
  name: string;
  path: string;
};

export const A11Y_ROUTES: readonly A11yRoute[] = [
  // S-22: instructions, trials and the pipeline.
  { name: 'Settings → Instructions', path: '/settings/instructions' },
  { name: 'Settings → Experiments', path: '/settings/experiments' },
  { name: 'Settings → Pipeline', path: '/settings/pipeline' },
  // S-21: Settings → Models, Review levels and Audit log.
  { name: 'Settings → Models', path: '/settings/models' },
  { name: 'Settings → Review levels', path: '/settings/review-levels' },
  { name: 'Settings → Review levels → Level 5', path: '/settings/review-levels/5' },
  { name: 'Settings → Audit log', path: '/settings/audit' },
];
