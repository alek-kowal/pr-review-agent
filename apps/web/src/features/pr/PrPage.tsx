import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { copy } from '@/copy/index.ts';
import { ApiError } from '@/lib/api.ts';
import { isActiveStatus } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { DecideFocusContext, type DecideFocus } from './decide-focus.ts';
import { NextStepBanner } from './NextStepBanner.tsx';
import { PrHeader } from './PrHeader.tsx';
import { prKeys, prViewQuery } from './queries.ts';
import { PR_PANELS } from './slots.ts';
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
  const [focus, setFocus] = useState({ seq: 0, live: false });
  const decideFocus = useMemo<DecideFocus>(
    () => ({
      request: focus.live ? focus.seq : 0,
      focusFirstUndecided: () => {
        onTabChange('findings');
        setFocus((f) => ({ seq: f.seq + 1, live: true }));
      },
    }),
    [focus, onTabChange],
  );
  const changeTab = (next: string) => {
    setFocus((f) => ({ ...f, live: false }));
    onTabChange(next);
  };

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

  const slotProps = { repo, number, view: view.data };
  const panels = PR_PANELS.filter((panel) => panel.shows(view.data));

  return (
    <DecideFocusContext value={decideFocus}>
      <div className="flex flex-col">
        <PrHeader {...slotProps} />
        <NextStepBanner {...slotProps} />
        <div
          className={`mt-4 grid items-start gap-5 ${panels.length > 0 ? 'lg:grid-cols-[minmax(0,1fr)_340px]' : ''}`}
        >
          {panels.length > 0 && (
            // Before the tabs in reading order (under the banner on narrow screens), the right
            // column on wide ones.
            <aside
              aria-label={copy.pr.sideLabel}
              className="flex flex-col gap-3 lg:sticky lg:top-16 lg:order-2"
            >
              {panels.map(({ key, Component }) => (
                <Component key={key} {...slotProps} />
              ))}
            </aside>
          )}
          <Tabs value={tab} onValueChange={changeTab} className="min-w-0 lg:order-1">
            <TabsList variant="line" aria-label={copy.pr.tabsLabel}>
              {PR_TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {PR_TABS.map(({ key, Panel }) => (
              <TabsContent key={key} value={key} className="pt-3">
                <Panel {...slotProps} />
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </DecideFocusContext>
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
