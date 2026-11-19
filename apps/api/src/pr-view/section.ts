import type { Executor, PullRequest, Repository } from '@pra/db';
import { z } from 'zod/v4';

/** What every PR view section reads. Sections only read; they never write. */
export interface PrViewContext {
  db: Executor;
  repository: Repository;
  pullRequest: PullRequest;
}

/**
 * One top-level key of `GET /api/prs/:repo/:number`. A package that adds something to the PR
 * page adds a section file and one line in `PR_VIEW_SECTIONS` (extension point from P-04).
 */
export interface PrViewSection<K extends string = string, S extends z.ZodType = z.ZodType> {
  key: K;
  schema: S;
  build(context: PrViewContext): Promise<z.output<S>>;
}

export const defineSection = <K extends string, S extends z.ZodType>(
  section: PrViewSection<K, S>,
): PrViewSection<K, S> => section;

type SectionsShape<T extends readonly PrViewSection[]> = {
  [S in T[number] as S['key']]: S['schema'];
};

/** The response schema: one key per section. */
export function sectionsSchema<const T extends readonly PrViewSection[]>(sections: T) {
  const keys = sections.map((section) => section.key);
  const duplicate = keys.find((key, i) => keys.indexOf(key) !== i);
  if (duplicate) throw new Error(`PR view section "${duplicate}" is registered twice`);
  return z.object(
    Object.fromEntries(
      sections.map((section) => [section.key, section.schema]),
    ) as SectionsShape<T>,
  );
}

/** Builds every section (in parallel) into one response object. */
export async function buildSections<const T extends readonly PrViewSection[]>(
  sections: T,
  context: PrViewContext,
): Promise<z.output<ReturnType<typeof sectionsSchema<T>>>> {
  const entries = await Promise.all(
    sections.map(async (section) => [section.key, await section.build(context)] as const),
  );
  return Object.fromEntries(entries) as z.output<ReturnType<typeof sectionsSchema<T>>>;
}
