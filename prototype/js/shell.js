/* App shell: top bar, factory status chip, command palette, shortcuts overlay. */
function setTheme(t) { document.documentElement.setAttribute('data-theme', t); LS.set('theme', t); commit(); }
function currentTheme() { const a = document.documentElement.getAttribute('data-theme'); if (a) return a; try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'light'; } }
function openChip() { UI.chip = true; commit(); }

function StatusChip() {
  const f = S.factory, st = factoryStatus(), open = !!UI.chip, ref = useRef();
  const [by, setBy] = useSigner(), [reason, setReason] = useState(''), [budget, setBudgetV] = useState(String(f.budget)), [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return; setBudgetV(String(S.factory.budget)); setErr('');
    const out = e => { if (ref.current && !ref.current.contains(e.target)) { UI.chip = false; commit(); } };
    const esc = e => { if (e.key === 'Escape') { UI.chip = false; commit(); ref.current.querySelector('button').focus(); } };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc);
    const i = ref.current.querySelector('.pop input'); i && i.focus();
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [open]);
  const queued = Object.values(S.prs).filter(p => p.run && p.run.queued).length + S.jobs.filter(j => j.queued).length;
  const pct = Math.min(100, f.spent / f.budget * 100);
  const label = st === 'paused' ? html`<${Icon} n="pause" s=${13} /><span class="trunc">Paused by ${actorName(f.pausedBy)}: ${f.pauseReason}</span>`
    : st === 'budget' ? html`<${Icon} n="circle-alert" s=${13} /><span>Budget reached · <span class="num">${money(f.spent)} / $${f.budget}</span></span>`
    : html`<span class="w-2 h-2 rounded-full" style="background:var(--ok-solid)"></span><span>Running · <span class="num">${money(f.spent)} / $${f.budget}</span> today</span>`;
  const need = () => { if (!by) { setErr('Pick your name to sign.'); return false; } return true; };
  return html`<div class="relative min-w-0" ref=${ref}>
    <button id="status-chip" class=${cx('chip max-w-full', st === 'paused' && 't-amber', st === 'budget' && 't-red')} style="height:32px" aria-haspopup="dialog" aria-expanded=${String(open)} onClick=${() => { UI.chip = !open; commit(); }}>${label}${activeAlerts().length > 0 && html`<span class="chip-alert" data-chip-alerts=${activeAlerts().length}><${Icon} n="bell-ring" s=${11} />${activeAlerts().length}<span class="sr-only"> active alerts</span></span>`}<${Icon} n="chevron-down" s=${13} /></button>
    ${open && html`<div class="pop p-4 right-0" role="dialog" aria-label="Factory status" style="top:calc(100% + 8px);width:min(380px, calc(100vw - 32px))">
      <${ChipAlertList} close=${() => { UI.chip = false; }} />
      <div class="flex items-baseline justify-between text-sm"><span class="text-ink2">Spent today<${Info} pos="right" tip="Real spend only. Resets at midnight." /></span><span class="num font-medium">${money(f.spent)} of ${money(f.budget)}</span></div>
      <div class=${cx('bar mt-1.5', pct >= 100 ? 'bad' : pct > 80 ? 'warn' : '')} style="height:6px"><i style=${{ width: pct + '%' }}></i></div>
      ${queued > 0 && html`<div class="hint mt-1.5"><a class="link" href="#/activity" onClick=${() => { UI.chip = false; }}>${plural(queued, 'run')} queued</a></div>`}
      <div class="border-t border-div my-3"></div>
      ${st === 'paused' ? html`<div class="text-sm"><span class="font-medium">Paused by ${actorName(f.pausedBy)}</span> <${Time} t=${f.pausedAt} cls="text-ink3" /><div class="text-ink2 mt-0.5">${f.pauseReason}</div></div>`
        : html`<${Field} label="Pause the factory" id="pause-reason" hint="Running rounds finish. New rounds wait in the queue until someone resumes."><input id="pause-reason" class="input" placeholder="Reason, e.g. release freeze" value=${reason} onInput=${e => { setReason(e.target.value); setErr(''); }} /></${Field}>`}
      ${st === 'budget' && html`<div class="text-sm text-bad mt-3">Budget used up. Raise it, or wait until midnight.</div>`}
      <div class="mt-3"><${Sign} id="chip-sign" value=${by} onChange=${v => { setBy(v); setErr(''); }} note="Pause, resume and budget changes are signed and go to the Audit log." /></div>
      ${err && html`<div class="hint mt-2" style="color:var(--bad)" role="alert">${err}</div>`}
      <div class="flex items-center justify-between gap-2 mt-3 flex-wrap">
        <div class="flex items-center gap-1.5"><label class="text-xs text-ink2" for="chip-budget">Daily budget $</label><input id="chip-budget" class="input num" style="width:72px;height:28px" inputmode="decimal" value=${budget} onInput=${e => setBudgetV(e.target.value)} />
          <${Btn} sz="sm" why=${Number(budget) === f.budget ? 'Change the amount first.' : !(Number(budget) > 0) ? 'Enter an amount above 0.' : null} onClick=${() => { if (!need()) return; mutate(() => setBudget(Number(budget), by)); toast({ title: 'Daily budget is now ' + money(Number(budget)), desc: 'Signed by ' + actorName(by) + '.' }); }}>Save budget</${Btn}></div>
        ${st === 'paused' ? html`<${Btn} v="primary" icon="play" onClick=${() => { if (!need()) return; mutate(() => resumeFactory(by)); toast({ title: 'Factory resumed', desc: 'Queued rounds are starting. Signed by ' + actorName(by) + '.', tone: 'ok' }); }}>Resume</${Btn}>`
          : html`<${Btn} v="primary" icon="pause" onClick=${() => { if (!reason.trim()) { setErr('Give a reason, so the team knows why rounds are waiting.'); return; } if (!need()) return; mutate(() => pauseFactory(reason.trim(), by)); setReason(''); toast({ title: 'Factory paused', desc: 'New rounds wait in the queue. Signed by ' + actorName(by) + '.' }); }}>Pause</${Btn}>`}
      </div>
      <div class="mt-3"><a class="link text-xs" href="#/settings/budget" onClick=${() => { UI.chip = false; }}>Budget & status settings</a></div>
    </div>`}
  </div>`;
}

