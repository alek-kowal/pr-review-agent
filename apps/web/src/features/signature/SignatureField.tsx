import { Link } from '@tanstack/react-router';
import { Check, ChevronsUpDown, PenLine } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from 'cn';
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
import type { Signature } from './use-signature.ts';

type Props = {
  /** From `useSignature()` in the form that is signed. */
  signature: Signature;
  /** Shown under the field, for example "Pick your name to sign." */
  error?: string | null;
  className?: string;
};

/**
 * "Signed by": a Combobox of active Team members inside a signed action's own form (FR-087). It
 * starts with this browser's last signer; the form calls `signature.remember()` after it succeeds.
 */
export function SignatureField({ signature, error, className }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const { members, signedBy, setSignedBy, isLoading } = signature;
  const selected = members.find((m) => m.id === signedBy);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  if (!isLoading && members.length === 0) {
    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        <span className="text-sm font-medium">{copy.signature.label}</span>
        <p className="text-sm text-text-3">
          {copy.signature.emptyTeam}{' '}
          <Link to="/settings/team" className="font-medium text-brand-text underline">
            {copy.signature.addYourself}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {copy.signature.label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            disabled={isLoading}
            className="w-full justify-between font-normal sm:w-64"
          >
            <span className="flex min-w-0 items-center gap-2">
              <PenLine aria-hidden="true" className="text-text-3" />
              <span className={cn('truncate', !selected && 'text-muted-foreground')}>
                {isLoading
                  ? copy.signature.loading
                  : (selected?.name ?? copy.signature.placeholder)}
              </span>
            </span>
            <ChevronsUpDown aria-hidden="true" className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
          {/* cmdk names its input from the Command's label. */}
          <Command label={copy.signature.search}>
            <CommandInput placeholder={copy.signature.search} />
            <CommandList>
              <CommandEmpty>{copy.signature.noMatch}</CommandEmpty>
              <CommandGroup>
                {members.map((member) => (
                  <CommandItem
                    key={member.id}
                    value={`${member.name} ${member.githubLogin} ${member.id}`}
                    onSelect={() => {
                      setSignedBy(member.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      aria-hidden="true"
                      className={cn(member.id === signedBy ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="truncate">{member.name}</span>
                    <span className="ml-auto truncate text-xs text-text-3">
                      {copy.signature.login(member.githubLogin)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <p id={hintId} className="text-xs text-text-3">
        {copy.signature.hint}
      </p>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
