import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.tsx';
import { copy } from '@/copy/index.ts';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { ApiError } from '@/lib/api.ts';
import type { AuditEntry, AuditResponse } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { auditQuery, type AuditSearch } from './search.ts';

const t = copy.audit;
/** The Select value for "no filter" (a Select item cannot have an empty value). */
const ALL = '__all';
const SEARCH_DELAY_MS = 300;

/**
 * Settings → Audit log (S-21-T7, FR-082): every settings change, the bot's own included, with a
 * search, area and who filters and a date range kept in the URL. A row expands to before and after.
 */
export function AuditPage() {
  const search = useSearch({ from: '/settings/audit' });
  const navigate = useNavigate({ from: '/settings/audit' });
  const query = useInfiniteQuery(auditQuery(search));
  const pages = query.data?.pages ?? [];
  const entries = pages.flatMap((page) => page.entries);
  const facets = pages[0];

  const setSearch = useCallback(
    (patch: Partial<AuditSearch>) =>
      void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true }),
    [navigate],
  );
  const filtered = Object.values(search).some((value) => value !== undefined);

  return (
    <SettingsPage title={t.title} affects={t.affects}>
      <Filters
        search={search}
        facets={facets}
        onChange={setSearch}
        onClear={filtered ? () => void navigate({ search: {}, replace: true }) : undefined}
      />
      {query.isError ? (
        <p role="alert" className="text-bad">
          {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
        </p>
      ) : !query.data ? (
        <p className="text-text-3">{t.loading}</p>
      ) : entries.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-text-3">
          {filtered ? t.empty : t.none}
        </p>
      ) : (
        <>
          <p className="text-sm text-text-3" aria-live="polite">
            {t.count(entries.length, query.hasNextPage)}
          </p>
          <AuditTable entries={entries} />
          {query.hasNextPage && (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? t.loadingMore : t.loadMore}
            </Button>
          )}
        </>
      )}
    </SettingsPage>
  );
}

function Filters(props: {
  search: AuditSearch;
  facets: AuditResponse | undefined;
  onChange: (patch: Partial<AuditSearch>) => void;
  onClear?: () => void;
}) {
  const f = t.filters;
  const { search, facets, onChange } = props;
  // The search text reaches the URL after a short pause, not on every key.
  const [text, setText] = useState(search.q ?? '');
  const [seen, setSeen] = useState(search.q);
  if (seen !== search.q) {
    setSeen(search.q);
    setText(search.q ?? '');
  }
  useEffect(() => {
    if (text === (search.q ?? '')) return;
    const timer = setTimeout(() => onChange({ q: text.trim() || undefined }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, search.q, onChange]);

  // A filter from the URL stays selectable even before the log lists it.
  const areas = [...new Set([...(facets?.areas ?? []), ...(search.area ? [search.area] : [])])];
  const signers = facets?.signers ?? [];

  return (
    <div role="search" aria-label={f.label} className="flex flex-wrap items-end gap-3">
      <label className="grid min-w-[200px] flex-1 gap-1 text-sm font-medium sm:max-w-sm">
        {f.search}
        <Input
          type="search"
          placeholder={f.searchPlaceholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="grid w-48 gap-1 text-sm font-medium">
        <label htmlFor="audit-area">{f.area}</label>
        <Select
          value={search.area ?? ALL}
          onValueChange={(value) => onChange({ area: value === ALL ? undefined : value })}
        >
          <SelectTrigger id="audit-area" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{f.allAreas}</SelectItem>
            {areas.map((area) => (
              <SelectItem key={area} value={area}>
                {areaName(area)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid w-48 gap-1 text-sm font-medium">
        <label htmlFor="audit-who">{f.who}</label>
        <Select
          value={search.who ?? ALL}
          onValueChange={(value) => onChange({ who: value === ALL ? undefined : value })}
        >
          <SelectTrigger id="audit-who" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{f.everyone}</SelectItem>
            {signers.map((signer) => (
              <SelectItem key={signer.id} value={signer.id}>
                {signer.name}
              </SelectItem>
            ))}
            {search.who &&
              !['bot', 'hand'].includes(search.who) &&
              !signers.some((signer) => signer.id === search.who) && (
                <SelectItem value={search.who}>{t.formerMember}</SelectItem>
              )}
            <SelectItem value="bot">{t.bot}</SelectItem>
            <SelectItem value="hand">{t.hand}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <label className="grid gap-1 text-sm font-medium">
        {f.from}
        <Input
          type="date"
          className="w-40"
          value={search.from ?? ''}
          max={search.to}
          onChange={(event) => onChange({ from: event.target.value || undefined })}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        {f.to}
        <Input
          type="date"
          className="w-40"
          value={search.to ?? ''}
          min={search.from}
          onChange={(event) => onChange({ to: event.target.value || undefined })}
        />
      </label>
      {props.onClear && (
        <Button type="button" variant="ghost" onClick={props.onClear}>
          <X aria-hidden="true" />
          {f.clear}
        </Button>
      )}
    </div>
  );
}

function AuditTable({ entries }: { entries: AuditEntry[] }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const c = t.columns;
  return (
    <div className="rounded-lg border border-border bg-surface">
      <Table aria-label={t.tableLabel}>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-10">
              <span className="sr-only">{t.expand}</span>
            </TableHead>
            <TableHead scope="col">{c.when}</TableHead>
            <TableHead scope="col">{c.who}</TableHead>
            <TableHead scope="col">{c.area}</TableHead>
            <TableHead scope="col">{c.summary}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const expanded = open.has(entry.id);
            const detailsId = `audit-${entry.id}`;
            return (
              <Fragment key={entry.id}>
                <TableRow data-entry={entry.id}>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-expanded={expanded}
                      aria-controls={expanded ? detailsId : undefined}
                      aria-label={expanded ? t.collapse : t.expand}
                      onClick={() => toggle(entry.id)}
                    >
                      {expanded ? (
                        <ChevronDown aria-hidden="true" />
                      ) : (
                        <ChevronRight aria-hidden="true" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-text-2">
                    <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{who(entry)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                      {areaName(entry.area)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{summary(entry)}</span>
                    {entry.note && <span className="block text-xs text-text-3">{entry.note}</span>}
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow id={detailsId} data-details={entry.id}>
                    <TableCell />
                    <TableCell colSpan={4}>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Value label={t.before} value={entry.before} />
                        <Value label={t.after} value={entry.after} />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Value({ label, value }: { label: string; value: unknown }) {
  return (
    <figure className="m-0 min-w-0">
      <figcaption className="mb-1 text-xs font-semibold text-text-3">{label}</figcaption>
      <pre className="max-h-80 overflow-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-xs whitespace-pre-wrap">
        {value === null || value === undefined ? t.nothing : JSON.stringify(value, null, 2)}
      </pre>
    </figure>
  );
}

const areaName = (area: string) => t.areas[area] ?? area;

function who(entry: AuditEntry): string {
  if (entry.actor === 'bot') return t.bot;
  if (entry.actor === 'hand') return t.hand;
  return entry.signer?.name || t.formerMember;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What changed, from before and after: the keys that differ, or added / removed. */
function summary(entry: Pick<AuditEntry, 'entity' | 'before' | 'after'>): string {
  const { before, after } = entry;
  if (before === null || before === undefined) return t.summary.created(entry.entity);
  if (after === null || after === undefined) return t.summary.removed(entry.entity);
  if (!isRecord(before) || !isRecord(after)) return t.summary.value;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  return t.summary.changed(keys);
}
