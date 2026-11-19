/* Pilot metrics (Insights → Overview), alerts (a ClickUp comment plus a mark on the dashboard), and the PR time summary.
   Definitions: docs/06-metrics.md. Loaded after the other scripts, before app.js. */

/* ---------- Formatting and statistics ---------- */
function hrs(sec) {
  sec = Math.max(0, sec || 0); if (sec < 3600) return dur(sec);
  const h = sec / 3600; if (h < 48) return (h < 10 ? Math.round(h * 10) / 10 : Math.round(h)) + ' h';
  const H = Math.round(h), d = Math.floor(H / 24), r = H % 24; return d + ' d' + (r ? ' ' + r + ' h' : '');
}
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pctOf = (n, d) => d ? Math.round(n / d * 100) + '%' : '—';

/* ---------- Pilot history: PRs that finished in the last 30 days ----------
   [num, repo, title, author, endedDaysAgo, outcome, agentMin, queueMin, peopleH, mergeWaitH, cost, roundsTotal, chainMax, changedAfterReady, ignoredNote] */
const HIST_ROWS = [
  [260, WB, 'fix(sdk): snackbar offset respects the bottom toolbar', 'kasia', 1.0, 'merged', 2.2, 0.1, 18, 9.5, 1.12, 1, 1, null, null],
  [258, WB, 'feat(sdk): experimental minimap themes', 'piotr', 2.0, 'closed', 2.5, 0.3, 70, 0, 1.36, 1, 1, null, null],
  [244, WB, 'docs(mcp): describe the docs snapshot', 'marek', 2.0, 'merged', 2.1, 0, 30, 21, 1.21, 1, 1, null, null],
  [257, WB, 'feat(ui): tooltip delay tokens', 'ola', 3.1, 'merged', 4.1, 0.2, 12, 7, 1.48, 1, 1, null, null],
  [255, WB, 'fix(temporal): retry policy for signal handlers', 'marek', 4.2, 'merged', 11.5, 1.4, 118, 22, 3.92, 4, 3, null, null],
  [254, WB, 'docs(sdk): migration guide for v2', 'tomek', 4.8, 'merged', 2.4, 0, 9, 17, 1.05, 1, 1, null, null],
  [249, WB, 'feat(sdk): copy and paste keeps edge labels', 'kasia', 6.0, 'merged', 8.7, 0.5, 44, 18, 2.61, 2, 2, 'Kasia pushed 1 commit after it was ready at 7d2e9a1', null],
  [248, WB, 'refactor(ui): split NodeHeader into slots', 'piotr', 6.5, 'merged', 5.2, 0, 290, 46, 1.74, 1, 1, null, null],
  [247, WB, 'fix(ai-studio): Stop button state after an error', 'ola', 7.3, 'merged', 3.0, 0.2, 15, 7, 1.31, 1, 1, null, null],
  [36, TPL, 'feat(templates): HR onboarding template', 'alek', 8.1, 'merged', 1.9, 0, 31, 16, 0.62, 1, 1, null, null],
  [245, WB, 'test(sdk): edge routing snapshots', 'tomek', 9.0, 'merged', 6.8, 0.3, 21, 9, 2.05, 2, 2, null, null],
  [243, WB, 'feat(sdk): read-only mode for the properties panel', 'kasia', 11.4, 'merged', 14.9, 2.1, 160, 28, 5.84, 5, 3, 'Merged in GitHub at 41ac0be, not at the reviewed commit 9e17c2d', null],
  [241, WB, 'fix(ui): focus ring on icon buttons', 'piotr', 12.6, 'merged', 2.6, 0, 11, 9, 1.22, 1, 1, 'Piotr pushed 2 commits after it was ready at c03b5e8', null],
  [240, WB, 'chore(temporal): bump the Temporal SDK to 1.11', 'marek', 14.1, 'merged', 7.4, 0.4, 52, 23, 2.38, 1, 1, null, '1 commit ignored: it only merged main into the branch'],
  [237, WB, 'feat(ai-studio): run history drawer', 'ola', 16.0, 'merged', 9.9, 0.8, 88, 24, 3.27, 2, 2, null, null],
  [236, WB, 'fix(sdk): guard test for undo batching', 'tomek', 18.3, 'merged', 3.8, 0, 26, 14, 1.44, 1, 1, null, null],
  [35, TPL, 'fix(templates): schema description typos', 'ola', 20.0, 'merged', 1.2, 0, 15, 8, 0.41, 1, 1, null, null],
  [233, WB, 'feat(sdk): public CSS variable for the grid colour', 'kasia', 22.5, 'merged', 4.4, 0.2, 40, 18, 1.67, 1, 1, null, null],
  [229, WB, 'feat(sdk): experimental auto-layout', 'piotr', 25.0, 'closed', 6.1, 0.6, 140, 0, 2.12, 2, 2, null, null]
];
function history() {
  const now = Date.now();
  return HIST_ROWS.map(([num, repo, title, author, ago, outcome, agentMin, queueMin, peopleH, mergeH, cost, rounds, chainMax, changed, ignored]) => {
    const agent = agentMin * 60, queue = queueMin * 60, people = peopleH * 3600, wait = mergeH * 3600, total = agent + queue + people + wait, endAt = now - ago * DAY;
    return { num, repo, title, author, outcome, agent, queue, people, wait, total, endAt, readyAt: endAt - total * 1000, cost, rounds, chainMax, changed, ignored };
  });
}

