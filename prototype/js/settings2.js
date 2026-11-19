/* Settings, part 2: Review levels, Instructions, Pipeline, Experiments, Learning, Audit log. */
const LEVEL_FIELDS = [
  { k: 'brief', label: 'Reviewer brief', hint: 'One paragraph added to the reviewer\'s instructions at this level.', type: 'text' },
  { k: 'maxFindings', label: 'Most findings per round', hint: 'The reviewer\'s list is cut to this number.', type: 'num' },
  { k: 'maxQuestions', label: 'Most questions per round', hint: '0 means the reviewer may not ask.', type: 'num' },
  { k: 'reviewTimeout', label: 'Review timeout', hint: 'Minutes before the Review stage is stopped.', type: 'num', unit: 'min' }
];
function effective(n, k, levels) { levels = levels || S.levels; for (let i = n; i >= 1; i--) { if (levels[i] && levels[i][k] != null) return { v: levels[i][k], from: i }; } return { v: '', from: 1 }; }
function effModel(n, role, levels) { levels = levels || S.levels; for (let i = n; i >= 1; i--) { if (levels[i] && levels[i].models && levels[i].models[role]) return { v: levels[i].models[role], from: i }; } return { v: S.models[role], from: 0 }; }
const stagesAt = n => ['Review'].concat(n >= 2 ? ['Checks', 'Task', 'Change type'] : [], n >= 3 ? ['Verify'] : [], n >= 4 ? ['Implement with agent'] : [], n >= 5 ? ['Autofix'] : [], n >= 6 ? ['Learning'] : []);

