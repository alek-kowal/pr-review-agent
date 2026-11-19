// Vitest global setup of @pra/integrations. Docker sandbox tests label their containers with this
// test run's session and owner (`sandboxTestLabels`). Teardown removes every one of them that is
// left after a failed or timed-out test. Vitest skips teardown when it is interrupted (SIGINT,
// SIGTERM) or killed, so setup first removes the containers of such earlier runs.
import { randomUUID } from 'node:crypto';
import type { TestProject } from 'vitest/node';
import './provided-context.ts';
import {
  ownerOfThisProcess,
  removeLabelledContainers,
  removeStaleTestContainers,
  SANDBOX_TEST_SESSION_LABEL,
} from './sandbox-containers.ts';
import { dockerSkipReason } from './sandbox.ts';

export default async function setup(
  project: TestProject,
): Promise<(() => Promise<void>) | undefined> {
  const session = randomUUID();
  project.provide('sandboxTestSession', session);
  project.provide('sandboxTestOwner', ownerOfThisProcess());
  if (await dockerSkipReason()) return undefined;
  await removeStaleTestContainers();
  return () => removeLabelledContainers(`${SANDBOX_TEST_SESSION_LABEL}=${session}`);
}
