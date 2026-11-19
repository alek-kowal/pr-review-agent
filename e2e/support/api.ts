// Shortcuts for the specs: SQL on the stack's database, Team signers and decisions through the
// api, and reloading the PR page until the worker caught up.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import pg from 'pg';
import { stackState } from './github.ts';

export const WB_SLUG = 'workflowbuilder';

export async function sql<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: stackState().databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** Headers a state-changing api call needs (`X-PRA-Request` and an allowed `Origin`). */
export const writeHeaders = () => ({ 'x-pra-request': '1', origin: stackState().apiUrl });

export type TeamMember = { id: string; name: string; githubLogin: string };

const teamMembers = async (request: APIRequestContext) =>
  (
    (await (await request.get(`${stackState().apiUrl}/api/team`)).json()) as {
      members: TeamMember[];
    }
  ).members;

/** A Team member to sign with; the first one signs as themselves. */
export async function signer(request: APIRequestContext): Promise<TeamMember> {
  const { apiUrl } = stackState();
  const members = () => teamMembers(request);
  const existing = (await members())[0];
  if (existing) return existing;
  // Another spec may add the first person at the same moment; then theirs signs.
  await request.post(`${apiUrl}/api/team`, {
    headers: writeHeaders(),
    data: { name: 'Kasia', githubLogin: 'wb-dev' },
  });
  return (await members())[0]!;
}

/**
 * The Team member with this GitHub login, added through the api (signed by the first member) if
 * missing. Another spec may add the same person at the same moment; then theirs is used.
 */
export async function teamMember(
  request: APIRequestContext,
  name: string,
  githubLogin: string,
): Promise<TeamMember> {
  const first = await signer(request);
  const find = async () =>
    (await teamMembers(request)).find((m) => m.githubLogin.toLowerCase() === githubLogin);
  const existing = await find();
  if (existing) return existing;
  await request.post(`${stackState().apiUrl}/api/team`, {
    headers: writeHeaders(),
    data: { name, githubLogin, signedBy: first.id },
  });
  const added = await find();
  expect(added, `Team member @${githubLogin}`).toBeDefined();
  return added!;
}

/** Decides the findings with these titles through the api (decide.spec.ts covers the UI). */
export async function decide(
  request: APIRequestContext,
  number: number,
  titles: string[],
  decision: 'implement' | 'reject' | 'defer',
  slug = WB_SLUG,
): Promise<void> {
  const { apiUrl } = stackState();
  const base = `${apiUrl}/api/prs/${slug}/${number}`;
  const { findings } = (await (await request.get(`${base}/findings`)).json()) as {
    findings: { id: number; title: string; version: number }[];
  };
  const chosen = findings.filter((f) => titles.includes(f.title));
  expect(chosen).toHaveLength(titles.length);
  const response = await request.post(`${base}/decisions`, {
    headers: writeHeaders(),
    data: {
      findingIds: chosen.map((f) => f.id),
      decision,
      reason: decision === 'reject' ? 'Out of scope for this PR.' : null,
      signedBy: (await signer(request)).id,
      expectedVersions: Object.fromEntries(chosen.map((f) => [String(f.id), f.version])),
    },
  });
  expect(response.status()).toBe(200);
}

/** The Next step banner's title. */
export const bannerTitle = (page: Page) =>
  page.getByRole('region', { name: 'Next step' }).getByRole('heading', { level: 2 });

/** Reloads the PR page until `check` passes: the page does not follow the worker by itself. */
export async function onPrPage(
  page: Page,
  number: number,
  check: () => Promise<void>,
  slug = WB_SLUG,
): Promise<void> {
  await expect(async () => {
    await page.goto(`/pr/${slug}/${number}`);
    await check();
  }).toPass({ timeout: 60_000 });
}
