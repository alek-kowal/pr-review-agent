/* UI primitives. Each one maps to a shadcn/ui component (see README). */

/* Inline `code` in data strings. */
function md(text) { return String(text == null ? '' : text).split('`').map((part, i) => i % 2 ? html`<code class="c">${part}</code>` : part); }

/* Button: v = primary | secondary | outline | ghost | danger. A disabled button keeps focus and says why. */
function Btn({ v = 'outline', sz, icon, iconR, onClick, why, tip, tipPos, kbd, children, cls, type, label, pressed, id, spin }) {
  const disabled = !!why;
  return html`<button id=${id} type=${type || 'button'} class=${cx('btn', v === 'outline' ? 'ol' : v, sz, !children && 'icon', cls)} aria-disabled=${disabled ? 'true' : null} aria-label=${label || null} aria-pressed=${pressed == null ? null : String(pressed)}
    data-tip=${why || tip || null} data-tip-pos=${tipPos || null} onClick=${e => { if (disabled) { e.preventDefault(); return; } onClick && onClick(e); }}>
    ${icon && html`<${Icon} n=${icon} s=${sz === 'sm' ? 13 : 15} cls=${spin ? 'spin' : ''} />`}${children}${iconR && html`<${Icon} n=${iconR} s=${13} />`}${kbd && html`<span class="kbd">${kbd}</span>`}
  </button>`;
}
function Pill({ tone = 'neutral', icon, live, lg, children, tip }) {
  return html`<span class=${cx('pill', 't-' + tone, lg && 'lg')} data-tip=${tip || null}>${live ? html`<span class="pulse-dot"></span>` : icon && html`<${Icon} n=${icon} s=${lg ? 14 : 12} />`}${children}</span>`;
}
function Badge({ tone, icon, children, tip, tipPos }) { return html`<span class=${cx('badge', tone && 't-' + tone)} data-tip=${tip || null} data-tip-pos=${tipPos || null} tabindex=${tip ? 0 : null}>${icon && html`<${Icon} n=${icon} s=${11} />`}${children}</span>`; }
/* ⓘ: helper text lives behind this, never under a heading by default. */
function Info({ tip, pos, cls }) { return tip ? html`<span class=${cx('info', cls)} data-tip=${tip} data-tip-pos=${pos || null} tabindex="0" role="note" aria-label=${tip}><${Icon} n="info" s=${13} /></span>` : null; }
/* Collapsed section: its content is not rendered until it is opened. */
function Fold({ title, count, children, quiet, hook, cls }) {
  const [open, setOpen] = useState(false);
  return html`<section class=${cx('fold', quiet && 'quiet', open && 'open', cls)} data-fold=${hook || null}><button class="fold-s" aria-expanded=${String(open)} onClick=${() => setOpen(!open)}><${Icon} n="chevron-right" s=${quiet ? 14 : 15} />${title}${count != null && html`<span class="count">${count}</span>`}</button>${open && children}</section>`;
}
function Kbd({ children }) { return html`<span class="kbd">${children}</span>`; }

