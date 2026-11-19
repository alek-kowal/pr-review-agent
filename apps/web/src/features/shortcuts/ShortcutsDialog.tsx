import { useNavigate } from '@tanstack/react-router';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { copy } from '@/copy/index.ts';
import { DECISION_KEYS } from '@/features/findings/decision-ui.ts';
import { OPINION_KEYS } from '@/features/opinions/opinion-ui.ts';
import { ignoreSingleKey } from '@/lib/keyboard.ts';
import { useOpenShortcuts } from './open-shortcuts.ts';

const t = copy.shortcuts;

/** How long after `g` the second key of `g p` / `g a` still counts. */
const SEQUENCE_MS = 1500;

/** The second key after `g`, and where it goes. */
const GO_TO = { p: '/prs', a: '/activity' } as const;

/** One row: the keys pressed one after another, and what they do. */
type Row = { keys: string[]; label: string };

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: t.groups.global,
    rows: [
      { keys: [`${t.keys.mod}K`], label: t.items.palette },
      { keys: ['/'], label: t.items.search },
      { keys: ['?'], label: t.items.help },
      { keys: ['g', 'p'], label: t.items.goPrs },
      { keys: ['g', 'a'], label: t.items.goActivity },
    ],
  },
  {
    title: t.groups.findings,
    rows: [
      { keys: ['j'], label: t.items.next },
      { keys: ['k'], label: t.items.previous },
      { keys: ['o'], label: t.items.expand },
      { keys: ['x'], label: t.items.select },
      { keys: [OPINION_KEYS.worth], label: t.items.worth },
      { keys: [OPINION_KEYS.not_worth], label: t.items.notWorth },
      { keys: [DECISION_KEYS.implement], label: t.items.implement },
      { keys: [DECISION_KEYS.reject], label: t.items.reject },
      { keys: [DECISION_KEYS.defer], label: t.items.defer },
      { keys: [t.keys.enter], label: t.items.confirm },
    ],
  },
];

/**
 * The global keys (S-17-T6): `?` opens the Keyboard shortcuts dialog, `g p` goes to Pull
 * requests and `g a` to Activity. The palette's "Show keyboard shortcuts" opens it too.
 */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const gPressedAt = useRef(0);
  useOpenShortcuts(useCallback(() => setOpen(true), []));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (ignoreSingleKey(event)) return;
      const sinceG = Date.now() - gPressedAt.current;
      gPressedAt.current = 0;
      if (event.key === '?') {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === 'g') {
        gPressedAt.current = Date.now();
      } else if (sinceG <= SEQUENCE_MS && (event.key === 'p' || event.key === 'a')) {
        event.preventDefault();
        void navigate({ to: GO_TO[event.key] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent closeLabel={t.close} className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="mb-2 text-xs font-medium tracking-wide text-text-3 uppercase">
                {group.title}
              </h3>
              <dl className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 text-sm">
                {group.rows.map((row) => (
                  <Fragment key={row.label}>
                    <dt className="text-text-2">{row.label}</dt>
                    <dd className="flex items-center justify-end gap-1">
                      {row.keys.map((key, i) => (
                        <Fragment key={i}>
                          {i > 0 && <span className="text-xs text-text-3">{t.keys.then}</span>}
                          <Kbd>{key}</Kbd>
                        </Fragment>
                      ))}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