/* ---------- Alerts: speak up only when something is wrong ---------- */
const ALERT_KIND = {
  failed: { icon: 'circle-x', short: 'Stage failed', ended: 'A retry or a new review started' },
  rounds: { icon: 'repeat', short: 'Rounds used 3 of 3', ended: 'A new review started' },
  cost: { icon: 'wallet', short: 'Cost', ended: '' },
  budget: { icon: 'gauge', short: 'Budget', ended: 'Spend is below the threshold again' }
};
function ensureAlerts() {
  if (S.alerts) return;
  const now = Date.now();
  S.alertCfg = { failed: true, rounds: true, cost: true, costMax: 5, budget: true, budgetPct: 80, task: 'WB-700' };
  S.alerts = [
    { id: 'a-h1', key: 'rounds:255:h', kind: 'rounds', pr: 255, title: 'Automatic rounds used (3 of 3) on #255', next: 'Start review', task: 'WB-748', at: now - 5 * DAY, status: 'resolved', endedAt: now - 4.7 * DAY, endedBy: 'bot', endNote: 'A new review started' },
    { id: 'a-h2', key: 'budget80:h', kind: 'budget', pr: null, title: 'Daily budget 80% used: $40.30 of $50.00', next: 'Pause, raise the budget or wait until midnight', task: 'WB-700', toFactory: true, at: now - 3 * DAY - 5 * HOUR, status: 'resolved', endedAt: now - 3 * DAY + 7 * HOUR, endedBy: 'bot', endNote: 'Spend reset at midnight' },
    { id: 'a-h3', key: 'cost:243', kind: 'cost', pr: 243, title: '#243 has cost $5.84, above the $5.00 alert threshold', next: 'Check whether the PR should be split', task: 'WB-731', at: now - 12 * DAY, status: 'dismissed', endedAt: now - 11.6 * DAY, endedBy: 'hand', sticky: true }
  ];
  syncAlerts(true);
}
const prSpend = pr => pr.spend + (pr.run && !pr.run.queued ? runView(pr.run).cost : 0);
function alertConds() {
  const c = S.alertCfg, f = S.factory, out = [];
  openPrs().forEach(pr => {
    const st = prState(pr);
    if (c.failed && st === 'failed') out.push({ key: 'failed:' + pr.num + ':' + pr.timeline.filter(t => t.fail).length, kind: 'failed', pr: pr.num, title: pr.failed.title + ' on #' + pr.num, next: 'Retry from ' + pr.failed.stage });
    if (c.rounds && st === 'roundsused') out.push({ key: 'rounds:' + pr.num + ':' + pr.rounds.length, kind: 'rounds', pr: pr.num, title: 'Automatic rounds used (3 of 3) on #' + pr.num + ', a fix is still open', next: 'Start review' });
    const spent = prSpend(pr);
    if (c.cost && spent > c.costMax) out.push({ key: 'cost:' + pr.num, kind: 'cost', pr: pr.num, sticky: true, title: '#' + pr.num + ' has cost ' + money(spent) + ', above the ' + money(c.costMax) + ' alert threshold', next: 'Check whether the PR should be split' });
  });
  if (c.budget) {
    const day = new Date().toDateString();
    if (f.spent >= f.budget) out.push({ key: 'budget100:' + day, kind: 'budget', title: 'Daily budget reached: ' + money(f.spent) + ' of ' + money(f.budget), next: 'Raise the budget or wait until midnight' });
    else if (f.spent >= f.budget * c.budgetPct / 100) out.push({ key: 'budget' + c.budgetPct + ':' + day, kind: 'budget', title: 'Daily budget ' + c.budgetPct + '% used: ' + money(f.spent) + ' of ' + money(f.budget), next: 'Pause, raise the budget or wait until midnight' });
  }
  return out;
}
function syncAlerts(silent) {
  if (!S || !S.prs) return;
  if (!S.alerts) { ensureAlerts(); return; }
  const conds = alertConds(), live = new Set(conds.map(c => c.key)); let changed = false;
  conds.forEach(c => {
    if (S.alerts.some(a => a.key === c.key)) return;
    const pr = c.pr && S.prs[c.pr], task = pr && pr.clickup ? pr.clickup : S.alertCfg.task;
    const at = silent && pr ? pr.timeline.reduce((m, t) => Math.max(m, t.at), 0) + 2000 : Date.now();
    S.alerts.unshift(Object.assign({ id: uid('al'), at, task, toFactory: !(pr && pr.clickup), status: 'active' }, c));
    if (pr) pr.timeline.push({ at, actor: 'bot', text: 'Alert posted as a ClickUp comment on ' + task + ': ' + c.title });
    if (!silent) toast({ title: 'Alert: ' + c.title, desc: 'Posted as a comment on ClickUp ' + task + '.', tone: 'bad', go: [pr ? 'pr/' + pr.num : 'activity'] });
    changed = true;
  });
  S.alerts.forEach(a => {
    if (a.status === 'active' && !a.sticky && !live.has(a.key)) { Object.assign(a, { status: 'resolved', endedAt: Date.now(), endedBy: 'bot', endNote: ALERT_KIND[a.kind].ended }); changed = true; }
  });
  if (changed) commit();
}
function dismissAlert(a) {
  Object.assign(a, { status: 'dismissed', endedAt: Date.now(), endedBy: 'hand' });
  const pr = a.pr && S.prs[a.pr]; if (pr) tlog(pr, 'hand', 'Dismissed the alert: ' + a.title);
}
const activeAlerts = () => (S.alerts || []).filter(a => a.status === 'active');
const alertsFor = num => activeAlerts().filter(a => a.pr === num);
const alertShort = a => a.kind === 'cost' ? 'Cost ' + (a.title.match(/\$[0-9.]+/) || [''])[0] : a.kind === 'budget' ? (a.title.match(/reached/) ? 'Budget reached' : 'Budget ' + (a.title.match(/[0-9]+%/) || [''])[0]) : ALERT_KIND[a.kind].short;

