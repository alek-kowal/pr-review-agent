import { cn } from 'cn';
import { Alert } from '@/components/ui/alert.tsx';
import { copy } from '@/copy/index.ts';
import { usePauseNames } from '@/features/budget/wait-text.ts';
import { useTeamNames } from '@/features/team/names.ts';
import { bannerText, stepContext, whoText } from '@/lib/next-step.ts';
import { BANNER_LINES, MAIN_ACTIONS, type PrSlotProps } from './slots.ts';
import { BANNER_ICON, BANNER_ICON_TONE, BANNER_TONE } from './tone.ts';

/**
 * The Next step banner between the header and the tabs (FR-057): its colour and title are the
 * PR's state, a grey line says who usually acts, and one main action sits on the right.
 */
export function NextStepBanner(props: PrSlotProps) {
  const { view } = props;
  const step = view.nextStep;
  // The banner names people from the view (who sent the sensitive files back), the status (who
  // paused) and Team (who started the implementer).
  const sentBack = view.sensitive?.sentBack;
  const pauseNames = usePauseNames();
  const startedBy = step.banner.params.startedBy as { kind?: string } | null | undefined;
  const teamNames = useTeamNames(startedBy?.kind === 'member');
  const context = stepContext(
    view.author,
    new Map([
      ...teamNames,
      ...pauseNames,
      ...(sentBack ? [[sentBack.by.id, sentBack.by.name] as const] : []),
    ]),
  );
  const done = step.lane === null;
  const who = whoText(step, context);
  const Action = step.mainAction ? MAIN_ACTIONS[step.mainAction.action] : undefined;
  const Icon = BANNER_ICON[step.tone];

  return (
    <Alert
      role="region"
      aria-label={done ? copy.nextStep.stateLabel : copy.nextStep.label}
      data-testid="next-step"
      data-tone={step.tone}
      className={cn(
        'flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-text',
        BANNER_TONE[step.tone],
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface',
          BANNER_ICON_TONE[step.tone],
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn('size-[18px]', step.tone === 'working' && 'motion-safe:animate-spin')}
        />
      </span>
      <div className="min-w-[240px] flex-1">
        {!done && (
          <p className="text-xs text-text-3">
            {who ? copy.nextStep.meta(who) : copy.nextStep.label}
          </p>
        )}
        <h2 className="font-heading text-lg font-semibold">{bannerText(step, context)}</h2>
        {BANNER_LINES.map(({ key, Component }) => (
          <Component key={key} {...props} />
        ))}
      </div>
      {Action && step.mainAction && (
        <div className="flex flex-wrap items-center gap-2">
          <Action {...props} action={step.mainAction} />
        </div>
      )}
    </Alert>
  );
}
