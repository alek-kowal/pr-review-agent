/* Settings, part 1: shell, Budget & status, Models, Team, Integrations, Repositories. */
const clone = o => JSON.parse(JSON.stringify(o));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function SaveBar({ n, onDiscard, onSave, label }) {
  if (!n) return null;
  return html`<div class="savebar" role="region" aria-label="Unsaved changes"><span class="text-sm"><span class="font-semibold">${plural(n, 'unsaved change')}</span></span><span class="flex gap-2"><${Btn} v="ghost" onClick=${onDiscard}>Discard</${Btn}><${Btn} v="primary" icon="save" onClick=${onSave}>${label || 'Save changes'}…</${Btn}></span></div>`;
}
function SetHead({ title, affects, crumbs, right }) {
  return html`<div class="pb-4">${crumbs && html`<div class="mb-2"><${Breadcrumb} items=${[{ label: 'Settings', to: 'settings' }].concat(crumbs)} /></div>`}
    <div class="flex items-start justify-between gap-4 flex-wrap"><div class="min-w-0"><h1 class="text-xl font-semibold m-0">${title}</h1><p class="text-sm text-ink2 mt-1 mb-0 max-w-[90ch] flex items-start gap-1.5"><${Icon} n="info" s=${14} cls="mt-0.5 text-ink3" /><span><span class="font-medium">Affects:</span> ${affects}</span></p></div>${right && html`<div class="flex items-center gap-2">${right}</div>`}</div></div>`;
}
/* A row is a label and a control. The explanation sits behind ⓘ. */
function Row({ label, hint, children, id }) { return html`<div class="formrow"><div><label class="font-medium text-sm" for=${id}>${label}</label><${Info} tip=${hint} pos="right" /></div><div class="min-w-0">${children}</div></div>`; }
function Section({ title, right, children, sub }) { return html`<section class="card mb-4"><div class="card-h"><h2 class="card-t m-0">${title}<${Info} tip=${sub} pos="right" /></h2>${right}</div><div class="divide">${children}</div></section>`; }