function Avatar({ a, s = 20 }) {
  const st = { width: s + 'px', height: s + 'px', fontSize: Math.round(s * 0.46) + 'px' };
  if (a === 'bot') return html`<span class="av bot" style=${st} aria-hidden="true"><${Icon} n="bot" s=${Math.round(s * 0.62)} /></span>`;
  if (a === 'hand') return html`<span class="av hand" style=${st} aria-hidden="true"><${Icon} n="hand" s=${Math.round(s * 0.58)} /></span>`;
  const p = person(a), name = actorName(a);
  return html`<span class=${cx('av', p && 'av' + p.av)} style=${st} aria-hidden="true">${name.slice(0, 1).toUpperCase()}</span>`;
}
function Who({ a, s = 18, cls, sub }) { return html`<span class=${cx('inline-flex items-center gap-1.5 min-w-0', cls)}><${Avatar} a=${a} s=${s} /><span class="trunc">${actorName(a)}${sub}</span></span>`; }
function Time({ t, cls }) { return html`<time class=${cx('num whitespace-nowrap', cls)} datetime=${new Date(t).toISOString()} title=${abs(t)}>${rel(t)}</time>`; }
function Dots({ n }) { return html`<span class="dots" aria-hidden="true">${[1, 2, 3, 4, 5, 6].map(i => html`<i class=${i <= n ? 'on' : ''}></i>`)}</span>`; }
function Level({ n, tip }) { return html`<span class="badge" data-tip=${tip === false ? null : 'Review level ' + n + ': ' + LEVELS[n - 1].name} tabindex="0">L${n} <${Dots} n=${n} /></span>`; }
function Empty({ icon, title, children }) { return html`<div class="empty">${icon && html`<${Icon} n=${icon} s=${18} cls="mb-1" />`}${title && html`<div class="font-medium text-ink2">${title}</div>`}<div class="max-w-[52ch]">${children}</div></div>`; }
function Field({ label, hint, id, children, err }) { return html`<div><label class="label" for=${id}>${label}<${Info} tip=${hint} pos="right" /></label>${children}${err && html`<div class="hint mt-1" style="color:var(--bad)" role="alert">${err}</div>`}</div>`; }
function Switch({ on, onChange, label, id }) { return html`<button id=${id} type="button" role="switch" class="switch" aria-checked=${String(!!on)} aria-label=${label} onClick=${() => onChange(!on)}></button>`; }
function Tabs({ tabs, value, onChange, label }) {
  return html`<div class="tabs" role="tablist" aria-label=${label}>${tabs.map(t => html`<button role="tab" id=${'tab-' + t.id} aria-selected=${String(value === t.id)} aria-controls=${'panel-' + t.id} tabindex=${value === t.id ? 0 : -1} class="tab" onClick=${() => onChange(t.id)}
    onKeyDown=${e => { const i = tabs.findIndex(x => x.id === value); if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length].id); if (e.key === 'ArrowLeft') onChange(tabs[(i + tabs.length - 1) % tabs.length].id); }}>
    ${t.icon && html`<${Icon} n=${t.icon} s=${14} />`}${t.label}${t.count > 0 && html`<span class="count">${t.count}</span>`}</button>`)}</div>`;
}
function Breadcrumb({ items }) {
  return html`<nav aria-label="Breadcrumb" class="flex items-center gap-1.5 text-sm text-ink3 flex-wrap">${items.map((it, i) => html`${i > 0 && html`<${Icon} n="chevron-right" s=${13} />`}${it.to ? html`<a class="link" style="color:var(--text-3)" href=${href(it.to, it.q)}>${it.label}</a>` : html`<span class="text-ink" aria-current="page">${it.label}</span>`}`)}</nav>`;
}

/* ---------- Diff ---------- */
function DiffLines({ lines }) { return html`<div class="codeblk" role="group" aria-label="Diff">${lines.map(l => html`<span class=${cx('dl', l.s === '+' && 'add', l.s === '-' && 'del', l.s === '@' && 'hunk')} data-s=${l.s === '@' ? ' ' : l.s}>${l.t || ' '}</span>`)}</div>`; }
function Diff({ before, after, ctx }) { const lines = lineDiff(before || '', after || ''); return html`<${DiffLines} lines=${ctx == null ? lines : compactDiff(lines, ctx)} />`; }

/* ---------- Popover (also used as DropdownMenu) ---------- */
function Popover({ btn, children, align = 'left', up, width }) {
  const [open, setOpen] = useState(false); const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const out = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); const b = ref.current && ref.current.querySelector('button'); b && b.focus(); } };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc, true);
    const f = ref.current.querySelector('.pop [data-autofocus], .pop input, .pop textarea, .pop button'); f && f.focus();
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  return html`<span class="relative inline-flex" ref=${ref}>${btn({ onClick: () => setOpen(o => !o), open })}
    ${open && html`<div class="pop" role="dialog" style=${{ [align]: 0, [up ? 'bottom' : 'top']: 'calc(100% + 6px)', width: width ? 'min(' + width + 'px, calc(100vw - 32px))' : null }}>${children(() => setOpen(false))}</div>`}</span>`;
}

