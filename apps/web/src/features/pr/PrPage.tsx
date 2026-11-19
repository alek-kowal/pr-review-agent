import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { copy } from '@/copy/index.ts';
import { ApiError } from '@/lib/api.ts';
import { isActiveStatus } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { PrHeader } from './PrHeader.tsx';
import { prKeys, prViewQuery } from './queries.ts';
import { PR_TABS } from './tabs.ts';

export function PrPage({
  repo,
  number,
  tab,
  onTabChange,
}: {
  repo: string;
  number: string;
  tab: string;
  onTabChange: (tab: string) => void;
}) {
  const view = useQuery(prViewQuery(repo, number));
  useRefreshFindingsWhenRoundEnds(repo, number, view.data?.latestRound?.status);

  if (view.isPending) return <p className="text-text-3">{copy.pr.loading}</p>;
  if (view.isError) {
    const code = view.error instanceof ApiError ? view.error.code : 'http_error';
    return (
      <section className="flex flex-col gap-2">
        <h1 className="font-heading text-xl font-semibold">
          {code === 'pr_not_found' ? copy.pr.notFound : errorText(code)}
        </h1>
        {code === 'pr_not_found' && <p className="text-text-3">{copy.pr.notFoundHint}</p>}
        <Link to="/prs" className="text-brand-text">
          {copy.pr.backToList}
        </Link>
      </section>
    );
  }

  return (
    <div className="flex flex-col">
      <PrHeader view={view.data} />
      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList variant="line" aria-label={copy.pr.tabsLabel}>
          {PR_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {PR_TABS.map(({ key, Panel }) => (
          <TabsContent key={key} value={key} className="pt-3">
            <Panel repo={repo} number={number} view={view.data} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/** Findings come from the latest completed round: refetch them once a running round ends. */
function useRefreshFindingsWhenRoundEnds(repo: string, number: string, status?: string) {
  const queryClient = useQueryClient();
  const previous = useRef(status);
  useEffect(() => {
    const wasActive = isActiveStatus(previous.current as never);
    previous.current = status;
    if (wasActive && !isActiveStatus(status as never)) {
      void queryClient.invalidateQueries({ queryKey: prKeys.findings(repo, number) });
    }
  }, [queryClient, repo, number, status]);
}