function SetBudget() {
  const f = S.factory, st = factoryStatus(), src = { budget: f.budget, slots: f.slots }, [v, setV] = useState(clone(src)), [reason, setReason] = useState('');
  const diff = []; if (Number(v.budget) !== src.budget) diff.push({ k: 'Daily budget', from: money(src.budget), to: money(Number(v.budget)) }); if (Number(v.slots) !== src.slots) diff.push({ k: 'Agent slots', from: String(src.slots), to: String(v.slots) });
  const queued = Object.values(S.prs).filter(p => p.run && p.run.queued), pct = Math.min(100, f.spent / f.budget * 100);
  return html`<div><${SetHead} title="Budget & status" affects="whether new rounds start at all, and how much the whole factory may spend per day." />
    <${Section} title="Status" right=${html`<${Pill} tone=${st === 'running' ? 'green' : st === 'paused' ? 'amber' : 'red'} icon=${st === 'running' ? 'play' : st === 'paused' ? 'pause' : 'circle-alert'}>${st === 'running' ? 'Running' : st === 'paused' ? 'Paused' : 'Budget reached'}</${Pill}>`}>
      ${f.paused ? html`<${Row} label=${'Paused by ' + actorName(f.pausedBy)} hint="New rounds wait in the queue. Rounds that were running finished normally."><div class="text-sm mb-2"><span class="font-medium">${f.pauseReason}</span> · <${Time} t=${f.pausedAt} cls="text-ink3" /></div>
          <${Btn} v="primary" icon="play" onClick=${() => openDialog('confirmSave', { title: 'Resume the factory', desc: 'Queued rounds start right away.', area: 'Budget & status', text: 'Resumed the factory', icon: 'play', cta: 'Resume', diff: [{ k: 'Status', from: 'Paused: ' + f.pauseReason, to: 'Running' }], apply: by => { S.factory.paused = false; } })}>Resume…</${Btn}></${Row}>`
        : html`<${Row} id="set-pause" label="Pause the factory" hint="Use it for a release freeze or when costs look wrong. Rounds that are running finish; new ones wait in the queue."><div class="flex gap-2 flex-wrap"><input id="set-pause" class="input flex-1 min-w-[220px]" placeholder="Reason, e.g. release freeze" value=${reason} onInput=${e => setReason(e.target.value)} />
          <${Btn} icon="pause" why=${reason.trim() ? null : 'Give a reason first, so the team knows why rounds are waiting.'} onClick=${() => openDialog('confirmSave', { title: 'Pause the factory', desc: 'New rounds will wait in the queue until someone resumes.', area: 'Budget & status', text: 'Paused the factory', icon: 'pause', cta: 'Pause', diff: [{ k: 'Status', from: 'Running', to: 'Paused: ' + reason.trim() }], apply: by => { Object.assign(S.factory, { paused: true, pausedBy: by, pauseReason: reason.trim(), pausedAt: Date.now() }); }, done: () => setReason('') })}>Pause…</${Btn}></div></${Row}>`}
    </${Section}>
    <${Section} title="Budget">
      <${Row} label="Spent today" hint="Real spend only. Resets at midnight."><div class="flex items-baseline justify-between text-sm"><span class="num font-semibold text-lg">${money(f.spent)}</span><span class="num text-ink3">of ${money(f.budget)}</span></div><div class=${cx('bar mt-1.5', pct >= 100 ? 'bad' : pct > 80 ? 'warn' : '')} style="height:6px"><i style=${{ width: pct + '%' }}></i></div><a class="link text-xs mt-2 inline-block" href="#/insights/cost">Spend in Insights</a></${Row}>
      <${Row} id="set-budget" label="Daily budget" hint="When the spend reaches it, new rounds wait in the queue. It is checked before every agent session."><div class="flex items-center gap-2"><span class="text-ink3">$</span><input id="set-budget" class="input num" style="width:120px" inputmode="decimal" value=${v.budget} onInput=${e => setV(Object.assign({}, v, { budget: e.target.value }))} /><span class="text-sm text-ink3">per day</span></div></${Row}>
    </${Section}>
    <${Section} title="Queue" right=${html`<a class="link text-xs" href="#/activity">Open Activity</a>`}>
      <${Row} id="set-slots" label="Agent slots" hint="How many rounds may run at the same time. More slots finish sooner and spend the budget faster."><select id="set-slots" class="select" style="width:120px" value=${v.slots} onChange=${e => setV(Object.assign({}, v, { slots: Number(e.target.value) }))}>${[1, 2, 3, 4].map(n => html`<option value=${n}>${n}</option>`)}</select></${Row}>
      <${Row} label="Waiting now">${queued.length ? html`<ul class="m-0 p-0 list-none grid gap-1 text-sm">${queued.map(p => html`<li><a class="link" href=${'#/pr/' + p.num}>#${p.num}</a> ${p.title} <span class="text-ink3">· ${queueReason(p)}</span></li>`)}</ul>` : html`<span class="text-sm text-ink3">Nothing is queued.</span>`}</${Row}>
    </${Section}>
    <${SaveBar} n=${diff.length} onDiscard=${() => setV(clone(src))} onSave=${() => openDialog('confirmSave', { title: 'Save budget settings', area: 'Budget & status', text: diff.map(d => d.k).join(' and ') + ' changed', diff, apply: () => { S.factory.budget = Number(v.budget); S.factory.slots = Number(v.slots); } })} />
  </div>`;
}