/* ---------- Combobox ---------- */
function Combobox({ id, value, onChange, options, placeholder, label, lead, big, invalid }) {
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), [act, setAct] = useState(0); const ref = useRef();
  const sel = options.find(o => o.value === value);
  const list = options.filter(o => !q || (o.label + ' ' + (o.sub || '')).toLowerCase().indexOf(q.toLowerCase()) >= 0);
  const pick = o => { onChange(o.value); setOpen(false); setQ(''); };
  const lid = id + '-list';
  return html`<div class="relative" ref=${ref}>
    ${sel && sel.a && !open && html`<span class="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"><${Avatar} a=${sel.a} s=${big ? 22 : 18} /></span>`}
    ${!(sel && sel.a && !open) && lead && html`<span class="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-ink3"><${Icon} n=${lead} s=${15} /></span>`}
    <input id=${id} class=${cx('input', invalid && 'err')} style=${{ paddingLeft: (sel && sel.a && !open) || lead ? (big ? '36px' : '32px') : null, paddingRight: '28px', height: big ? '36px' : null, fontWeight: big && !open ? 500 : null, fontSize: big ? '14px' : null }} role="combobox" aria-expanded=${String(open)} aria-controls=${lid} aria-autocomplete="list" aria-label=${label || null}
      aria-activedescendant=${open && list[act] ? lid + '-' + act : null} placeholder=${sel ? sel.label : placeholder} value=${open ? q : sel ? sel.label : ''} autocomplete="off"
      onClick=${() => { setOpen(true); setAct(Math.max(0, list.findIndex(o => o.value === value))); }} onBlur=${() => setTimeout(() => { if (ref.current && !ref.current.contains(document.activeElement)) { setOpen(false); setQ(''); } }, 120)}
      onInput=${e => { setQ(e.target.value); setAct(0); setOpen(true); }}
      onKeyDown=${e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setAct(a => Math.min(list.length - 1, a + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setAct(a => Math.max(0, a - 1)); }
        else if (e.key === 'Enter' && open && list[act]) { e.preventDefault(); e.stopPropagation(); pick(list[act]); }
        else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); setQ(''); }
      }} />
    <span class="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-ink4"><${Icon} n="chevrons-up-down" s=${14} /></span>
    ${open && html`<ul id=${lid} role="listbox" class="pop p-1 left-0 right-0 max-h-64 overflow-y-auto" style="top:calc(100% + 4px)">
      ${list.length === 0 && html`<li class="px-2 py-2 text-sm text-ink3">No match.</li>`}
      ${list.map((o, i) => html`<li id=${lid + '-' + i} role="option" aria-selected=${String(o.value === value)} class=${cx('menu-item', i === act && 'active')} onMouseDown=${e => { e.preventDefault(); pick(o); }} onMouseEnter=${() => setAct(i)}>
        ${o.a ? html`<${Avatar} a=${o.a} s=${18} />` : o.icon && html`<${Icon} n=${o.icon} s=${14} cls="text-ink3" />`}<span class="flex-1 trunc">${o.label}</span>${o.sub && html`<span class="text-xs text-ink3 trunc">${o.sub}</span>`}${o.value === value && html`<${Icon} n="check" s=${14} cls="text-brandt" />`}</li>`)}
    </ul>`}
  </div>`;
}
const teamOptions = () => S.team.map(t => ({ value: t.id, label: t.name, sub: '@' + t.gh, a: t.id }));
/* Signature: lives inside each action's own form. Prefilled with the last name used in this browser. */
function Sign({ value, onChange, id = 'sign', note, inline }) {
  return html`<div class=${inline ? 'flex items-center gap-2' : ''}>
    <label class=${cx('label', inline && 'mb-0 whitespace-nowrap')} for=${id}>Signed by${!inline && html`<${Info} pos="right" tip=${note || 'One shared account: the signature says who acted.'} />`}</label>
    <div class=${inline ? 'w-44' : ''}><${Combobox} id=${id} value=${value} onChange=${onChange} options=${teamOptions()} placeholder="Pick your name" lead="pen-line" invalid=${false} /></div>
  </div>`;
}
const useSigner = () => useState(lastSigner());

