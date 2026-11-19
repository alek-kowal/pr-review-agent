/* PR tabs: Findings (opinions, decisions, bulk, keyboard), Questions, Patch, Timeline. */
const SEVS = [['blocking', 'Blocking', 'Must be dealt with before merge.'], ['worth', 'Worth fixing', 'Real problems that do not have to block.'], ['nit', 'Nits', 'Small remarks. A nit never blocks and needs no decision.']];
const VERDICTS = {
  confirmed: { t: 'Confirmed', tone: 'blue', icon: 'check-check', tip: 'The verifier proved it with quoted evidence or a reproduction.' },
  refuted: { t: 'Refuted', tone: 'neutral', icon: 'ban', tip: 'The verifier showed it does not happen. No decision needed.' },
  notproven: { t: 'Not proven', tone: 'neutral', icon: 'circle-help', tip: 'The verifier found no proof either way.' }
};
const DECISIONS = { implement: { t: 'Implement', past: 'Implement', icon: 'wrench', tone: 'neutral', key: 'i' }, reject: { t: 'Reject', past: 'Rejected', icon: 'ban', tone: 'neutral', key: 'r' }, defer: { t: 'Defer to ClickUp', past: 'Deferred to ClickUp', icon: 'clipboard-list', tone: 'neutral', key: 'd' } };
/* A verdict is evidence, not state: plain grey text with an icon, never a pill. */
function VerdictBadge({ f, level }) {
  if (f.verdict === 'unchecked') return html`<span class="vtext" data-tip=${'Level ' + level + ' does not verify findings. Nobody has checked this one yet.'} data-tip-pos="bl" tabindex="0"><${Icon} n="circle-dashed" s=${12} />Unchecked</span>`;
  const v = VERDICTS[f.verdict]; return html`<span class=${cx('vtext', f.verdict === 'confirmed' && 'text-ink2 font-medium')} data-tip=${v.tip} data-tip-pos="bl" tabindex="0"><${Icon} n=${v.icon} s=${12} />${v.t}</span>`;
}
function decisionLine(pr, f) { const d = f.decision; if (!d) return ''; const verb = { implement: 'Implement: decided by ', reject: 'Rejected by ', defer: 'Deferred to ClickUp by ' }[d.v]; return verb + (d.by === 'bot' ? 'Factory bot (autofix)' : actorName(d.by)) + (d.by !== pr.author && d.by !== 'bot' ? ' (author: ' + authorName(pr) + ')' : ''); }

