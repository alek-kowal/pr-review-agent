// S-18-T5: the PR's active alerts, for the banner line on the PR page (newest first).
import { activeAlertsForPr } from '@pra/db';
import { z } from 'zod/v4';
import { AlertSchema, alertView } from '../../alerts/view.ts';
import { defineSection } from '../section.ts';

export const alertsSection = defineSection({
  key: 'alerts',
  schema: z.array(AlertSchema),
  build: async ({ db, pullRequest }) =>
    (await activeAlertsForPr(db, pullRequest.id)).map(alertView),
});
