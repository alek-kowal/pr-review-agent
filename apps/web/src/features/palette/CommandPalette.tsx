import { useQuery } from '@tanstack/react-query';
import { useMatch, useNavigate } from '@tanstack/react-router';
import { GitPullRequest, Search, UserRound, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { copy } from '@/copy/index.ts';
import { settingsPages } from '@/features/settings/registry.ts';
import { teamQuery } from '@/features/team/queries.ts';
import { ignoreSingleKey } from '@/lib/keyboard.ts';
import { PALETTE_ACTIONS, type PaletteContext } from './actions.ts';
import { searchQuery } from './search-query.ts';

const t = copy.palette;

/** Every word of the query appears in the text, ignoring case. */
function matches(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** The query the PR search sends, 150 ms after typing stops. */
function useDebounced(value: string, ms = 150): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

type Item = {
  value: string;
  group: keyof typeof t.groups;
  label: string;
  detail?: string;
  icon?: typeof Search;
  shortcut?: string;
  run: () => void;
};

/**
 * One command palette (S-17-T5), opened by ⌘K (Ctrl+K), by `/` and by the top-bar Search
 * button. Groups: PRs from `GET /api/search`, People from Team, Settings pages and Actions from
 * `PALETTE_ACTIONS`. Arrow keys move, Enter runs; closing returns focus to where it was.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState({ list: '', value: '' });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const navigate = useNavigate();
  const prMatch = useMatch({ from: '/pr/$repo/$number', shouldThrow: false });
  const context: PaletteContext = { pr: prMatch ? prMatch.params : null };

  const show = useCallback(() => {
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setQuery('');
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (open) setOpen(false);
        else show();
      } else if (event.key === '/' && !ignoreSingleKey(event)) {
        event.preventDefault();
        show();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, show]);

  const debounced = useDebounced(query.trim());
  const search = useQuery({ ...searchQuery(debounced), enabled: open && debounced !== '' });
  const team = useQuery({ ...teamQuery(), enabled: open });

  /** Closes the palette, then runs `run` once it has closed. */
  const finish = (run: () => void) => {
    pending.current = run;
    setOpen(false);
  };

  const prs: Item[] =
    debounced === '' || query.trim() === ''
      ? []
      : (search.data?.pullRequests ?? []).map((pr) => ({
          value: `pr:${pr.repository.slug}:${pr.number}`,
          group: 'pullRequests',
          label: pr.title,
          detail: `${t.number(pr.number)} · ${pr.author.name ?? pr.author.login}`,
          icon: GitPullRequest,
          run: () =>
            void navigate({
              to: '/pr/$repo/$number',
              params: { repo: pr.repository.slug, number: String(pr.number) },
            }),
        }));
  const people: Item[] = (team.data?.members ?? [])
    .filter((m) => matches(`${m.name} ${m.githubLogin}`, query))
    .map((m) => ({
      value: `person:${m.githubLogin.toLowerCase()}`,
      group: 'people',
      label: m.name,
      detail: t.login(m.githubLogin),
      icon: UserRound,
      run: () => void navigate({ to: '/prs', search: { person: m.githubLogin } }),
    }));
  const settings: Item[] = settingsPages
    .filter((page) => matches(`${copy.settings.pages[page.id]} ${copy.settings.title}`, query))
    .map((page) => ({
      value: `settings:${page.id}`,
      group: 'settings',
      label: copy.settings.pages[page.id],
      icon: page.icon,
      run: () => void navigate({ to: page.to }),
    }));
  const actions: Item[] = PALETTE_ACTIONS.filter((a) => a.available?.(context) ?? true)
    .filter((a) => matches(`${t.actions[a.id] ?? a.id} ${a.keywords ?? ''}`, query))
    .map((a) => ({
      value: `action:${a.id.toLowerCase()}`,
      group: 'actions',
      label: t.actions[a.id] ?? a.id,
      icon: Zap,
      ...(a.shortcut ? { shortcut: a.shortcut } : {}),
      run: () => a.run(context),
    }));
  const items = [...prs, ...people, ...settings, ...actions];

  // The first item is selected whenever the list changes, so "272" + Enter opens PR #272; a
  // choice made with the arrow keys holds only for the list it was made in.
  const itemsKey = items.map((item) => item.value).join('|');
  const selected = selection.list === itemsKey ? selection.value : (items[0]?.value ?? '');

  const groups = (Object.keys(t.groups) as (keyof typeof t.groups)[])
    .map((group) => ({ group, items: items.filter((item) => item.group === group) }))
    .filter((entry) => entry.items.length > 0);

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        onClick={show}
        aria-keyshortcuts="Meta+K Control+K /"
        title={t.triggerHint}
        className="gap-2 font-normal text-text-3"
        data-palette-trigger
      >
        <Search aria-hidden="true" />
        <span className="hidden sm:inline">{t.trigger}</span>
        <span className="sr-only sm:hidden">{t.trigger}</span>
        <Kbd aria-hidden="true" className="hidden sm:inline-flex">
          {copy.shortcuts.keys.mod}K
        </Kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t.title}
        description={t.description}
        commandProps={{
          shouldFilter: false,
          label: t.title,
          value: selected,
          onValueChange: (value) => setSelection({ list: itemsKey, value }),
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const run = pending.current;
          pending.current = null;
          if (run) run();
          else (returnFocus.current ?? triggerRef.current)?.focus();
        }}
      >
        <CommandInput placeholder={t.placeholder} value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>{search.isFetching ? t.searching : t.empty}</CommandEmpty>
          {groups.map(({ group, items: groupItems }) => (
            <CommandGroup key={group} heading={t.groups[group]}>
              {groupItems.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.value}
                    value={item.value}
                    onSelect={() => finish(item.run)}
                  >
                    {Icon && <Icon aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.detail && (
                      <span className="shrink-0 text-xs text-text-3">{item.detail}</span>
                    )}
                    {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