const NAV = [['prs', 'Pull requests', 'git-pull-request'], ['activity', 'Activity', 'activity'], ['insights', 'Insights', 'chart-column'], ['settings', 'Settings', 'settings']];
function TopBar({ route }) {
  const top = route.path[0] || 'prs', cur = top === 'pr' || top === 'runs' ? 'prs' : top;
  const dark = currentTheme() === 'dark';
  return html`<header class="topbar"><div class="gutter flex items-center gap-3 h-14">
    <a href="#/prs" class="flex items-center gap-2 no-underline shrink-0 mr-1" aria-label="WB Factory, go to Pull requests">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="var(--brand)"/><path d="M6 8.5h5.5a3 3 0 0 1 3 3V17" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="6.5" cy="8.5" r="2" fill="#fff"/><circle cx="14.5" cy="17" r="2.2" fill="var(--coral)" stroke="#fff" stroke-width="1.2"/></svg>
      <span class="font-head font-semibold text-md hidden sm:inline">WB Factory</span></a>
    <nav class="flex items-center gap-0.5 overflow-x-auto" aria-label="Main">${NAV.map(([id, label, icon]) => html`<a class="nav-a" href=${'#/' + id} aria-current=${cur === id ? 'page' : null}><${Icon} n=${icon} s=${15} /><span class="hidden md:inline">${label}</span></a>`)}</nav>
    <div class="tb-search flex-1 flex justify-center min-w-0 px-2"><button class="searchbtn" onClick=${() => { UI.palette = true; commit(); }} aria-label="Search pull requests and settings">
      <${Icon} n="search" s=${14} /><span class="flex-1 text-left trunc">Search PRs, people, settings…</span><span class="kbd hidden sm:inline-flex">⌘K</span></button></div>
    <span class="tb-spacer"></span><${StatusChip} />
    <${Btn} v="ghost" icon="keyboard" label="Keyboard shortcuts" tip="Keyboard shortcuts (?)" tipPos="bl" cls="hidden md:inline-flex" onClick=${() => { UI.shortcuts = true; commit(); }} />
    <${Btn} v="ghost" icon=${dark ? 'sun' : 'moon'} label=${dark ? 'Switch to light theme' : 'Switch to dark theme'} tip=${dark ? 'Light theme' : 'Dark theme'} tipPos="bl" onClick=${() => setTheme(dark ? 'light' : 'dark')} />
    <${GuideBtn} />
  </div></header>`;
}