/* The clock also re-checks alert conditions. */
const _tickBase = tick;
tick = function () { _tickBase(); syncAlerts(false); };

/* ---------- Dashboard marks ---------- */
function AlertStrip() {
  const act = activeAlerts(); if (!act.length) return null;
  return html`<div class="alertstrip mb-4" role="status" data-alerts=${act.length}>
    <span class="flex items-center gap-2 font-semibold text-sm whitespace-nowrap"><${Icon} n="bell-ring" s=${15} cls="text-bad" />${plural(act.length, 'active alert')}</span>
    <span class="flex flex-wrap gap-1.5 min-w-0">${act.map(a => html`<a class="pill t-red" style="text-decoration:none" href=${a.pr ? '#/pr/' + a.pr : '#/activity'} data-tip=${a.title + '. Posted to ClickUp ' + a.task + '.'}><${Icon} n=${ALERT_KIND[a.kind].icon} s=${12} />${a.pr ? html`<span class="mono">#${a.pr}</span>` : ''}${alertShort(a)}</a>`)}</span>
    <a class="link text-sm ml-auto whitespace-nowrap" href="#/activity">All alerts</a></div>`;
}
/* One mark per card: a red bell. */
function CardAlert({ pr }) {
  const al = alertsFor(pr.num); if (!al.length) return null;
  return html`<span class="cardalert" data-card-alert data-tip=${al.map(a => a.title).join(' · ') + '. Posted to ClickUp ' + al[0].task + '.'} data-tip-pos="bl"><${Icon} n="bell-ring" s=${13} />${al.length > 1 ? al.length : ''}<span class="sr-only">${plural(al.length, 'active alert')}</span></span>`;
}
/* On the PR page an alert is a secondary line inside the Next step banner. */
function PrAlerts({ pr }) {
  const al = alertsFor(pr.num); if (!al.length) return null;
  return html`${al.map(a => html`<div class="alertline" data-alert=${a.kind}><${Icon} n="bell-ring" s=${13} /><span>${a.kind === 'cost' ? a.title.replace(/^#\d+ has cost/, 'Cost') + ' · alert' : 'Alert'} posted to ClickUp ${a.task} · <${Time} t=${a.at} /></span>
    ${a.sticky && html`<button class="link bg-transparent border-0 p-0" data-tip="Not signed: the timeline records “by hand”." onClick=${() => { mutate(() => dismissAlert(a)); toast({ title: 'Alert dismissed', desc: 'Recorded by hand.' }); }}>Dismiss</button>`}</div>`)}`;
}
function ChipAlertList({ close }) {
  const act = activeAlerts(); if (!act.length) return null;
  return html`<div class="mb-3 pb-3 border-b border-div">
    <div class="font-semibold text-sm flex items-center gap-1.5 text-bad"><${Icon} n="bell-ring" s=${14} />${plural(act.length, 'active alert')}<a class="link text-xs font-normal ml-auto" href="#/activity" onClick=${close}>All alerts</a></div>
    <ul class="m-0 mt-1 p-0 list-none grid gap-0.5 text-sm">${act.map(a => html`<li><a class="link" href=${a.pr ? '#/pr/' + a.pr : '#/activity'} onClick=${close}>${a.title}</a></li>`)}</ul></div>`;
}

/* ---------- Activity: alerts section. Active alerts and failed runs only; history sits behind a click. ---------- */
function AlertsSection() {
  const [past, setPast] = useState(false);
  const act = activeAlerts().slice().sort((a, b) => b.at - a.at), old = (S.alerts || []).filter(a => a.status !== 'active').sort((a, b) => b.at - a.at);
  /* A failed run with its alert switched off still needs a person: list it here as well. */
  const orphan = Object.values(S.prs).filter(p => p.failed && !p.run && !p.merged && !p.closed && !act.some(a => a.kind === 'failed' && a.pr === p.num));
  const retry = p => html`<${Btn} sz="sm" v="secondary" icon="refresh-cw" tip="Reruns the failed stage and the ones after it. Not signed." tipPos="left" onClick=${() => { mutate(() => startRun(p, 'retry', { by: 'hand' })); toast({ title: 'Retrying from ' + 'Review on #' + p.num }); }}>Retry from ${p.failed.stage}</${Btn}>`;
  const row = a => { const pr = a.pr && S.prs[a.pr], on = a.status === 'active', failedPr = on && a.kind === 'failed' && pr && pr.failed && !pr.run ? pr : null, lastR = failedPr && pr.rounds[pr.rounds.length - 1];
    return html`<tr data-alert-row=${a.status}><td><div class="flex items-start gap-2"><${Icon} n=${ALERT_KIND[a.kind].icon} s=${14} cls=${cx('mt-0.5', on ? 'text-bad' : 'text-ink3')} /><div><div class=${on ? 'font-medium' : 'text-ink2'} title=${'Posted to ClickUp ' + a.task + (a.toFactory ? ' (factory alerts task)' : '')}>${pr ? html`<a class="link" style="color:inherit" href=${'#/pr/' + a.pr}>${a.title}</a>` : a.title}</div>${on && !failedPr && html`<div class="text-xs text-ink3">${a.next}</div>`}${lastR && html`<a class="link text-xs" href=${'#/runs/' + lastR.id}>Run details</a>`}</div></div></td>
      <td class="r text-ink3">${!on && html`<span>${a.status === 'resolved' ? 'cleared' : 'dismissed'} · </span>`}<${Time} t=${a.at} /></td>
      <td class="r">${failedPr ? retry(failedPr) : on && html`<${Btn} sz="sm" icon="x" tip="Hides the alert. Not signed." tipPos="left" onClick=${() => { mutate(() => dismissAlert(a)); toast({ title: 'Alert dismissed', desc: 'Recorded by hand.' }); }}>Dismiss</${Btn}>`}</td></tr>`; };
  const n = act.length + orphan.length;
  return html`<section aria-labelledby="act-al"><div class="flex items-center gap-2 mb-2"><h2 class="sec-t m-0 flex items-center gap-2" id="act-al">Alerts ${n > 0 && html`<span class="count bad">${n}</span>`}</h2><span class="flex-1"></span><a class="link text-xs" href="#/settings/alerts">Alert settings</a></div>
    ${n === 0 && !past ? html`<div class="strip bg-surface" data-calm><${Icon} n="circle-check" s=${15} cls="text-ok" />Nothing needs attention.</div>` : html`<div class="tblwrap"><table class="tbl"><thead><tr><th>Alert</th><th class="r">Posted</th><th></th></tr></thead><tbody>
      ${act.map(row)}
      ${orphan.map(p => { const r = p.rounds[p.rounds.length - 1]; return html`<tr data-failed-row=${p.num}><td><div class="flex items-start gap-2"><${Icon} n="circle-x" s=${14} cls="mt-0.5 text-bad" /><div><div class="font-medium"><a class="link" style="color:inherit" href=${'#/pr/' + p.num}>${p.failed.title} on #${p.num}</a></div><a class="link text-xs" href=${'#/runs/' + r.id}>Run details</a></div></div></td><td class="r text-ink3"><${Time} t=${r.at} /></td><td class="r">${retry(p)}</td></tr>`; })}
      ${past && old.map(row)}
    </tbody></table></div>`}
    ${old.length > 0 && html`<button class="link text-xs bg-transparent border-0 p-0 mt-2" aria-expanded=${String(past)} data-past-alerts onClick=${() => setPast(!past)}>${past ? 'Hide past alerts' : 'Show ' + plural(old.length, 'past alert')}</button>`}
  </section>`;
}

/* ---------- Settings → Alerts ---------- */
function SetAlerts() {
  const src = clone(S.alertCfg), [v, setV] = useState(clone(src)), up = p => setV(Object.assign({}, v, p)), [prev, setPrev] = useState(false);
  const on = b => b ? 'On' : 'Off', diff = [];
  if (v.failed !== src.failed) diff.push({ k: 'A run failed', from: on(src.failed), to: on(v.failed) });
  if (v.rounds !== src.rounds) diff.push({ k: 'Automatic rounds used', from: on(src.rounds), to: on(v.rounds) });
  if (v.cost !== src.cost || Number(v.costMax) !== src.costMax) diff.push({ k: 'Cost of one PR', from: src.cost ? 'Above ' + money(src.costMax) : 'Off', to: v.cost ? 'Above ' + money(Number(v.costMax)) : 'Off' });
  if (v.budget !== src.budget || Number(v.budgetPct) !== src.budgetPct) diff.push({ k: 'Daily budget', from: src.budget ? src.budgetPct + '% and 100%' : 'Off', to: v.budget ? v.budgetPct + '% and 100%' : 'Off' });
  if (v.task.trim() !== src.task) diff.push({ k: 'Factory alerts task', from: src.task, to: v.task.trim() });
  const bad = v.cost && !(Number(v.costMax) > 0) ? 'Enter a cost above $0.' : !v.task.trim() ? 'Enter a ClickUp task ID for factory-wide alerts.' : null;
  const sample = S.prs[262] || openPrs()[0];
  return html`<div><${SetHead} title="Alerts" affects="when the factory speaks up about a problem, and where. Alerts never stop a round." />
    <${Section} title="When to alert">
      <${Row} id="al-failed" label="A run failed" hint="A stage timed out or crashed. The alert names the stage and the Retry action."><${Switch} id="al-failed" label="Alert when a run fails" on=${v.failed} onChange=${b => up({ failed: b })} /></${Row}>
      <${Row} id="al-rounds" label="Automatic rounds used (3 of 3)" hint="A chain used its 3 rounds and a fix is still open. Someone has to look at the PR."><${Switch} id="al-rounds" label="Alert when automatic rounds are used up" on=${v.rounds} onChange=${b => up({ rounds: b })} /></${Row}>
      <${Row} id="al-cost" label="Cost of one PR" hint="Real spend on the PR: every round, fix and retry. Trials and the analyst do not count. A warning, not a limit: rounds keep running."><div class="flex items-center gap-3 flex-wrap"><${Switch} id="al-cost" label="Alert when one PR costs too much" on=${v.cost} onChange=${b => up({ cost: b })} /><span class=${cx('flex items-center gap-2 text-sm', !v.cost && 'opacity-50')}>above <span class="text-ink3">$</span><input class="input num" style="width:84px" inputmode="decimal" aria-label="Cost threshold in dollars" disabled=${!v.cost} value=${v.costMax} onInput=${e => up({ costMax: e.target.value })} /><span class="text-ink3">per PR</span></span></div></${Row}>
      <${Row} id="al-budget" label="Daily budget" hint="Once when today's spend passes the threshold, and once when the budget is reached."><div class="flex items-center gap-3 flex-wrap"><${Switch} id="al-budget" label="Alert about the daily budget" on=${v.budget} onChange=${b => up({ budget: b })} /><span class=${cx('flex items-center gap-2 text-sm', !v.budget && 'opacity-50')}>at <select class="select" style="width:84px" aria-label="Budget threshold" disabled=${!v.budget} value=${v.budgetPct} onChange=${e => up({ budgetPct: Number(e.target.value) })}>${[50, 70, 80, 90].map(n => html`<option value=${n}>${n}%</option>`)}</select><span class="text-ink3">and at 100%</span></span></div></${Row}>
    </${Section}>
    <${Section} title="Where alerts go">
      <${Row} label="ClickUp comment" hint="On the PR's ClickUp task, so everyone who follows the task gets a notification. Posted with the factory's ClickUp key and signed “Factory bot” in the text. Always on."><div class="flex items-center gap-3 text-sm"><span>On the PR's task</span><button class="link bg-transparent border-0 p-0" aria-expanded=${String(prev)} data-preview onClick=${() => setPrev(!prev)}>${prev ? 'Hide preview' : 'Preview comment'}</button></div>
        ${prev && html`<div class="cu-preview mt-2"><div class="text-xs text-ink3 mb-1 flex items-center gap-1.5"><${Icon} n="square-check-big" s=${12} />Comment on ClickUp ${sample.clickup || v.task} · example for #${sample.num}</div><div class="text-sm"><span class="font-semibold">WB Factory alert · PR #${sample.num}</span><br />${sample.failed ? sample.failed.title : 'Review stage timed out after 30 min'}. This round is not counted.<br />Next step: Retry from Review.<br /><span class="text-brandt">Open the PR in WB Factory ↗</span><br /><span class="text-ink3">— Factory bot</span></div></div>`}</${Row}>
      <${Row} id="al-task" label="Factory alerts task" hint="Budget alerts, and alerts for PRs with no linked task, go here."><input id="al-task" class="input mono" style="width:140px" value=${v.task} onInput=${e => up({ task: e.target.value })} /></${Row}>
      <${Row} label="On the dashboard" hint="Always on, so nobody has to open ClickUp to see that something is wrong: a bell on the PR card, a line in the PR's Next step banner, the strip above the board, the count on the status chip, and the list in Activity."><span class="text-sm">Always on · <a class="link" href="#/activity">Activity</a></span></${Row}>
    </${Section}>
    <${SaveBar} n=${diff.length} onDiscard=${() => setV(clone(src))} onSave=${() => { if (bad) { toast({ title: bad, tone: 'bad' }); return; } openDialog('confirmSave', { title: 'Save alert settings', area: 'Alerts', text: 'Alert settings changed', diff, apply: () => { S.alertCfg = Object.assign({}, v, { costMax: Number(v.costMax), task: v.task.trim() }); } }); }} />
  </div>`;
}

SETTINGS_PAGES.alerts = SetAlerts;

/* ---------- PR page: time summary on the Timeline tab ---------- */
function prTimes(pr) {
  const readyE = pr.timeline.filter(t => /^Marked the PR ready for review|^Opened the PR in GitHub$/.test(t.text)).map(t => t.at);
  const readyAt = readyE.length ? Math.min.apply(null, readyE) : null;
  let agent = pr.timeline.filter(t => t.actor === 'bot' && t.dur != null && !/^Analyst/.test(t.text)).reduce((s, t) => s + t.dur, 0) + pr.rounds.filter(r => r.status === 'failed').reduce((s, r) => s + (r.dur || 0), 0);
  if (pr.run && !pr.run.queued) agent += runView(pr.run).real;
  const end = (pr.merged || pr.closed || {}).at || Date.now();
  return { readyAt, agent, wait: readyAt ? Math.max(0, (end - readyAt) / 1000 - agent) : 0, end, cost: prSpend(pr) };
}
function TimeSummary({ pr }) {
  const t = prTimes(pr);
  if (!t.readyAt) return html`<div class="strip mb-3 text-sm"><${Icon} n="timer" s=${14} cls="text-ink3" /><span>Not ready for review yet.</span></div>`;
  const done = pr.merged || pr.closed;
  return html`<div class="timesum mb-3" data-timesum>
    <span><span class="text-ink3">Ready for review</span> <${Time} t=${t.readyAt} cls="font-medium" /></span>
    <span><span class="text-ink3">${done ? (pr.merged ? 'Ready → merged' : 'Ready → closed') : 'Open for'}</span> <span class="num font-medium">${hrs((t.end - t.readyAt) / 1000)}</span></span>
    <span><span class="sw" style="background:var(--viz-agent)"></span><span class="text-ink3">Agents worked</span> <span class="num font-medium">${hrs(t.agent)}</span></span>
    <span><span class="sw" style="background:var(--viz-people)"></span><span class="text-ink3">Waiting for people and merge</span> <span class="num font-medium">${hrs(t.wait)}</span></span>
    <span><span class="text-ink3">Cost</span> <span class="num font-medium">${money(t.cost)}</span></span></div>`;
}

/* ---------- Insights → Overview: the five pilot metrics ---------- */
function SplitBar({ parts, h = 28, labels }) {
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  return html`<div class="splitbar" style=${{ height: h + 'px' }} role="img" aria-label=${parts.map(p => p.label + ' ' + Math.round(p.v / total * 1000) / 10 + '%').join(', ')}>
    ${parts.map(p => { const w = p.v / total * 100; return html`<span class="seg" style=${{ flexGrow: Math.max(w, labels ? 0.6 : 0.8), background: p.color, color: p.ink || '#fff' }} data-tip=${p.label + ': ' + (Math.round(w * 10) / 10) + '% · ' + p.tip}>${labels && w > 9 && html`<b>${Math.round(w)}%</b>`}</span>`; })}</div>`;
}
/* A tile is a label, a number and one grey line with the sample size. Everything else is behind ⓘ. Never coloured. */
function Kpi({ n, label, value, line, def }) {
  return html`<div class="card kpi" data-kpi=${n}><div class="text-xs text-ink2 font-medium leading-4">${label}<${Info} tip=${def} pos=${n === '5' ? 'left' : n === '1' ? 'right' : null} /></div>
    <div class="num font-head font-semibold text-2xl mt-1.5">${value}</div><div class="text-xs text-ink3 mt-0.5" data-sample>${line}</div></div>`;
}
function Overview({ q }) {
  const range = Number(q.range || 30), now = Date.now();
  const rows = history().filter(r => now - r.endAt <= range * DAY && (!q.repo || repoShort(r.repo) === q.repo) && (!q.person || r.author === q.person)).sort((a, b) => b.endAt - a.endAt);
  const merged = rows.filter(r => r.outcome === 'merged');
  const agentMed = median(rows.map(r => r.agent)), agentMax = rows.length ? Math.max.apply(null, rows.map(r => r.agent)) : 0;
  const r2m = median(merged.map(r => r.total)), sum = k => merged.reduce((s, r) => s + r[k], 0), tot = sum('total') || 1;
  const costs = rows.map(r => r.cost), costMed = median(costs), costMax = costs.length ? Math.max.apply(null, costs) : 0, costSum = costs.reduce((a, b) => a + b, 0);
  const used = rows.filter(r => r.chainMax >= 3).length, over3 = rows.filter(r => r.rounds > 3).length;
  const changed = merged.filter(r => r.changed).length, ignored = merged.filter(r => r.ignored).length;
  const extra = S.trials.reduce((s, t) => s + (t.costA || 0) + (t.costB || 0), 0) + S.analyses.reduce((s, a) => s + (a.cost || 0), 0);
  const set = p => setQ(p, true);
  const nPRs = (n, what) => plural(n, 'PR') + (what ? ' ' + what : '') + (n < 10 ? ' · too few to conclude' : '');
  const parts = [
    { label: 'Agents working', v: sum('agent') + sum('queue'), color: 'var(--viz-agent)', tip: hrs(sum('agent') + sum('queue')) + ' in total, of which ' + hrs(sum('queue')) + ' queued' },
    { label: 'Waiting for people', v: sum('people'), color: 'var(--viz-people)', ink: '#2a1a02', tip: hrs(sum('people')) + ' in total, in Action needed' },
    { label: 'Waiting for merge', v: sum('wait'), color: 'var(--viz-merge)', tip: hrs(sum('wait')) + ' in total, in Ready to merge' }
  ];
  const people = [{ value: '', label: 'Everyone' }].concat(S.team.map(t => ({ value: t.id, label: t.name })));
  return html`<div class="grid gap-4 mt-4" data-overview>
    <div class="flex items-center gap-2 flex-wrap">
      <div class="seg" role="group" aria-label="Time range">${[14, 30].map(r => html`<button aria-pressed=${String(range === r)} onClick=${() => set({ range: r === 30 ? '' : r })}>Last ${r} days</button>`)}</div>
      <${FilterMenu} label="Author" icon="user-round" value=${q.person} onPick=${v => set({ person: v })} options=${people} />
      <${FilterMenu} label="Repo" icon="folder-git-2" value=${q.repo} onPick=${v => set({ repo: v })} options=${[{ value: '', label: 'All repositories' }].concat(Object.keys(S.repos).map(r => ({ value: repoShort(r), label: repoShort(r) })))} />
    </div>
    ${rows.length === 0 ? html`<${Empty} icon="search-x" title="No PR finished in this range">Pick a longer range or another author.</${Empty}>` : html`<${Fragment}>
    <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
      <${Kpi} n="1" label="Agent work per PR" value=${hrs(agentMed)} line=${'median · ' + nPRs(rows.length)} def=${'Time agents actually worked on the PR, from ready for review to the end of the last stage: every round, fix and fix check. Queue time is not counted. Longest: ' + hrs(agentMax) + '.'} />
      <${Kpi} n="2" label="Ready → merge" value=${r2m == null ? '—' : hrs(r2m)} line=${'median · ' + nPRs(merged.length, 'merged')} def=${'From the first “ready for review” in GitHub to the merge. Agents worked ' + (Math.round(parts[0].v / tot * 1000) / 10) + '% of it; the rest is waiting for people or for the merge click.'} />
      <${Kpi} n="3" label="Cost per PR" value=${costMed == null ? '—' : money(costMed)} line=${'median · ' + nPRs(rows.length)} def=${'Every agent session on the PR, priced at API rates, also when the run used a subscription. Highest ' + money(costMax) + ', total ' + money(costSum) + '. Trials and analyst (' + money(extra) + ') are not included.'} />
      <${Kpi} n="4" label="Not finished after 3 rounds" value=${used + ' of ' + rows.length} line=${pctOf(used, rows.length) + ' · ' + nPRs(rows.length)} def=${'PRs where a chain used all 3 automatic rounds and a fix was still open: a sign of a problem in the task or in the review itself. ' + plural(over3, 'PR') + ' had more than 3 rounds in total (a manual Start review begins a new chain).'} />
      <${Kpi} n="5" label="Ready, then changed by a person" value=${changed + ' of ' + merged.length} line=${pctOf(changed, merged.length) + ' · lower bound · ' + nPRs(merged.length, 'merged')} def=${'PRs that were Ready to merge and then got a commit from a person, or were merged in GitHub at another commit. It cannot see an approval without reading, or a fix made in a later PR.' + (ignored ? ' ' + plural(ignored, 'commit') + ' that only merged main ignored.' : '')} />
    </div>
    <section class="card"><div class="card-h flex-wrap"><h2 class="card-t m-0">Where the time goes, ready → merge</h2><span class="text-xs text-ink3" data-sample>${plural(merged.length, 'merged PR')}</span></div>
      <div class="p-4"><${SplitBar} parts=${parts} h=${24} />
        <div class="flex flex-wrap gap-x-6 gap-y-2 mt-3 text-sm">${parts.map(p => html`<span class="inline-flex items-center"><span class="sw" style=${{ background: p.color }}></span><span>${p.label}</span><span class="num font-medium ml-2">${Math.round(p.v / tot * 1000) / 10}%</span><span class="text-ink3 num ml-2">${hrs(p.v)}</span></span>`)}</div></div></section>
    <${Fold} hook="pr-table" title=${plural(rows.length, 'pull request') + ' in the range'}><div class="tblwrap mt-2"><table class="tbl"><thead><tr><th>Pull request</th><th>Author</th><th class="r">Ready → merge</th><th class="r">Agent work</th><th class="r">Cost</th><th class="r">Rounds</th><th>Changed after ready</th></tr></thead><tbody>
      ${rows.map(r => { const inApp = !!S.prs[r.num]; return html`<tr class=${inApp ? 'click' : ''} onClick=${() => { if (inApp) nav('pr/' + r.num); }}>
        <td><span class="font-medium">${r.title}</span> <span class="mono text-ink3">#${r.num}</span><div class="text-xs text-ink3">${r.repo !== WB ? repoShort(r.repo) + ' · ' : ''}${r.outcome === 'merged' ? 'merged' : 'closed without merging'} <${Time} t=${r.endAt} /></div></td>
        <td>${actorName(r.author)}</td>
        <td class="r">${r.outcome === 'merged' ? html`<span data-tip=${'Agents ' + hrs(r.agent + r.queue) + ' · people ' + hrs(r.people) + ' · merge ' + hrs(r.wait)}>${hrs(r.total)}</span>` : html`<span class="text-ink4">—</span>`}</td>
        <td class="r">${hrs(r.agent)}</td>
        <td class="r">${r.cost > S.alertCfg.costMax ? html`<span data-tip=${'Above the ' + money(S.alertCfg.costMax) + ' alert threshold'} data-tip-pos="left" class="inline-flex items-center gap-1"><${Icon} n="bell" s=${11} cls="text-ink3" />${money(r.cost)}</span>` : money(r.cost)}</td>
        <td class="r">${r.chainMax >= 3 ? html`<span data-tip=${'A chain used all 3 automatic rounds. ' + r.rounds + ' rounds in total.'} data-tip-pos="left">${r.rounds} · 3 of 3 used</span>` : r.rounds}</td>
        <td>${r.changed ? html`<span data-tip=${r.changed} data-tip-pos="left">Changed</span>` : r.ignored ? html`<span class="text-ink3" data-tip=${r.ignored} data-tip-pos="left">No · 1 ignored</span>` : r.outcome === 'merged' ? html`<span class="text-ink3">No</span>` : html`<span class="text-ink4">—</span>`}</td></tr>`; })}
    </tbody></table></div></${Fold}></${Fragment}>`}
    <${Fold} quiet hook="not-measured" title="Not measured yet">
      <ul class="m-0 mt-2 pl-9 text-sm text-ink2 grid gap-1 list-disc">
        <li>Where problems are found: by an agent, a person, CI, or only after merge.</li>
        <li>Fix PRs and reverts within 14 days of merge (needs about a month of data).</li>
        <li>Regressions caught by E2E (once E2E runs on every PR).</li>
      </ul>
      <p class="text-xs text-ink3 mt-2 mb-0 pl-5 max-w-[90ch]">The data is already logged for every PR: each agent session in full and every GitHub event in raw form, so these can be computed later without new tracking.</p></${Fold}>
  </div>`;
}
