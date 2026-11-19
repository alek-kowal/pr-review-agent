/* PR detail: title, one grey line, Next step banner, round line, tabs, slim sidebar. */
function startReviewNow(pr) {
  mutate(() => startRun(pr, 'review', { by: 'hand' }));
  toast({ title: 'Review started on #' + pr.num, desc: pr.run && pr.run.queued ? 'Queued: ' + queueReason(pr) + '.' : 'Round 1 of 3 is running. Started by hand, not signed.' });
}
/* Stand-in for GitHub: one small dashed line in the tabs row. Not part of the product. */
function ProtoStrip({ pr }) {
  if (pr.merged || pr.closed) return null;
  const a = authorName(pr);
  return html`<div class="proto" role="group" aria-label="Prototype: simulate GitHub"><span class="pl" data-tip="Prototype only: simulates what the author does in GitHub." data-tip-pos="bl" tabindex="0">PROTOTYPE · ${a} in GitHub:</span>
    ${pr.draft && html`<button class="ga" data-sim="ready" onClick=${() => mutate(() => markReady(pr))}>marks ready</button>`}
    <button class="ga" data-sim="push" onClick=${() => { mutate(() => pushFromIde(pr, 2)); toast({ title: a + ' pushed 2 commits to #' + pr.num, desc: 'Simulated. A push never starts a review.' }); }}>pushes 2 commits</button>
    <button class="ga" data-sim="close" onClick=${() => { mutate(() => closePr(pr)); toast({ title: '#' + pr.num + ' closed in GitHub', desc: 'Simulated. The PR leaves the board.' }); }}>closes the PR</button>
  </div>`;
}
function NotifyCards({ pr }) {
  const pend = Object.keys(pr.review || {}).filter(by => !pr.review[by].notified && !pr.review[by].hidden);
  return pend.map(by => { const r = pr.review[by], parts = []; if (r.w) parts.push(r.w + ' worth implementing'); if (r.nw) parts.push(r.nw + ' not worth it');
    return html`<div class="card mt-3 p-3 flex items-start gap-3 flex-wrap" data-notify=${by}>
      <${Avatar} a=${by} s=${28} />
      <div class="flex-1 min-w-[240px]"><div class="font-medium">${actorName(by)}'s review saved: ${parts.join(', ')}</div>
        ${pr.clickup ? html`<div class="mt-1.5 px-3 py-2 rounded-md bg-sunk border border-div text-sm"><span class="text-xs text-ink3">ClickUp ${pr.clickup} · </span>${notifyText(pr, by)}</div>`
        : html`<div class="text-sm text-ink3 mt-0.5">No ClickUp task linked, so there is nowhere to notify ${authorName(pr)}.</div>`}</div>
      <div class="flex items-center gap-2"><${Btn} v="ghost" sz="sm" onClick=${() => mutate(() => { r.hidden = true; })}>Not now</${Btn}>
        ${pr.clickup ? html`<${Btn} v="secondary" icon="send" onClick=${() => { mutate(() => notifyAuthor(pr, by)); toast({ title: authorName(pr) + ' notified in ClickUp', desc: 'Comment posted on ' + pr.clickup + '.', tone: 'ok' }); }}>Notify author</${Btn}>`
          : html`<${Btn} v="secondary" icon="link" onClick=${() => openDialog('linkClickup', { num: pr.num })}>Link a ClickUp task</${Btn}>`}</div>
    </div>`; });
}
/* Next step: the one tinted surface on the page. Its colour and title are the PR's state. */
function Banner({ pr, tab, setTab }) {
  const ns = nextStep(pr), st = ns.st, v = pr.run && !pr.run.queued ? runView(pr.run) : null;
  const [detail, setDetail] = useState(false);
  let primary = null, secondary = null;
  const start = html`<${Btn} v="primary" icon="play" onClick=${() => startReviewNow(pr)}>Start review</${Btn}>`;
  if (st === 'draft' || st === 'never' || st === 'newcommits' || st === 'roundsused') primary = start;
  else if (st === 'queued') { const fs = factoryStatus(); primary = fs === 'paused' ? html`<${Btn} v="primary" icon="play" onClick=${openChip}>Resume…</${Btn}>` : fs === 'budget' ? html`<${Btn} v="primary" icon="wallet" onClick=${openChip}>Raise budget…</${Btn}>` : null; secondary = html`<${Btn} icon="x" onClick=${() => mutate(() => cancelRun(pr))}>Remove from queue</${Btn}>`; }
  else if (v) secondary = html`<${Btn} v="danger-outline" icon="square" tip="Stops the agent now. What was spent stays spent; the round is not counted. Not signed." tipPos="bl" onClick=${() => mutate(() => cancelRun(pr))}>Cancel</${Btn}>`;
  else if (st === 'sensitive') {
    primary = html`<${Btn} v="primary" icon="check" tip="Not signed. The timeline records “approved by hand”." tipPos="bl" onClick=${() => { mutate(() => approveSensitive(pr)); toast({ title: 'Sensitive files approved', desc: 'Recorded as approved by hand.', undo: () => mutate(() => { pr.sensitive.status = 'pending'; pr.timeline.pop(); }) }); }}>Approve changes</${Btn}>`;
    secondary = html`<${Btn} icon="undo-2" onClick=${() => openDialog('sendBack', { num: pr.num })}>Send back…</${Btn}>`;
  } else if (st === 'tofix') {
    primary = html`<${Btn} v="primary" icon="wrench" why=${pr.fork ? 'Forks are read-only: the agent cannot push to a fork.' : pr.level < 4 ? 'Implement with agent turns on at level 4. This PR is at level ' + pr.level + '.' : null} onClick=${() => openDialog('implement', { num: pr.num })}>Implement with agent…</${Btn}>`;
    if (pr.level < 4 && !pr.fork) secondary = html`<${Btn} icon="arrow-up" onClick=${() => { mutate(() => { pr.level = 4; tlog(pr, 'hand', 'Review level for this PR raised to 4 by hand'); }); toast({ title: 'This PR is now at level 4', desc: 'Implement with agent is available.' }); }}>Raise this PR to level 4</${Btn}>`;
  } else if (st === 'patch') { primary = html`<${Btn} v="primary" icon="upload" why=${pr.patch.stale ? 'The branch moved after this patch was made. Revise the patch first.' : pr.patch.files.every(f => f.reverted) ? 'Every file is reverted. Nothing to push.' : null} onClick=${() => openDialog('push', { num: pr.num })}>Push to ${pr.branch}…</${Btn}>`; if (tab !== 'patch') secondary = html`<${Btn} icon="file-diff" onClick=${() => setTab('patch')}>View the diff</${Btn}>`; }
  else if (st === 'failed') primary = html`<${Btn} v="primary" icon="refresh-cw" tip="Reruns Review and the stages after it. Keeps the round number. Not signed." tipPos="bl" onClick=${() => { mutate(() => startRun(pr, 'retry', { by: 'hand' })); toast({ title: 'Retrying from Review on #' + pr.num, desc: 'Checks, Task and Change type are reused.' }); }}>Retry from ${pr.failed.stage}</${Btn}>`;
  else if (st === 'ready') primary = html`<${Btn} v="primary" icon="git-merge" onClick=${() => openDialog('merge', { num: pr.num })}>Merge #${pr.num}…</${Btn}>`;
  const L = pr.learning, done = st === 'merged' || st === 'closed';
  const meta = done ? [] : ['Next step', ns.who, ns.extra, v && html`<span class="num">${money(v.cost)} so far · ${dur(v.real)}</span>`].filter(Boolean);
  return html`<section class=${cx('banner', 't-' + ns.tone)} aria-label=${done ? 'State' : 'Next step'} data-banner=${st}>
    <span class="banner-ico"><${Icon} n=${ns.icon} s=${18} cls=${ns.live ? 'spin' : ''} /></span>
    <div class="flex-1 min-w-[260px]">
      ${!done && html`<div class="text-xs text-ink3">${meta.map((m, i) => html`${i > 0 ? ' · ' : ''}${m}`)}<${Info} tip=${ns.sub + (st === 'failed' ? ' ' + pr.failed.hint : '')} pos=${null} /></div>`}
      <h2 class="text-lg font-semibold m-0" id="banner-title">${ns.title}</h2>
      ${done && html`<div class="text-sm text-ink2">${ns.sub}</div>`}
      ${st === 'failed' && html`<div class="text-sm text-ink2">${pr.failed.why} <button class="link bg-transparent border-0 p-0" aria-expanded=${String(detail)} onClick=${() => setDetail(!detail)}>Technical details</button></div>${detail && html`<div class="codeblk mt-2"><pre>${pr.failed.detail}</pre></div>`}`}
      <${PrAlerts} pr=${pr} />
      ${done && html`<div class="flex items-center gap-2 mt-1 text-sm flex-wrap text-ink2"><${Icon} n="graduation-cap" s=${15} cls="text-ink3" />
        ${L && L.status === 'running' ? html`<span class="inline-flex items-center gap-1.5"><span class="pulse-dot"></span>Learning: Analyst is running</span>` : L && L.status === 'done' ? html`<span>Learning: Analyst finished: ${L.text || plural(L.candidates || 1, 'lesson candidate')} · <span class="num">${money(L.cost)}</span></span><a class="link" href="#/settings/learning">Open Learning</a>` : html`<span>Learning is off at level ${pr.level}.</span><a class="link" href="#/settings/learning">Run the analyst by hand</a>`}</div>`}
    </div>
    ${(primary || secondary) && html`<div class="flex items-center gap-2 flex-wrap">${secondary}${primary}</div>`}
  </section>`;
}
/* The round: full stepper only while agents run or after a stage failed. Otherwise one line, expandable. */
function RoundLine({ pr }) {
  const [open, setOpen] = useState(false);
  if (pr.merged || pr.closed) return null;
  const st = prState(pr), rl = roundLabel(pr), last = pr.rounds[pr.rounds.length - 1], live = pr.run && !pr.run.queued;
  if (!rl || (!pr.run && !last)) return null;
  const full = live || st === 'failed';
  return html`<div class="mt-2.5" data-round>
    <div class="roundline"><span>${rl}</span>
      ${pr.run && pr.run.queued && html`<span>· queued</span>`}
      ${!pr.run && last && last.status !== 'failed' && html`<span>· finished <${Time} t=${last.at} /> · <span class="num">${money(last.cost)}</span></span>`}
      ${!full && last && !pr.run && html`<button class="link bg-transparent border-0 p-0 inline-flex items-center gap-0.5" aria-expanded=${String(open)} onClick=${() => setOpen(!open)}>Stages<${Icon} n=${open ? 'chevron-up' : 'chevron-down'} s=${12} /></button>`}
      ${(pr.run && pr.run.kind !== 'fix' || (!pr.run && last)) && html`<a class="link" href=${'#/runs/' + (pr.run ? pr.run.id : last.id)}>Run details</a>`}
    </div>
    ${(full || (open && last && !pr.run)) && html`<div class="mt-1.5"><${Stepper} pr=${pr} /></div>`}
  </div>`;
}
/* Review level + Start review: quiet, in the header, on every open PR. */
function StartReview({ pr }) {
  const busy = pr.run ? (pr.run.queued ? 'A round is already queued for this PR.' : 'A run is in progress. Cancel it first, or wait.') : null;
  return html`<${Popover} align="right" width=${300} btn=${({ onClick, open }) => html`<button class="btn ol sm" aria-haspopup="dialog" aria-expanded=${String(open)} data-start-review onClick=${onClick}><${Icon} n="play" s=${13} />Start review<${Icon} n="chevron-down" s=${12} /></button>`}>
    ${close => html`<div class="p-3 grid gap-2.5"><div><label class="label" for="pr-level">Review level</label>
      <select id="pr-level" class="select" value=${pr.level} onChange=${e => mutate(() => { pr.level = Number(e.target.value); })}>${LEVELS.map(l => html`<option value=${l.n}>${l.n} · ${l.name}${l.n === S.repos[pr.repo].defaultLevel ? ' (repo default)' : ''}</option>`)}</select>
      <div class="hint mt-1">${LEVELS[pr.level - 1].desc}</div></div>
      <${Btn} v="secondary" icon="play" cls="w-full" why=${busy} onClick=${() => { close(); startReviewNow(pr); }}>Start review</${Btn}>
      <div class="hint">New chain, round 1 on <span class="mono">${pr.head}</span>. Not signed.${pr.fork ? ' Fork: read-only review.' : ''}</div></div>`}
  </${Popover}>`;
}

