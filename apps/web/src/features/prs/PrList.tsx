import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { copy } from '@/copy/index.ts';
import type { PrListItem, RepositoryRef } from '@/lib/api-types.ts';
import { ApiError } from '@/lib/api.ts';
import { errorText } from '@/lib/reasons.ts';
import { prListQuery, repositoriesQuery } from '@/features/pr/queries.ts';

const ALL = '__all__';

/** The minimal PR list (S-01); the board replaces it in S-02. */
export function PrList({
  repo,
  onRepoChange,
}: {
  repo: string | undefined;
  onRepoChange: (repo: string | undefined) => void;
}) {
  const repositories = useQuery(repositoriesQuery());
  const list = useQuery(prListQuery(repo));
  const repos = repositories.data?.repositories ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-heading text-xl font-semibold">{copy.prs.title}</h1>
        {repos.length > 1 && (
          <RepositoryFilter repos={repos} value={repo} onChange={onRepoChange} />
        )}
      </div>
      {list.isPending ? (
        <p className="text-text-3">{copy.prs.loading}</p>
      ) : list.isError ? (
        <p role="alert" className="text-bad">
          {errorText(list.error instanceof ApiError ? list.error.code : 'http_error')}
        </p>
      ) : list.data.pullRequests.length === 0 ? (
        <p className="text-text-3">{repo ? copy.prs.emptyInRepository : copy.prs.empty}</p>
      ) : (
        <ul
          aria-label={copy.prs.listLabel}
          className="divide-y divide-divider overflow-hidden rounded-lg border border-border bg-surface"
        >
          {list.data.pullRequests.map((pr) => (
            <PrRow key={`${pr.repository.slug}#${pr.number}`} pr={pr} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RepositoryFilter({
  repos,
  value,
  onChange,
}: {
  repos: RepositoryRef[];
  value: string | undefined;
  onChange: (repo: string | undefined) => void;
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL ? undefined : next)}
    >
      <SelectTrigger size="sm" aria-label={copy.prs.repositoryFilter} className="min-w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{copy.prs.allRepositories}</SelectItem>
        {repos.map((r) => (
          <SelectItem key={r.slug} value={r.slug}>
            {r.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PrRow({ pr }: { pr: PrListItem }) {
  const status = copy.prs.roundStatus[pr.latestRoundStatus ?? 'none'];
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
      <Link
        to="/pr/$repo/$number"
        params={{ repo: pr.repository.slug, number: String(pr.number) }}
        className="min-w-0 flex-1 text-text no-underline hover:underline"
      >
        <span className="mr-2 font-mono text-[13px] text-text-3">
          {pr.repository.slug}#{pr.number}
        </span>
        <span className="font-medium">{pr.title}</span>
      </Link>
      <span className="text-[13px] text-text-3">
        {pr.authorLogin}
        {pr.isDraft && ` · ${copy.prs.draft}`}
      </span>
      <span className="w-32 text-right text-[13px] text-text-2">{status}</span>
    </li>
  );
}
