/* Dialogs for PR actions. Friction matches risk: merge and push ask for the PR number and a signature. */
function ErrLine({ err }) { return err ? html`<div class="hint mt-2" style="color:var(--bad)" role="alert">${err}</div>` : null; }

DIALOGS.merge = function MergeDialog({ num, onClose }) {
  const pr = S.prs[num], cl = checklist(pr), [typed, setTyped] = useState(''), [by, setBy] = useSigner();
  const why = !cl.ok ? 'The merge checklist is not green any more.' : typed !== String(num) ? 'Type the PR number ' + num + ' to confirm.' : !by ? 'Pick your name to sign the merge.' : null;
  const go = () => { mutate(() => mergePr(pr, by)); onClose(); toast({ title: '#' + num + ' merged by ' + actorName(by), desc: 'Squash-merged at ' + pr.merged.sha + '. The PR left the board.' + (pr.level >= 6 ? ' Factory bot started the analyst.' : ''), tone: 'ok' }); };
  return html`<${Dialog} alert icon="git-merge" tone="green" title=${'Merge #' + num} desc=${html`Squash merge at <span class="mono">${pr.head}</span> into <span class="mono">${pr.base}</span>. Cannot be undone from here.`} onClose=${onClose}
    footer=${html`<${Btn} v="ghost" onClick=${onClose}>Cancel</${Btn}><${Btn} v="primary" icon="git-merge" why=${why} onClick=${go}>Merge #${num}</${Btn}>`}>
    ${cl.ok ? html`<div class="text-sm flex items-center gap-2 mb-3"><${Icon} n="circle-check" s=${15} cls="text-ok" /><span><span class="font-medium">Merge checklist: ${cl.items.length} of ${cl.items.length} pass</span><${Info} tip="Checked again against fresh GitHub state when you click Merge." />${pr.level >= 6 ? html`<span class="text-ink3"> · the analyst runs after the merge</span>` : ''}</span></div>`
      : html`<ul class="m-0 p-0 list-none mb-3">${cl.items.filter(i => !i.ok).map(i => html`<li class="flex items-start gap-2 py-1 text-sm"><${Icon} n="circle-x" s=${14} cls="mt-0.5 text-warn" /><span><span class="font-medium">${i.t}.</span> <span class="text-ink3">${i.why}</span></span></li>`)}</ul>`}
    <div class="grid gap-3 sm:grid-cols-2"><${TypeNumber} num=${num} value=${typed} onChange=${setTyped} /><${Sign} id="merge-sign" value=${by} onChange=${setBy} note="Recorded as “Merged by …” in the timeline." /></div>
  </${Dialog}>`;
};

DIALOGS.push = function PushDialog({ num, onClose }) {
  const pr = S.prs[num], p = pr.patch, files = p.files.filter(f => !f.reverted), [typed, setTyped] = useState(''), [by, setBy] = useSigner();
  const why = typed !== String(num) ? 'Type the PR number ' + num + ' to confirm.' : !by ? 'Pick your name to sign the push.' : null;
  const next = pr.chain && pr.chain.n < 3;
  const go = () => { remember(by); mutate(() => pushPatch(pr, by)); onClose(); nav('pr/' + num, { tab: 'findings' }); toast({ title: 'Fix pushed to ' + pr.branch, desc: next ? 'Factory bot started round ' + pr.chain.n + ' of 3 to check the fix.' : 'Automatic rounds are used (3 of 3). Start a review when you want one.', tone: 'ok' }); };
  return html`<${Dialog} alert icon="upload" title=${'Push the fix to #' + num} desc=${html`Adds one commit to <span class="mono">${pr.branch}</span>. Never forced.`} onClose=${onClose}
    footer=${html`<${Btn} v="ghost" onClick=${onClose}>Cancel</${Btn}><${Btn} v="primary" icon="upload" why=${why} onClick=${go}>Push to ${pr.branch}</${Btn}>`}>
    <div class="rounded-lg border border-line overflow-hidden"><div class="px-3 py-2 bg-sunk text-xs font-medium text-ink2 border-b border-div flex justify-between gap-2 flex-wrap"><span>${plural(files.length, 'file')} · fixed ${p.fixed} of ${p.total} · reproductions pass</span><span>revision ${p.rev}</span></div>
      <ul class="m-0 p-0 list-none py-1">${files.map(f => { const s = diffStat(lineDiff(f.before, f.after)); return html`<li class="flex items-center gap-2 px-3 py-1 text-sm"><${Icon} n="file-code" s=${13} cls="text-ink3" /><span class="mono flex-1 break-all">${f.path}</span>${f.sensitive && html`<${Badge} tone="amber" icon="shield-alert">Sensitive</${Badge}>`}<span class="num text-xs whitespace-nowrap"><span style="color:var(--ok)">+${s.add}</span> <span style="color:var(--bad)">−${s.del}</span></span></li>`; })}</ul></div>
    <div class="text-sm text-ink2 mt-3">On top of <span class="mono">${pr.head}</span>. Next: ${next ? html`Factory bot starts <span class="font-medium">round ${pr.chain.n + 1} of 3</span>, a fix check.` : 'Automatic rounds used (3 of 3), so no re-review starts.'}</div>
    <div class="grid gap-3 sm:grid-cols-2 mt-4"><${TypeNumber} num=${num} value=${typed} onChange=${setTyped} /><${Sign} id="push-sign" value=${by} onChange=${setBy} note="The commit is written by the implementer agent; your name is recorded as the person who pushed it." /></div>
  </${Dialog}>`;
};

DIALOGS.implement = function ImplementDialog({ num, onClose }) {
  const pr = S.prs[num], fx = toFix(pr), [by, setBy] = useSigner(), [err, setErr] = useState('');
  const go = () => { if (!by) { setErr('Pick your name to sign.'); return; } mutate(() => implementWithAgent(pr, by)); onClose(); nav('pr/' + num, { tab: 'patch' }); toast({ title: 'Implementer started on #' + num, desc: 'Fixing ' + plural(fx.length, 'finding') + '. Signed by ' + actorName(by) + '.' }); };
  return html`<${Dialog} icon="wrench" title="Implement with agent" desc=${'Fixes ' + plural(fx.length, 'finding') + ' marked Implement. You read the diff before anything is pushed.'} onClose=${onClose}
    footer=${html`<${Btn} v="ghost" onClick=${onClose}>Cancel</${Btn}><${Btn} v="primary" icon="wrench" onClick=${go}>Start the implementer</${Btn}>`}>
    <ul class="m-0 p-0 list-none grid gap-1.5 mb-4">${fx.map(f => html`<li class="flex items-start gap-2 text-sm"><span class=${cx('sev mt-1.5', f.sev)}></span><span><span class="font-medium">${md(f.title)}</span><span class="block mono text-ink3 break-all">${f.file}:${f.line}</span></span></li>`)}</ul>
    <${Sign} id="impl-sign" value=${by} onChange=${v => { setBy(v); setErr(''); }} note="Signed, because it leads to a push on this PR." /><${ErrLine} err=${err} />
  </${Dialog}>`;
};

DIALOGS.bulkDecide = function BulkDecideDialog({ num, ids, v, onClose }) {
  const pr = S.prs[num], D = DECISIONS[v], fs = pr.findings.filter(f => ids.indexOf(f.id) >= 0);
  return html`<${Dialog} icon=${D.icon} title=${D.t + ': ' + plural(fs.length, 'finding')} desc="One signature covers all of them." onClose=${onClose}
    footer=${html`<${Btn} v="ghost" onClick=${onClose}>Cancel</${Btn}><${Btn} v="primary" icon=${D.icon} onClick=${() => document.getElementById('bulk-submit').click()}>${D.t} ${fs.length}</${Btn}>`}>
    <ul class="m-0 p-0 list-none grid gap-1 mb-4 max-h-40 overflow-y-auto">${fs.map(f => html`<li class="flex items-start gap-2 text-sm"><span class=${cx('sev mt-1.5', f.sev)}></span><span class="min-w-0">${md(f.title)}</span></li>`)}</ul>
    <${DecideForm} pr=${pr} ids=${ids} v=${v} inDialog onDone=${onClose} />
  </${Dialog}>`;
};

DIALOGS.saveReview = function SaveReviewDialog({ num, onClose }) {
  const pr = S.prs[num], draft = UI.draft[num] || {}, ids = Object.keys(draft), [by, setBy] = useSigner(), [err, setErr] = useState('');
  const go = () => { if (!by) { setErr('Pick your name to sign the review.'); return; } let undo; const kept = JSON.parse(JSON.stringify(draft)); mutate(() => { undo = saveReview(pr, draft, by); }); UI.draft[num] = {}; onClose();
    toast({ title: actorName(by) + "'s review saved", desc: plural(ids.length, 'opinion') + ' on #' + num + '. ' + authorName(pr) + ' is not notified yet.', undo: () => { undo(); UI.draft[num] = kept; commit(); } }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  return html`<${Dialog} icon="message-square-text" title="Save your review" desc=${'One signed review. ' + authorName(pr) + ' sees it before deciding.'} onClose=${onClose}
    footer=${html`<${Btn} v="ghost" onClick=${onClose}>Keep editing</${Btn}><${Btn} v="primary" icon="check" onClick=${go}>Save review</${Btn}>`}>
    <ul class="m-0 p-0 list-none grid gap-2 mb-4">${ids.map(id => { const f = pr.findings.find(x => String(x.id) === id), d = draft[id]; return html`<li class="flex items-start gap-2 text-sm"><span class="inline-flex items-center gap-1 whitespace-nowrap font-medium w-[150px] shrink-0" style=${d.v === 'worth' ? 'color:var(--ok)' : 'color:var(--text-2)'}><${Icon} n=${d.v === 'worth' ? 'thumbs-up' : 'thumbs-down'} s=${13} />${d.v === 'worth' ? 'Worth implementing' : 'Not worth it'}</span><span class="min-w-0">${md(f.title)}${d.comment && html`<span class="block text-ink3">"${d.comment}"</span>`}</span></li>`; })}</ul>
    <${Sign} id="review-sign" value=${by} onChange=${v => { setBy(v); setErr(''); }} /><${ErrLine} err=${err} />
  </${Dialog}>`;
};

DIALOGS.linkClickup = function LinkClickupDialog({ num, onClose }) {
  const pr = S.prs[num], [v, setV] = useState('');
  const id = (v.match(/WB-\d+/i) || [''])[0].toUpperCase();
  return html`<${Dialog} icon="link" title="Link a ClickUp task" desc=${'No task was found for #' + num + '. Paste the task link or its id.'} onClose=${onClose}
    footer=${html`<${Btn} v="ghost" onClick=${onClose}>Cancel</${Btn}><${Btn} v="primary" icon="link" why=${id ? null : 'Enter a task id such as WB-812, or paste the task link.'} onClick=${() => { mutate(() => { pr.clickup = id; tlog(pr, 'hand', 'Linked ClickUp task ' + id + ' by hand'); }); onClose(); toast({ title: id + ' linked to #' + num, desc: 'Notify author and Defer to ClickUp can use it now.', tone: 'ok' }); }}>Link task</${Btn}>`}>
    <${Field} label="ClickUp task" id="cu-task" hint="The task is used for Notify author and for follow-ups from deferred findings."><input id="cu-task" class="input" placeholder="WB-812 or https://app.clickup.com/t/…/WB-812" value=${v} onInput=${e => setV(e.target.value)} /></${Field}>
  </${Dialog}>`;
};

DIALOGS.sendBack = function SendBackDialog({ num, onClose }) {
  const pr = S.prs[num], [c, setC] = useState(''), [by, setBy] = useSigner(), [err, setErr] = useState('');
  const go = () => { if (!c.trim()) { setErr('Write a comment, so ' + authorName(pr) + ' knows what to change.'); return; } if (!by) { setErr('Pick your name to sign.'); return; } mutate(() => sendBackSensitive(pr, c.trim(), by)); onClose(); toast({ title: 'Sent back to ' + authorName(pr), desc: 'Signed by ' + actorName(by) + '. The PR stays in Action needed until the files change.' }); };
  return html`<${Dialog} icon="undo-2" tone="amber" title="Send the sensitive files back" desc=${'Tell ' + authorName(pr) + ' what must change before approval.'} onClose=${onClose}
    footer=${html`<${Btn} v="ghost" onClick=${onClose}>Cancel</${Btn}><${Btn} v="primary" icon="undo-2" onClick=${go}>Send back to ${authorName(pr)}</${Btn}>`}>
    <ul class="m-0 p-0 list-none mb-3 grid gap-1">${pr.sensitive.files.map(f => html`<li class="mono break-all">${f.path}</li>`)}</ul>
    <${Field} label="Comment for the author (required)" id="sb-comment"><textarea id="sb-comment" class="textarea" rows="3" placeholder="e.g. Do not export the marker yet; keep it internal until the API settles." value=${c} onInput=${e => { setC(e.target.value); setErr(''); }}></textarea></${Field}>
    <div class="mt-3"><${Sign} id="sb-sign" value=${by} onChange=${v => { setBy(v); setErr(''); }} /></div><${ErrLine} err=${err} />
  </${Dialog}>`;
};

/* Generic signed confirmation for every Settings change that lands in the Audit log. */
DIALOGS.confirmSave = function ConfirmSaveDialog({ title, desc, area, text, diff, impact, apply, cta, icon, onClose, done }) {
  const [by, setBy] = useSigner(), [err, setErr] = useState('');
  const go = () => { if (!by) { setErr('Pick your name to sign the change.'); return; } remember(by); mutate(() => { apply(by); audit(by, area, text, diff); }); onClose(); toast({ title: text, desc: 'Signed by ' + actorName(by) + '. Recorded in the Audit log.', tone: 'ok', go: ['settings/audit'] }); done && done(); };
  return html`<${Dialog} alert icon=${icon || 'save'} title=${title} desc=${desc} onClose=${onClose}
    footer=${html`<${Btn} v="ghost" onClick=${onClose}>Cancel</${Btn}><${Btn} v="primary" icon="check" onClick=${go}>${cta || 'Save changes'}</${Btn}>`}>
    ${impact && html`<div class="strip t-amber mb-3" style="border-color:var(--warn-line)"><${Icon} n="triangle-alert" s=${15} cls="text-warn" /><span>${impact}</span></div>`}
    ${diff && diff.length > 0 && html`<div class="rounded-lg border border-line overflow-hidden mb-4"><table class="tbl"><thead><tr><th>Setting</th><th>Now</th><th>After</th></tr></thead><tbody>${diff.map(d => html`<tr><td class="font-medium">${d.k}</td><td class="text-ink3">${d.from || '—'}</td><td>${d.to}</td></tr>`)}</tbody></table></div>`}
    <${Sign} id="save-sign" value=${by} onChange=${v => { setBy(v); setErr(''); }} note="This change is signed and recorded in the Audit log." /><${ErrLine} err=${err} />
  </${Dialog}>`;
};