/* ---------- Dialog / AlertDialog / Sheet ---------- */
function useFocusTrap(ref, onClose) {
  useEffect(() => {
    const prev = document.activeElement, el = ref.current;
    const sel = 'a[href], button:not([tabindex="-1"]), input, select, textarea, [tabindex="0"]';
    const first = el.querySelector('[data-autofocus]') || el.querySelector('.dialog-b input, .dialog-b textarea, .dialog-b select') || el.querySelector(sel); first && first.focus();
    const key = e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(el.querySelectorAll(sel)).filter(x => x.offsetParent !== null); if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } else if (!el.contains(document.activeElement)) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prev && prev.focus && prev.focus(); };
  }, []);
}
function Dialog({ title, desc, children, footer, onClose, size, alert, icon, tone }) {
  const ref = useRef(); useFocusTrap(ref, onClose);
  return html`<div class="scrim" onMouseDown=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref=${ref} class=${cx('dialog', size)} role=${alert ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="dlg-t" aria-describedby=${desc ? 'dlg-d' : null}>
      <div class="dialog-h flex items-start gap-3">
        ${icon && html`<span class=${cx('banner-ico', 't-' + (tone || 'blue'))} style="width:32px;height:32px"><${Icon} n=${icon} s=${16} /></span>`}
        <div class="flex-1 min-w-0"><h2 id="dlg-t" class="dialog-t">${title}</h2>${desc && html`<p id="dlg-d" class="text-sm text-ink2 mt-1">${desc}</p>`}</div>
        <${Btn} v="ghost" sz="sm" icon="x" label="Close" onClick=${onClose} />
      </div>
      <div class="dialog-b">${children}</div>
      ${footer && html`<div class="dialog-f">${footer}</div>`}
    </div></div>`;
}
function Sheet({ title, sub, children, onClose }) {
  const ref = useRef(); useFocusTrap(ref, onClose);
  return html`<div class="fixed inset-0 z-[100]" style="background:var(--scrim)" onMouseDown=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <aside ref=${ref} class="sheet" role="dialog" aria-modal="true" aria-label=${title}>
      <div class="flex items-start gap-3 p-4 border-b border-div sticky top-0 bg-surface z-10"><div class="flex-1 min-w-0"><h2 class="dialog-t">${title}</h2>${sub && html`<div class="text-sm text-ink3 mt-0.5">${sub}</div>`}</div><${Btn} v="ghost" sz="sm" icon="x" label="Close" onClick=${onClose} /></div>
      <div class="p-4">${children}</div>
    </aside></div>`;
}
const DIALOGS = {};
function openDialog(name, props) { UI.dialog = { name, props: props || {} }; commit(); }
function closeDialog() { UI.dialog = null; commit(); }
function DialogHost() { const d = UI.dialog; if (!d) return null; const C = DIALOGS[d.name]; return html`<${C} key=${d.name} ...${d.props} onClose=${closeDialog} />`; }