function SetModels() {
  const [v, setV] = useState(clone(S.models));
  const diff = ROLES.filter(r => v[r.id] !== S.models[r.id]).map(r => ({ k: r.name, from: S.models[r.id], to: v[r.id] }));
  const overrides = id => Object.keys(S.levels).filter(n => S.levels[n].models && S.levels[n].models[id]).map(n => [n, S.levels[n].models[id]]);
  return html`<div><${SetHead} title="Models" affects="which model each agent role uses in every new round, unless a review level sets its own." />
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Role</th><th>Default model</th><th>Per-level overrides<${Info} tip="A level can set its own model for a role in Review levels. It wins at that level and above, until a higher level sets another." pos="bl" /></th></tr></thead><tbody>
      ${ROLES.map(r => { const ov = overrides(r.id); return html`<tr><td class="font-medium whitespace-nowrap"><label for=${'model-' + r.id} title=${r.does}>${r.name}</label><div class="text-xs text-ink3 font-normal whitespace-normal max-w-[38ch]">${r.does}</div></td>
        <td><select id=${'model-' + r.id} class="select mono" style="min-width:190px" value=${v[r.id]} onChange=${e => setV(Object.assign({}, v, { [r.id]: e.target.value }))}>${MODELS.map(m => html`<option value=${m}>${m}</option>`)}</select></td>
        <td>${ov.length ? ov.map(([n, m]) => html`<a class="link text-sm mr-2" href=${'#/settings/review-levels/' + n}>level ${n}: <span class="mono">${m}</span></a>`) : html`<span class="text-ink4 text-sm">—</span>`}</td></tr>`; })}
    </tbody></table></div>
    <${SaveBar} n=${diff.length} onDiscard=${() => setV(clone(S.models))} onSave=${() => openDialog('confirmSave', { title: 'Save models', area: 'Models', text: 'Changed the ' + diff.map(d => d.k.toLowerCase()).join(' and ') + ' model', diff, impact: 'New rounds use the new model. Rounds that are running keep the model they started with.', apply: () => { S.models = clone(v); } })} />
  </div>`;
}

function SetTeam() {
  const [v, setV] = useState(clone(S.team));
  const set = (i, k, x) => { const n = clone(v); n[i][k] = x; setV(n); };
  const diff = [];
  v.forEach(t => { const o = S.team.find(x => x.id === t.id); if (!o) diff.push({ k: 'New person', from: '', to: t.name + ' (@' + t.gh + ')' }); else ['name', 'gh', 'cu'].forEach(k => { if (o[k] !== t[k]) diff.push({ k: o.name + ': ' + { name: 'name', gh: 'GitHub login', cu: 'ClickUp user' }[k], from: o[k], to: t[k] }); }); });
  S.team.forEach(o => { if (!v.find(t => t.id === o.id)) diff.push({ k: 'Removed', from: o.name + ' (@' + o.gh + ')', to: 'not in the team list' }); });
  const bad = v.find(t => !t.name.trim() || !t.gh.trim());
  return html`<div><${SetHead} title="Team" affects="the names offered in every signature field and in the Person filter. Nobody signs in: a signature is a name picked from this list." right=${html`<${Btn} icon="plus" onClick=${() => setV(v.concat([{ id: uid('p'), name: '', gh: '', cu: '', av: (v.length % 6) + 1 }]))}>Add a person</${Btn}>`} />
    <div class="tblwrap"><table class="tbl"><thead><tr><th style="width:26%">Name</th><th style="width:26%">GitHub login<${Info} tip="Links a person to the PRs they wrote." pos="bottom" /></th><th style="width:26%">ClickUp user<${Info} tip="Who Notify author mentions." pos="bottom" /></th><th>Open PRs</th><th></th></tr></thead><tbody>
      ${v.map((t, i) => html`<tr><td><div class="flex items-center gap-2"><span class=${cx('av', 'av' + t.av)} style="width:24px;height:24px">${(t.name || '?').slice(0, 1).toUpperCase()}</span><input class="input" aria-label="Name" placeholder="Name" value=${t.name} onInput=${e => set(i, 'name', e.target.value)} /></div></td>
        <td><div class="flex items-center gap-1"><span class="text-ink3">@</span><input class="input mono" aria-label="GitHub login" placeholder="github-login" value=${t.gh} onInput=${e => set(i, 'gh', e.target.value.trim())} /></div></td>
        <td><input class="input" aria-label="ClickUp user" placeholder="Name in ClickUp" value=${t.cu} onInput=${e => set(i, 'cu', e.target.value)} /></td>
        <td class="text-xs text-ink3 align-middle">${S.team.find(x => x.id === t.id) ? openPrs().filter(p => p.author === t.id).length : 'new'}</td>
        <td class="r"><${Btn} v="ghost" sz="sm" icon="trash-2" label=${'Remove ' + t.name} tip="Remove from the team list. Past signatures stay in the timeline." tipPos="left" onClick=${() => setV(v.filter((_, j) => j !== i))} /></td></tr>`)}
    </tbody></table></div>
    <${SaveBar} n=${diff.length} onDiscard=${() => setV(clone(S.team))} onSave=${() => bad ? toast({ title: 'A person needs a name and a GitHub login', tone: 'bad' }) : openDialog('confirmSave', { title: 'Save the team list', area: 'Team', text: 'Changed the team list', diff, apply: () => { S.team = clone(v); } })} />
  </div>`;
}

