import * as React from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cn } from 'cn';

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(
        'inline-flex w-fit items-center rounded-md border border-border bg-surface-2 p-0.5',
        className,
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        'inline-flex h-7 items-center justify-center rounded px-2.5 text-xs font-medium whitespace-nowrap text-text-2 transition-colors outline-none',
        'hover:text-text focus-visible:ring-3 focus-visible:ring-ring/50',
        'data-[state=on]:bg-surface data-[state=on]:text-text data-[state=on]:shadow-xs',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
