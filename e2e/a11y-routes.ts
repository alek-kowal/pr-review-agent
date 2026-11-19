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
  // S-23: learning.
  { name: 'Settings → Learning', path: '/settings/learning' },
];
