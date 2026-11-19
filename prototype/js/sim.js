/* Domain logic and the simulated backend: PR state, next step, runs that tick in place, and every action. */
const person = id => S.team.find(t => t.id === id);
const actorName = a => a === 'bot' ? 'Factory bot' : a === 'hand' ? 'by hand' : person(a) ? person(a).name : String(a || '').replace(/^@/, '');
const authorName = pr => actorName(pr.author);
const repoShort = r => r.split('/')[1];
const prList = () => Object.values(S.prs).sort((a, b) => b.num - a.num);
const openPrs = () => prList().filter(p => !p.merged && !p.closed);

const openQuestions = pr => pr.questions.filter(q => !q.answer);
const toDecide = pr => pr.findings.filter(f => !f.decision && f.verdict !== 'refuted' && f.sev !== 'nit' && f.resolved !== true);
const toFix = pr => pr.findings.filter(f => f.decision && f.decision.v === 'implement' && f.resolved !== true);
const reviewsCount = pr => new Set(pr.findings.flatMap(f => f.opinions.map(o => o.by))).size;

function prState(pr) {
  if (pr.merged) return 'merged'; if (pr.closed) return 'closed';
  if (pr.run) return pr.run.queued ? 'queued' : pr.run.kind === 'fix' ? 'fixing' : pr.run.kind === 'fixcheck' ? 'fixcheck' : 'running';
  if (pr.failed) return 'failed';
  if (!pr.reviewedSha) return pr.draft ? 'draft' : 'never';
  if (pr.commitsSince > 0) return 'newcommits';
  if (pr.patch && pr.patch.state === 'ready') return 'patch';
  if (openQuestions(pr).length) return 'questions';
  if (toDecide(pr).length) return 'decide';
  if (pr.sensitive && pr.sensitive.status !== 'approved') return 'sensitive';
  if (toFix(pr).length) return pr.chain && pr.chain.n >= 3 ? 'roundsused' : 'tofix';
  return 'ready';
}
const LANES = [
  { id: 'not', name: 'Not reviewed', empty: 'No drafts or forks waiting.' },
  { id: 'work', name: 'Agents working', empty: 'No agent is working.' },
  { id: 'action', name: 'Action needed', empty: 'Nothing needs a person right now.' },
  { id: 'ready', name: 'Ready to merge', empty: 'No PR is ready yet.' }
];
const LANE_OF = { draft: 'not', never: 'not', queued: 'work', running: 'work', fixcheck: 'work', fixing: 'work', ready: 'ready', merged: null, closed: null };
const laneOf = st => st in LANE_OF ? LANE_OF[st] : 'action';
const STATE_NAMES = { draft: 'Draft', never: 'Never reviewed', queued: 'Queued', running: 'Round 1 running', fixcheck: 'Fix check running', questions: 'Questions waiting', decide: 'Findings to decide', sensitive: 'Sensitive files changed', tofix: 'Waiting for the fix', fixing: 'Fixing', patch: 'Patch ready', newcommits: 'New commits since last review', roundsused: 'Automatic rounds used', failed: 'Stage failed', ready: 'Ready to merge', merged: 'Merged', closed: 'Closed' };

function canStart() { return !S.factory.paused && S.factory.spent < S.factory.budget; }
function factoryStatus() { const f = S.factory; return f.paused ? 'paused' : f.spent >= f.budget ? 'budget' : 'running'; }
function queueReason(pr) {
  const f = S.factory;
  if (f.paused) return 'factory paused by ' + actorName(f.pausedBy) + ' (' + f.pauseReason + ')';
  if (f.spent >= f.budget) return 'daily budget reached (' + money(f.budget).replace('.00', '') + ' of ' + money(f.budget).replace('.00', '') + ')';
  const w = (pr.run && pr.run.waitFor || []).filter(n => S.prs[n] && S.prs[n].run && !S.prs[n].run.queued);
  return w.length ? 'both agent slots are busy (' + w.map(n => '#' + n).join(', ') + ')' : 'starting';
}