function SideCard({ title, right, children, id }) { return html`<section class="card" aria-labelledby=${id}><div class="card-h"><h3 class="card-t m-0" id=${id}>${title}</h3>${right}</div>${children}</section>`; }
/* Merge checklist: failing rows only. Passing rows sit behind "Show all N"; all green is one line. */
function Checklist({ pr }) {
  const [all, setAll] = useState(false);
  const cl = checklist(pr), n = cl.items.length, okN = cl.items.filter(i => i.ok).length, pending = !pr.reviewedSha || !!pr.failed;
  const row = i => html`<li class="checkrow"><${Icon} n=${i.ok ? 'circle-check' : 'circle-x'} s=${15} cls=${cx('mt-0.5', i.ok ? 'text-ok' : 'text-warn')} label=${i.ok ? 'Passes' : 'Fails'} /><div class="min-w-0"><div class="font-medium">${i.t}</div><div class="text-xs text-ink3">${i.why}</div></div></li>`;
  if (cl.ok) return html`<section class="card" aria-label="Merge checklist" data-checklist="ok"><button class="checkline" aria-expanded=${String(all)} onClick=${() => setAll(!all)}><${Icon} n="circle-check" s=${15} cls="text-ok" /><span class="font-medium flex-1 text-left">Merge checklist</span><span class="num text-ink3">${n} of ${n}</span><${Icon} n=${all ? 'chevron-up' : 'chevron-down'} s=${14} cls="text-ink3" /></button>
    ${all && html`<ul class="m-0 p-0 list-none py-1 border-t border-div">${cl.items.map(row)}</ul>`}</section>`;
  return html`<section class="card" aria-labelledby="sc-merge" data-checklist="open"><div class="card-h"><h3 class="card-t m-0" id="sc-merge">Merge checklist</h3>${!pending && html`<span class="text-xs text-ink3 num">${okN} of ${n}</span>`}</div>
    <ul class="m-0 p-0 list-none py-1">${cl.items.filter(i => all || !i.ok).map(row)}</ul>
    <button class="link text-xs bg-transparent border-0 px-3.5 pb-2.5 pt-0" aria-expanded=${String(all)} onClick=${() => setAll(!all)}>${all ? 'Show failing only' : 'Show all ' + n}</button></section>`;
}
const hasSide = pr => !(pr.merged || pr.closed) || !!pr.sensitive || pr.rounds.length > 1;
function PrSidebar({ pr }) {
  const closed = pr.merged || pr.closed;
  const rounds = pr.rounds.slice().reverse();
  return html`<aside class="prside" aria-label="PR status">
    ${!closed && html`<${Checklist} pr=${pr} />`}
    ${pr.sensitive && html`<${SideCard} id="sc-sens" title="Sensitive files" right=${html`<span class="text-xs text-ink3">${pr.sensitive.status === 'approved' ? 'approved' : pr.sensitive.status === 'sent_back' ? 'sent back' : 'need approval'}</span>`}>
      <ul class="m-0 p-0 list-none divide">${pr.sensitive.files.map(f => html`<li class="px-3.5 py-2"><div class="mono break-all">${f.path}</div><div class="text-xs text-ink3 mt-0.5">${f.rule}. ${f.note}</div></li>`)}</ul>
      ${pr.sensitive.status === 'sent_back' && html`<div class="px-3.5 py-2 text-xs text-ink2 border-t border-div">"${pr.sensitive.comment}"</div>`}
    </${SideCard}>`}
    ${rounds.length > 1 && html`<${SideCard} id="sc-rounds" title="Rounds">
      <ul class="m-0 p-0 list-none divide">${rounds.map(r => html`<li><a class="flex items-center gap-2 px-3.5 py-1.5 text-sm no-underline hover:bg-sunk" href=${'#/runs/' + r.id}>
          <span class="flex-1 min-w-0 trunc">Round ${r.n}${r.n === 1 && rounds.some(x => x.n === 1 && x.at < r.at) ? html` <span class="text-ink3">· new chain</span>` : ''}${r.kind === 'fixcheck' ? ' · fix check' : ''}${r.status === 'failed' ? html` <span class="text-bad">· failed</span>` : ''}</span>
          <span class="text-xs text-ink3 num whitespace-nowrap">${money(r.cost)} · <${Time} t=${r.at} /></span></a></li>`)}</ul>
    </${SideCard}>`}
  </aside>`;
}

