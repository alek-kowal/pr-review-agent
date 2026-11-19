/* Pull requests: the landing board. Four lanes by whose move it is; the Person filter is the main control.
   Show exceptions, not defaults: no repo, level or round on a card unless it differs from the usual. */
function signedBy(pr, id) {
  return pr.author === id || pr.timeline.some(t => t.actor === id) || pr.findings.some(f => (f.decision && f.decision.by === id) || f.opinions.some(o => o.by === id)) || pr.questions.some(q => q.answer && q.answer.by === id);
}
/* A card is three lines: title; number · author · age (+ only the flags that are exceptions); the next step. */
function cardMeta(pr, q) {
  const def = S.repos[pr.repo].defaultLevel, t = pr.rounds.length ? Math.max(pr.openedAt, pr.timeline[pr.timeline.length - 1].at) : pr.openedAt;
  return html`<div class="cardmeta"><span class="mono">#${pr.num}</span><span class="sep">·</span>${pr.repo !== WB && !q.repo && html`<span class="trunc">${repoShort(pr.repo)}</span><span class="sep">·</span>`}<span class="who">${authorName(pr)}</span><span class="sep">·</span><${Time} t=${t} />
    ${pr.chain && pr.chain.n >= 2 && html`<span class="sep">·</span><span class="whitespace-nowrap">round ${pr.chain.n} of 3</span>`}<span class="flex-1"></span>
    ${pr.fork && prState(pr) !== 'never' && html`<span class="badge" title="Fork: read-only review, started by hand">Fork</span>`}${pr.level !== def && html`<span class="badge" title=${'Review level ' + pr.level + ': ' + LEVELS[pr.level - 1].name + ' (repo default: ' + def + ')'}>L${pr.level}</span>`}</div>`;
}
function PrCard({ pr, q }) {
  const ns = nextStep(pr), v = pr.run && !pr.run.queued ? runView(pr.run) : null, act = v && v.steps[v.cur];
  const who = ns.who && ns.who !== 'usually ' + authorName(pr) + ' (author)' && ns.who !== 'no one needs to act' ? ns.who : null;
  return html`<a class="prcard" href=${'#/pr/' + pr.num} data-pr=${pr.num} data-state=${ns.st}>
    <div class="flex items-start gap-2"><div class="font-medium text-base leading-5 clamp2 flex-1 min-w-0">${pr.title}</div><${CardAlert} pr=${pr} /></div>
    ${cardMeta(pr, q)}
    <div class="next"><span class=${cx('mt-px', ns.tone === 'amber' ? 'text-warn' : ns.tone === 'blue' ? 'text-brandt' : ns.tone === 'red' ? 'text-bad' : 'text-ink3')}>${ns.live ? html`<span class="pulse-dot mt-1 mx-0.5 block"></span>` : html`<${Icon} n=${ns.icon} s=${14} />`}</span>
      <span class="min-w-0"><span class="font-medium text-ink">${act ? act.label + (act.units ? ': ' + act.unit.replace('%d', act.du).replace('%d', act.units) : ' running') : ns.short}</span>${who && html`<span class="text-ink3"> · ${who}</span>`}</span></div>
    ${v && html`<div class="bar mt-2" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(v.p * 100)} aria-label="Round progress"><i style=${{ width: Math.round(v.p * 100) + '%' }}></i></div>`}
  </a>`;
}
/* Things that need nothing are smaller: Ready to merge is two lines, a draft is one. */
function PrRow({ pr, q, one }) {
  const st = prState(pr);
  if (one) return html`<a class="prrow" href=${'#/pr/' + pr.num} data-pr=${pr.num} data-state=${st}><span class="trunc flex-1">${pr.title}</span><span class="text-ink3 whitespace-nowrap">${authorName(pr)}</span></a>`;
  return html`<a class="prcard slim" href=${'#/pr/' + pr.num} data-pr=${pr.num} data-state=${st}>
    <div class="flex items-start gap-2"><div class="font-medium leading-5 trunc flex-1 min-w-0">${pr.title}</div><${CardAlert} pr=${pr} /></div>${cardMeta(pr, q)}</a>`;
}
function FilterMenu({ label, icon, value, options, onPick }) {
  const sel = options.find(o => o.value === value);
  return html`<${Popover} btn=${({ onClick, open }) => html`<button class=${cx('chip', value && 'on')} aria-haspopup="listbox" aria-expanded=${String(open)} onClick=${onClick}><${Icon} n=${icon} s=${13} />${label}${sel && value ? ': ' + sel.label : ''}<${Icon} n="chevron-down" s=${12} /></button>`}>
    ${close => html`<div class="p-1" role="listbox" aria-label=${label}>${options.map(o => html`<button class="menu-item" role="option" aria-selected=${String((value || '') === o.value)} onClick=${() => { onPick(o.value); close(); }}><span class="flex-1">${o.label}</span>${(value || '') === o.value && html`<${Icon} n="check" s=${14} cls="text-brandt" />`}</button>`)}</div>`}
  </${Popover}>`;
}
function BoardFilters({ q, set }) {
  const n = ['repo', 'forks', 'level', 'drafts'].filter(k => q[k]).length;
  const sel = (id, label, k, opts) => html`<div><label class="label" for=${id}>${label}</label><select id=${id} class="select" value=${q[k] || ''} onChange=${e => set({ [k]: e.target.value })}>${opts.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></div>`;
  return html`<${Popover} width=${260} btn=${({ onClick, open }) => html`<button class=${cx('chip', n && 'on')} style="height:32px" aria-haspopup="dialog" aria-expanded=${String(open)} data-filters=${n} onClick=${onClick}><${Icon} n="sliders-horizontal" s=${13} />Filters${n ? ' · ' + n : ''}<${Icon} n="chevron-down" s=${12} /></button>`}>
    ${() => html`<div class="p-3 grid gap-2.5">
      ${sel('f-repo', 'Repository', 'repo', [['', 'All']].concat(Object.keys(S.repos).map(r => [repoShort(r), repoShort(r)])))}
      ${sel('f-forks', 'Forks', 'forks', [['', 'Show'], ['hide', 'Hide'], ['only', 'Only forks']])}
      ${sel('f-level', 'Review level', 'level', [['', 'Any']].concat(LEVELS.map(l => [String(l.n), l.n + ' · ' + l.name])))}
      <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" class="check" checked=${q.drafts === 'hide'} onChange=${e => set({ drafts: e.target.checked ? 'hide' : '' })} />Hide drafts</label>
    </div>`}
  </${Popover}>`;
}
function Board({ route }) {
  const q = route.q, st = factoryStatus();
  const all = openPrs();
  const list = all.filter(p => (!q.person || signedBy(p, q.person)) && (!q.repo || repoShort(p.repo) === q.repo) && (q.forks === 'only' ? p.fork : q.forks === 'hide' ? !p.fork : true) && (!q.level || String(p.level) === q.level) && (q.drafts !== 'hide' || !p.draft));
  const active = ['person', 'repo', 'forks', 'level', 'drafts'].filter(k => q[k]);
  const who = q.person && person(q.person);
  const closed = prList().filter(p => p.merged || p.closed);
  const set = patch => setQ(patch, true);
  const people = [{ value: '', label: 'Everyone', icon: 'users', sub: plural(all.length, 'open PR') }].concat(S.team.map(t => ({ value: t.id, label: t.name, a: t.id, sub: plural(all.filter(p => signedBy(p, t.id)).length, 'PR') })));
  const order = ['failed', 'questions', 'decide', 'sensitive', 'patch', 'tofix', 'newcommits', 'roundsused'];
  return html`<main class="gutter pb-24">
    <div class="pt-4 pb-3 flex items-center gap-x-3 gap-y-2 flex-wrap">
      <h1 class="text-xl font-semibold m-0 mr-3">Pull requests</h1>
      <label class="text-sm text-ink3" for="person-filter">Person</label><div class="w-full sm:w-56"><${Combobox} id="person-filter" value=${q.person || ''} onChange=${v => set({ person: v })} options=${people} lead="users" placeholder="Everyone" /></div>
      <${BoardFilters} q=${q} set=${set} />
      ${active.length > 0 && html`<${Btn} v="ghost" sz="sm" icon="x" onClick=${() => set({ person: '', repo: '', forks: '', level: '', drafts: '' })}>Clear</${Btn}>`}
    </div>
    ${st === 'paused' && html`<div class="strip t-amber mb-3" style="border-color:var(--warn-line)" role="status"><${Icon} n="pause" s=${15} cls="text-warn" /><span class="font-semibold flex-1">Factory paused by ${actorName(S.factory.pausedBy)}: ${S.factory.pauseReason}<${Info} tip="New rounds wait in the queue. Rounds that were already running finish. Anyone can resume." /></span><${Btn} sz="sm" icon="play" onClick=${openChip}>Resume…</${Btn}></div>`}
    ${st === 'budget' && html`<div class="strip t-red mb-3" style="border-color:var(--bad-line)" role="status"><${Icon} n="circle-alert" s=${15} cls="text-bad" /><span class="font-semibold flex-1">Daily budget reached: ${money(S.factory.spent)} of ${money(S.factory.budget)}<${Info} tip="New rounds wait in the queue until the budget is raised, or until midnight when the spend resets." /></span><${Btn} sz="sm" icon="wallet" onClick=${openChip}>Raise budget…</${Btn}></div>`}
    <${AlertStrip} />
    ${list.length === 0 ? html`<${Empty} icon="search-x" title=${who ? who.name + ' has no open pull requests with these filters' : 'No pull request matches these filters'}><a class="link" href="#/prs">Clear filters</a> to see all ${all.length}.</${Empty}>`
      : html`<div class="board">${LANES.map(l => { const inLane = list.filter(p => laneOf(prState(p)) === l.id), hot = l.id === 'action';
        if (hot) inLane.sort((a, b) => order.indexOf(prState(a)) - order.indexOf(prState(b)));
        const drafts = l.id === 'not' ? inLane.filter(p => p.draft) : [], cards = inLane.filter(p => drafts.indexOf(p) < 0);
        return html`<section class=${cx('lane', hot && 'wide')} aria-labelledby=${'lane-' + l.id} data-lane=${l.id}>
          <h2 class="lane-h m-0" id=${'lane-' + l.id}><${Icon} n=${{ not: 'circle-dashed', work: 'bot', action: 'user-round', ready: 'circle-check' }[l.id]} s=${15} cls=${hot ? 'text-warn' : 'text-ink3'} />${l.name}<span class=${cx('count', hot && inLane.length && 'hot')}>${inLane.length}</span></h2>
          ${inLane.length === 0 && html`<div class="empty">${active.length ? 'Nothing matches the filters.' : l.empty}</div>`}
          ${cards.length > 0 && html`<div class="lane-cards">${cards.map(p => l.id === 'ready' ? html`<${PrRow} key=${p.num} pr=${p} q=${q} />` : html`<${PrCard} key=${p.num} pr=${p} q=${q} />`)}</div>`}
          ${drafts.length > 0 && html`<div class="lane-div">${plural(drafts.length, 'draft')}</div><div class="prrows">${drafts.map(p => html`<${PrRow} key=${p.num} pr=${p} q=${q} one />`)}</div>`}
        </section>`; })}</div>`}
    ${closed.length > 0 && !active.length && html`<${Fold} quiet cls="mt-8" hook="closed" title="Merged or closed in the last 7 days" count=${closed.length}>
      <div class="tblwrap mt-2"><table class="tbl"><thead><tr><th>Pull request</th><th>Author</th><th>Outcome</th><th>Learning</th><th class="r">Spent</th></tr></thead><tbody>
        ${closed.map(p => html`<tr class="click" onClick=${() => nav('pr/' + p.num)}><td><a class="link font-medium" style="color:var(--text)" href=${'#/pr/' + p.num}>${p.title}</a> <span class="mono text-ink3">#${p.num}</span></td><td>${authorName(p)}</td>
          <td class="text-ink2">${p.merged ? 'Merged by ' + actorName(p.merged.by) : 'Closed'} · <${Time} t=${(p.merged || p.closed).at} cls="text-ink3" /></td>
          <td class="text-ink2">${learningText(p)}</td><td class="r">${money(p.spend)}</td></tr>`)}
      </tbody></table></div></${Fold}>`}
  </main>`;
}
function learningText(p) { const l = p.learning || { status: 'off' }; return l.status === 'running' ? 'Analyst is running…' : l.status === 'done' ? 'Analyst finished: ' + (l.text || plural(l.candidates || 1, 'lesson candidate')) : 'Off at level ' + p.level; }
