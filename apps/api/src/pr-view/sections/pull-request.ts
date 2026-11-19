import { PR_STATES } from '@pra/db';
import { z } from 'zod/v4';
import { iso } from '../round.ts';
import { defineSection } from '../section.ts';

export const RepositoryRefSchema = z.object({
  slug: z.string(),
  /** The repository's name without the owner. */
  name: z.string(),
  githubFullName: z.string(),
});

/** The PR as GitHub last described it. */
export const pullRequestSection = defineSection({
  key: 'pullRequest',
  schema: z.object({
    /** The PR's id; live change events name PRs by it. */
    id: z.number().int(),
    repository: RepositoryRefSchema,
    number: z.number().int(),
    title: z.string(),
    authorLogin: z.string(),
    state: z.enum(PR_STATES),
    isDraft: z.boolean(),
    isFork: z.boolean(),
    headRef: z.string(),
    baseRef: z.string(),
    headSha: z.string(),
    commitsCount: z.number().int(),
    openedAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    githubUrl: z.url(),
  }),
  async build({ repository, pullRequest }) {
    return {
      id: pullRequest.id,
      repository: repositoryRef(repository),
      number: pullRequest.number,
      title: pullRequest.title,
      authorLogin: pullRequest.authorLogin,
      state: pullRequest.state,
      isDraft: pullRequest.isDraft,
      isFork: pullRequest.isFork,
      headRef: pullRequest.headRef,
      baseRef: pullRequest.baseRef,
      headSha: pullRequest.headSha,
      commitsCount: pullRequest.commitsCount,
      openedAt: iso(pullRequest.openedAt)!,
      updatedAt: iso(pullRequest.updatedAt)!,
      githubUrl: `https://github.com/${repository.githubFullName}/pull/${pullRequest.number}`,
    };
  },
});

export function repositoryRef(repository: { slug: string; githubFullName: string }) {
  return {
    slug: repository.slug,
    name: repository.githubFullName.split('/').pop() ?? repository.githubFullName,
    githubFullName: repository.githubFullName,
  };
}