/* ---------- Toasts (Sonner) ---------- */
function toast(t) {
  t.id = uid('toast'); UI.toasts = UI.toasts.concat([t]).slice(-4);
  setTimeout(() => { UI.toasts = UI.toasts.filter(x => x.id !== t.id); commit(); }, t.undo ? 9000 : 6500);
  commit();
}
function Toasts() {
  const drop = t => { UI.toasts = UI.toasts.filter(x => x.id !== t.id); commit(); };
  return html`<div class="toasts" role="status" aria-live="polite">${UI.toasts.map(t => html`<div class="toast" key=${t.id}>
    <${Icon} n=${t.tone === 'ok' ? 'circle-check' : t.tone === 'bad' ? 'circle-alert' : 'info'} s=${16} cls=${cx('mt-0.5', t.tone === 'ok' ? 'text-ok' : t.tone === 'bad' ? 'text-bad' : 'text-brandt')} />
    <div class="flex-1 min-w-0"><div class="font-medium text-sm">${t.title}</div>${t.desc && html`<div class="text-xs text-ink3 mt-0.5">${t.desc}</div>`}</div>
    ${t.undo && html`<${Btn} sz="sm" onClick=${() => { t.undo(); drop(t); }}>Undo</${Btn}>`}
    ${t.go && html`<${Btn} sz="sm" onClick=${() => { nav(t.go[0], t.go[1]); drop(t); }}>View</${Btn}>`}
    <${Btn} v="ghost" sz="sm" icon="x" label="Dismiss" onClick=${() => drop(t)} />
  </div>`)}</div>`;
}

/* ---------- Stepper ---------- */
function stepsView(pr) {
  const st = prState(pr);
  if (pr.run) { const v = runView(pr.run); return { live: !pr.run.queued, v, steps: v.steps, kind: pr.run.kind }; }
  const last = pr.rounds[pr.rounds.length - 1];
  if (!last) return { steps: stepsFor('review', pr).map(s => Object.assign({}, s, { state: s.off ? 'off' : 'pending' })), kind: 'review' };
  const info = getRunInfo(last.id);
  return { steps: info.r.steps, kind: last.kind, last };
}
function Stepper({ pr }) {
  const sv = stepsView(pr), st = prState(pr), L = pr.level;
  const ico = { done: 'circle-check', active: 'loader-circle', pending: 'circle', off: 'circle-off', failed: 'circle-x' };
  const sub = s => s.state === 'off' ? 'off at level ' + L : s.state === 'pending' ? (st === 'failed' ? 'not run' : 'waiting') : s.state === 'failed' ? 'timed out after 30 min'
    : s.state === 'active' ? [s.units ? s.unit.replace('%d', s.du).replace('%d', s.units) : 'working', dur(s.realEl), s.cost ? money(s.costEl) : null].filter(Boolean).join(' · ')
    : s.reused ? 'reused from the failed round' : [dur(s.real), s.cost ? money(s.cost) : null].filter(Boolean).join(' · ') || s.note;
  return html`<div class="card overflow-hidden"><ol class="stepper m-0 p-0 list-none" aria-label="Stages of this round">
    ${sv.steps.map(s => html`<li class=${cx('step', s.state)} data-tip=${s.state === 'done' && s.note ? s.note : s.state === 'off' ? s.label + ' turns on at level ' + (s.k === 'verify' ? 3 : 2) + '.' : null} data-tip-pos="bottom">
      <div class="step-top"><${Icon} n=${ico[s.state]} s=${14} cls=${s.state === 'active' ? 'spin' : ''} />${s.label}</div>
      <div class="step-sub">${sub(s)}</div>
      ${s.state === 'active' && html`<div class="bar"><i style=${{ width: Math.round(s.p * 100) + '%' }}></i></div>`}
    </li>`)}
  </ol></div>`;
}
/* Typed PR number: friction only for merge and push. */
function TypeNumber({ num, value, onChange, id = 'typenum' }) {
  return html`<${Field} label=${html`Type <span class="mono">${num}</span> to confirm`} id=${id}><input id=${id} class="input num" inputmode="numeric" autocomplete="off" placeholder=${String(num)} value=${value} onInput=${e => onChange(e.target.value.replace(/[^0-9]/g, ''))} /></${Field}>`;
}