/* What is needed, who usually does it, and the pill. One source for cards, banners and the palette. */
function nextStep(pr) {
  const st = prState(pr), a = authorName(pr), auth = 'usually ' + a + ' (author)', sha = pr.reviewedSha;
  const base = { st, lane: laneOf(st) };
  const r = pr.run, n = pr.chain ? pr.chain.n : 1;
  switch (st) {
    case 'draft': return Object.assign(base, { tone: 'neutral', icon: 'git-pull-request-draft', pill: 'Not reviewed', title: 'Draft: review starts when the PR is ready for review', short: 'Review starts when the PR is ready', who: a + ' marks it ready in GitHub', sub: 'Round 1 starts by itself when ' + a + ' marks the PR ready for review in GitHub. You can also start a review now.' });
    case 'never': return Object.assign(base, { tone: 'neutral', icon: 'circle-dashed', pill: 'Not reviewed', title: 'Not reviewed yet', short: pr.fork ? 'Fork: start the review by hand' : 'Start a review', who: 'anyone can start it', sub: pr.cancelledNote || (pr.fork ? 'Forks are never reviewed automatically. A review of a fork only reads the code: no install, no scripts, no agent fixes.' : 'This PR has not been reviewed. Start a review when you want one.') });
    case 'queued': return Object.assign(base, { tone: 'blue', icon: 'clock', pill: 'Queued', title: 'Queued: ' + queueReason(pr), short: 'Queued: ' + queueReason(pr), who: S.factory.paused || S.factory.spent >= S.factory.budget ? 'anyone can resume in the status chip' : 'starts by itself', sub: S.factory.paused ? 'The round starts as soon as the factory is resumed.' : S.factory.spent >= S.factory.budget ? 'The round starts when the budget is raised or tomorrow, when the daily spend resets.' : 'The round starts by itself when a slot is free.' });
    case 'running': return Object.assign(base, { tone: 'blue', live: true, icon: 'loader-circle', pill: 'Agents working', title: r.kind === 'retry' ? 'Retrying from Review: earlier stages are reused' : r.by === 'bot' ? 'Review starting: PR marked ready for review' : 'Review running: started by hand', short: 'Round ' + n + ' of 3 is running', who: 'no one needs to act', sub: 'You can leave this page. The PR moves to Action needed or Ready to merge when the round ends.' });
    case 'fixcheck': return Object.assign(base, { tone: 'blue', live: true, icon: 'loader-circle', pill: 'Agents working', title: 'Re-review starting: Factory bot pushed a fix (round ' + n + ' of 3)', short: 'Round ' + n + ' of 3 checks the fix', who: 'no one needs to act', sub: 'This round checks the fixes only: it reads the diff since round ' + (n - 1) + ' and re-runs the reproductions.' });
    case 'fixing': return Object.assign(base, { tone: 'blue', live: true, icon: 'wrench', pill: 'Agents working', title: 'Implementer is fixing ' + plural(toFix(pr).length, 'finding') + ' · started by ' + actorName(r.by).replace('by hand', 'hand'), short: 'Implementer is fixing ' + plural(toFix(pr).length, 'finding'), who: 'no one needs to act', sub: r.by === 'bot' ? 'Level 5 autofix. The patch is pushed automatically only if everything is fixed, the reproductions pass and no sensitive file is touched.' : 'Nothing is pushed yet. You will see the diff before it goes to the branch.' });
    case 'questions': { const q = openQuestions(pr).length, d = toDecide(pr).length; return Object.assign(base, { tone: 'amber', icon: 'message-circle-question', pill: 'Action needed', title: 'Answer ' + plural(q, 'question'), short: 'Answer ' + plural(q, 'question'), who: auth, sub: 'The reviewer needs a decision on intent before the findings can be judged.' + (d ? ' After that: ' + plural(d, 'finding') + ' to decide.' : '') }); }
    case 'decide': { const d = toDecide(pr).length, rv = reviewsCount(pr); return Object.assign(base, { tone: 'amber', icon: 'list-checks', pill: 'Action needed', title: 'Decide ' + plural(d, 'finding'), short: 'Decide ' + plural(d, 'finding'), who: auth, extra: rv ? plural(rv, 'review') + ' so far' : 'no reviews yet', sub: 'Teammates give opinions. One person, usually the author, decides each finding: Implement, Reject or Defer to ClickUp.' }); }
    case 'sensitive': { const k = pr.sensitive.files.length, sb = pr.sensitive.status === 'sent_back'; return Object.assign(base, { tone: 'amber', icon: 'shield-alert', pill: 'Action needed', title: sb ? 'Sent back by ' + actorName(pr.sensitive.by) + ': ' + a + ' changes ' + plural(k, 'sensitive file') : 'Approve changes to ' + plural(k, 'sensitive file'), short: sb ? 'Sensitive files sent back' : 'Approve ' + plural(k, 'sensitive file'), who: sb ? auth : 'usually a teammate, not the author', sub: sb ? '"' + pr.sensitive.comment + '"' : 'A change to a sensitive file needs a human OK, even after a clean review.' }); }
    case 'tofix': { const k = toFix(pr).length; return Object.assign(base, { tone: 'amber', icon: 'wrench', pill: 'Action needed', title: plural(k, 'finding') + ' to implement', short: plural(k, 'finding') + ' to implement', who: auth, sub: 'Fix them in your editor and push, then start a review. Or let the implementer agent write the patch and show you the diff.' }); }
    case 'patch': { const p = pr.patch; return Object.assign(base, { tone: 'amber', icon: 'file-diff', pill: 'Action needed', title: p.waiting === 'sensitive' ? 'Autofix waiting: patch touches a sensitive file' : 'Patch ready: ' + p.fixed + ' of ' + p.total + ' fixed, reproductions pass', short: p.waiting === 'sensitive' ? 'Autofix waiting: sensitive file' : 'Patch ready: review and push', who: auth, sub: p.waiting === 'sensitive' ? 'Level 5 never pushes a change to a sensitive file by itself. Read the diff, then push it or revise it.' : 'Read the diff. Push it to the branch, or revise it with a note to the implementer.' }); }
    case 'newcommits': return Object.assign(base, { tone: 'amber', icon: 'git-commit-horizontal', pill: 'Action needed', title: plural(pr.commitsSince, 'new commit') + ' since last review (' + sha + ')', short: plural(pr.commitsSince, 'new commit') + ' since last review', who: auth, sub: 'A push never starts a review. The results below are from ' + sha + '; start a review when the new commits are ready.' });
    case 'roundsused': { const k = toFix(pr).length; return Object.assign(base, { tone: 'amber', icon: 'repeat', pill: 'Action needed', title: 'Automatic rounds used (3 of 3)', short: 'Automatic rounds used (3 of 3)', who: auth, sub: plural(k, 'fix', 'fixes') + ' still not resolved after 3 rounds. Running out of rounds is not approval. Fix it by hand and start a review, which begins a new chain.' }); }
    case 'failed': return Object.assign(base, { tone: 'red', icon: 'circle-alert', pill: 'Failed', title: pr.failed.title, short: pr.failed.stage + ' stage timed out', who: 'anyone can retry', sub: pr.failed.why });
    case 'ready': return Object.assign(base, { tone: 'green', icon: 'circle-check', pill: 'Ready to merge', title: 'Ready to merge: checklist green at ' + sha, short: 'Merge when you are ready', who: auth, sub: 'Every item on the merge checklist passes for ' + sha + '. Merging is pinned to this commit.' });
    case 'merged': return Object.assign(base, { tone: 'neutral', icon: 'git-merge', pill: 'Merged', title: 'Merged by ' + actorName(pr.merged.by), short: 'Merged by ' + actorName(pr.merged.by), who: '', sub: 'Squash-merged at ' + pr.merged.sha + ' into ' + pr.base + '.' });
    default: return Object.assign(base, { tone: 'neutral', icon: 'circle-x', pill: 'Closed', title: 'Closed without merging', short: 'Closed', who: '', sub: 'Closed in GitHub by ' + actorName(pr.closed.by) + '.' });
  }
}

