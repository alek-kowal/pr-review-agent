import * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';
import { cn } from 'cn';

type Props = React.ComponentProps<typeof ProgressPrimitive.Root> & {
  /** The filled part's class, for example a warn or bad tone. */
  indicatorClassName?: string;
};

function Progress({ className, indicatorClassName, value, ...props }: Props) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn('h-full w-full flex-1 bg-ok-solid transition-all', indicatorClassName)}
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
