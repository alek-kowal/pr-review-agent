/* Prototype guide: deliberately styled as outside the product. Flows, GitHub simulations, state jump list, reset. */
function resetDemo() {
  LS.del('demo'); Object.assign(UI, { dialog: null, toasts: [], palette: false, shortcuts: false, draft: {}, sel: {}, cur: {}, open: {}, stale: {}, form: null, chip: false });
  S = seed(); ensureAlerts(); nav('prs'); commit(); toast({ title: 'Demo reset', desc: 'All sample data is back to the start.' });
}
const FLOWS = [
  ['A', 'PR ready → round 1', 'pr/281', null, 'Click “marks ready” in the dashed PROTOTYPE line, then watch the stepper.'],
  ['B', 'Team review → author decides → merge', 'pr/272', { tab: 'questions' }, 'Answer as Tomek, give opinions, Save review, Notify author. Then decide as Kasia.'],
  ['C', 'Implement with agent → push → fix check', 'pr/265', null, 'Implement with agent, read the patch, Push. Round 2 of 3 checks the fix.'],
  ['D', 'Change an instruction safely', 'settings/instructions/review-rules', null, 'Edit, Save as draft, Try on a PR, Compare, Activate.'],
  ['E', 'Learning after a PR closes', 'pr/278', null, 'Merge #278 (level 6). The analyst runs; then open Settings → Learning.']
];
const VARIANTS = [['Level-5 autofix that pushes by itself', 'pr/38', 'mark it ready and watch'], ['Autofix waiting: sensitive file', 'pr/268'], ['Automatic rounds used (3 of 3)', 'pr/250'], ['Someone pushed on top: nothing starts', 'pr/239']];
/* The closed guide is a small dashed chip in the top bar, so it never covers content. */
UI.guide = LS.get('guide', false);
function toggleGuide(v) { UI.guide = v; LS.set('guide', v); commit(); }
function GuideBtn() { return html`<button class="guide-btn" aria-expanded=${String(!!UI.guide)} aria-label="Prototype guide" title="Prototype guide: flows, GitHub simulations, reset. Not part of the product." onClick=${() => toggleGuide(!UI.guide)}><${Icon} n="map" s=${12} /><span class="hidden xl:inline">Prototype guide</span></button>`; }
function Guide({ route }) {
  const open = !!UI.guide, tog = toggleGuide;
  const cur = route.path[0] === 'pr' ? S.prs[Number(route.path[1])] : null, live = cur && !cur.merged && !cur.closed;
  const f = S.factory;
  if (!open) return null;
  return html`<div class="guide"><div class="guide-panel" role="region" aria-label="Prototype guide">
    <div class="flex items-center justify-between gap-2 px-3 py-2 sticky top-0" style="background:var(--guide-bg);border-bottom:1.5px dashed var(--guide-line)"><span style="color:var(--guide-accent)">PROTOTYPE GUIDE · not part of the product</span><button class="ga" aria-expanded="true" onClick=${() => tog(false)}>hide</button></div>
    <h4>Flows</h4>${FLOWS.map(([k, name, to, q, how]) => html`<div class="px-3 py-1"><div class="flex items-baseline justify-between gap-2"><span><span style="color:var(--guide-accent)">${k}</span> ${name}</span><a href=${href(to, q)} data-flow=${k}>Start</a></div><div class="dim">${how}</div></div>`)}
    <h4>Flow C variants</h4>${VARIANTS.map(([name, to, note]) => html`<div class="guide-row"><span>${name}${note && html` <span class="dim">(${note})</span>`}</span><a href=${href(to)}>open</a></div>`)}
    <h4>Simulate GitHub ${cur ? 'on #' + cur.num : ''}</h4>
    ${!live ? html`<div class="px-3 dim">Open a pull request to simulate what its author does in GitHub. The same controls sit in the dashed PROTOTYPE line next to the tabs.</div>` : html`
      ${cur.draft && html`<div class="guide-row"><span>Author marks the PR ready for review</span><button class="ga" onClick=${() => mutate(() => markReady(cur))}>run</button></div>`}
      <div class="guide-row"><span>Author pushes 2 commits from an IDE</span><button class="ga" onClick=${() => mutate(() => pushFromIde(cur, 2))}>run</button></div>
      <div class="guide-row"><span>Author closes the PR without merging</span><button class="ga" onClick=${() => mutate(() => closePr(cur))}>run</button></div>`}
    <h4>Simulate the factory</h4>
    <div class="guide-row"><span>Daily budget reached</span><button class="ga" data-sim="budget" onClick=${() => mutate(() => { if (f.spent >= f.budget) f.spent = 4.76; else f.spent = f.budget; })}>${f.spent >= f.budget ? 'undo' : 'run'}</button></div>
    <div class="guide-row"><span>Paused by Tomek: release freeze</span><button class="ga" data-sim="pause" onClick=${() => mutate(() => { if (f.paused) resumeFactory('tomek'); else pauseFactory('release freeze', 'tomek'); })}>${f.paused ? 'resume' : 'run'}</button></div>
    <h4>Every PR state</h4>${Object.keys(S.seedStates).map(n => { const want = S.seedStates[n], pr = S.prs[n], now = prState(pr); return html`<div class="guide-row"><span>${STATE_NAMES[want]}${n === '268' ? ' (autofix waiting)' : ''}${now !== want && html` <span class="dim">(now: ${STATE_NAMES[now].toLowerCase()})</span>`}</span><a href=${'#/pr/' + n}>#${n}</a></div>`; })}
    <div class="px-3 pt-1 dim">States change as you click and as live runs finish. Reset brings them all back.</div>
    <div class="px-3 py-3"><button class="guide-btn" data-reset onClick=${resetDemo}><${Icon} n="rotate-ccw" s=${13} />Reset demo</button></div>
  </div></div>`;
}
