import { useNavigate } from '@tanstack/react-router';
import { ChevronsUpDown, FolderGit2, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { copy } from '@/copy/index.ts';
import type { AvailableRepository } from '@/lib/api-types.ts';

const t = copy.repositories.connect;

/** "Connect a repository": a Combobox of the repositories the App reaches that are not connected. */
export function ConnectPicker(props: {
  available: readonly AvailableRepository[];
  /** Full names already connected; never offered, even if the list is out of date. */
  connected: readonly string[];
}) {
  const taken = new Set(props.connected.map((name) => name.toLowerCase()));
  const available = props.available.filter((r) => !taken.has(r.fullName.toLowerCase()));
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" role="combobox" aria-expanded={open} aria-label={t.label}>
          <Plus aria-hidden="true" />
          {t.label}
          <ChevronsUpDown aria-hidden="true" className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command label={t.search}>
          <CommandInput placeholder={t.search} />
          <CommandList>
            <CommandEmpty>{available.length === 0 ? t.none : t.noMatch}</CommandEmpty>
            <CommandGroup>
              {available.map((repository) => (
                <CommandItem
                  key={repository.fullName}
                  value={repository.fullName}
                  onSelect={() => {
                    setOpen(false);
                    void navigate({
                      to: '/settings/repositories/connect',
                      search: { fullName: repository.fullName },
                    });
                  }}
                >
                  <FolderGit2 aria-hidden="true" className="text-text-3" />
                  <span className="truncate font-mono text-[13px]">{repository.fullName}</span>
                  {repository.private && (
                    <span className="ml-auto text-xs text-text-3">{t.private}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