function checklist(pr) {
  const st = prState(pr), q = openQuestions(pr).length, d = toDecide(pr).length, x = toFix(pr).length, sha = pr.reviewedSha;
  const it = [];
  it.push(!sha ? { ok: false, t: 'Review covers the head commit', why: pr.run && !pr.run.queued ? 'A round is running on ' + pr.head + '.' : 'No completed review yet.' }
    : pr.commitsSince > 0 ? { ok: false, t: 'Review covers the head commit', why: plural(pr.commitsSince, 'commit') + ' pushed after the reviewed ' + sha + '.' }
    : pr.run && !pr.run.queued && pr.run.kind !== 'fix' ? { ok: false, t: 'Review covers the head commit', why: 'A round is running on ' + pr.head + '.' }
    : pr.failed ? { ok: false, t: 'Review covers the head commit', why: 'The last round failed and is not counted.' }
    : sha !== pr.head ? { ok: false, t: 'Review covers the head commit', why: 'The fix ' + pr.head + ' was pushed after the last review.' }
    : { ok: true, t: 'Review covers the head commit', why: 'Reviewed ' + sha + ', the current head.' });
  it.push({ ok: q === 0, t: 'Questions answered', why: pr.questions.length ? (pr.questions.length - q) + ' of ' + pr.questions.length + ' answered.' : 'The reviewer asked nothing.' });
  it.push({ ok: d === 0, t: 'No finding left undecided', why: d ? plural(d, 'finding') + ' to decide.' : pr.findings.length ? 'Every blocking and worth-fixing finding has a decision.' : 'No findings.' });
  it.push({ ok: x === 0, t: 'Nothing waiting for a fix', why: x ? plural(x, 'finding') + ' marked Implement ' + (x === 1 ? 'is' : 'are') + ' not resolved yet.' : 'No fix is pending.' });
  if (pr.sensitive) it.push({ ok: pr.sensitive.status === 'approved', t: 'Sensitive files approved', why: pr.sensitive.status === 'approved' ? plural(pr.sensitive.files.length, 'file') + ' approved by hand.' : pr.sensitive.status === 'sent_back' ? 'Sent back to the author by ' + actorName(pr.sensitive.by) + '.' : plural(pr.sensitive.files.length, 'file') + ' wait for a human OK.' });
  it.push({ ok: pr.ci === 'green', t: 'CI is green in GitHub', why: pr.ci === 'green' ? '14 of 14 checks passed on ' + pr.head + '.' : 'Checks are failing in GitHub.' });
  it.push({ ok: true, t: 'No "changes requested" in GitHub', why: 'No reviewer in GitHub has requested changes.' });
  return { items: it, ok: it.every(i => i.ok) && st === 'ready' };
}

function roundLabel(pr) {
  const c = pr.chain; if (!c) return null;
  const how = c.by === 'hand' ? 'started by hand' : c.by === 'bot' ? 'started by Factory bot' + (/^after fix/.test(c.reason) ? ' ' + c.reason : ' · ' + c.reason) : 'started by ' + actorName(c.by);
  return 'Round ' + c.n + ' of 3 · ' + how;
}
const roundShort = pr => pr.chain ? 'Round ' + pr.chain.n + ' of 3' : null;

/* ---------- Timeline, audit, activity ---------- */
function tlog(pr, actor, text, x) { pr.timeline.push(Object.assign({ at: Date.now(), actor, text }, x || {})); }
function audit(actor, area, text, diff) { S.audit.unshift({ at: Date.now(), actor, area, text, diff: diff || [] }); }
function remember(by) { S.lastSigner = by; LS.set('signer', by); }
const lastSigner = () => { const v = S.lastSigner || LS.get('signer', ''); return person(v) ? v : ''; };

