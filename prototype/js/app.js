/* Boot, root component, global shortcuts, the clock. */
(function boot() {
  const saved = LS.get('demo', null);
  if (saved && saved.v === 4 && Date.now() - saved.seededAt < 6 * HOUR) S = saved; else seed();
  S.lastSigner = S.lastSigner || LS.get('signer', '');
  ensureAlerts();
})();
const TITLES = { prs: 'Pull requests', pr: 'Pull request', runs: 'Run', activity: 'Activity', insights: 'Insights', settings: 'Settings' };
function App() {
  useStore(); const route = useRoute(), top = route.path[0] || 'prs', pathKey = route.path.join('/');
  useEffect(() => { window.scrollTo(0, 0); document.title = (top === 'pr' ? '#' + route.path[1] + ' · ' : (TITLES[top] || 'Pull requests') + ' · ') + 'WB Factory'; UI.form = null; }, [pathKey]);
  useEffect(() => {
    let g = 0;
    const key = e => {
      const t = e.target, typing = t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); UI.palette = !UI.palette; commit(); return; }
      if (typing || UI.dialog || UI.palette || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' && UI.shortcuts) { UI.shortcuts = false; commit(); return; }
      if (e.key === '?') { UI.shortcuts = true; commit(); e.preventDefault(); return; }
      if (e.key === '/') { UI.palette = true; commit(); e.preventDefault(); return; }
      if (Date.now() - g < 900) { if (e.key === 'p') nav('prs'); if (e.key === 'a') nav('activity'); g = 0; return; }
      if (e.key === 'g') g = Date.now();
    };
    document.addEventListener('keydown', key); const iv = setInterval(tick, 300);
    return () => { document.removeEventListener('keydown', key); clearInterval(iv); };
  }, []);
  const Page = { prs: Board, pr: PrPage, runs: RunPage, activity: ActivityPage, insights: InsightsPage, settings: SettingsPage }[top] || Board;
  return html`<${Fragment}><a href="#main" class="sr-only focus:not-sr-only">Skip to content</a><${TopBar} route=${route} /><div id="main"><${Page} key=${top === 'pr' || top === 'runs' ? pathKey : top} route=${route} /></div>
    <${Guide} route=${route} /><${DialogHost} />${UI.palette && html`<${Palette} />`}${UI.shortcuts && html`<${ShortcutsDialog} />`}<${Toasts} /></${Fragment}>`;
}
render(html`<${App} />`, document.getElementById('app'));
