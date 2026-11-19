/* Core: rendering helpers, store, router, formatting, icons. Classic script, no modules (works on file://). */
const { h, render, Fragment } = preact;
const { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } = preactHooks;
const html = htm.bind(h);

/* ---------- localStorage, always guarded ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('wbf.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('wbf.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem('wbf.' + k); } catch (e) { /* storage unavailable */ } }
};

/* ---------- Store: S = persisted demo state, UI = ephemeral ---------- */
let S = null;
const UI = { dialog: null, toasts: [], sheet: null, palette: false, shortcuts: false, draft: {}, sel: {}, cur: {}, open: {}, viewing: null };
const subs = new Set();
let persistT = null;
function commit() {
  subs.forEach(f => f());
  if (!persistT) persistT = setTimeout(() => { persistT = null; LS.set('demo', S); }, 900);
}
function mutate(fn) { fn(S); commit(); }
function useStore() { const [, set] = useState(0); useEffect(() => { const f = () => set(x => x + 1); subs.add(f); return () => subs.delete(f); }, []); }

/* ---------- Router: #/path/segments?key=value ---------- */
function parseHash() {
  const raw = (location.hash || '#/prs').replace(/^#\/?/, '');
  const [p, qs] = raw.split('?');
  const q = {};
  (qs || '').split('&').filter(Boolean).forEach(kv => { const [k, v] = kv.split('='); q[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
  return { path: p.split('/').filter(Boolean), q };
}
function href(path, q) {
  const qs = Object.entries(q || {}).filter(([, v]) => v !== '' && v != null && v !== false).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  return '#/' + path + (qs ? '?' + qs : '');
}
function nav(path, q) { location.hash = href(path, q).slice(1); }
function setQ(patch, replace) {
  const r = parseHash(); const q = Object.assign({}, r.q, patch);
  const url = href(r.path.join('/'), q);
  if (replace) { history.replaceState(null, '', url); window.dispatchEvent(new HashChangeEvent('hashchange')); } else location.hash = url.slice(1);
}
function useRoute() { const [r, set] = useState(parseHash()); useEffect(() => { const f = () => set(parseHash()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []); return r; }

/* ---------- Formatting ---------- */
const money = n => '$' + (Math.round((n || 0) * 100) / 100).toFixed(2);
function dur(sec) { sec = Math.max(0, Math.round(sec)); if (sec < 60) return sec + ' s'; const m = Math.floor(sec / 60), s = sec % 60; if (m >= 60) { const hh = Math.floor(m / 60); return hh + ' h ' + (m % 60) + ' min'; } return m + ' min' + (s ? ' ' + s + ' s' : ''); }
function rel(t) {
  const d = (Date.now() - t) / 1000;
  if (d < 45) return 'just now'; if (d < 3600) return Math.round(d / 60) + ' min ago'; if (d < 86400) return Math.round(d / 3600) + ' h ago';
  const days = Math.round(d / 86400); return days === 1 ? 'yesterday' : days + ' days ago';
}
const abs = t => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const hhmm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayLabel = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
const cx = (...a) => a.filter(Boolean).join(' ');
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
let uidN = 0; const uid = p => (p || 'id') + (++uidN) + Math.random().toString(36).slice(2, 6);
function newSha() { let s = ''; for (let i = 0; i < 7; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)]; return s; }

/* ---------- Icons (Lucide UMD) ---------- */
const missingIcons = new Set();
function Icon({ n, s = 16, cls, sw = 2, label }) {
  const key = n.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
  let node = window.lucide && lucide.icons && lucide.icons[key];
  if (!node) { if (!missingIcons.has(n)) { missingIcons.add(n); console.warn('icon missing:', n); } node = [['circle', { cx: 12, cy: 12, r: 9 }]]; }
  const kids = typeof node[0] === 'string' ? node[2] : node;
  return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: cx('shrink-0', cls), 'aria-hidden': label ? null : 'true', 'aria-label': label || null, role: label ? 'img' : null },
    kids.map(([tag, attrs]) => h(tag, attrs)));
}

/* ---------- Line diff (LCS), used by instruction and patch editors ---------- */
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { out.push({ s: ' ', t: A[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ s: '-', t: A[i++] }); else out.push({ s: '+', t: B[j++] }); }
  while (i < n) out.push({ s: '-', t: A[i++] }); while (j < m) out.push({ s: '+', t: B[j++] });
  return out;
}
/* Keep changed lines plus `ctx` lines of context around them. */
function compactDiff(lines, ctx = 2) {
  const keep = new Uint8Array(lines.length);
  lines.forEach((l, i) => { if (l.s !== ' ') for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) keep[k] = 1; });
  const out = []; let gap = false;
  lines.forEach((l, i) => { if (keep[i]) { if (gap && out.length) out.push({ s: '@', t: '⋯' }); gap = false; out.push(l); } else gap = true; });
  return out;
}
const diffStat = lines => ({ add: lines.filter(l => l.s === '+').length, del: lines.filter(l => l.s === '-').length });