/* ---------- Runs ---------- */
function stepsFor(kind, pr) {
  const L = pr.level, nf = (pr.script ? pr.script.findings.length : pr.findings.filter(f => f.resolved !== true).length) || 2, k = Math.max(1, toFix(pr).length);
  const big = pr.files > 30, rc = Math.min(3.1, 0.55 + pr.files * 0.021 + (pr.add + pr.del) / 4000);
  const checks = { k: 'checks', label: 'Checks', sim: 1800, real: 38, off: L < 2, note: 'CI 14/14 green · install ok' };
  if (kind === 'fixcheck') return [checks,
    { k: 'diff', label: 'Fix diff', sim: 1200, real: 7, note: 'read ' + (pr.patch ? pr.patch.files.length : 1) + ' changed files' },
    { k: 'fixes', label: 'Check fixes', sim: 6000, real: 52, cost: 0.34, units: k, unit: 'checked %d of %d fixes' },
    { k: 'repro', label: 'Reproductions', sim: 3000, real: 24, cost: 0.08, units: k, unit: 're-ran %d of %d' }];
  if (kind === 'fix') return [
    { k: 'worktree', label: 'Worktree', sim: 1200, real: 6, note: 'on ' + pr.branch },
    { k: 'impl', label: 'Implement', sim: 7000, real: 71, cost: 0.09, units: k, unit: 'fixed %d of %d' },
    { k: 'repro', label: 'Reproductions', sim: 3000, real: 22, cost: 0.02, units: k, unit: 're-ran %d of %d' }];
  const reused = kind === 'retry';
  return [Object.assign({}, checks, { reused }),
    { k: 'task', label: 'Task', sim: 900, real: 4, off: L < 2, reused, note: pr.clickup ? pr.clickup + ' linked' : 'no task found' },
    { k: 'type', label: 'Change type', sim: 900, real: 3, off: L < 2, reused, note: pr.ctype || 'Changes behaviour' },
    { k: 'review', label: 'Review', sim: 8000, real: big ? 246 : 112, cost: Math.round(rc * 100) / 100, units: pr.files, unit: 'read %d of %d files' },
    { k: 'verify', label: 'Verify', sim: 5000, real: 20 + 14 * nf, cost: Math.round(0.18 * nf * 100) / 100, units: nf, unit: 'verified %d of %d', off: L < 3 }];
}
function runView(run, at) {
  let el = Math.max(0, ((at || Date.now()) - run.startedAt) / (run.speed || 1));
  let cost = 0, real = 0, done = true, cur = -1;
  const steps = run.steps.map((s, i) => {
    if (s.off) return Object.assign({}, s, { state: 'off' });
    if (s.reused) return Object.assign({}, s, { state: 'done', p: 1 });
    if (run.queued) { done = false; return Object.assign({}, s, { state: 'pending', p: 0 }); }
    if (el >= s.sim) { el -= s.sim; cost += s.cost || 0; real += s.real; return Object.assign({}, s, { state: 'done', p: 1 }); }
    if (cur < 0 && done) { const p = el / s.sim; el = -1; cur = i; done = false; cost += (s.cost || 0) * p; real += s.real * p; return Object.assign({}, s, { state: 'active', p, du: s.units ? Math.min(s.units, Math.floor(p * (s.units + 0.5))) : 0, realEl: s.real * p, costEl: (s.cost || 0) * p }); }
    done = false; return Object.assign({}, s, { state: 'pending', p: 0 });
  });
  const total = run.steps.filter(s => !s.off && !s.reused).reduce((a, s) => a + s.sim, 0);
  const elapsed = Math.min(total, Math.max(0, ((at || Date.now()) - run.startedAt) / (run.speed || 1)));
  return { steps, cost, real, done: done && !run.queued, cur, p: run.queued ? 0 : elapsed / total };
}
function startRun(pr, kind, o) {
  o = o || {};
  const n = kind === 'fixcheck' ? pr.chain.n + 1 : kind === 'review' ? 1 : pr.chain ? pr.chain.n : 1;
  const run = { id: 'r' + pr.num + '-' + (pr.rounds.length + 1) + (kind === 'fix' ? 'f' + uid('') : ''), kind, by: o.by || 'hand', reason: o.reason || (o.by === 'bot' ? '' : 'started by hand'), startedAt: Date.now() - (o.ago || 0), speed: o.speed || 1, steps: stepsFor(kind, pr), queued: false, waitFor: o.waitFor || null, n, sha: pr.head, acc: 0, prevChain: pr.chain, prevCommits: pr.commitsSince, hadCommits: pr.commitsSince > 0, prevFailed: pr.failed };
  if (o.waitFor || (!canStart() && !o.ago)) run.queued = true;
  pr.run = run; pr.failed = null; pr.cancelledNote = null;
  if (kind !== 'fix') { pr.chain = { n, by: run.by, reason: run.reason }; pr.commitsSince = 0; }
  if (!o.silent) {
    if (kind === 'review') tlog(pr, run.by, run.by === 'bot' ? 'Round 1 of 3 started · ' + run.reason : 'Review started by hand · round 1 of 3', { run: run.id });
    if (kind === 'retry') tlog(pr, 'hand', 'Retry from Review started by hand · round ' + n + ' of 3, earlier stages reused', { run: run.id });
    if (kind === 'fixcheck') tlog(pr, 'bot', 'Round ' + n + ' of 3 started: fix check ' + run.reason, { run: run.id });
    if (run.queued) tlog(pr, 'bot', 'Queued: ' + queueReason(pr));
  }
  return run;
}
function addRound(pr, run, v, summary, status) {
  const r = { n: run.n, id: run.id, kind: run.kind, sha: run.sha, by: run.by, reason: run.reason, cost: Math.round(v.cost * 100) / 100, dur: Math.round(v.real), at: Date.now(), status: status || 'done', level: pr.level, summary, chainStart: run.n === 1, steps: v.steps.map(s => ({ k: s.k, label: s.label, state: s.state, real: s.state === 'done' ? s.real : Math.round(s.realEl || 0), cost: s.state === 'done' ? (s.cost || 0) : (s.costEl || 0), off: s.off, reused: s.reused, note: s.note, units: s.units })) };
  pr.rounds.push(r); pr.spend += r.cost;
  S.activity.unshift({ id: r.id, pr: pr.num, what: run.kind === 'fix' ? 'Implementer' : 'Round ' + r.n, by: run.by, at: r.at, cost: r.cost, dur: r.dur, status: r.status });
  return r;
}
const touchesSensitive = (pr, patch) => patch.files.find(f => f.sensitive || (S.repos[pr.repo].sensitive || []).some(s => { try { return new RegExp(s.pattern.replace(/\./g, '\\.').replace(/\*/g, '[^/]*')).test(f.path); } catch (e) { return f.path.indexOf(s.pattern) >= 0; } }));

