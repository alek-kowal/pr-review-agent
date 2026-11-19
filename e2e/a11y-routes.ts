// The routes the accessibility and layout checks visit (S-17-T9, `a11y-layout.spec.ts`). Each
// slice adds the routes it registers; a route needs no seeded PR or run to render.
export type A11yRoute = { name: string; path: string };

export const A11Y_ROUTES: readonly A11yRoute[] = [
  // S-21: Settings → Models, Review levels and Audit log.
  { name: 'Settings → Models', path: '/settings/models' },
  { name: 'Settings → Review levels', path: '/settings/review-levels' },
  { name: 'Settings → Review levels → Level 5', path: '/settings/review-levels/5' },
  { name: 'Settings → Audit log', path: '/settings/audit' },
];
