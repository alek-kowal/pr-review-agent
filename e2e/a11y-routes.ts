// Routes for the accessibility and layout checks (S-17-T9, `a11y-layout.spec.ts`): axe in both
// themes, a visible focus on every Tab stop, and the work start near the top. Each slice adds the
// routes it builds. A path resolves on the e2e stack as it is, or through one of these
// placeholders, which the spec fills in before the checks:
// - `{pr}`: a workflowbuilder PR the spec delivers and waits for until round 1 is done;
// - `{run}`: that round's run;
// - `{repository}`, `{instruction}`, `{trial}`: the first one stored. A route whose record does
//   not exist yet on the stack (no experiment has run) is skipped, with the reason.
export type A11yRoute = {
  /** Shown in the test title. */
  name: string;
  path: string;
};

export const A11Y_ROUTES: readonly A11yRoute[] = [
  // S-02, S-17: the board and the PR page.
  { name: 'Pull requests', path: '/prs' },
  { name: 'PR → Findings', path: '/pr/workflowbuilder/{pr}' },
  { name: 'PR → Questions', path: '/pr/workflowbuilder/{pr}?tab=questions' },
  { name: 'PR → Patch', path: '/pr/workflowbuilder/{pr}?tab=patch' },
  { name: 'PR → Timeline', path: '/pr/workflowbuilder/{pr}?tab=timeline' },
  // S-03, S-12: Run detail and Activity.
  { name: 'Run detail', path: '/runs/{run}' },
  { name: 'Activity', path: '/activity' },
  // S-13: Insights.
  { name: 'Insights', path: '/insights' },
  { name: 'Insights → Cost', path: '/insights/cost' },
  { name: 'Insights → Quality', path: '/insights/quality' },
  { name: 'Insights → Trust', path: '/insights/trust' },
  // S-04, S-05, S-09, S-10: Settings.
  { name: 'Settings → Team', path: '/settings/team' },
  { name: 'Settings → Repositories', path: '/settings/repositories' },
  { name: 'Settings → Connect a repository', path: '/settings/repositories/connect' },
  { name: 'Settings → Repository', path: '/settings/repositories/{repository}' },
  { name: 'Settings → Budget', path: '/settings/budget' },
  { name: 'Settings → Integrations', path: '/settings/integrations' },
  // S-22: instructions, trials and the pipeline.
  { name: 'Settings → Instructions', path: '/settings/instructions' },
  { name: 'Settings → Instruction file', path: '/settings/instructions/{instruction}' },
  { name: 'Settings → Experiments', path: '/settings/experiments' },
  { name: 'Settings → Experiment', path: '/settings/experiments/{trial}' },
  { name: 'Settings → Pipeline', path: '/settings/pipeline' },
  // S-21: Settings → Models, Review levels and Audit log.
  { name: 'Settings → Models', path: '/settings/models' },
  { name: 'Settings → Review levels', path: '/settings/review-levels' },
  { name: 'Settings → Review levels → Level 5', path: '/settings/review-levels/5' },
  { name: 'Settings → Audit log', path: '/settings/audit' },
  // S-21-T9: Settings → Alerts.
  { name: 'Settings → Alerts', path: '/settings/alerts' },
];