function finishRun(pr) {
  const run = pr.run, v = runView(run, run.startedAt + 1e9); pr.run = null;
  const viewing = UI.viewing === pr.num;
  if (run.kind === 'fix') {
    const fx = toFix(pr);
    const files = pr.patch && pr.patch.state === 'revising' ? pr.patch.files : pr.scriptPatch ? pr.scriptPatch.files : fx.filter(f => f.before && f.after).map(f => ({ path: f.file, finding: f.id, before: f.before, after: f.after }));
    pr.patch = { state: 'ready', rev: pr.patch && pr.patch.state === 'revising' ? pr.patch.rev + 1 : 1, fixed: fx.length, total: fx.length, repro: 'pass', cost: Math.round(v.cost * 100) / 100, waiting: null, by: run.by, sha: null, note: '', files: JSON.parse(JSON.stringify(files.length ? files : [{ path: fx[0].file, finding: fx[0].id, before: '// before', after: '// after' }])) };
    pr.spend += pr.patch.cost;
    S.activity.unshift({ id: run.id, pr: pr.num, what: 'Implementer', by: run.by, at: Date.now(), cost: pr.patch.cost, dur: Math.round(v.real), status: 'done' });
    tlog(pr, 'bot', 'Patch ready: ' + fx.length + ' of ' + fx.length + ' fixed, reproductions pass', { cost: pr.patch.cost, dur: Math.round(v.real) });
    if (run.by === 'bot') {
      pr.autoPatches++;
      const sf = touchesSensitive(pr, pr.patch);
      if (sf) { pr.patch.waiting = 'sensitive'; tlog(pr, 'bot', 'Autofix waiting: the patch touches a sensitive file (' + sf.path + '). A person must push it.'); toast({ title: 'Autofix is waiting on #' + pr.num, desc: 'The patch touches a sensitive file.', go: ['pr/' + pr.num, { tab: 'patch' }] }); }
      else { pushPatch(pr, 'bot'); }
    } else toast({ title: 'Patch ready on #' + pr.num, desc: fx.length + ' of ' + fx.length + ' fixed, reproductions pass.', go: ['pr/' + pr.num, { tab: 'patch' }] });
    return;
  }
  let summary;
  const prevFindings = pr.findings.length ? JSON.parse(JSON.stringify(pr.findings)) : null;
  if (run.kind === 'fixcheck') {
    const fx = toFix(pr); let ok = 0;
    fx.forEach(f => { if (f.failFix) { f.resolved = false; } else { f.resolved = true; ok++; } });
    summary = ok + ' of ' + fx.length + ' fixes resolved';
  } else {
    if (pr.script) { pr.findings = pr.script.findings; pr.questions = pr.script.questions; pr.script = null; }
    else pr.findings.forEach(f => { f.opinions.forEach(o => { o.carried = true; }); if (f.decision && f.decision.v === 'implement' && run.hadCommits) f.resolved = true; });
    const fixed = pr.findings.filter(f => f.resolved === true).length, nf = pr.findings.filter(f => f.resolved !== true).length;
    summary = run.hadCommits && fixed ? fixed + ' of ' + fixed + ' fixes resolved, ' + (toDecide(pr).length ? plural(toDecide(pr).length, 'finding') + ' to decide' : 'nothing new')
      : (nf ? plural(nf, 'finding') : 'no findings') + ', ' + (pr.questions.length ? plural(pr.questions.length, 'question') : 'no questions');
  }
  pr.reviewedSha = run.sha;
  const r = addRound(pr, run, v, summary);
  tlog(pr, 'bot', 'Round ' + r.n + ' finished: ' + summary, { cost: r.cost, dur: r.dur, run: r.id });
  if (S.integrations.ghComment) tlog(pr, 'bot', 'GitHub comment posted: "Ready for team member review (round ' + r.n + ')"');
  if (pr.commitsSince > 0) tlog(pr, 'bot', 'Result is for ' + run.sha + ' · ' + plural(pr.commitsSince, 'new commit') + ' since. Start a review to cover them.');
  if (viewing && prevFindings && run.kind !== 'fixcheck') { UI.stale = UI.stale || {}; UI.stale[pr.num] = prevFindings; }
  /* Level 5: autofix when every finding that needs work is confirmed with an obvious fix. */
  const need = pr.findings.filter(f => f.verdict !== 'refuted' && f.resolved !== true && !(f.decision && f.decision.v !== 'implement'));
  if (pr.level >= 5 && !pr.fork && need.length && !openQuestions(pr).length && need.every(f => f.verdict === 'confirmed' && f.remedy === 'obvious') && pr.autoPatches < 2 && pr.commitsSince === 0 && r.n < 3) {
    need.forEach(f => { f.decision = { v: 'implement', by: 'bot', at: Date.now(), agent: true }; });
    tlog(pr, 'bot', 'Autofix started: ' + plural(need.length, 'confirmed finding') + ' with an obvious fix');
    startRun(pr, 'fix', { by: 'bot' });
    toast({ title: 'Round ' + r.n + ' finished on #' + pr.num, desc: summary + '. Level 5 autofix started.', go: ['pr/' + pr.num] });
    return;
  }
  const ns = nextStep(pr);
  toast({ title: 'Round ' + r.n + ' finished on #' + pr.num, desc: summary + '. Next: ' + ns.short.charAt(0).toLowerCase() + ns.short.slice(1) + '.', go: viewing ? null : ['pr/' + pr.num], tone: ns.st === 'ready' ? 'ok' : null });
}
function cancelRun(pr) {
  const run = pr.run; if (!run) return;
  const v = runView(run); pr.run = null;
  if (run.kind !== 'fix') { pr.chain = run.prevChain; pr.commitsSince = run.prevCommits + pr.commitsSince; }
  const spent = money(v.cost);
  tlog(pr, 'hand', run.queued ? 'Removed from the queue by hand' : (run.kind === 'fix' ? 'Implementer cancelled by hand' : 'Round ' + run.n + ' cancelled by hand') + ' · ' + spent + ' spent' + (run.kind === 'fix' ? '' : ' · the round is not counted'));
  if (!run.queued) { pr.spend += v.cost; S.activity.unshift({ id: run.id, pr: pr.num, what: run.kind === 'fix' ? 'Implementer' : 'Round ' + run.n, by: run.by, at: Date.now(), cost: v.cost, dur: Math.round(v.real), status: 'cancelled' }); }
  if (!pr.reviewedSha) pr.cancelledNote = 'The last round was cancelled and is not counted. Start a review when you want one.';
  toast({ title: run.queued ? 'Removed from the queue' : 'Cancelled', desc: run.queued ? 'Nothing was spent.' : spent + ' was spent before the agent stopped.' });
}
function pushPatch(pr, by) {
  const sha = newSha(), p = pr.patch;
  p.state = 'pushed'; p.sha = sha; p.waiting = null; pr.head = sha; pr.fixSha = sha;
  tlog(pr, by, by === 'bot' ? 'Autofix pushed ' + sha + ': all findings fixed, reproductions pass, no sensitive file touched' : 'Pushed the fix ' + sha + ' to ' + pr.branch + ' (written by the implementer agent)');
  if (pr.chain.n < 3) startRun(pr, 'fixcheck', { by: 'bot', reason: 'after fix ' + sha });
  else tlog(pr, 'bot', 'Automatic rounds used (3 of 3): no re-review started');
}
function pushFromIde(pr, n) {
  n = n || 2; const sha = newSha(); pr.head = sha; pr.commitsSince += n; pr.fixSha = null;
  tlog(pr, pr.author, 'Pushed ' + plural(n, 'commit') + ' (' + sha + ') · no review started, a push never starts one' + (pr.run && !pr.run.queued && pr.run.kind !== 'fix' ? ' · the running round continues on ' + pr.run.sha : ''), { gh: true });
  if (pr.patch && pr.patch.state === 'ready') pr.patch.stale = true;
  if (pr.sensitive && pr.sensitive.status === 'sent_back') pr.sensitive.status = 'pending';
}
function markReady(pr) {
  pr.draft = false; tlog(pr, pr.author, 'Marked the PR ready for review in GitHub', { gh: true });
  if (!pr.fork) startRun(pr, 'review', { by: 'bot', reason: 'PR marked ready for review' });
}
function startLearning(pr) {
  S.analyses.unshift({ pr: pr.num, title: pr.title, closed: pr.merged ? 'merged' : 'closed', at: Date.now(), status: pr.level >= 6 ? 'running' : 'none', cost: 0, result: pr.level >= 6 ? 'Analyst is running' : 'Not analysed: level ' + pr.level + ' has no learning', by: pr.level >= 6 ? 'bot' : null });
  if (pr.level >= 6) { pr.learning = { status: 'running' }; tlog(pr, 'bot', 'Analyst started: the PR closed at level 6'); startAnalyst(pr.num, 'bot'); } else pr.learning = { status: 'off' };
}
function startAnalyst(num, by) {
  const a = S.analyses.find(x => x.pr === num); if (a) { a.status = 'running'; a.result = 'Analyst is running'; a.by = by; }
  S.jobs.push({ id: uid('job'), type: 'analyst', pr: num, by, startedAt: Date.now(), sim: 7000, real: 41, cost: 0.07, acc: 0, queued: !canStart() });
}
function mergePr(pr, by) {
  pr.merged = { by, at: Date.now(), sha: pr.head }; remember(by);
  tlog(pr, by, 'Squash-merged #' + pr.num + ' at ' + pr.head + ' into ' + pr.base);
  startLearning(pr);
}
function closePr(pr) {
  if (pr.run) cancelRun(pr);
  pr.closed = { by: pr.author, at: Date.now() }; tlog(pr, pr.author, 'Closed the PR in GitHub without merging', { gh: true });
  startLearning(pr);
}
function startTrial(o) {
  const t = Object.assign({ id: uid('t'), status: 'running', at: Date.now(), by: 'hand', startedAt: Date.now(), sim: 14000 }, o);
  S.trials.unshift(t);
  S.jobs.push({ id: uid('job'), type: 'trial', trial: t.id, by: 'hand', startedAt: Date.now(), sim: 14000, real: 290, cost: 2.61, acc: 0, pr: o.pr, queued: !canStart() });
  return t;
}
function finishJob(j) {
  if (j.type === 'analyst') {
    const pr = S.prs[j.pr], a = S.analyses.find(x => x.pr === j.pr);
    let c = S.candidates.find(x => x.status === 'proposed' && x.id === 'c2' && x.prs.indexOf(j.pr) < 0), text;
    if (c && j.pr === 278) { c.prs.push(j.pr); c.at = Date.now(); c.fresh = true; text = '1 existing candidate now has ' + c.prs.length + ' PRs'; }
    else { c = { id: uid('c'), title: 'Docs links must be checked when a page is removed', rule: 'When a PR deletes or renames a docs page, search the docs for links to it and report every broken one.', why: 'In #' + j.pr + ' a removed page was still linked from the quick start.', prs: [j.pr], status: 'proposed', at: Date.now(), fresh: true }; S.candidates.unshift(c); text = '1 lesson candidate'; }
    if (a) { a.status = 'done'; a.cost = 0.07; a.result = text; a.at = Date.now(); }
    if (pr) { pr.learning = { status: 'done', text, cost: 0.07 }; pr.spend += 0.07; tlog(pr, 'bot', 'Analyst finished: ' + text, { cost: 0.07, dur: 41 }); }
    audit(j.by === 'bot' ? 'bot' : 'hand', 'Learning', 'Analyst finished for #' + j.pr + ': ' + text, [{ k: 'Candidate', from: '', to: c.title + ' (' + plural(c.prs.length, 'PR') + ')' }]);
    S.activity.unshift({ id: j.id, pr: j.pr, what: 'Analyst', by: j.by, at: Date.now(), cost: 0.07, dur: 41, status: 'done' });
    toast({ title: 'Analyst finished for #' + j.pr, desc: text + ' in Learning.', go: ['settings/learning'] });
  } else if (j.type === 'trial') {
    const t = S.trials.find(x => x.id === j.trial);
    Object.assign(t, { status: 'done', costA: 1.24, costB: 1.37, durA: 141, durB: 149, both: ['Terminator is invisible when EnhancedBaseEdge gets `endpoint` without `style.stroke`', 'Temporary edge points the wrong way when dragging from an input port'], onlyA: ['Arrow tip overshoots the path end by about 0.7 px'], onlyB: ['`EdgeEndpoint` is exported from `packages/ui` without a changeset entry', 'Root spec does not cover changing `edgeEndpoint` while the editor is mounted'] });
    S.activity.unshift({ id: j.id, pr: j.pr, what: 'Trial (2 rounds)', by: 'hand', at: Date.now(), cost: 2.61, dur: 290, status: 'done' });
    toast({ title: 'Trial finished on #' + j.pr, desc: 'Both versions ran on the same commit. Compare the results.', go: ['settings/experiments/' + t.id] });
  }
}

