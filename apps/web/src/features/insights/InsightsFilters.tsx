import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { copy } from '@/copy/index.ts';
import { repositoryOptionsQuery } from './queries.ts';
import { DEFAULT_RANGE, RANGES, type InsightsSearch } from './search.ts';

/** Radix Select reserves the empty value, so "no filter" has its own. */
const ALL = '__all__';

type Props = {
  search: InsightsSearch;
  /** Which filters this tab takes. */
  show: readonly ('range' | 'author' | 'repo')[];
  /** Author options (the PR authors in the range); only Overview has them. */
  authors?: readonly string[];
};

/** The filter bar; every change goes to the URL, so a filtered view can be shared. */
export function InsightsFilters({ search, show, authors = [] }: Props) {
  const t = copy.insights.filters;
  const navigate = useNavigate();
  const set = (patch: InsightsSearch) =>
    void navigate({ to: '.', search: (prev) => ({ ...prev, ...patch }), replace: true });
  const range = search.range ?? DEFAULT_RANGE;
  const repositories = useQuery({ ...repositoryOptionsQuery(), enabled: show.includes('repo') });
  // A filtered author with no PR in the range stays pickable.
  const authorOptions = [...new Set([...authors, ...(search.author ? [search.author] : [])])];
  const repoOptions = [
    ...new Set([
      ...(repositories.data?.repositories.map((r) => r.slug) ?? []),
      ...(search.repo ? [search.repo] : []),
    ]),
  ];

  return (
    <div role="group" aria-label={t.label} className="flex flex-wrap items-center gap-2">
      {show.includes('range') && (
        <div
          role="group"
          aria-label={t.range}
          className="inline-flex rounded-md border border-border bg-surface p-0.5"
        >
          {RANGES.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={range === days}
              onClick={() => set({ range: days === DEFAULT_RANGE ? undefined : days })}
              className="h-7 rounded px-2.5 text-[13px] font-medium text-text-2 aria-pressed:bg-brand-bg aria-pressed:text-brand-text"
            >
              {t.rangeOption(days)}
            </button>
          ))}
        </div>
      )}
      {show.includes('author') && (
        <FilterSelect
          label={t.author}
          allLabel={t.allAuthors}
          value={search.author}
          options={authorOptions}
          onChange={(author) => set({ author })}
        />
      )}
      {show.includes('repo') && (
        <FilterSelect
          label={t.repo}
          allLabel={t.allRepos}
          value={search.repo}
          options={repoOptions}
          onChange={(repo) => set({ repo })}
        />
      )}
    </div>
  );
}

function FilterSelect(props: {
  label: string;
  allLabel: string;
  value: string | undefined;
  options: readonly string[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Select
      value={props.value ?? ALL}
      onValueChange={(value) => props.onChange(value === ALL ? undefined : value)}
    >
      <SelectTrigger aria-label={props.label} className="h-8 w-auto min-w-40 text-[13px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{props.allLabel}</SelectItem>
        {props.options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