function DecideForm({ pr, ids, v, onDone, inDialog }) {
  const [by, setBy] = useSigner(), [reason, setReason] = useState(''), [agent, setAgent] = useState(false), [err, setErr] = useState('');
  const D = DECISIONS[v], n = ids.length, canAgent = pr.level >= 4 && !pr.fork;
  const submit = e => {
    e && e.preventDefault();
    if (v === 'reject' && !reason.trim()) { setErr('A reason is required to reject, so the author knows why.'); return; }
    if (!by) { setErr('Pick your name to sign the decision.'); return; }
    let undo; mutate(() => { undo = decide(pr, ids, v, by, { reason: reason.trim(), agent: v === 'implement' && agent && canAgent }); });
    UI.form = null; UI.sel[pr.num] = []; commit();
    toast({ title: plural(n, 'finding') + ': ' + D.past.toLowerCase() + (v === 'implement' && agent && canAgent ? ', implementer started' : ''), desc: 'Signed by ' + actorName(by) + (by !== pr.author ? ' (author: ' + authorName(pr) + ')' : '') + '.', undo });
    onDone && onDone();
  };
  return html`<form class=${inDialog ? 'grid gap-3' : 'grid gap-3 p-3 rounded-lg border border-line bg-sunk'} onSubmit=${submit} data-form=${v}>
    ${!inDialog && html`<div class="font-medium text-sm flex items-center gap-2"><${Icon} n=${D.icon} s=${14} />${D.t}${n > 1 ? ' ' + n + ' findings' : ''}</div>`}
    ${v === 'implement' && html`<div><label class="flex items-start gap-2 text-sm ${canAgent ? 'cursor-pointer' : ''}"><input type="checkbox" id="agent-check" class="check mt-0.5" checked=${agent && canAgent} disabled=${!canAgent} onChange=${e => setAgent(e.target.checked)} />
        <span><span class=${canAgent ? 'font-medium' : 'font-medium text-ink3'}>Implement with agent</span><${Info} tip=${'Implement means “this must be fixed”. With the agent: it writes a patch now and you see the diff before any push; your signature covers both. Without: ' + authorName(pr) + ' fixes it and pushes.'} />${!canAgent && html`<span class="block hint">${pr.fork ? 'Not on forks: the agent cannot push to a fork.' : 'Turns on at level 4; this PR is at level ' + pr.level + '.'}</span>`}</span></label>
      ${!canAgent && !pr.fork && html`<button type="button" class="link text-xs bg-transparent border-0 p-0 ml-6 mt-1" onClick=${() => mutate(() => { pr.level = 4; tlog(pr, 'hand', 'Review level for this PR raised to 4 by hand'); })}>Raise this PR to level 4</button>`}</div>`}
    ${v === 'reject' && html`<${Field} label="Reason (required)" id="dec-reason" hint="Shown under the finding and in the timeline."><textarea id="dec-reason" data-autofocus class=${cx('textarea', err && !reason.trim() && 'err')} rows="2" placeholder="Why is this not going to be fixed?" value=${reason} onInput=${e => { setReason(e.target.value); setErr(''); }}></textarea></${Field}>`}
    ${v === 'defer' && html`<${Field} label="Note for the follow-up task (optional)" id="dec-reason" hint=${pr.clickup ? 'Creates a ClickUp follow-up task linked to ' + pr.clickup + '.' : 'Creates a ClickUp follow-up task in the repository\'s space.'}><textarea id="dec-reason" data-autofocus class="textarea" rows="2" value=${reason} onInput=${e => setReason(e.target.value)}></textarea></${Field}>`}
    <div class="flex items-end gap-3 flex-wrap"><div class="flex-1 min-w-[200px]"><${Sign} id=${'dec-sign-' + v} value=${by} onChange=${x => { setBy(x); setErr(''); }} note=${'Usually decided by: ' + authorName(pr) + ' (author). Anyone may decide; the record says who did.'} /></div></div>
    ${err && html`<div class="hint" style="color:var(--bad)" role="alert">${err}</div>`}
    ${!inDialog && html`<div class="flex justify-end gap-2"><${Btn} v="ghost" onClick=${() => { UI.form = null; commit(); }}>Cancel</${Btn}><${Btn} v="primary" type="submit" icon=${D.icon}>${D.t}${n > 1 ? ' ' + n : ''}</${Btn}></div>`}
    ${inDialog && html`<button type="submit" id="bulk-submit" hidden></button>`}
  </form>`;
}