/* ---------- Human actions on a PR ---------- */
function decide(pr, ids, v, by, o) {
  o = o || {}; remember(by);
  const fs = pr.findings.filter(f => ids.indexOf(f.id) >= 0), prev = fs.map(f => [f, f.decision]), tl = pr.timeline.length;
  fs.forEach(f => { f.decision = { v, by, at: Date.now(), reason: o.reason || '', agent: !!o.agent }; });
  const word = { implement: 'implement', reject: 'reject', defer: 'defer to ClickUp' }[v];
  const other = by !== pr.author ? ' (author: ' + authorName(pr) + ')' : '';
  tlog(pr, by, 'Decided ' + plural(fs.length, 'finding') + ': ' + fs.length + ' ' + word + other + (o.reason ? ' · "' + o.reason + '"' : ''));
  if (v === 'defer') tlog(pr, 'bot', 'Created ClickUp follow-up WB-' + (840 + pr.timeline.length) + ' for ' + plural(fs.length, 'deferred finding'));
  let started = false;
  if (v === 'implement' && o.agent) { tlog(pr, by, 'Implement with agent started for ' + plural(toFix(pr).length, 'finding')); startRun(pr, 'fix', { by }); started = true; }
  return () => mutate(() => { prev.forEach(([f, d]) => { f.decision = d; }); pr.timeline.length = tl; if (started && pr.run && pr.run.kind === 'fix') pr.run = null; });
}
function implementWithAgent(pr, by) { remember(by); tlog(pr, by, 'Implement with agent started for ' + plural(toFix(pr).length, 'finding')); startRun(pr, 'fix', { by }); }
function saveReview(pr, draft, by) {
  remember(by); const ids = Object.keys(draft), tl = pr.timeline.length, added = [];
  let w = 0, nw = 0;
  ids.forEach(id => { const f = pr.findings.find(x => String(x.id) === String(id)); if (!f) return; const d = draft[id]; f.opinions = f.opinions.filter(o => o.by !== by); const op = { by, v: d.v, comment: d.comment || '', round: pr.chain ? pr.chain.n : 1, at: Date.now() }; f.opinions.push(op); added.push([f, op]); d.v === 'worth' ? w++ : nw++; });
  const parts = []; if (w) parts.push(w + ' worth implementing'); if (nw) parts.push(nw + ' not worth it');
  pr.review = pr.review || {}; const prevRv = pr.review[by]; pr.review[by] = { at: Date.now(), w, nw, notified: false };
  tlog(pr, by, actorName(by) + "'s review: " + parts.join(', '));
  return () => mutate(() => { added.forEach(([f, op]) => { f.opinions = f.opinions.filter(o => o !== op); }); pr.timeline.length = tl; if (prevRv) pr.review[by] = prevRv; else delete pr.review[by]; });
}
function notifyText(pr, by) { const r = pr.review[by] || { w: 0, nw: 0 }; const a = person(pr.author); const parts = []; if (r.w) parts.push(plural(r.w, 'finding') + ' as worth implementing'); if (r.nw) parts.push(plural(r.nw, 'finding') + ' as not worth it'); return '@' + (a ? a.name : authorName(pr)) + ': ' + actorName(by) + ' marked ' + parts.join(' and ') + ' in PR #' + pr.num; }
function notifyAuthor(pr, by) { pr.review[by].notified = true; tlog(pr, by, 'Notified ' + authorName(pr) + ' in ClickUp (' + pr.clickup + ')'); }
function answerQuestions(pr, answers, by) {
  remember(by); const ids = Object.keys(answers);
  ids.forEach(id => { const q = pr.questions.find(x => String(x.id) === String(id)); q.answer = { by, text: answers[id], at: Date.now() }; });
  tlog(pr, by, 'Answered ' + plural(ids.length, 'question'));
}
function approveSensitive(pr) { pr.sensitive.status = 'approved'; tlog(pr, 'hand', 'Sensitive files approved by hand (' + plural(pr.sensitive.files.length, 'file') + ')'); }
function sendBackSensitive(pr, comment, by) { remember(by); Object.assign(pr.sensitive, { status: 'sent_back', by, comment }); tlog(pr, by, 'Sent ' + plural(pr.sensitive.files.length, 'sensitive file') + ' back to ' + authorName(pr) + ': "' + comment + '"'); }