const SETTINGS_NAV = [
  ['Factory', [['budget', 'Budget & status', 'wallet'], ['models', 'Models', 'cpu'], ['team', 'Team', 'users'], ['integrations', 'Integrations', 'plug'], ['alerts', 'Alerts', 'bell']]],
  ['Repositories', [['repos', 'Repositories', 'folder-git-2']]],
  ['Review', [['review-levels', 'Review levels', 'layers'], ['instructions', 'Instructions', 'file-text'], ['pipeline', 'Pipeline', 'workflow']]],
  ['Improve', [['experiments', 'Experiments', 'flask-conical'], ['learning', 'Learning', 'graduation-cap']]],
  ['System', [['audit', 'Audit log', 'scroll-text']]]
];

function Palette() {
  const [q, setQ] = useState(''), [act, setAct] = useState(0); const ref = useRef();
  const close = () => { UI.palette = false; commit(); };
  useFocusTrap(ref, close);
  const ql = q.trim().toLowerCase().replace(/^#/, '');
  const m = s => !ql || s.toLowerCase().indexOf(ql) >= 0;
  const groups = [];
  const prs = prList().filter(p => m('#' + p.num + ' ' + p.title + ' ' + authorName(p) + ' ' + repoShort(p.repo))).slice(0, ql ? 8 : 5);
  groups.push(['Pull requests', prs.map(p => ({ icon: p.merged ? 'git-merge' : 'git-pull-request', label: p.title, pre: '#' + p.num, sub: authorName(p) + ' · ' + nextStep(p).short, go: () => nav('pr/' + p.num) }))]);
  const people = S.team.filter(t => ql && m(t.name + ' ' + t.gh));
  groups.push(['People', people.map(t => ({ a: t.id, label: 'Pull requests for ' + t.name, sub: 'Person filter', go: () => nav('prs', { person: t.id }) }))]);
  const pages = [['prs', 'Pull requests', 'git-pull-request'], ['activity', 'Activity', 'activity'], ['insights/overview', 'Insights: Overview', 'chart-column'], ['insights/cost', 'Insights: Cost', 'chart-column'], ['insights/quality', 'Insights: Quality', 'chart-column'], ['insights/trust', 'Insights: Trust ladder', 'chart-column']]
    .concat(SETTINGS_NAV.flatMap(([g, items]) => items.map(([id, label, icon]) => ['settings/' + id, 'Settings: ' + label, icon])));
  groups.push(['Go to', pages.filter(p => m(p[1])).slice(0, ql ? 8 : 4).map(p => ({ icon: p[2], label: p[1], go: () => nav(p[0]) }))]);
  const actions = [
    { icon: S.factory.paused ? 'play' : 'pause', label: S.factory.paused ? 'Resume the factory…' : 'Pause the factory…', go: () => { openChip(); } },
    { icon: 'moon', label: 'Switch theme', go: () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark') },
    { icon: 'keyboard', label: 'Show keyboard shortcuts', go: () => { UI.shortcuts = true; } },
    { icon: 'rotate-ccw', label: 'Reset demo data', go: () => resetDemo() }
  ].filter(a => m(a.label));
  groups.push(['Actions', actions]);
  const flat = groups.flatMap(g => g[1]); let idx = -1;
  const run = it => { close(); it.go(); commit(); };
  return html`<div class="scrim" style="padding-top:12vh" onMouseDown=${e => { if (e.target === e.currentTarget) close(); }}>
    <div ref=${ref} class="dialog" style="max-width:620px" role="dialog" aria-modal="true" aria-label="Command palette">
      <div class="flex items-center gap-2 px-4 border-b border-div"><${Icon} n="search" s=${16} cls="text-ink3" />
        <input data-autofocus class="flex-1 h-12 bg-transparent border-0 text-md" style="outline:none" placeholder="Jump to a PR, a person or a settings page…" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant=${'pal-' + act} value=${q} onInput=${e => { setQ(e.target.value); setAct(0); }}
          onKeyDown=${e => { if (e.key === 'ArrowDown') { e.preventDefault(); setAct(a => Math.min(flat.length - 1, a + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setAct(a => Math.max(0, a - 1)); } else if (e.key === 'Enter' && flat[act]) { e.preventDefault(); run(flat[act]); } }} /><${Kbd}>esc</${Kbd}></div>
      <div id="pal-list" role="listbox" class="p-2 max-h-[52vh] overflow-y-auto">
        ${flat.length === 0 && html`<div class="p-6 text-center text-sm text-ink3">Nothing matches "${q}".</div>`}
        ${groups.filter(g => g[1].length).map(([name, items]) => html`<div class="px-2 pt-2 pb-1 text-xs font-medium text-ink3">${name}</div>
          ${items.map(it => { idx++; const i = idx; return html`<div id=${'pal-' + i} role="option" aria-selected=${String(i === act)} class=${cx('menu-item', i === act && 'active')} onMouseEnter=${() => setAct(i)} onClick=${() => run(it)}>
            ${it.a ? html`<${Avatar} a=${it.a} s=${18} />` : html`<${Icon} n=${it.icon} s=${15} cls="text-ink3" />`}${it.pre && html`<span class="mono text-ink3">${it.pre}</span>`}<span class="flex-1 trunc">${it.label}</span>${it.sub && html`<span class="text-xs text-ink3 trunc max-w-[45%]">${it.sub}</span>`}</div>`; })}`)}
      </div>
    </div></div>`;
}

const SHORTCUTS = [
  ['Everywhere', [['⌘K', 'Open the command palette'], ['/', 'Search'], ['?', 'Show these shortcuts'], ['g p', 'Go to Pull requests'], ['g a', 'Go to Activity']]],
  ['Findings (on a PR)', [['j / k', 'Next / previous finding'], ['o', 'Expand or collapse'], ['x', 'Select'], ['w', 'Opinion: worth implementing'], ['n', 'Opinion: not worth it'], ['i', 'Decide: implement'], ['r', 'Decide: reject'], ['d', 'Decide: defer to ClickUp']]]
];
function ShortcutsDialog() {
  const close = () => { UI.shortcuts = false; commit(); };
  return html`<${Dialog} title="Keyboard shortcuts" onClose=${close} size="wide" footer=${html`<${Btn} v="primary" onClick=${close}>Close</${Btn}>`}>
    <div class="grid gap-6 sm:grid-cols-2">${SHORTCUTS.map(([g, rows]) => html`<div><div class="card-t mb-2">${g}</div><dl class="m-0 divide">${rows.map(([k, t]) => html`<div class="flex items-center justify-between gap-3 py-1.5 text-sm"><dt class="text-ink2">${t}</dt><dd class="m-0 flex gap-1">${k.split(' ').map(x => x === '/' && k.length > 1 ? html`<span class="text-ink3">/</span>` : html`<${Kbd}>${x}</${Kbd}>`)}</dd></div>`)}</dl></div>`)}</div>
  </${Dialog}>`;
}
function PageHead({ title, sub, crumbs, right }) {
  return html`<div class="pt-5 pb-4">${crumbs && html`<div class="mb-2"><${Breadcrumb} items=${crumbs} /></div>`}
    <div class="flex items-end justify-between gap-4 flex-wrap"><div class="min-w-0"><h1 class="text-xl font-semibold m-0">${title}</h1>${sub && html`<p class="text-sm text-ink3 mt-1 mb-0 max-w-[90ch]">${sub}</p>`}</div>${right && html`<div class="flex items-center gap-2 flex-wrap">${right}</div>`}</div></div>`;
}