function SetLevels({ sub }) {
  if (sub && LEVELS[Number(sub) - 1]) return html`<${SetLevel} key=${sub} n=${Number(sub)} />`;
  const [def, setDef] = useState(S.defaultLevel);
  const share = { 1: '64%', 2: '7%', 3: '20%', 4: '4%', 5: '3%', 6: '2%' };
  return html`<div><${SetHead} title="Review levels" affects="what runs in a round. A higher level includes everything below it and costs more per round." />
    <${Section} title="The ladder" sub="Each level adds something to the one below. Click a level to change its settings.">
      ${LEVELS.map(l => { const repos = Object.values(S.repos).filter(r => r.defaultLevel === l.n).map(r => repoShort(r.name)); return html`<a class="ladder-step" href=${'#/settings/review-levels/' + l.n} data-level=${l.n}>
        <span class=${cx('lvl', l.n <= S.defaultLevel && 'on')}>${l.n}</span>
        <span class="min-w-0"><span class="font-semibold">${l.name}</span>${l.n === S.defaultLevel && html` <${Badge} tone="blue">Default</${Badge}>`}${repos.map(r => html` <span class="text-xs text-ink3 font-normal">· default in ${r}</span>`)}
          <span class="block text-sm text-ink2 mt-0.5">${l.desc}</span></span>
        <span class="flex items-center gap-3 text-xs text-ink3 whitespace-nowrap"><span class="num hidden sm:inline" data-tip="Share of rounds in the last 14 days" data-tip-pos="left">${share[l.n]} of rounds</span><${Icon} n="chevron-right" s=${15} /></span></a>`; })}
    </${Section}>
    <${Section} title="Default level">
      <${Row} id="def-level" label="Default for repositories without their own" hint="Each repository can set its own default in Repositories."><select id="def-level" class="select" style="max-width:320px" value=${def} onChange=${e => setDef(Number(e.target.value))}>${LEVELS.map(l => html`<option value=${l.n}>${l.n} · ${l.name}</option>`)}</select></${Row}>
    </${Section}>
    <${SaveBar} n=${def !== S.defaultLevel ? 1 : 0} onDiscard=${() => setDef(S.defaultLevel)} onSave=${() => openDialog('confirmSave', { title: 'Change the default level', area: 'Review levels', text: 'Changed the default level', impact: 'Round 1 of new PRs uses level ' + def + ' in repositories without their own default.', diff: [{ k: 'Default level', from: S.defaultLevel + ' · ' + LEVELS[S.defaultLevel - 1].name, to: def + ' · ' + LEVELS[def - 1].name }], apply: () => { S.defaultLevel = def; } })} />
  </div>`;
}
function SetLevel({ n }) {
  const L = LEVELS[n - 1], [v, setV] = useState(clone(S.levels[n] || {})), base = n === 1;
  const lv = Object.assign({}, S.levels, { [n]: v });
  const setOwn = (k, own) => { const x = clone(v); if (own) x[k] = effective(n, k, lv).v; else delete x[k]; setV(x); };
  const setModelOwn = (role, own) => { const x = clone(v); x.models = x.models || {}; if (own) x.models[role] = effModel(n, role, lv).v; else delete x.models[role]; if (!Object.keys(x.models).length) delete x.models; setV(x); };
  const diff = [];
  LEVEL_FIELDS.concat(n === 5 ? [{ k: 'autofixMax', label: 'Automatic patches per chain' }] : []).forEach(f => { const a = (S.levels[n] || {})[f.k], b = v[f.k]; if (a !== b && !(a == null && b == null)) diff.push({ k: f.label, from: a == null ? 'inherited' : String(a), to: b == null ? 'inherited' : String(b) }); });
  ROLES.forEach(r => { const a = ((S.levels[n] || {}).models || {})[r.id], b = (v.models || {})[r.id]; if (a !== b) diff.push({ k: r.name + ' model', from: a || 'default', to: b || 'default' }); });
  /* Inherited values are plain text with an Override link; an own value is the input with a way back. */
  const lnk = (t, f) => html`<button type="button" class="link text-xs bg-transparent border-0 p-0" onClick=${f}>${t}</button>`;
  const inh = (own, shown, from, onChange, input) => base ? input : own ? html`<div class="flex items-center gap-3 flex-wrap">${input}${lnk('Use inherited', () => onChange(false))}</div>`
    : html`<div class="text-sm" data-inherited><span>${shown}</span> <span class="text-ink3">· ${from}</span> ${lnk('Override', () => onChange(true))}</div>`;
  return html`<div><${SetHead} crumbs=${[{ label: 'Review levels', to: 'settings/review-levels' }, { label: 'Level ' + n }]} title=${'Level ' + n + ' · ' + L.name} affects=${'every new round that runs at level ' + n + (n < 6 ? ', and higher levels that inherit from it.' : '.')}
      right=${html`${n > 1 && html`<a class="btn ol sm" href=${'#/settings/review-levels/' + (n - 1)}><${Icon} n="chevron-left" s=${13} />Level ${n - 1}</a>`}${n < 6 && html`<a class="btn ol sm" href=${'#/settings/review-levels/' + (n + 1)}>Level ${n + 1}<${Icon} n="chevron-right" s=${13} /></a>`}`} />
    <${Section} title="What runs at this level" right=${html`<a class="link text-xs" href="#/settings/pipeline">Pipeline diagram</a>`}><div class="px-4 py-3 text-sm"><span class="text-ink2">${stagesAt(n).filter(x => L.adds.indexOf(x) < 0).join(' · ')}${n > 1 ? ' · ' : ''}</span><span class="font-medium">${L.adds.map(x => '+ ' + x).join(' · ')}</span><span class="text-ink3"> · added at this level</span></div></${Section}>
    <${Section} title="Settings" sub=${base ? 'Level 1 is the base: higher levels inherit from it unless they set their own value.' : 'A value is inherited from the nearest lower level that sets it, until you give this level its own.'}>
      ${LEVEL_FIELDS.map(f => { const own = v[f.k] != null, e = effective(base ? 1 : own ? n : n - 1, f.k, lv), val = own ? v[f.k] : e.v; return html`<${Row} id=${'lv-' + f.k} label=${f.label} hint=${f.hint}>
        ${inh(own, val + (f.unit ? ' ' + f.unit : ''), 'inherited from level ' + e.from, o => setOwn(f.k, o), f.type === 'text' ? html`<textarea id=${'lv-' + f.k} class="textarea flex-1 min-w-[240px]" rows="2" value=${val} onInput=${ev => setV(Object.assign({}, v, { [f.k]: ev.target.value }))}></textarea>`
            : html`<div class="flex items-center gap-2"><input id=${'lv-' + f.k} class="input num" inputmode="numeric" style="width:100px" value=${val} onInput=${ev => setV(Object.assign({}, v, { [f.k]: Number(ev.target.value.replace(/\D/g, '')) || 0 }))} />${f.unit && html`<span class="text-sm text-ink3">${f.unit}</span>`}</div>`)}</${Row}>`; })}
    </${Section}>
    <${Section} title="Models at this level" right=${html`<a class="link text-xs" href="#/settings/models">Open Models</a>`}>
      ${ROLES.map(r => { const own = !!(v.models && v.models[r.id]), e = effModel(own ? n : n - 1, r.id, lv); return html`<${Row} id=${'lm-' + r.id} label=${r.name} hint=${r.does}>
        ${own ? html`<div class="flex items-center gap-3 flex-wrap"><select id=${'lm-' + r.id} class="select mono" style="width:200px" value=${v.models[r.id]} onChange=${ev => { const x = clone(v); x.models[r.id] = ev.target.value; setV(x); }}>${MODELS.map(m => html`<option value=${m}>${m}</option>`)}</select>${lnk('Use inherited', () => setModelOwn(r.id, false))}</div>`
          : html`<div class="text-sm" data-inherited><span class="mono">${e.v}</span> <span class="text-ink3">· ${e.from === 0 ? 'default from Models' : 'inherited from level ' + e.from}</span> ${lnk('Override', () => setModelOwn(r.id, true))}</div>`}</${Row}>`; })}
    </${Section}>
    ${n >= 5 && html`<${Section} title="Autofix conditions" sub="At level 5 the factory starts the implementer and pushes by itself only when all of these hold. Otherwise it waits and says why on the PR. At lower levels the same check runs silently and is logged.">
      <div class="px-4 py-3"><ol class="m-0 p-0 list-none grid gap-2 text-sm">${['Every finding that needs work is confirmed and fixed by the patch.', 'Every reproduction passes on the patched code.', 'The patch touches no sensitive file.'].map((t, i) => html`<li class="flex items-start gap-2"><span class="lvl" style="width:22px;height:22px;font-size:12px">${i + 1}</span><span class="pt-0.5">${t}</span></li>`)}
        <li class="flex items-start gap-2"><span class="lvl" style="width:22px;height:22px;font-size:12px">4</span><span class="flex items-center gap-2 flex-wrap">At most ${n === 5 ? html`<input class="input num" aria-label="Automatic patches per chain" style="width:56px;height:28px" value=${v.autofixMax == null ? effective(5, 'autofixMax', lv).v : v.autofixMax} onInput=${e => setV(Object.assign({}, v, { autofixMax: Number(e.target.value.replace(/\D/g, '')) || 0 }))} />` : html`<span class="font-semibold">${effective(n, 'autofixMax', lv).v}</span>`} automatic patches per chain.</span></li></ol>
        <a class="link text-xs mt-3 inline-block" href="#/insights/trust">Shadow log in Insights → Trust ladder</a></div></${Section}>`}
    ${n === 6 && html`<${Section} title="Learning" right=${html`<a class="link text-xs" href="#/settings/learning">Open Learning</a>`}><div class="px-4 py-3 text-sm grid gap-1.5"><div class="flex items-start gap-2"><${Icon} n="check" s=${14} cls="mt-0.5 text-ok" />When a PR at this level is merged or closed, Factory bot runs the analyst.</div><div class="flex items-start gap-2"><${Icon} n="check" s=${14} cls="mt-0.5 text-ok" />A lesson needs at least 2 PRs before it can be accepted.</div><div class="flex items-start gap-2"><${Icon} n="check" s=${14} cls="mt-0.5 text-ok" />A person accepts every lesson. The PR author's own comments are ignored.</div></div></${Section}>`}
    <${SaveBar} n=${diff.length} onDiscard=${() => setV(clone(S.levels[n] || {}))} onSave=${() => openDialog('confirmSave', { title: 'Save level ' + n, area: 'Review levels', text: 'Changed level ' + n + ' · ' + L.name, diff, impact: 'New rounds at level ' + n + (n < 6 ? ' and at higher levels that inherit these values' : '') + ' use the new settings.', apply: () => { S.levels[n] = clone(v); } })} />
  </div>`;
}

/* ---------- Instructions ---------- */
function SetInstructions({ sub }) {
  const file = sub && S.instructions.find(f => f.id === sub);
  if (file) return html`<${InstrEditor} key=${file.id} f=${file} />`;
  const groups = [['global', 'Global', 'Used in every repository.'], ['repo', 'Repository', 'Added for one repository.'], ['level', 'Level copies', 'Replace the global file at one review level.']];
  return html`<div><${SetHead} title="Instructions" affects="what the agents are told. A change applies only after you activate a version; try it on a PR first." />
    ${groups.map(([k, name, tip]) => { const fs = S.instructions.filter(f => f.scope === k); return html`<section class="mb-5"><h2 class="sec-t m-0 mb-2">${name}<${Info} tip=${tip} pos="right" /></h2>
      <div class="tblwrap"><table class="tbl"><thead><tr><th>File</th><th>Read by</th><th>Active version</th><th class="r">Used in runs</th><th></th></tr></thead><tbody>
        ${fs.map(f => { const a = f.versions.find(x => x.n === f.active); return html`<tr class="click" onClick=${() => nav('settings/instructions/' + f.id)}><td class="whitespace-nowrap"><a class="link mono font-medium" href=${'#/settings/instructions/' + f.id}>${f.name}</a>${f.scope === 'repo' && html` <${Badge}>${repoShort(f.repo)}</${Badge}>`}${f.scope === 'level' && html` <${Badge}>level ${f.level}</${Badge}>`}${f.draft && html` <${Badge}>draft v${f.draft.n}</${Badge}>`}<div class="text-xs text-ink3 whitespace-normal">${f.about}</div></td><td>${f.role}</td><td class="whitespace-nowrap">v${f.active} <span class="text-ink3">· ${a.note}</span></td><td class="r">${a.runs}</td><td class="r"><${Icon} n="chevron-right" s=${15} cls="text-ink3" /></td></tr>`; })}
      </tbody></table></div></section>`; })}</div>`;
}
function InstrEditor({ f }) {
  const active = f.versions.find(x => x.n === f.active), baseText = f.draft ? f.draft.text : active.text;
  const [text, setText] = useState(baseText), [note, setNote] = useState(f.draft ? f.draft.note : ''), [err, setErr] = useState(''), [view, setView] = useState(null);
  const dirty = text !== baseText || (f.draft && note !== f.draft.note), changed = text !== active.text;
  const lines = lineDiff(active.text, text), st = diffStat(lines), nextN = Math.max.apply(null, f.versions.map(x => x.n)) + 1;
  const saveDraft = () => { if (!changed) { setErr('Nothing differs from the active version.'); return; } if (!note.trim()) { setErr('Add a short note: it names this version in the history.'); return; } mutate(() => { f.draft = { n: nextN, text, note: note.trim(), at: Date.now() }; }); setErr(''); toast({ title: 'Draft v' + nextN + ' saved', desc: 'No round uses it yet. Try it on a PR, then activate it.', tone: 'ok' }); };
  const activate = (ver, isRollback) => openDialog('confirmSave', { title: (isRollback ? 'Roll back to' : 'Activate') + ' version ' + ver.n + ' of ' + f.name, icon: isRollback ? 'undo-2' : 'rocket', cta: isRollback ? 'Roll back to version ' + ver.n : 'Activate version ' + ver.n, area: 'Instructions',
    text: (isRollback ? 'Rolled back ' : 'Activated ') + f.name + (isRollback ? ' to version ' : ' version ') + ver.n, impact: 'All new rounds will use version ' + ver.n + (isRollback ? ' again' : '') + '. Rounds that are running keep version ' + f.active + '.', diff: [{ k: f.name, from: 'version ' + f.active + ': ' + active.note, to: 'version ' + ver.n + ': ' + ver.note }],
    apply: by => { if (!isRollback) { f.versions.push({ n: ver.n, at: Date.now(), by, note: ver.note, runs: 0, text: ver.text }); f.draft = null; } f.active = ver.n; }, done: () => { if (isRollback) { const t = f.versions.find(x => x.n === ver.n).text; setText(t); setNote(''); } } });
  const shown = view != null ? f.versions.find(x => x.n === view) : null;
  return html`<div><${SetHead} crumbs=${[{ label: 'Instructions', to: 'settings/instructions' }, { label: f.name + (f.scope === 'level' ? ' (level ' + f.level + ' copy)' : '') }]} title=${html`<span class="mono" style="font-size:18px">${f.name}</span>${f.scope === 'level' ? ' · level ' + f.level + ' copy' : f.scope === 'repo' ? ' · ' + repoShort(f.repo) : ''}`} affects=${html`what the ${f.role.toLowerCase()} is told in every new round${f.scope === 'repo' ? ' in ' + repoShort(f.repo) : f.scope === 'level' ? ' at level ' + f.level : ''}. Nothing changes until a version is activated.`} />
    <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] items-start">
      <div class="min-w-0 grid gap-4">
        <div class="grid gap-4 lg:grid-cols-2">
          <section class="card overflow-hidden"><div class="card-h"><label class="card-t" for="instr-text">${f.draft && !dirty ? 'Draft v' + f.draft.n : 'Editor'}</label><span class="text-xs text-ink3">${changed ? 'differs from active v' + f.active : 'same as active v' + f.active}</span></div>
            <textarea id="instr-text" class="textarea code" style="border:0;border-radius:0;min-height:380px;display:block" spellcheck="false" value=${text} onInput=${e => { setText(e.target.value); setErr(''); }}></textarea></section>
          <section class="card overflow-hidden"><div class="card-h"><h2 class="card-t m-0">Diff against active v${f.active}</h2><span class="num text-xs"><span style="color:var(--ok)">+${st.add}</span> <span style="color:var(--bad)">−${st.del}</span></span></div>
            ${changed ? html`<div style="margin:-1px;max-height:420px;overflow:auto" data-instr-diff><${DiffLines} lines=${lines} /></div>` : html`<div class="p-6 text-sm text-ink3 text-center">No changes yet.</div>`}</section>
        </div>
        <section class="card p-4"><div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] items-end">
          <${Field} label="Short note (required)" id="instr-note" hint="Names this version in the history, e.g. “Ask for a test when a public prop is added”. Safe order: save a draft, try it on a PR and compare, then activate. A draft changes nothing for running or new rounds." err=${err}><input id="instr-note" class=${cx('input', err && 'err')} placeholder="What does this version change?" value=${note} onInput=${e => { setNote(e.target.value); setErr(''); }} /></${Field}>
          <div class="flex items-center gap-2 flex-wrap">
            ${dirty || !f.draft ? html`<${Btn} v=${dirty ? 'primary' : 'outline'} icon="save" why=${!changed ? 'Nothing differs from the active version yet.' : null} onClick=${saveDraft}>Save as draft</${Btn}>` : null}
            <${Btn} icon="flask-conical" why=${!f.draft ? 'Save a draft first.' : dirty ? 'Save your changes as a draft first.' : null} onClick=${() => openDialog('tryPr', { file: f.id })}>Try on a PR…</${Btn}>
            ${f.draft && !dirty && html`<${Btn} v="primary" icon="rocket" onClick=${() => activate(f.draft)}>Activate version ${f.draft.n}…</${Btn}>`}
            ${f.draft && html`<${Btn} v="ghost" onClick=${() => { mutate(() => { f.draft = null; }); setText(active.text); setNote(''); }}>Discard draft</${Btn}>`}
          </div></div></section>
        ${shown && html`<section class="card overflow-hidden"><div class="card-h"><h2 class="card-t m-0">Version ${shown.n} · ${shown.note}</h2><${Btn} v="ghost" sz="sm" icon="x" label="Close version" onClick=${() => setView(null)} /></div><div class="codeblk" style="border:0;border-radius:0"><pre style="white-space:pre-wrap">${shown.text}</pre></div></section>`}
      </div>
      <aside><section class="card"><div class="card-h"><h2 class="card-t m-0">Version history</h2></div><ul class="m-0 p-0 list-none divide" data-history>
        ${f.draft && html`<li class="px-3.5 py-2.5"><div class="flex items-center gap-2 flex-wrap"><span class="font-semibold text-sm">v${f.draft.n}</span><${Badge}>Draft</${Badge}></div><div class="text-sm mt-0.5">${f.draft.note}</div><div class="text-xs text-ink3 mt-0.5">saved <${Time} t=${f.draft.at} /> · used in 0 runs</div></li>`}
        ${f.versions.slice().reverse().map(ver => html`<li class="px-3.5 py-2.5"><div class="flex items-center gap-2 flex-wrap"><span class="font-semibold text-sm">v${ver.n}</span>${ver.n === f.active && html`<${Badge} tone="green" icon="check">Active</${Badge}>`}<span class="flex-1"></span><button class="link text-xs bg-transparent border-0 p-0" onClick=${() => setView(ver.n)}>View</button>${ver.n !== f.active && html`<${Btn} sz="sm" icon="undo-2" onClick=${() => activate(ver, true)}>Rollback…</${Btn}>`}</div>
          <div class="text-sm mt-0.5">${ver.note}</div><div class="text-xs text-ink3 mt-0.5 flex items-center gap-1.5 flex-wrap"><${Who} a=${ver.by} s=${14} /> · <${Time} t=${ver.at} /> · used in ${plural(ver.runs, 'run')}</div></li>`)}
      </ul></section></aside>
    </div></div>`;
}
DIALOGS.tryPr = function TryPrDialog({ file, lesson, onClose }) {
  const fid = file || 'lessons', f = S.instructions.find(x => x.id === fid), cands = openPrs().filter(p => p.reviewedSha && !p.fork);
  const [pr, setPr] = useState(String((cands.find(p => p.num === 272) || cands[0]).num)), [level, setLevel] = useState(3);
  const bLabel = lesson ? 'active v' + f.active + ' + this lesson' : 'draft v' + f.draft.n;
  const go = () => { let t; mutate(() => { t = startTrial({ pr: Number(pr), level, file: fid, a: f.active, b: lesson ? f.active + 1 : f.draft.n, bDraft: true, lesson: lesson || null }); }); onClose(); nav('settings/experiments/' + t.id); toast({ title: 'Trial started on #' + pr, desc: 'Two rounds on the same commit. Started by hand, not signed.' }); };
  return html`<${Dialog} icon="flask-conical" title="Try on a PR" desc="Two rounds on the same commit, one per version. The PR itself does not change." onClose=${onClose}
    footer=${html`<${Btn} v="ghost" onClick=${onClose}>Cancel</${Btn}><${Btn} v="primary" icon="play" onClick=${go}>Start the trial</${Btn}>`}>
    <div class="grid gap-3"><${Field} label="Pull request" id="try-pr" hint="Only PRs that were reviewed before, so there is a commit to compare on."><${Combobox} id="try-pr" value=${pr} onChange=${setPr} options=${cands.map(p => ({ value: String(p.num), label: '#' + p.num + ' ' + p.title, sub: authorName(p) }))} lead="git-pull-request" /></${Field}>
      <div class="grid gap-3 sm:grid-cols-2"><${Field} label="Version A" id="try-a"><input id="try-a" class="input" disabled value=${f.name + ' · active v' + f.active} /></${Field}><${Field} label="Version B" id="try-b"><input id="try-b" class="input" disabled value=${f.name + ' · ' + bLabel} /></${Field}></div>
      <${Field} label="Review level for both rounds" id="try-level"><select id="try-level" class="select" value=${level} onChange=${e => setLevel(Number(e.target.value))}>${LEVELS.map(l => html`<option value=${l.n}>${l.n} · ${l.name}</option>`)}</select></${Field}></div>
  </${Dialog}>`;
};

function SetPipeline() {
  const [sel, setSel] = useState(null), s = STAGES.find(x => x.id === sel);
  return html`<div><${SetHead} title="Pipeline" affects="nothing: read-only. Change behaviour in Review levels, Models and Instructions." />
    <section class="card p-4"><${PipelineSvg} onPick=${setSel} sel=${sel} /><div class="hint mt-1">Click a stage for details.</div></section>
    <div class="tblwrap mt-4"><table class="tbl"><thead><tr><th>Stage</th><th>Runs as</th><th>Model</th><th>From level</th><th>Timeout</th><th>Attempts</th></tr></thead><tbody>
      ${STAGES.map(x => html`<tr class="click" onClick=${() => setSel(x.id)}><td class="font-medium">${x.label}</td><td>${x.kind === 'agent' ? 'agent' : x.kind === 'human' ? 'a person' : 'code'}</td><td class="mono">${x.role ? S.models[x.role] : '—'}</td><td>${x.level}</td><td>${x.timeout}</td><td>${x.attempts}</td></tr>`)}
    </tbody></table></div>
    ${s && html`<${Sheet} title=${s.label} sub=${(s.kind === 'agent' ? 'Agent stage' : s.kind === 'human' ? 'A person acts here' : 'Code stage') + ' · runs from level ' + s.level} onClose=${() => setSel(null)}>
      <p class="text-sm m-0 mb-4">${s.what}</p>
      <dl class="kv" style="grid-template-columns:120px minmax(0,1fr);row-gap:12px">
        <dt>Model</dt><dd>${s.role ? html`<span class="mono">${S.models[s.role]}</span> <span class="text-ink3">· role: ${s.role}</span> <a class="link text-xs" href="#/settings/models">Change in Models</a>` : 'No model: ' + (s.kind === 'human' ? 'a person acts' : 'plain code')}</dd>
        <dt>Tools</dt><dd>${s.tools}</dd>
        <dt>Instructions</dt><dd>${s.prompt === '—' ? '—' : s.prompt.split(', ').map((p, i) => { const fi = S.instructions.find(f => f.name === p); return html`${i > 0 ? ', ' : ''}${fi ? html`<a class="link mono" href=${'#/settings/instructions/' + fi.id}>${p}</a>` : html`<span class="mono">${p}</span>`}`; })}</dd>
        <dt>Output</dt><dd>${s.schema}</dd><dt>Timeout</dt><dd>${s.timeout}</dd><dt>Attempts</dt><dd>${s.attempts}</dd>
        <dt>Turns on at</dt><dd><a class="link" href=${'#/settings/review-levels/' + s.level}>Level ${s.level} · ${LEVELS[s.level - 1].name}</a></dd></dl>
    </${Sheet}>`}
  </div>`;
}

/* ---------- Experiments ---------- */
function trialLabel(t) { const f = S.instructions.find(x => x.id === t.file); return { f, a: 'v' + t.a + ' (active)', b: t.lesson ? 'v' + t.a + ' + lesson' : 'v' + t.b + (t.bDraft ? ' (draft)' : '') }; }
function SetExperiments({ sub }) {
  const t = sub && S.trials.find(x => x.id === sub);
  if (t) return html`<${Compare} t=${t} />`;
  const drafts = S.instructions.filter(f => f.draft);
  return html`<div><${SetHead} title="Experiments" affects="nothing by itself. A trial runs two versions of an instruction on the same PR, to compare before you activate."
      right=${html`<${Btn} v="primary" icon="flask-conical" why=${drafts.length ? null : 'There is no draft to try. Save a draft in Instructions first.'} onClick=${() => openDialog('tryPr', { file: drafts[0].id })}>Try on a PR…</${Btn}>`} />
    ${!drafts.length && html`<div class="strip mb-4 bg-surface"><${Icon} n="info" s=${14} cls="text-ink3" /><span>A trial needs a draft: <a class="link" href="#/settings/instructions/review-rules">edit review-rules.md</a>, or try a lesson from <a class="link" href="#/settings/learning">Learning</a>.</span></div>`}
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Trial</th><th>Pull request</th><th>Level</th><th>Status</th><th class="r">Cost A + B</th><th class="r">Started</th><th></th></tr></thead><tbody>
      ${S.trials.map(x => { const l = trialLabel(x), job = S.jobs.find(j => j.trial === x.id), p = job ? Math.min(1, (Date.now() - job.startedAt) / job.sim) : 1; return html`<tr class="click" data-trial=${x.id} onClick=${() => nav('settings/experiments/' + x.id)}><td><a class="link font-medium" href=${'#/settings/experiments/' + x.id}><span class="mono">${l.f.name}</span> ${l.a} against ${l.b}</a></td><td><span class="mono">#${x.pr}</span> <span class="text-ink3">${(S.prs[x.pr] || {}).title || ''}</span></td><td>${x.level}</td>
        <td>${x.status === 'running' ? html`<div class="flex items-center gap-2"><${Pill} tone="blue" live>${job && job.queued ? 'Queued' : p < 0.5 ? 'Running A' : 'Running B'}</${Pill}><div class="bar w-20"><i style=${{ width: Math.round(p * 100) + '%' }}></i></div></div>` : html`<${Pill} tone="green" icon="circle-check">Finished</${Pill}>`}</td>
        <td class="r">${x.status === 'running' ? money((job ? job.cost : 0) * p) + ' so far' : money(x.costA + x.costB)}</td><td class="r text-ink3"><${Time} t=${x.at} /> · by hand</td><td class="r">${x.status === 'done' ? html`<span class="link">Compare</span>` : ''}</td></tr>`; })}
    </tbody></table></div></div>`;
}
function Compare({ t }) {
  const l = trialLabel(t), f = l.f, pr = S.prs[t.pr], job = S.jobs.find(j => j.trial === t.id), p = job ? Math.min(1, (Date.now() - job.startedAt) / job.sim) : 1;
  const active = f.versions.find(x => x.n === t.a), bText = t.lesson ? active.text + '\n\n## ' + t.lesson.title + '\n' + t.lesson.rule : f.draft && f.draft.n === t.b ? f.draft.text : (f.versions.find(x => x.n === t.b) || active).text;
  const col = (title, sub, items, tone) => html`<section class="card"><div class="card-h"><h3 class="card-t m-0">${title}<${Info} tip=${sub} pos="right" /></h3><span class="count">${items.length}</span></div>${items.length ? html`<ul class="m-0 p-0 list-none divide">${items.map(x => html`<li class="px-3.5 py-2 text-sm">${md(x)}</li>`)}</ul>` : html`<div class="px-3.5 py-4 text-sm text-ink3">None.</div>`}</section>`;
  return html`<div><${SetHead} crumbs=${[{ label: 'Experiments', to: 'settings/experiments' }, { label: 'Compare on #' + t.pr }]} title=${html`Compare <span class="mono" style="font-size:18px">${f.name}</span> ${l.a} against ${l.b}`} affects=${html`nothing yet. This is a trial on <a class="link" href=${'#/pr/' + t.pr}>#${t.pr} ${pr ? pr.title : ''}</a> at level ${t.level}. The PR itself was not touched.`}
      right=${t.status === 'done' && f.draft && f.draft.n === t.b ? html`<a class="btn primary" href=${'#/settings/instructions/' + f.id}><${Icon} n="rocket" s=${15} />Go to activate version ${t.b}</a>` : t.status === 'done' && t.lesson ? html`<a class="btn primary" href="#/settings/learning"><${Icon} n="graduation-cap" s=${15} />Back to the lesson</a>` : null} />
    ${t.status === 'running' ? html`<section class="banner t-blue" data-trial-running><span class="banner-ico"><${Icon} n="loader-circle" s=${18} cls="spin" /></span><div class="flex-1 min-w-[240px]"><div class="text-lg font-semibold font-head">${job && job.queued ? 'Queued: ' + (S.factory.paused ? 'the factory is paused' : 'the daily budget is reached') : 'The trial is running: version ' + (p < 0.5 ? 'A' : 'B') + ' of 2'}</div><div class="text-sm text-ink2">Same commit <span class="mono">${pr ? pr.reviewedSha : ''}</span> for both. This page fills in when both are done.</div>
        <div class="flex items-center gap-3 mt-2 text-sm"><span class="num font-medium">${money((job ? job.cost : 0) * p)} so far</span><div class="bar flex-1 max-w-xs"><i style=${{ width: Math.round(p * 100) + '%' }}></i></div></div></div></section>`
    : html`<div class="grid gap-4" data-compare>
      <div class="grid gap-4 lg:grid-cols-3">${col('Only in A · ' + l.a, 'Findings the active version reported and B did not.', t.onlyA, '')}${col('In both', 'Reported by both versions.', t.both, '')}${col('Only in B · ' + l.b, 'New with the changed instruction.', t.onlyB, 'hot')}</div>
      <div class="tblwrap"><table class="tbl"><thead><tr><th>Version</th><th class="r">Findings</th><th class="r">Cost</th><th class="r">Duration</th></tr></thead><tbody>
        <tr><td class="font-medium">A · ${l.a}</td><td class="r">${t.onlyA.length + t.both.length}</td><td class="r">${money(t.costA)}</td><td class="r">${dur(t.durA)}</td></tr><tr><td class="font-medium">B · ${l.b}</td><td class="r">${t.onlyB.length + t.both.length}</td><td class="r">${money(t.costB)}</td><td class="r">${dur(t.durB)}</td></tr></tbody></table></div>
      <section class="card overflow-hidden"><div class="card-h"><h3 class="card-t m-0">Instruction diff: A to B</h3></div><div style="margin:-1px"><${Diff} before=${active.text} after=${bText} ctx=${2} /></div></section></div>`}
  </div>`;
}

/* ---------- Learning ---------- */
function SetLearning() {
  const [edit, setEdit] = useState(null), [draft, setDraft] = useState({});
  const cands = S.candidates.filter(c => c.status === 'proposed').sort((a, b) => (b.prs.length >= 2) - (a.prs.length >= 2)), lf = S.instructions.find(f => f.id === 'lessons');
  const accept = c => openDialog('confirmSave', { title: 'Accept the lesson', icon: 'graduation-cap', cta: 'Accept the lesson', area: 'Learning', text: 'Accepted the lesson "' + c.title + '"', impact: 'Adds the lesson to lessons.md as version ' + (lf.active + 1) + '. Reviewers read it from the next round on.', diff: [{ k: 'lessons.md', from: 'version ' + lf.active, to: 'version ' + (lf.active + 1) + ': + ' + c.title }],
    apply: by => { const a = lf.versions.find(x => x.n === lf.active); lf.versions.push({ n: lf.active + 1, at: Date.now(), by, note: 'Lesson: ' + c.title, runs: 0, text: a.text + '\n\n## ' + c.title + '\n' + c.rule }); lf.active++; c.status = 'accepted'; S.lessons.push({ id: c.id, title: c.title, by, at: Date.now(), prs: c.prs, version: lf.active }); } });
  const reject = c => openDialog('confirmSave', { title: 'Reject the lesson candidate', icon: 'ban', cta: 'Reject the candidate', area: 'Learning', text: 'Rejected the lesson candidate "' + c.title + '"', diff: [{ k: 'Candidate', from: 'proposed', to: 'rejected' }], apply: () => { c.status = 'rejected'; } });
  return html`<div><${SetHead} title="Learning" affects="what reviewers learn from closed PRs. Nothing is learned until a person accepts a lesson." />
    <h2 class="sec-t m-0 mb-2 flex items-center gap-2">Lesson candidates ${cands.length > 0 && html`<span class="count">${cands.length}</span>`}</h2>
    ${cands.length === 0 ? html`<${Empty} icon="graduation-cap">No candidates yet. The analyst proposes lessons after a PR closes at level 6.</${Empty}>` : html`<div class="grid gap-3">${cands.map(c => { const ok = c.prs.length >= 2, ed = edit === c.id; return html`<section class="card" data-cand=${c.id}>
      <div class="p-4 grid gap-2.5"><div class="flex items-start gap-2 flex-wrap"><h3 class="text-base font-semibold m-0 font-sans flex-1 min-w-[240px]">${ed ? html`<input class="input" aria-label="Lesson title" value=${draft.title} onInput=${e => setDraft(Object.assign({}, draft, { title: e.target.value }))} />` : md(c.title)}</h3>
          ${c.fresh && html`<span class="text-xs text-ink3">updated <${Time} t=${c.at} /></span>`}<span class="text-xs text-ink3 whitespace-nowrap">${ok ? c.prs.length + ' PRs: can be accepted' : '1 of 2 PRs: waits for one more'}</span></div>
        <div><div class="blk-t">Rule for the reviewer</div>${ed ? html`<textarea class="textarea" aria-label="Rule" rows="3" value=${draft.rule} onInput=${e => setDraft(Object.assign({}, draft, { rule: e.target.value }))}></textarea>` : html`<div class="prose">${md(c.rule)}</div>`}</div>
        <div><div class="blk-t">Why</div><div class="prose text-ink2">${md(c.why)}</div></div>
        <div class="flex items-center gap-2 flex-wrap text-sm"><span class="blk-t m-0">Came from</span>${c.prs.map(n => S.prs[n] ? html`<a class="badge no-underline mono" href=${'#/pr/' + n}>#${n}</a>` : html`<span class="badge mono" data-tip="Closed earlier; not in this demo's data.">#${n}</span>`)}</div>
        <div class="flex items-center justify-end gap-2 flex-wrap border-t border-div pt-3">
          ${ed ? html`<${Btn} v="ghost" onClick=${() => setEdit(null)}>Cancel</${Btn}><${Btn} v="secondary" icon="check" onClick=${() => { mutate(() => { c.title = draft.title; c.rule = draft.rule; c.edited = true; }); setEdit(null); toast({ title: 'Candidate edited', desc: 'Accept it to make it a lesson.' }); }}>Save edit</${Btn}>`
            : html`<${Btn} icon="pencil" onClick=${() => { setEdit(c.id); setDraft({ title: c.title, rule: c.rule }); }}>Edit</${Btn}><${Btn} icon="flask-conical" onClick=${() => openDialog('tryPr', { lesson: { title: c.title, rule: c.rule } })}>Try on a PR…</${Btn}><${Btn} icon="ban" onClick=${() => reject(c)}>Reject…</${Btn}>
              <${Btn} v=${ok ? 'secondary' : 'outline'} icon="check" why=${ok ? null : 'A lesson needs at least 2 PRs. This one has 1, so it may be a one-off.'} onClick=${() => accept(c)}>Accept…</${Btn}>`}
        </div></div></section>`; })}</div>`}
    <h2 class="sec-t m-0 mt-6 mb-2">Accepted lessons</h2>
    <div class="tblwrap"><table class="tbl" data-lessons><thead><tr><th>Lesson</th><th>From PRs</th><th>Accepted by</th><th>In lessons.md</th></tr></thead><tbody>${S.lessons.slice().reverse().map(l => html`<tr><td class="font-medium">${md(l.title)}</td><td class="mono text-ink2">${l.prs.map(n => '#' + n).join(' ')}</td><td><${Who} a=${l.by} /> <${Time} t=${l.at} cls="text-ink3 text-xs" /></td><td><a class="link" href="#/settings/instructions/lessons">version ${l.version}</a></td></tr>`)}</tbody></table></div>
    <h2 class="sec-t m-0 mt-6 mb-2">Closed pull requests<${Info} pos="right" tip="At level 6 Factory bot runs the analyst when a PR closes. For other PRs you can run it by hand; that is not signed." /></h2>
    <div class="tblwrap"><table class="tbl" data-analyses><thead><tr><th>Pull request</th><th>Closed</th><th>Analyst</th><th>Started by</th><th class="r">Cost</th><th></th></tr></thead><tbody>${S.analyses.map(a => html`<tr><td><span class="font-medium">${a.title}</span> <span class="mono text-ink3">#${a.pr}</span></td><td class="whitespace-nowrap">${a.closed} <${Time} t=${a.at} cls="text-ink3 text-xs" /></td>
      <td>${a.status === 'running' ? html`<${Pill} tone="blue" live>Running</${Pill}>` : a.status === 'done' ? html`<span>${a.result}</span>` : html`<span class="text-ink3">${a.result}</span>`}</td><td>${a.by ? html`<${Who} a=${a.by} />` : '—'}</td><td class="r">${a.cost ? money(a.cost) : '—'}</td>
      <td class="r">${a.status === 'none' && html`<${Btn} sz="sm" icon="play" onClick=${() => { mutate(() => startAnalyst(a.pr, 'hand')); toast({ title: 'Analyst started for #' + a.pr, desc: 'Started by hand, not signed.' }); }}>Run analyst</${Btn}>`}</td></tr>`)}</tbody></table></div>
  </div>`;
}

function SetAudit() {
  const [actor, setActor] = useState(''), [area, setArea] = useState(''), [q, setQq] = useState('');
  const areas = Array.from(new Set(S.audit.map(a => a.area))).sort();
  const rows = S.audit.filter(a => (!actor || a.actor === actor) && (!area || a.area === area) && (!q || (a.text + ' ' + a.diff.map(d => d.k + d.from + d.to).join(' ')).toLowerCase().indexOf(q.toLowerCase()) >= 0));
  return html`<div><${SetHead} title="Audit log" affects="nothing: a record of every signed settings change and every change the factory made by itself." />
    <div class="flex items-end gap-3 flex-wrap mb-3"><div class="w-52"><label class="label" for="au-actor">Who</label><select id="au-actor" class="select" value=${actor} onChange=${e => setActor(e.target.value)}><option value="">Everyone</option>${S.team.map(t => html`<option value=${t.id}>${t.name}</option>`)}<option value="bot">Factory bot</option><option value="hand">By hand (unsigned)</option></select></div>
      <div class="w-52"><label class="label" for="au-area">Area</label><select id="au-area" class="select" value=${area} onChange=${e => setArea(e.target.value)}><option value="">All areas</option>${areas.map(a => html`<option value=${a}>${a}</option>`)}</select></div>
      <div class="flex-1 min-w-[200px] max-w-sm"><label class="label" for="au-q">Search</label><input id="au-q" class="input" placeholder="e.g. budget, review-rules, level" value=${q} onInput=${e => setQq(e.target.value)} /></div>
      ${(actor || area || q) && html`<${Btn} v="ghost" icon="x" onClick=${() => { setActor(''); setArea(''); setQq(''); }}>Clear</${Btn}>`}<span class="flex-1"></span><span class="text-sm text-ink3 pb-1.5">${plural(rows.length, 'entry', 'entries')}</span></div>
    ${rows.length === 0 ? html`<${Empty} icon="search-x">No entry matches. Clear a filter to see more.</${Empty}>` : html`<div class="tblwrap"><table class="tbl" data-audit><thead><tr><th>When</th><th>Who</th><th>Area</th><th>What changed</th><th style="width:38%">Before → after</th></tr></thead><tbody>
      ${rows.map(a => html`<tr><td class="whitespace-nowrap text-ink2"><${Time} t=${a.at} /></td><td class="whitespace-nowrap"><${Who} a=${a.actor} sub=${a.actor === 'hand' ? '' : ''} /></td><td class="whitespace-nowrap"><span class="badge">${a.area}</span></td><td class="font-medium">${a.text}</td>
        <td>${a.diff.map(d => html`<div class="text-xs leading-5"><span class="text-ink3">${d.k}:</span> ${d.from && html`<span class="px-1 rounded" style="background:var(--del-bg)">${d.from}</span> <${Icon} n="arrow-right" s=${11} cls="inline text-ink3" /> `}<span class="px-1 rounded" style="background:var(--add-bg)">${d.to}</span></div>`)}</td></tr>`)}
    </tbody></table></div>`}</div>`;
}

const SETTINGS_PAGES = { budget: SetBudget, models: SetModels, team: SetTeam, integrations: SetIntegrations, repos: SetRepos, 'review-levels': SetLevels, instructions: SetInstructions, pipeline: SetPipeline, experiments: SetExperiments, learning: SetLearning, audit: SetAudit };
function SettingsPage({ route }) {
  const page = route.path[1] || 'budget', sub = route.path[2], C = SETTINGS_PAGES[page] || SetBudget;
  return html`<main class="gutter pt-5 pb-24"><div class="setgrid">
    <nav class="setside" aria-label="Settings">${SETTINGS_NAV.map(([g, items]) => html`<div class="mb-4"><div class="px-2.5 mb-1 text-xs font-semibold text-ink3 font-head">${g}</div>${items.map(([id, label, icon]) => html`<a class="side-a" href=${'#/settings/' + id} aria-current=${page === id ? 'page' : null}><${Icon} n=${icon} s=${15} />${label}${id === 'learning' && S.candidates.filter(c => c.status === 'proposed' && c.prs.length >= 2).length > 0 && html`<span class="count ml-auto">${S.candidates.filter(c => c.status === 'proposed' && c.prs.length >= 2).length}</span>`}</a>`)}</div>`)}</nav>
    <div class="min-w-0"><${C} key=${page + '/' + (sub || '')} sub=${sub} /></div>
  </div></main>`;
}