function PrPage({ route }) {
  const num = Number(route.path[1]), pr = S.prs[num];
  useEffect(() => { UI.viewing = num; return () => { UI.viewing = null; if (UI.stale) delete UI.stale[num]; }; }, [num]);
  if (!pr) return html`<main class="gutter py-10"><${Empty} icon="search-x" title=${'No pull request #' + route.path[1]}>It may have been removed by a demo reset. <a class="link" href="#/prs">Back to Pull requests</a></${Empty}></main>`;
  const st = prState(pr), ns = nextStep(pr);
  const tab = route.q.tab || (st === 'questions' ? 'questions' : st === 'patch' || st === 'fixing' ? 'patch' : 'findings');
  const setTab = t => setQ({ tab: t });
  const a = person(pr.author), side = hasSide(pr);
  const tabs = [{ id: 'findings', label: 'Findings', icon: 'list-checks', count: pr.findings.length }, { id: 'questions', label: 'Questions', icon: 'message-circle-question', count: pr.questions.length }, { id: 'patch', label: 'Patch', icon: 'file-diff' }, { id: 'timeline', label: 'Timeline', icon: 'history' }];
  const meta = [
    pr.repo !== WB && repoShort(pr.repo),
    html`<span class="text-ink2 font-medium" title=${a ? '@' + a.gh : 'Outside the team'}>${authorName(pr)}</span>`,
    pr.draft && 'draft',
    pr.fork && html`<span data-tip="Forks are read-only: no automatic review, no install, no scripts, no agent fixes." tabindex="0">fork</span>`,
    html`<span class="mono">${pr.branch}</span> → <span class="mono">${pr.base}</span>`,
    html`<span class="num">${plural(pr.files, 'file')} +${pr.add.toLocaleString('en-US')} −${pr.del.toLocaleString('en-US')}</span>`,
    html`<span data-tip=${LEVELS[pr.level - 1].name + (pr.ctype && pr.reviewedSha && pr.level > 1 ? ' · change type: ' + pr.ctype : '')} tabindex="0">level ${pr.level}</span>`,
    pr.reviewedSha && html`<span>Reviewed <span class="mono">${pr.reviewedSha}</span>${pr.commitsSince > 0 && html`<span class="text-ink2 font-medium" data-tip="Merge is pinned to the reviewed commit." tabindex="0"> · ${plural(pr.commitsSince, 'new commit')} since</span>`}</span>`
  ].filter(Boolean);
  return html`<main class="gutter pb-24">
    <div class="pt-4 pb-3">
      <div class="flex items-start gap-x-3 gap-y-2 flex-wrap"><h1 class="text-xl font-semibold m-0 flex-1 min-w-[280px]">${pr.title} <span class="text-ink3 font-normal font-sans num">#${pr.num}</span></h1>
        <div class="flex items-center gap-2 flex-wrap"><a class="btn ol sm" href=${'https://github.com/' + pr.repo + '/pull/' + pr.num} target="_blank" rel="noopener"><${Icon} n="github" s=${13} />GitHub</a>
          ${pr.clickup ? html`<a class="btn ol sm" href=${'https://app.clickup.com/t/' + pr.clickup} target="_blank" rel="noopener"><${Icon} n="square-check-big" s=${13} />${pr.clickup}</a>` : html`<${Btn} sz="sm" icon="link" tip="Notify author and Defer to ClickUp need a task." tipPos="bl" onClick=${() => openDialog('linkClickup', { num: pr.num })}>Link a ClickUp task</${Btn}>`}
          ${!(pr.merged || pr.closed) && html`<${StartReview} pr=${pr} />`}</div></div>
      <div class="metaline mt-1" data-state=${st}>${meta.map((m, i) => html`${i > 0 && html`<span class="sep">·</span>`}<span>${m}</span>`)}</div>
    </div>
    <${Banner} pr=${pr} tab=${tab} setTab=${setTab} />
    <${NotifyCards} pr=${pr} />
    <${RoundLine} pr=${pr} />
    <div class=${cx('prgrid mt-3', !side && 'one')}>
      <div class="min-w-0">
        <div class="tabsrow"><${Tabs} label="PR sections" tabs=${tabs} value=${tab} onChange=${setTab} /><${ProtoStrip} pr=${pr} /></div>
        <div class="pt-3" role="tabpanel" id=${'panel-' + tab} aria-labelledby=${'tab-' + tab}>
          ${tab === 'findings' && html`<${FindingsTab} pr=${pr} />`}
          ${tab === 'questions' && html`<${QuestionsTab} pr=${pr} />`}
          ${tab === 'patch' && html`<${PatchTab} pr=${pr} />`}
          ${tab === 'timeline' && html`<${TimelineTab} pr=${pr} />`}
        </div>
      </div>
      ${side && html`<${PrSidebar} pr=${pr} />`}
    </div>
  </main>`;
}