/* ---------- Factory ---------- */
function pauseFactory(reason, by) { remember(by); Object.assign(S.factory, { paused: true, pausedBy: by, pauseReason: reason, pausedAt: Date.now() }); audit(by, 'Budget & status', 'Paused the factory', [{ k: 'Status', from: 'Running', to: 'Paused: ' + reason }]); }
function resumeFactory(by) { remember(by); const was = S.factory.pauseReason; Object.assign(S.factory, { paused: false }); audit(by, 'Budget & status', 'Resumed the factory', [{ k: 'Status', from: 'Paused: ' + was, to: 'Running' }]); }
function setBudget(v, by) { remember(by); const was = S.factory.budget; S.factory.budget = v; audit(by, 'Budget & status', 'Changed the daily budget', [{ k: 'Daily budget', from: money(was), to: money(v) }]); }

/* ---------- The clock: advances every live run and job in place ---------- */
function tick() {
  let live = false; const ok = canStart();
  Object.values(S.prs).forEach(pr => {
    const run = pr.run; if (!run) return; live = true;
    if (run.queued) {
      const waiting = (run.waitFor || []).length && run.waitFor.every(n => S.prs[n] && S.prs[n].run && !S.prs[n].run.queued && S.prs[n].run.speed > 1);
      if (ok && !waiting) { run.queued = false; run.waitFor = null; run.startedAt = Date.now(); if (run.kind === 'review' && run.by === 'bot') tlog(pr, 'bot', 'Round 1 of 3 started · ' + run.reason, { run: run.id }); }
      return;
    }
    const v = runView(run); S.factory.spent += v.cost - run.acc; run.acc = v.cost;
    if (v.done) finishRun(pr);
  });
  S.jobs = S.jobs.filter(j => {
    live = true;
    if (j.queued) { if (ok) { j.queued = false; j.startedAt = Date.now(); } return true; }
    const p = Math.min(1, (Date.now() - j.startedAt) / j.sim); S.factory.spent += j.cost * p - j.acc; j.acc = j.cost * p;
    if (p >= 1) { finishJob(j); return false; } return true;
  });
  if (live) commit();
}
function getRunInfo(id) {
  for (const pr of Object.values(S.prs)) {
    if (pr.run && pr.run.id === id) { const v = runView(pr.run); return { pr, live: true, run: pr.run, v, r: { n: pr.run.n, id, kind: pr.run.kind, sha: pr.run.sha, by: pr.run.by, reason: pr.run.reason, cost: v.cost, dur: v.real, at: pr.run.startedAt, status: pr.run.queued ? 'queued' : 'running', level: pr.level, steps: v.steps.map(s => Object.assign({}, s, { real: s.state === 'done' ? s.real : s.realEl || 0, cost: s.state === 'done' ? s.cost || 0 : s.costEl || 0 })) } }; }
    const r = pr.rounds.find(x => x.id === id);
    if (r) {
      if (!r.steps) {
        const st = stepsFor(r.kind === 'fixcheck' ? 'fixcheck' : 'review', Object.assign({}, pr, { level: r.level, script: null })), on = st.filter(s => !s.off), tr = on.reduce((a, s) => a + s.real, 0), tc = on.reduce((a, s) => a + (s.cost || 0), 0) || 1;
        r.steps = st.map(s => { const failedHere = r.status === 'failed' && s.k === 'review', after = r.status === 'failed' && s.k === 'verify'; return { k: s.k, label: s.label, off: s.off, note: s.note, units: s.units, state: s.off ? 'off' : failedHere ? 'failed' : after ? 'pending' : 'done', real: s.off || after ? 0 : failedHere ? 1800 : Math.round(s.real / tr * (r.status === 'failed' ? 45 * tr / (tr - 112) : r.dur)), cost: s.off || after ? 0 : r.status === 'failed' ? (failedHere ? r.cost : 0) : Math.round((s.cost || 0) / tc * r.cost * 100) / 100 }; });
      }
      return { pr, live: false, r };
    }
  }
  return null;
}