function Finding({ pr, f, cur, sel, open, draft, readOnly, behind }) {
  const num = pr.num, key = num + ':' + f.id, form = UI.form && UI.form.num === num && UI.form.fid === f.id ? UI.form : null;
  const w = f.opinions.filter(o => o.v === 'worth'), nw = f.opinions.filter(o => o.v === 'not'), d = f.decision, needs = !d && f.verdict !== 'refuted' && f.sev !== 'nit' && f.resolved !== true;
  const toggle = () => { UI.open[key] = !open; UI.cur[num] = f.id; commit(); };
  const setOp = v => { const dr = UI.draft[num] = UI.draft[num] || {}; if (dr[f.id] && dr[f.id].v === v) delete dr[f.id]; else dr[f.id] = { v, comment: (dr[f.id] || {}).comment || '' }; commit(); };
  const sevName = { blocking: 'Blocking', worth: 'Worth fixing', nit: 'Nit' }[f.sev];
  return html`<article class=${cx('finding', cur && 'cur', sel && 'sel')} id=${'f-' + f.id} data-finding=${f.id} data-decision=${d ? d.v : ''} aria-label=${sevName + ': ' + f.title.replace(/`/g, '')}>
    <div class="f-row">
      <label class="f-check" data-tip="Select (x)" data-tip-pos="right"><input type="checkbox" class="check" checked=${sel} disabled=${readOnly} aria-label=${'Select finding ' + f.id} onChange=${() => { const s = UI.sel[num] = UI.sel[num] || []; const i = s.indexOf(f.id); i >= 0 ? s.splice(i, 1) : s.push(f.id); commit(); }} /></label>
      <button class="f-main" aria-expanded=${String(open)} aria-controls=${'fb-' + f.id} onClick=${toggle}>
        <div class="flex items-start gap-x-3 gap-y-1.5 flex-wrap lg:flex-nowrap">
          <div class="flex-1 min-w-[240px]">
            <div class="flex items-start gap-2"><span class=${cx('sev mt-1.5', f.sev)} role="img" aria-label=${sevName}></span><span class=${cx('font-medium', (f.verdict === 'refuted' || f.resolved === true) && 'text-ink3')}>${md(f.title)}</span></div>
            <div class="mono text-ink3 mt-1 ml-4 break-all">${f.file}:${f.line}</div>
          </div>
          <div class="flex items-center gap-x-3 gap-y-1 flex-wrap justify-end ml-4 lg:ml-0 lg:max-w-[46%]">
            ${f.resolved === true && html`<${Badge} tone="green" icon="circle-check">Resolved</${Badge}>`}${f.resolved === false && html`<${Badge} tone="red" icon="circle-x">Not resolved</${Badge}>`}
            <${VerdictBadge} f=${f} level=${pr.rounds.length ? pr.rounds[pr.rounds.length - 1].level : pr.level} />
            ${(w.length > 0 || nw.length > 0) && html`<span class="vtext" data-tip=${[w.length && 'Worth implementing: ' + w.map(o => actorName(o.by)).join(', '), nw.length && 'Not worth it: ' + nw.map(o => actorName(o.by)).join(', ')].filter(Boolean).join(' · ')} data-tip-pos="bl">${w.length > 0 && html`<span class="inline-flex items-center gap-0.5"><${Icon} n="thumbs-up" s=${11} />${w.length}</span>`}${nw.length > 0 && html`<span class="inline-flex items-center gap-0.5"><${Icon} n="thumbs-down" s=${11} />${nw.length}</span>`}</span>`}
            ${draft && html`<span class="vtext" style="color:var(--brand-text)"><${Icon} n=${draft.v === 'worth' ? 'thumbs-up' : 'thumbs-down'} s=${11} />your draft</span>`}
            ${d && html`<${Badge} tone="neutral" icon=${DECISIONS[d.v].icon}>${DECISIONS[d.v].past}</${Badge}>`}
            <${Icon} n=${open ? 'chevron-up' : 'chevron-down'} s=${15} cls="text-ink3" />
          </div>
        </div>
      </button>
    </div>
    ${open && html`<div class="f-body" id=${'fb-' + f.id}>
      ${f.resolved === false && f.resolvedNote && html`<div class="text-sm flex items-start gap-2"><${Icon} n="circle-x" s=${14} cls="text-bad mt-0.5" /><span>${f.resolvedNote}</span></div>`}
      <div class="grid gap-x-6 gap-y-4 xl:grid-cols-2">
        <div class="grid gap-3.5 content-start min-w-0">
          <div><div class="blk-t">Scenario</div><div class="prose">${md(f.scenario)}</div></div>
          <div><div class="blk-t">Suggestion</div><div class="prose">${md(f.suggestion)}</div></div>
          ${f.before && f.after && html`<div class="min-w-0"><div class="blk-t">Suggested change</div><${Diff} before=${f.before} after=${f.after} /></div>`}
        </div>
        <div class="grid gap-3.5 content-start min-w-0">
          ${f.verdict === 'unchecked' ? html`<div class="rounded-lg border border-dashed border-line p-3 text-sm text-ink2"><div class="font-medium text-ink flex items-center gap-1.5"><${Icon} n="circle-dashed" s=${14} />Unchecked (level ${pr.rounds.length ? pr.rounds[pr.rounds.length - 1].level : pr.level})</div><div class="mt-1">Not verified at this level. For a verdict, start a review at level 3.</div></div>`
            : html`<div><div class="blk-t">Verifier: ${VERDICTS[f.verdict].t.toLowerCase()}</div><div class="prose">${md(f.reason)}</div></div>
              ${f.evidence && f.evidence.length > 0 && html`<div class="min-w-0"><div class="blk-t">Evidence quoted from the code</div><div class="grid gap-2">${f.evidence.map(e => html`<div class="quote min-w-0"><div class="mono text-ink3 break-all">${e.file}:${e.line}</div><div class="codeblk mt-1"><pre>${e.quote}</pre></div></div>`)}</div></div>`}
              ${f.repro && html`<div class="min-w-0"><div class="blk-t">Reproduction <span class="font-normal text-ink3">· exit ${f.repro.exit}: ${f.repro.exit === 0 ? 'reproduced' : f.repro.exit === 3 ? 'does not happen' : 'could not run'}</span></div><div class="codeblk"><pre><span class="text-ink3">$ ${f.repro.cmd}</span>${'\n' + f.repro.out}</pre></div></div>`}`}
        </div>
      </div>
      <div><div class="blk-t">Opinions from the team${f.opinions.length ? ' (' + f.opinions.length + ')' : ''}</div>
        ${f.opinions.length === 0 && !draft ? html`<div class="text-sm text-ink3">No opinions yet.</div>`
          : html`<ul class="m-0 p-0 list-none grid gap-1.5">${f.opinions.map(o => html`<li class="flex items-start gap-2 text-sm"><${Avatar} a=${o.by} s=${20} /><div class="min-w-0"><span class="font-medium">${actorName(o.by)}</span> <span class="inline-flex items-center gap-1 text-ink2"><${Icon} n=${o.v === 'worth' ? 'thumbs-up' : 'thumbs-down'} s=${12} />${o.v === 'worth' ? 'Worth implementing' : 'Not worth it'}</span>${o.comment && html`<span class="text-ink2"> · "${o.comment}"</span>`} <span class="text-xs text-ink3">· ${o.carried && html`<span title="Carried over from an earlier round: same file and content.">from round ${o.round} · </span>`}<${Time} t=${o.at} /></span></div></li>`)}</ul>`}
      </div>
      ${!readOnly && html`<div class="border-t border-div pt-3 grid gap-3">
        <div class="flex items-center gap-x-6 gap-y-3 flex-wrap">
          <div class="flex items-center gap-2 flex-wrap"><span class="text-xs font-medium text-ink3 w-16">Opinion</span>
            <${Btn} sz="sm" icon="thumbs-up" cls=${draft && draft.v === 'worth' ? 'on' : ''} pressed=${!!(draft && draft.v === 'worth')} kbd="w" onClick=${() => setOp('worth')}>Worth implementing</${Btn}>
            <${Btn} sz="sm" icon="thumbs-down" cls=${draft && draft.v === 'not' ? 'on' : ''} pressed=${!!(draft && draft.v === 'not')} kbd="n" onClick=${() => setOp('not')}>Not worth it</${Btn}></div>
          <div class="flex items-center gap-2 flex-wrap"><span class="text-xs font-medium text-ink3 w-16">${d ? 'Change' : 'Decide'}</span>
            ${Object.keys(DECISIONS).map(k => html`<${Btn} sz="sm" icon=${DECISIONS[k].icon} cls=${(form && form.v === k) || (d && d.v === k && !form) ? 'on' : ''} kbd=${DECISIONS[k].key} onClick=${() => { UI.form = { num, fid: f.id, v: k }; commit(); }}>${DECISIONS[k].t}${k === 'reject' ? '…' : ''}</${Btn}>`)}${!d && html`<span class="text-xs text-ink3">usually ${authorName(pr)} (author)</span>`}</div>
        </div>
        ${draft && html`<div class="flex items-center gap-2"><input class="input" id=${'opc-' + f.id} aria-label="Comment for your opinion (optional)" placeholder="Comment on your opinion (optional)" value=${draft.comment} onInput=${e => { draft.comment = e.target.value; commit(); }} /></div>`}
        ${d && !form && html`<div class="text-sm text-ink2 flex items-center gap-2 flex-wrap"><${Icon} n=${DECISIONS[d.v].icon} s=${14} /><span class="font-medium text-ink">${decisionLine(pr, f)}</span><${Time} t=${d.at} cls="text-ink3" />${d.reason && html`<span>· "${d.reason}"</span>`}${d.agent && d.by !== 'bot' && html`<${Badge}>with agent</${Badge}>`}</div>`}
        ${form && html`<${DecideForm} key=${form.v} pr=${pr} ids=${[f.id]} v=${form.v} />`}
      </div>`}
    </div>`}
  </article>`;
}

function FindingsTab({ pr }) {
  const num = pr.num, stale = UI.stale && UI.stale[num], data = stale || pr.findings, st = prState(pr);
  const [filter, setFilter] = useState('all');
  const draft = UI.draft[num] || {}, sel = (UI.sel[num] || []).filter(id => data.some(f => f.id === id)), dIds = Object.keys(draft);
  const needs = f => !f.decision && f.verdict !== 'refuted' && f.sev !== 'nit' && f.resolved !== true;
  const shown = data.filter(f => filter === 'all' || (filter === 'todo' ? needs(f) : !!f.decision));
  const rank = f => (f.resolved === true || f.verdict === 'refuted' ? 2 : f.decision ? 1 : 0);
  const groups = SEVS.map(([k, name, tip]) => [k, name, tip, shown.filter(f => f.sev === k).sort((a, b) => rank(a) - rank(b) || a.id - b.id)]).filter(g => g[3].length);
  const order = groups.flatMap(g => g[3].map(f => f.id)); const ordRef = useRef(order); ordRef.current = order;
  const fixed = data.filter(f => f.decision && f.decision.v === 'implement' && f.resolved != null);
  useEffect(() => {
    const key = e => {
      if (UI.dialog || UI.palette || UI.shortcuts || UI.chip || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target; if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
      const ord = ordRef.current; if (!ord.length) return; let cur = UI.cur[num]; const i = ord.indexOf(cur);
      const focusCur = id => { UI.cur[num] = id; commit(); const el = document.getElementById('f-' + id); el && el.scrollIntoView({ block: 'nearest' }); };
      const k = e.key.toLowerCase();
      if (k === 'j') { focusCur(ord[Math.min(ord.length - 1, i + 1)]); e.preventDefault(); return; }
      if (k === 'k') { focusCur(ord[Math.max(0, i < 0 ? 0 : i - 1)]); e.preventDefault(); return; }
      if (i < 0) return;
      const kk = num + ':' + cur;
      if (k === 'o') { UI.open[kk] = !UI.open[kk]; commit(); }
      else if (k === 'x') { const s = UI.sel[num] = UI.sel[num] || []; const j = s.indexOf(cur); j >= 0 ? s.splice(j, 1) : s.push(cur); commit(); }
      else if (k === 'w' || k === 'n') { const v = k === 'w' ? 'worth' : 'not'; const dr = UI.draft[num] = UI.draft[num] || {}; if (dr[cur] && dr[cur].v === v) delete dr[cur]; else dr[cur] = { v, comment: (dr[cur] || {}).comment || '' }; commit(); }
      else if (k === 'i' || k === 'r' || k === 'd') { UI.open[kk] = true; UI.form = { num, fid: cur, v: { i: 'implement', r: 'reject', d: 'defer' }[k] }; commit(); e.preventDefault(); }
      else return;
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [num]);
  if (!data.length) return html`<${Empty} icon=${pr.run ? 'loader-circle' : 'list-checks'} title=${pr.run && pr.run.kind !== 'fix' ? 'Findings appear when the round finishes' : pr.reviewedSha ? 'No findings on ' + pr.reviewedSha : 'No findings yet'}>${!pr.run && !pr.reviewedSha && !pr.failed && (pr.draft ? 'Round 1 starts when the PR is marked ready.' : 'Start a review to get findings.')}</${Empty}>`;
  const w = dIds.filter(id => draft[id].v === 'worth').length, nwN = dIds.length - w;
  /* A filter for a handful of findings is noise: it shows from 7 findings up. */
  const many = data.length > 6, allOpen = order.length > 0 && order.every(id => UI.open[num + ':' + id]);
  const expand = html`<button class="link text-xs bg-transparent border-0 p-0" onClick=${() => { order.forEach(id => { UI.open[num + ':' + id] = !allOpen; }); commit(); }}>${allOpen ? 'Collapse all' : 'Expand all'}</button>`;
  const setDraftAll = v => { const dr = UI.draft[num] = UI.draft[num] || {}; sel.forEach(id => { dr[id] = { v, comment: (dr[id] || {}).comment || '' }; }); UI.sel[num] = []; commit(); };
  return html`<div data-tab="findings">
    ${stale && html`<div class="strip mb-3" role="status"><${Icon} n="refresh-cw" s=${14} cls="text-brandt" /><span class="flex-1">New results: round ${pr.chain.n} finished. These are the earlier findings.</span><${Btn} sz="sm" v="secondary" onClick=${() => { delete UI.stale[num]; commit(); }}>View new results</${Btn}></div>`}
    ${st === 'newcommits' && html`<div class="strip mb-3"><${Icon} n="git-commit-horizontal" s=${14} cls="text-warn" /><span>From <span class="mono">${pr.reviewedSha}</span> · ${plural(pr.commitsSince, 'commit')} behind<${Info} tip="These findings stay usable until the next review: you can still give opinions and decide." /></span></div>`}
    ${fixed.length > 0 && html`<div class="strip mb-3" data-fixes><${Icon} n=${fixed.every(f => f.resolved) ? 'circle-check' : 'circle-alert'} s=${14} cls=${fixed.every(f => f.resolved) ? 'text-ok' : 'text-warn'} /><span class="font-medium">${fixed.filter(f => f.resolved).length} of ${fixed.length} fixes resolved<${Info} tip="The last round checked each finding marked Implement against the new commits." /></span></div>`}
    ${many && html`<div class="flex items-center gap-3 mb-2.5 flex-wrap">
      <div class="seg" role="group" aria-label="Filter findings">${[['all', 'All'], ['todo', 'To decide'], ['done', 'Decided']].map(([k, t]) => html`<button aria-pressed=${String(filter === k)} onClick=${() => setFilter(k)}>${t}</button>`)}</div>
      <span class="flex-1"></span>${expand}</div>`}
    ${groups.length === 0 && html`<${Empty}>No finding matches this filter.</${Empty}>`}
    ${groups.map(([k, name, tip, items], gi) => html`<section class="mb-4" aria-label=${name}>
      <div class="flex items-center mb-1.5"><h3 class="flex items-center gap-2 text-sm font-semibold m-0" data-tip=${tip} data-tip-pos="right" tabindex="0"><span class=${cx('sev', k)}></span>${name}<span class="text-ink3 font-normal font-sans num">${items.length}</span></h3><span class="flex-1"></span>${gi === 0 && !many && expand}</div>
      ${items.map(f => html`<${Finding} key=${f.id} pr=${pr} f=${f} cur=${UI.cur[num] === f.id} sel=${sel.indexOf(f.id) >= 0} open=${!!UI.open[num + ':' + f.id]} draft=${draft[f.id]} readOnly=${!!stale || !!pr.merged || !!pr.closed} behind=${st === 'newcommits'} />`)}
    </section>`)}
    ${sel.length > 0 && html`<div class="sticky-bar" role="toolbar" aria-label="Bulk actions" data-bulk>
      <span class="font-medium text-sm">${sel.length} selected</span><${Btn} v="ghost" sz="sm" onClick=${() => { UI.sel[num] = []; commit(); }}>Clear</${Btn}>
      <span class="flex-1"></span><span class="text-xs text-ink3">Opinion</span><${Btn} sz="sm" icon="thumbs-up" onClick=${() => setDraftAll('worth')}>Worth implementing</${Btn}><${Btn} sz="sm" icon="thumbs-down" onClick=${() => setDraftAll('not')}>Not worth it</${Btn}>
      <span class="text-xs text-ink3 ml-2">Decide</span>${Object.keys(DECISIONS).map(k => html`<${Btn} sz="sm" icon=${DECISIONS[k].icon} onClick=${() => openDialog('bulkDecide', { num, ids: sel.slice(), v: k })}>${DECISIONS[k].t}…</${Btn}>`)}
    </div>`}
    ${dIds.length > 0 && sel.length === 0 && html`<div class="sticky-bar" style="border-color:var(--brand)" role="region" aria-label="Your review" data-tray>
      <${Icon} n="message-square-text" s=${16} cls="text-brandt" /><span class="text-sm"><span class="font-semibold">Your review: ${plural(dIds.length, 'opinion')}</span> <span class="text-ink3">${[w && w + ' worth implementing', nwN && nwN + ' not worth it'].filter(Boolean).join(', ')}</span></span>
      <span class="flex-1"></span><${Btn} v="ghost" sz="sm" onClick=${() => { UI.draft[num] = {}; commit(); }}>Discard</${Btn}><${Btn} v="primary" icon="check" onClick=${() => openDialog('saveReview', { num })}>Save review…</${Btn}>
    </div>`}
  </div>`;
}

function QuestionsTab({ pr }) {
  const [pick, setPick] = useState({}), [own, setOwn] = useState({}), [by, setBy] = useSigner(), [err, setErr] = useState('');
  const open = openQuestions(pr), ro = pr.merged || pr.closed;
  if (!pr.questions.length) return html`<${Empty} icon="message-circle-question" title=${pr.reviewedSha ? 'The reviewer asked nothing' : 'No questions yet'}></${Empty}>`;
  const ans = {}; open.forEach(q => { const t = (own[q.id] || '').trim(); if (t) ans[q.id] = t; else if (pick[q.id] != null) ans[q.id] = q.options[pick[q.id]]; });
  const n = Object.keys(ans).length;
  const save = () => { if (!by) { setErr('Pick your name to sign the answers.'); return; } mutate(() => answerQuestions(pr, ans, by)); setPick({}); setOwn({}); const left = openQuestions(pr).length; toast({ title: plural(n, 'answer') + ' saved', desc: 'Signed by ' + actorName(by) + '. ' + (left ? plural(left, 'question') + ' left.' : 'Next: ' + nextStep(pr).short.toLowerCase() + '.'), tone: 'ok' }); if (!left) setQ({ tab: 'findings' }); };
  return html`<div class="grid gap-3" data-tab="questions">
    ${pr.questions.map((q, qi) => html`<section class="card" data-question=${q.id} aria-labelledby=${'q-' + q.id}>
      <div class="p-4"><div class="flex items-start gap-3"><span class="lvl" style="width:26px;height:26px;font-size:12px">Q${qi + 1}</span><div class="min-w-0 flex-1"><h3 class="text-base font-semibold m-0 font-sans" id=${'q-' + q.id}>${md(q.text)}</h3><p class="text-sm text-ink2 m-0 mt-1">${md(q.why)}</p></div></div>
      ${q.answer ? html`<div class="mt-3 ml-[38px] flex items-start gap-2 text-sm"><${Avatar} a=${q.answer.by} s=${20} /><div><span class="font-medium">${actorName(q.answer.by)}</span> answered <${Time} t=${q.answer.at} cls="text-ink3" /><div class="mt-0.5">${md(q.answer.text)}</div></div></div>`
        : html`<fieldset class="mt-3 ml-[38px] border-0 p-0 m-0 grid gap-1.5" disabled=${ro}><legend class="sr-only">Options</legend>
          ${q.options.map((o, i) => html`<label class=${cx('flex items-center gap-2.5 px-3 py-2 rounded-md border cursor-pointer text-sm', pick[q.id] === i && !(own[q.id] || '').trim() ? 'border-brand bg-brandbg' : 'border-line hover:bg-sunk')}><input type="radio" class="check" name=${'q' + pr.num + '-' + q.id} checked=${pick[q.id] === i && !(own[q.id] || '').trim()} onChange=${() => { setPick(Object.assign({}, pick, { [q.id]: i })); setOwn(Object.assign({}, own, { [q.id]: '' })); setErr(''); }} /><span class="flex-1">${md(o)}</span>${q.rec === i && html`<span class="vtext"><${Icon} n="sparkle" s=${11} />recommended</span>`}</label>`)}
          <input class="input mt-1" id=${'q-own-' + q.id} aria-label="Your own answer" placeholder="Or write your own answer" value=${own[q.id] || ''} onInput=${e => { setOwn(Object.assign({}, own, { [q.id]: e.target.value })); setErr(''); }} />
        </fieldset>`}</div>
    </section>`)}
    ${open.length > 0 && !ro && html`<div class="sticky-bar" data-answers><div class="flex-1 min-w-[220px]"><${Sign} id="q-sign" inline value=${by} onChange=${v => { setBy(v); setErr(''); }} /></div>
      ${err && html`<span class="hint" style="color:var(--bad)" role="alert">${err}</span>`}
      <${Btn} v="primary" icon="check" why=${n === 0 ? 'Pick an option or write an answer first.' : null} onClick=${save}>Save ${n ? plural(n, 'answer') : 'answers'}</${Btn}></div>`}
  </div>`;
}

function PatchTab({ pr }) {
  const p = pr.patch, [edit, setEdit] = useState(null), [text, setText] = useState(''), [note, setNote] = useState('');
  if (pr.run && pr.run.kind === 'fix') { const v = runView(pr.run), s = v.steps[v.cur] || {}; return html`<${Empty} icon="wrench" title="The implementer is writing the patch">${s.label ? s.label + (s.units ? ': ' + s.unit.replace('%d', s.du).replace('%d', s.units) : '') + ' · ' : ''}${money(v.cost)} so far</${Empty}>`; }
  if (!p) return html`<${Empty} icon="file-diff" title="No patch">Appears after Implement with agent, or level 5 autofix.</${Empty}>`;
  const live = p.state === 'ready', files = p.files.filter(f => !f.reverted);
  const revise = () => { mutate(() => { tlog(pr, 'hand', 'Revise requested by hand' + (note.trim() ? ': "' + note.trim() + '"' : '')); const prevRev = p.rev; startRun(pr, 'fix', { by: p.by === 'bot' ? 'hand' : p.by }); pr.patch.rev = prevRev; pr.patch.state = 'revising'; }); setNote(''); toast({ title: 'Implementer is revising the patch', desc: 'It reads your note and the current diff.' }); };
  return html`<div class="grid gap-3" data-tab="patch">
    <div class="metaline"><span class="text-ink font-medium">${live ? 'Patch, revision ' + p.rev : p.state === 'pushed' ? html`Pushed as <span class="mono">${p.sha}</span>` : 'Patch'}</span><span class="sep">·</span><span>Fixed ${p.fixed} of ${p.total}</span><span class="sep">·</span><span>reproductions pass<${Info} tip="Each reproduction that showed a bug was run again on the patched code." /></span><span class="sep">·</span><span>started by ${p.by === 'bot' ? 'Factory bot (autofix)' : actorName(p.by)}</span><span class="sep">·</span><span class="num">${money(p.cost)}</span></div>
    ${p.stale && live && html`<div class="strip"><${Icon} n="git-commit-horizontal" s=${15} cls="text-warn" />The branch moved. Revise to rebuild the patch on the new head; a push is never forced.</div>`}
    ${p.files.map((f, i) => { const lines = lineDiff(f.before, f.after), stt = diffStat(lines), fd = pr.findings.find(x => x.id === f.finding);
      return html`<section class="card overflow-hidden" data-file=${f.path}>
        <div class="card-h flex-wrap"><div class="min-w-0 flex items-center gap-2 flex-wrap"><${Icon} n="file-code" s=${14} cls="text-ink3" /><span class=${cx('mono break-all', f.reverted && 'line-through text-ink3')}>${f.path}</span>
          ${!f.reverted && html`<span class="num text-xs"><span style="color:var(--ok)">+${stt.add}</span> <span style="color:var(--bad)">−${stt.del}</span></span>`}${f.sensitive && html`<${Badge} icon="shield-alert">Sensitive: ${f.sensitive}</${Badge}>`}${f.edited && html`<${Badge}>edited by hand</${Badge}>`}${f.reverted && html`<${Badge}>reverted, will not be pushed</${Badge}>`}</div>
          ${live && html`<div class="flex items-center gap-1.5">${f.reverted ? html`<${Btn} sz="sm" icon="undo-2" onClick=${() => mutate(() => { f.reverted = false; })}>Restore</${Btn}>`
            : edit === i ? null : html`<${Btn} sz="sm" icon="pencil" onClick=${() => { setEdit(i); setText(f.after); }}>Edit</${Btn}><${Btn} sz="sm" icon="undo-2" tip="Drop this file from the patch." tipPos="bl" onClick=${() => mutate(() => { f.reverted = true; })}>Revert file</${Btn}>`}</div>`}
        </div>
        ${fd && !f.reverted && html`<div class="px-3.5 py-2 text-xs text-ink2 border-b border-div">Fixes: ${md(fd.title)}</div>`}
        ${!f.reverted && (edit === i ? html`<div class="p-3 grid gap-2"><label class="label" for=${'edit-' + i}>New content of the changed part</label><textarea id=${'edit-' + i} class="textarea code" rows=${Math.min(18, text.split('\n').length + 1)} value=${text} onInput=${e => setText(e.target.value)} spellcheck="false"></textarea>
            <div class="flex justify-end gap-2"><${Btn} v="ghost" onClick=${() => setEdit(null)}>Cancel</${Btn}><${Btn} v="secondary" icon="check" onClick=${() => { mutate(() => { f.after = text; f.edited = true; tlog(pr, 'hand', 'Edited ' + f.path + ' in the patch by hand'); }); setEdit(null); }}>Save edit</${Btn}></div></div>`
          : html`<div style="margin:-1px"><${DiffLines} lines=${lines} /></div>`)}
      </section>`; })}
    ${live && html`<section class="card p-3.5"><label class="card-t block mb-1.5" for="revise-note">Revise<${Info} pos="right" tip="Write a note to the implementer. It redoes the patch and you review the new diff. Nothing is pushed." /></label>
      <textarea id="revise-note" class="textarea" rows="2" placeholder="Note to the implementer, e.g. keep the early return; only add the group kill." value=${note} onInput=${e => setNote(e.target.value)}></textarea>
      <div class="flex justify-end mt-2"><${Btn} icon="refresh-cw" why=${!note.trim() ? 'Write a note first, so the implementer knows what to change.' : null} onClick=${revise}>Revise with this note</${Btn}></div></section>`}
  </div>`;
}

function TimelineTab({ pr }) {
  const [who, setWho] = useState('all');
  const items = pr.timeline.slice().sort((a, b) => b.at - a.at).filter(t => who === 'all' || (who === 'bot' ? t.actor === 'bot' : t.actor !== 'bot'));
  return html`<div data-tab="timeline"><${TimeSummary} pr=${pr} />
    <div class="flex items-center gap-3 mb-3 flex-wrap"><div class="seg" role="group" aria-label="Filter timeline">${[['all', 'Everything'], ['people', 'People'], ['bot', 'Factory bot']].map(([k, t]) => html`<button aria-pressed=${String(who === k)} onClick=${() => setWho(k)}>${t}</button>`)}</div></div>
    <div class="card p-4"><ol class="tl m-0 list-none">${items.map(t => html`<li class="tl-item"><${Avatar} a=${t.actor} s=${20} />
      <div class="flex items-baseline gap-x-2 gap-y-0.5 flex-wrap text-sm"><span class="font-medium">${t.actor === 'hand' ? 'By hand' : actorName(t.actor)}</span>${t.gh && html`<span class="text-xs text-ink3">in GitHub</span>`}<span class=${cx('flex-1 min-w-[200px]', t.fail && 'text-bad')}>${md(t.text)}</span>
        ${t.cost != null && html`<span class="num text-xs text-ink2">${money(t.cost)}</span>`}${t.dur != null && html`<span class="num text-xs text-ink3">${dur(t.dur)}</span>`}${t.run && html`<a class="link text-xs" href=${'#/runs/' + t.run}>Run details</a>`}<${Time} t=${t.at} cls="text-xs text-ink3" /></div></li>`)}</ol></div>
  </div>`;
}