function SetIntegrations() {
  const I = S.integrations, [on, setOn] = useState(I.ghComment);
  return html`<div><${SetHead} title="Integrations" affects="how the factory reads from and writes to GitHub and ClickUp." />
    <${Section} title="GitHub App" right=${html`<${Pill} tone="green" icon="circle-check">Connected</${Pill}>`}>
      <${Row} label="Installation" hint="The app's name is visible on public PRs."><dl class="kv"><dt>App</dt><dd class="mono">${I.github.app}</dd><dt>Organisation</dt><dd>synergycodes</dd><dt>Installed</dt><dd><${Time} t=${I.github.installed} /></dd></dl></${Row}>
      <${Row} label="Repositories" hint="The app can read these and merge or push to their PR branches.">${Object.keys(S.repos).map(r => html`<div class="flex items-center gap-2 text-sm py-0.5"><${Icon} n="folder-git-2" s=${14} cls="text-ink3" /><a class="link mono" href=${'#/settings/repos/' + repoShort(r)}>${r}</a><span class="text-ink3">· ${plural(openPrs().filter(p => p.repo === r).length, 'open PR')}</span></div>`)}</${Row}>
      <${Row} label="Webhook health" hint="GitHub tells the factory when a PR opens, becomes ready, gets commits or closes."><div class="flex items-center gap-2 text-sm flex-wrap"><${Pill} tone="green" icon="activity">Healthy</${Pill}><span>Last delivery <${Time} t=${I.github.lastDelivery} /></span><span class="text-ink3">· ${I.github.failed24h} failed in 24 h</span></div></${Row}>
    </${Section}>
    <${Section} title="Comment on the PR in GitHub">
      <${Row} id="gh-comment" label="Post a comment after each completed round" hint="Failed or cancelled rounds get no comment."><div class="flex items-center gap-3"><${Switch} id="gh-comment" on=${on} onChange=${setOn} label="Post a comment after each completed round" /><span class="text-sm">${on ? 'On' : 'Off'}</span></div>
        <div class="codeblk mt-2"><pre>Ready for team member review (round N)</pre></div>
        <div class="hint mt-1.5">No link, no findings: the PRs are public and this app is private.</div></${Row}>
    </${Section}>
    <${Section} title="ClickUp" right=${html`<${Pill} tone="green" icon="circle-check">Connected</${Pill}>`}>
      <${Row} label="Connection" hint=${'Used to find the task of a PR, for Notify author, and for follow-ups from deferred findings. There is one API key, so ClickUp shows ' + I.clickup.keyOwner + ' as the comment author; the name of the person who signed goes in the comment text.'}><dl class="kv"><dt>Workspace</dt><dd>${I.clickup.workspace}</dd><dt>API key owner</dt><dd>${I.clickup.keyOwner}</dd><dt>Last call</dt><dd><${Time} t=${I.clickup.lastCall} /></dd></dl>
        <div class="mt-3"><${Btn} icon="plug" onClick=${() => toast({ title: 'ClickUp answered in 212 ms', desc: 'The connection works.', tone: 'ok' })}>Test the connection</${Btn}></div></${Row}>
    </${Section}>
    <${SaveBar} n=${on !== I.ghComment ? 1 : 0} onDiscard=${() => setOn(I.ghComment)} onSave=${() => openDialog('confirmSave', { title: 'Save integrations', area: 'Integrations', text: (on ? 'Switched on' : 'Switched off') + ' the GitHub comment', diff: [{ k: 'GitHub comment after a round', from: I.ghComment ? 'On' : 'Off', to: on ? 'On' : 'Off' }], apply: () => { S.integrations.ghComment = on; } })} />
  </div>`;
}

