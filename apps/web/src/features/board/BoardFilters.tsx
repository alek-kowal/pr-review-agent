import { useQuery } from '@tanstack/react-query';
import { LEVEL_NUMBERS } from '@pra/core';
import { Check, ChevronDown, ChevronsUpDown, SlidersHorizontal, Users, X } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { copy } from '@/copy/index.ts';
import { teamQuery } from '@/features/team/queries.ts';
import { activeCount, FILTER_KEYS, PANEL_KEYS, type BoardFilters } from './filters.ts';

type Props = {
  filters: BoardFilters;
  /** Sets or clears the given filters; the others stay. */
  onChange: (patch: BoardFilters) => void;
  /** Connected repositories' slugs. */
  repositories: string[];
};

const t = copy.board.filters;

const sameLogin = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();

/** Person (always visible), the Filters panel and Clear filters (FR-007). */
export function BoardFilterBar({ filters, onChange, repositories }: Props) {
  const any = activeCount(filters, FILTER_KEYS) > 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <PersonFilter value={filters.person} onChange={(person) => onChange({ person })} />
      <FiltersPanel filters={filters} onChange={onChange} repositories={repositories} />
      {any && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])))}
        >
          <X aria-hidden="true" />
          {t.clear}
        </Button>
      )}
    </div>
  );
}

/** A Combobox of Team members; the value is their GitHub login, empty for everyone. */
function PersonFilter({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (login: string | undefined) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const team = useQuery(teamQuery());
  const members = team.data?.members ?? [];
  const selected = members.find((m) => sameLogin(m.githubLogin, value));
  const label = value === undefined ? t.everyone : (selected?.name ?? t.login(value));
  const pick = (login: string | undefined) => {
    onChange(login);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-text-3">
        {t.person}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            data-person-filter
            className="w-56 justify-between font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Users aria-hidden="true" className="text-text-3" />
              <span className="truncate">{label}</span>
            </span>
            <ChevronsUpDown aria-hidden="true" className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
          <Command label={t.searchPeople}>
            <CommandInput placeholder={t.searchPeople} />
            <CommandList>
              <CommandEmpty>{t.noPerson}</CommandEmpty>
              <CommandGroup>
                <CommandItem value={t.everyone} onSelect={() => pick(undefined)}>
                  <Check
                    aria-hidden="true"
                    className={cn(value === undefined ? 'opacity-100' : 'opacity-0')}
                  />
                  {t.everyone}
                </CommandItem>
                {members.map((member) => (
                  <CommandItem
                    key={member.id}
                    value={`${member.name} ${member.githubLogin}`}
                    onSelect={() => pick(member.githubLogin)}
                  >
                    <Check
                      aria-hidden="true"
                      className={cn(
                        sameLogin(member.githubLogin, value) ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="truncate">{member.name}</span>
                    <span className="ml-auto truncate text-xs text-text-3">
                      {t.login(member.githubLogin)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const SELECT =
  'h-9 w-full rounded-md border border-input bg-surface px-2 text-sm text-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

/** Repository, Forks, Level and Hide drafts in one Popover. */
function FiltersPanel({ filters, onChange, repositories }: Props) {
  const id = useId();
  const count = activeCount(filters, PANEL_KEYS);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn('font-normal', count > 0 && 'border-brand text-brand-text')}
        >
          <SlidersHorizontal aria-hidden="true" />
          {count > 0 ? t.buttonCount(count) : t.button}
          <ChevronDown aria-hidden="true" className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64" aria-label={t.panelLabel}>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor={`${id}-repo`}>{t.repository}</Label>
            <select
              id={`${id}-repo`}
              className={SELECT}
              value={filters.repo ?? ''}
              onChange={(e) => onChange({ repo: e.target.value || undefined })}
            >
              <option value="">{t.allRepositories}</option>
              {repositories.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-forks`}>{t.forks}</Label>
            <select
              id={`${id}-forks`}
              className={SELECT}
              value={filters.forks ?? ''}
              onChange={(e) =>
                onChange({ forks: (e.target.value || undefined) as BoardFilters['forks'] })
              }
            >
              <option value="">{t.forkOptions.show}</option>
              <option value="hide">{t.forkOptions.hide}</option>
              <option value="only">{t.forkOptions.only}</option>
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-level`}>{t.level}</Label>
            <select
              id={`${id}-level`}
              className={SELECT}
              value={filters.level ?? ''}
              onChange={(e) =>
                onChange({ level: e.target.value ? Number(e.target.value) : undefined })
              }
            >
              <option value="">{t.anyLevel}</option>
              {LEVEL_NUMBERS.map((n) => (
                <option key={n} value={n}>
                  {copy.repositories.level(n)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-drafts`}
              checked={filters.drafts === 'hide'}
              onCheckedChange={(checked) =>
                onChange({ drafts: checked === true ? 'hide' : undefined })
              }
            />
            <Label htmlFor={`${id}-drafts`}>{t.hideDrafts}</Label>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