function SetRepos({ sub }) {
  const rp = sub && Object.values(S.repos).find(r => repoShort(r.name) === sub);
  if (rp) return html`<${SetRepo} key=${rp.name} rp=${rp} />`;
  return html`<div><${SetHead} title="Repositories" affects="per-repository rules: the default review level, sensitive files and how the change type is chosen." />
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Repository</th><th>Default level</th><th>Sensitive files</th><th>Default branch</th><th class="r">Open PRs</th><th></th></tr></thead><tbody>
      ${Object.values(S.repos).map(r => html`<tr class="click" onClick=${() => nav('settings/repos/' + repoShort(r.name))}><td><a class="link mono font-medium" href=${'#/settings/repos/' + repoShort(r.name)}>${r.name}</a></td><td>${r.defaultLevel} · ${LEVELS[r.defaultLevel - 1].name}</td><td>${plural(r.sensitive.length, 'pattern')}</td><td class="mono">${r.defaultBranch}</td><td class="r">${openPrs().filter(p => p.repo === r.name).length}</td><td class="r"><${Icon} n="chevron-right" s=${15} cls="text-ink3" /></td></tr>`)}
    </tbody></table></div>
    <p class="hint mt-2">Repositories come from the <a class="link" href="#/settings/integrations">GitHub App</a>.</p></div>`;
}
function SetRepo({ rp }) {
  const [v, setV] = useState(clone(rp)); const up = (k, x) => setV(Object.assign({}, v, { [k]: x }));
  const sens = (i, k, x) => { const n = clone(v.sensitive); n[i][k] = x; up('sensitive', n); };
  const diff = [];
  if (v.defaultLevel !== rp.defaultLevel) diff.push({ k: 'Default level', from: rp.defaultLevel + ' · ' + LEVELS[rp.defaultLevel - 1].name, to: v.defaultLevel + ' · ' + LEVELS[v.defaultLevel - 1].name });
  [['defaultBranch', 'Default branch'], ['install', 'Install command'], ['clickupSpace', 'ClickUp space']].forEach(([k, l]) => { if (v[k] !== rp[k]) diff.push({ k: l, from: rp[k], to: v[k] }); });
  if (!same(v.sensitive, rp.sensitive)) diff.push({ k: 'Sensitive files', from: plural(rp.sensitive.length, 'pattern'), to: plural(v.sensitive.length, 'pattern') + ': ' + v.sensitive.filter(s => !rp.sensitive.find(o => o.pattern === s.pattern)).map(s => '+ ' + s.pattern).concat(rp.sensitive.filter(o => !v.sensitive.find(s => s.pattern === o.pattern)).map(s => '− ' + s.pattern)).join(', ') });
  if (!same(v.ctypeRules, rp.ctypeRules)) diff.push({ k: 'Change-type rules', from: 'current rules', to: 'edited rules' });
  const short = repoShort(rp.name);
  return html`<div><${SetHead} crumbs=${[{ label: 'Repositories', to: 'settings/repos' }, { label: short }]} title=${rp.name} affects=${'every new round on PRs in ' + short + '. Rounds that are running keep the settings they started with.'} />
    <${Section} title="General">
      <${Row} id="repo-level" label="Default review level" hint="Used for round 1 when a PR becomes ready. Anyone can pick another level for one PR on its page."><select id="repo-level" class="select" style="max-width:320px" value=${v.defaultLevel} onChange=${e => up('defaultLevel', Number(e.target.value))}>${LEVELS.map(l => html`<option value=${l.n}>${l.n} · ${l.name}</option>`)}</select><a class="link text-xs mt-1 inline-block" href="#/settings/review-levels">What each level switches on</a></${Row}>
      <${Row} id="repo-branch" label="Default branch" hint="Merges go here."><input id="repo-branch" class="input mono" style="max-width:320px" value=${v.defaultBranch} onInput=${e => up('defaultBranch', e.target.value)} /></${Row}>
      <${Row} id="repo-install" label="Install command" hint="Run in the Checks stage, never for forks."><input id="repo-install" class="input mono" value=${v.install} onInput=${e => up('install', e.target.value)} /></${Row}>
      <${Row} id="repo-cu" label="ClickUp space" hint="Where tasks for PRs are looked up and follow-ups are created."><input id="repo-cu" class="input" style="max-width:320px" value=${v.clickupSpace} onInput=${e => up('clickupSpace', e.target.value)} /></${Row}>
    </${Section}>
    <${Section} title="Sensitive files" sub="A change to a matching file needs a human OK, even after a clean review. Level 5 never pushes a fix to one by itself." right=${html`<${Btn} sz="sm" icon="plus" onClick=${() => up('sensitive', v.sensitive.concat([{ pattern: '', reason: '' }]))}>Add a pattern</${Btn}>`}>
      <div class="overflow-x-auto"><table class="tbl" data-sensitive><thead><tr><th style="width:38%">Path pattern</th><th>Reason shown to people</th><th></th></tr></thead><tbody>
        ${v.sensitive.map((s, i) => html`<tr><td><input class="input mono" aria-label="Path pattern" placeholder="path/or/pattern" value=${s.pattern} onInput=${e => sens(i, 'pattern', e.target.value)} /></td><td><input class="input" aria-label="Reason" placeholder="Why does a change here need a human OK?" value=${s.reason} onInput=${e => sens(i, 'reason', e.target.value)} /></td><td class="r"><${Btn} v="ghost" sz="sm" icon="trash-2" label=${'Remove pattern ' + s.pattern} onClick=${() => up('sensitive', v.sensitive.filter((_, j) => j !== i))} /></td></tr>`)}
      </tbody></table></div>
    </${Section}>
    <${Section} title="Change-type rules" sub="The change type says how risky a PR is. Rules set the floor; the judge may only raise it.">
      <${Row} id="ct-ex" label="Uses existing parts" hint="When only these paths change."><input id="ct-ex" class="input mono" value=${v.ctypeRules.existing} onInput=${e => up('ctypeRules', Object.assign({}, v.ctypeRules, { existing: e.target.value }))} /></${Row}>
      <${Row} id="ct-size" label="Changes behaviour" hint="Everything else, and any PR above this size."><div class="flex items-center gap-2"><input id="ct-size" class="input num" style="width:100px" inputmode="numeric" value=${v.ctypeRules.sizeLines} onInput=${e => up('ctypeRules', Object.assign({}, v.ctypeRules, { sizeLines: Number(e.target.value.replace(/\D/g, '')) || 0 }))} /><span class="text-sm text-ink3">changed lines</span></div></${Row}>
      <${Row} id="ct-ow" label="One-way door" hint="When any of these paths change. Always needs a person."><input id="ct-ow" class="input mono" value=${v.ctypeRules.oneWay} onInput=${e => up('ctypeRules', Object.assign({}, v.ctypeRules, { oneWay: e.target.value }))} /></${Row}>
    </${Section}>
    <${SaveBar} n=${diff.length} onDiscard=${() => setV(clone(rp))} onSave=${() => v.sensitive.some(s => !s.pattern.trim() || !s.reason.trim()) ? toast({ title: 'Each sensitive file pattern needs a path and a reason', tone: 'bad' }) : openDialog('confirmSave', { title: 'Save settings for ' + short, area: 'Repositories', text: 'Changed repository settings of ' + short, diff, apply: () => { S.repos[rp.name] = clone(v); } })} />
  </div>`;
}
