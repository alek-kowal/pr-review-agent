/* Sample data, modelled on real runs (sizes, costs, durations). People and logins are fictional. */
const TEAM0 = [
  { id: 'alek', name: 'Alek', gh: 'alek-nowy', cu: 'Alek N.', av: 1 },
  { id: 'kasia', name: 'Kasia', gh: 'kasia-wrona', cu: 'Kasia W.', av: 4 },
  { id: 'tomek', name: 'Tomek', gh: 'tomek-lis', cu: 'Tomek L.', av: 2 },
  { id: 'piotr', name: 'Piotr', gh: 'piotr-zim', cu: 'Piotr Z.', av: 3 },
  { id: 'ola', name: 'Ola', gh: 'ola-maj', cu: 'Ola M.', av: 5 },
  { id: 'marek', name: 'Marek', gh: 'marek-dab', cu: 'Marek D.', av: 6 }
];
const WB = 'synergycodes/workflowbuilder', TPL = 'synergycodes/wb-templates';
const LEVELS = [
  { n: 1, name: 'Diff only', desc: 'The reviewer reads the diff. Findings are not verified.', adds: ['Review'] },
  { n: 2, name: 'With context', desc: 'Adds CI and install checks, the ClickUp task and the change type.', adds: ['Checks', 'Task', 'Change type'] },
  { n: 3, name: 'Verified', desc: 'Each finding gets a verdict with quoted evidence and a reproduction.', adds: ['Verify'] },
  { n: 4, name: 'Fix on request', desc: 'People can ask the implementer agent to fix findings. Nothing is pushed without a person.', adds: ['Implement with agent'] },
  { n: 5, name: 'Autofix', desc: 'The factory fixes and pushes by itself when every autofix condition holds.', adds: ['Autofix'] },
  { n: 6, name: 'Learning', desc: 'After a PR closes, the analyst proposes lessons for a person to accept.', adds: ['Learning'] }
];
const ROLES = [
  { id: 'reviewer', name: 'Reviewer', does: 'Reads the PR and writes findings and questions.' },
  { id: 'verifier', name: 'Verifier', does: 'Checks each finding and runs its reproduction.' },
  { id: 'implementer', name: 'Implementer', does: 'Fixes findings marked Implement.' },
  { id: 'judge', name: 'Judge', does: 'Sets the change type when rules are not enough.' },
  { id: 'analyst', name: 'Analyst', does: 'Proposes lessons after a PR closes.' }
];
const MODELS = ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'];

/* f(id, severity, title, file, line, verdict, detail) */
const F = (id, sev, title, file, line, verdict, d) => Object.assign({ id, sev, title, file, line, verdict, opinions: [], decision: null, resolved: null }, d || {});
const EV = (file, line, quote) => ({ file, line, quote });

const F272 = () => [
  F(1, 'blocking', 'Temporary edge points the wrong way when dragging from an input port', 'packages/sdk/src/features/diagram/edges/temporary-edge/temporary-edge.tsx', 37, 'confirmed', {
    scenario: 'Start dragging a connection from an input handle (target side) of any node. The temporary edge now draws the endpoint marker at the cursor, so the arrow points away from the node the edge will end in. After drop, the real edge is drawn correctly, so the direction flips under the pointer.',
    suggestion: 'Read the drag origin (`connection.fromHandle.type`) and place the marker at the node end when the drag starts from a target handle.',
    before: "const markerEnd = endpoint ? markerId : undefined;\nreturn <BaseEdge path={path} markerEnd={markerEnd} />;",
    after: "const fromTarget = connection.fromHandle?.type === 'target';\nconst marker = endpoint ? markerId : undefined;\nreturn (\n  <BaseEdge path={path} markerStart={fromTarget ? marker : undefined} markerEnd={fromTarget ? undefined : marker} />\n);",
    reason: 'The reproduction renders `TemporaryEdge` with a connection that starts on a target handle and finds `marker-end` set on the path. The marker should be on the start of the path in that case.',
    evidence: [EV('packages/sdk/src/features/diagram/edges/temporary-edge/temporary-edge.tsx', 37, 'const markerEnd = endpoint ? markerId : undefined;'), EV('packages/sdk/src/features/diagram/edges/temporary-edge/temporary-edge.tsx', 21, "const { fromHandle, toPosition } = connection;")],
    repro: { exit: 0, cmd: 'vitest run .verify/temporary-edge-direction.spec.tsx', out: " FAIL  .verify/temporary-edge-direction.spec.tsx\n  × marker sits on the node end when dragging from a target handle\n    expected path to have attribute 'marker-start', found 'marker-end'\n\nexit 0: the bug is reproduced" }
  }),
  F(2, 'worth', 'Terminator is invisible when EnhancedBaseEdge gets `endpoint` without `style.stroke`', 'packages/ui/src/components/edge/edge-endpoint-marker/edge-endpoint-marker.tsx', 31, 'confirmed', {
    scenario: 'A consumer renders `<EnhancedBaseEdge endpoint="circle" />` and sets the line colour through a CSS class, not through `style.stroke`. The marker reads `style?.stroke` only, gets `undefined`, and fills with `none`.',
    suggestion: 'Fall back to `currentColor` and set `color` on the edge group from the computed stroke, so class-based colours work too.',
    before: "const fill = style?.stroke;",
    after: "const fill = style?.stroke ?? 'currentColor';",
    reason: 'Confirmed by reading the code and by the reproduction: with no inline stroke the marker renders `fill="undefined"`, which browsers treat as no fill.',
    evidence: [EV('packages/ui/src/components/edge/edge-endpoint-marker/edge-endpoint-marker.tsx', 31, 'const fill = style?.stroke;')],
    repro: { exit: 0, cmd: 'vitest run .verify/endpoint-fill.spec.tsx', out: " FAIL  .verify/endpoint-fill.spec.tsx\n  × marker has a visible fill without style.stroke\n    expected 'undefined' not to be 'undefined'\n\nexit 0: the bug is reproduced" }
  }),
  F(3, 'worth', 'Marker clips the arrowhead when the app thickens the line', 'packages/ui/src/components/edge/edge-endpoint-marker/edge-endpoint-marker.tsx', 39, 'notproven', {
    scenario: 'An app sets `--wb-edge-stroke-width: 3px`. The marker keeps `markerWidth="8"` with `overflow: hidden`, so the arrowhead and the circle are cut at the marker box.',
    suggestion: 'Scale the marker box with the stroke width, or set `overflow="visible"` on the marker.',
    reason: 'The code matches the description, but the reproduction could not measure clipping in jsdom, which has no layout. No proof either way.',
    evidence: [EV('packages/ui/src/components/edge/edge-endpoint-marker/edge-endpoint-marker.tsx', 39, '<marker id={id} markerWidth="8" markerHeight="8" orient="auto-start-reverse">')],
    repro: { exit: 1, cmd: 'vitest run .verify/marker-clip.spec.tsx', out: " ERROR  getBBox is not implemented in jsdom\n\nexit 1: the reproduction could not run, so the verdict rests on the code only" }
  }),
  F(4, 'worth', 'Root spec does not cover changing `edgeEndpoint` while the editor is mounted', 'packages/sdk/src/workflow-builder-root/workflow-builder-root.spec.tsx', 4474, 'confirmed', {
    scenario: 'The new test renders Root once with `edgeEndpoint="arrow"`. Nothing re-renders with a different value, so a regression where the prop is read only on mount would pass every test.',
    suggestion: 'Add a `rerender` with `edgeEndpoint="circle"` and assert the marker id changes.',
    reason: 'Confirmed: the only assertion on `edgeEndpoint` is in the first render. Replacing the selector with a mount-time ref keeps the suite green.',
    evidence: [EV('packages/sdk/src/workflow-builder-root/workflow-builder-root.spec.tsx', 4474, "render(<WorkflowBuilder.Root edgeEndpoint=\"arrow\" />);")],
    repro: { exit: 0, cmd: 'vitest run packages/sdk --mutate .verify/mount-only.patch', out: " ✓ 412 tests passed with the mount-only mutation applied\n\nexit 0: the gap is reproduced" }
  }),
  F(5, 'nit', 'Arrow tip overshoots the path end by about 0.7 px', 'packages/ui/src/components/edge/edge-endpoint-marker/edge-endpoint-marker.tsx', 42, 'confirmed', {
    scenario: 'At 400% zoom the arrow tip sits slightly past the handle centre, because `refX` is 8 and the path is 7.3 units long.',
    suggestion: 'Set `refX="7.3"`.', before: 'refX="8"', after: 'refX="7.3"',
    reason: 'Confirmed from the path data: the tip is at x = 7.3.', evidence: [EV('packages/ui/src/components/edge/edge-endpoint-marker/edge-endpoint-marker.tsx', 42, 'refX="8"')]
  }),
  F(6, 'worth', 'Hit area lost `!important` and can pick up a colour from consumer rules', 'packages/sdk/src/features/diagram/edges/enhanced-base-edge/enhanced-base-edge.module.css', 2, 'refuted', {
    scenario: 'A consumer rule `.react-flow__edge path { stroke: red }` would now colour the invisible hit area.',
    suggestion: 'Restore `stroke: transparent !important` on the hit area.',
    reason: 'Refuted by the reproduction: the hit area sets `stroke-opacity: 0`, so a consumer colour stays invisible.',
    evidence: [EV('packages/sdk/src/features/diagram/edges/enhanced-base-edge/enhanced-base-edge.module.css', 4, 'stroke-opacity: 0;')],
    repro: { exit: 3, cmd: 'vitest run .verify/hit-area-colour.spec.tsx', out: " ✓ hit area stays invisible under a consumer stroke rule\n\nexit 3: the bug does not happen" }
  })
];

const PATCH_265 = () => ({
  state: 'ready', rev: 1, fixed: 2, total: 2, repro: 'pass', cost: 0.11, waiting: null, by: 'piotr', sha: null, note: '',
  files: [
    { path: 'apps/ai-studio/src/components/execution/node-run-status.tsx', finding: 1,
      before: "export function NodeRunStatus({ nodeId }: Props) {\n  const status = useNodeStatus(nodeId);\n  const openLog = useOpenLog();\n\n  if (status === 'running' || status === 'waiting') {\n    return <StatusPart status={status} onClick={() => openLog(nodeId)} />;\n  }\n  return <StatusPart status={status} />;\n}",
      after: "export function NodeRunStatus({ nodeId }: Props) {\n  const status = useNodeStatus(nodeId);\n  const openLog = useOpenLog();\n\n  // Every status that has a log entry opens it, not only the live ones.\n  const hasLog = status !== 'idle';\n  return <StatusPart status={status} onClick={hasLog ? () => openLog(nodeId) : undefined} />;\n}" },
    { path: 'packages/ui/src/components/node/node-panel/node-panel.module.css', finding: 2,
      before: ".halo {\n  position: absolute;\n  inset: -4px;\n  border-radius: inherit;\n  z-index: 2;\n}\n\n.selected {\n  outline: 2px solid var(--wb-ds-ui-stroke-highlight);\n}",
      after: ".halo {\n  position: absolute;\n  inset: -4px;\n  border-radius: inherit;\n  z-index: 0;\n}\n\n.selected {\n  outline: 2px solid var(--wb-ds-ui-stroke-highlight);\n  outline-offset: 5px;\n}" }
  ]
});

const INSTR = () => {
  const v3 = "# Review rules\n\nYou review one pull request. Report only what you can point to in the diff.\n\n## What counts as a finding\n- A bug a user or a consumer of the SDK would hit.\n- A missing test for behaviour the PR adds.\n- A public API change that is not in a changeset.\n\n## Limits\n- At most 7 findings. Prefer fewer, stronger ones.\n- A nit never blocks. Mark style remarks as nits.\n\n## Questions\n- Ask only what a person must decide: intent, public contract, trade-offs.\n- Give 2 or 3 options and mark the one you recommend.";
  return [
    { id: 'review-rules', name: 'review-rules.md', scope: 'global', role: 'Reviewer', about: 'What the reviewer reports and how.', active: 3, draft: null,
      versions: [
        { n: 1, at: -21 * DAY, by: 'alek', note: 'First version', runs: 41, text: v3.replace('At most 7 findings. Prefer fewer, stronger ones.', 'At most 10 findings.').replace("\n- A public API change that is not in a changeset.", '') },
        { n: 2, at: -12 * DAY, by: 'tomek', note: 'Cap findings at 7', runs: 58, text: v3.replace("\n- A public API change that is not in a changeset.", '') },
        { n: 3, at: -5 * DAY, by: 'alek', note: 'Flag public API changes without a changeset', runs: 37, text: v3 }
      ] },
    { id: 'verify-rules', name: 'verify-rules.md', scope: 'global', role: 'Verifier', about: 'How a finding is confirmed or refuted.', active: 2, draft: null,
      versions: [
        { n: 1, at: -21 * DAY, by: 'alek', note: 'First version', runs: 9, text: "# Verify rules\n\nYou check one finding. You do not see the proposed fix.\n\n- Quote the lines that prove your verdict. Quotes must exist in the file word for word.\n- Write a reproduction script when the bug can be shown by running code." },
        { n: 2, at: -9 * DAY, by: 'piotr', note: 'Script result beats the verdict', runs: 22, text: "# Verify rules\n\nYou check one finding. You do not see the proposed fix.\n\n- Quote the lines that prove your verdict. Quotes must exist in the file word for word.\n- Write a reproduction script when the bug can be shown by running code.\n- Exit 0 means the bug is reproduced, exit 3 means it does not happen. The script result beats your own verdict.\n- No evidence means Not proven." }
      ] },
    { id: 'implement-rules', name: 'implement-rules.md', scope: 'global', role: 'Implementer', about: 'How fixes are written.', active: 1, draft: null,
      versions: [{ n: 1, at: -14 * DAY, by: 'marek', note: 'First version', runs: 6, text: "# Implement rules\n\n- Fix only the findings you were given.\n- Edit files; never run shell commands.\n- Keep the change minimal and match the code around it.\n- Add a one-line comment only when the reason is not visible in the code." }] },
    { id: 'classify-rules', name: 'classify-rules.md', scope: 'global', role: 'Judge', about: 'How the change type is chosen.', active: 1, draft: null,
      versions: [{ n: 1, at: -14 * DAY, by: 'alek', note: 'First version', runs: 44, text: "# Change type rules\n\n- Uses existing parts: docs, tests, or code that only composes existing APIs.\n- Changes behaviour: anything a user or consumer can observe.\n- One-way door: migrations, public exports, published manifests, deploy files." }] },
    { id: 'analyst-rules', name: 'analyst-rules.md', scope: 'global', role: 'Analyst', about: 'How lessons are proposed after a PR closes.', active: 1, draft: null,
      versions: [{ n: 1, at: -10 * DAY, by: 'alek', note: 'First version', runs: 5, text: "# Analyst rules\n\n- Propose at most 5 lessons per closed PR.\n- A lesson is a rule a reviewer can apply to the next PR.\n- Ignore the PR author's own comments.\n- If a lesson already exists, add this PR to it instead of writing a new one." }] },
    { id: 'lessons', name: 'lessons.md', scope: 'global', role: 'Reviewer', about: 'Accepted lessons. Reviewers read them in every round.', active: 2, draft: null,
      versions: [
        { n: 1, at: -8 * DAY, by: 'alek', note: 'Lesson: changesets must match the declared bump', runs: 31, text: "# Lessons\n\n## Changesets must match the declared bump\nWhen the PR description says \"SDK minor, UI patch\", open every file in `.changeset/` and compare. Report a mismatch as Worth fixing." },
        { n: 2, at: -3 * DAY, by: 'tomek', note: 'Lesson: guard tests must fail without the change', runs: 19, text: "# Lessons\n\n## Changesets must match the declared bump\nWhen the PR description says \"SDK minor, UI patch\", open every file in `.changeset/` and compare. Report a mismatch as Worth fixing.\n\n## A guard test must fail without the change\nFor every new test that protects a fix, check that it would fail on the base branch. A test that passes both ways is a finding." }
      ] },
    { id: 'repo-wb', name: 'repo-knowledge.md', scope: 'repo', repo: WB, role: 'Reviewer', about: 'What the reviewer should know about this repository.', active: 2, draft: null,
      versions: [
        { n: 1, at: -18 * DAY, by: 'kasia', note: 'First version', runs: 60, text: "# workflowbuilder\n\n- `packages/sdk` and `packages/ui` are published. Their `src/index.ts` is the public contract.\n- A consumer-visible change needs a changeset." },
        { n: 2, at: -6 * DAY, by: 'kasia', note: 'Temporal replay contract', runs: 48, text: "# workflowbuilder\n\n- `packages/sdk` and `packages/ui` are published. Their `src/index.ts` is the public contract.\n- A consumer-visible change needs a changeset.\n- `packages/temporal` must replay histories recorded by older versions. Breaking replay is a major." }
      ] },
    { id: 'review-rules-l1', name: 'review-rules.md', scope: 'level', level: 1, role: 'Reviewer', about: 'Level 1 copy: shorter rules for the diff-only review.', active: 1, draft: null,
      versions: [{ n: 1, at: -11 * DAY, by: 'alek', note: 'Short copy for level 1', runs: 96, text: "# Review rules (level 1)\n\nRead the diff only. Report at most 4 findings. Do not ask questions about intent; you cannot see the task." }] }
  ];
};

function seed() {
  const now = Date.now();
  const T = (minAgo, actor, text, x) => Object.assign({ at: now - minAgo * MIN, actor, text }, x || {});
  const prs = {};
  const P = (num, repo, title, author, o) => {
    const pr = Object.assign({ num, repo, title, author, branch: 'feat/' + title.replace(/^[a-z]+\([a-z-]+\):\s*/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28).replace(/-$/, ''), base: 'main', fork: false, draft: false, files: 9, add: 180, del: 40, openedAt: now - 2 * DAY, head: newSha(), clickup: 'WB-' + (500 + num), level: repo === WB ? 3 : 1, ctype: 'Changes behaviour',
      chain: null, reviewedSha: null, commitsSince: 0, run: null, findings: [], questions: [], sensitive: null, patch: null, rounds: [], timeline: [], spend: 0, failed: null, merged: null, closed: null, learning: null, script: null, ci: 'green', autoPatches: 0, cancelledNote: null, review: {} }, o || {});
    prs[num] = pr; return pr;
  };
  /* A completed round with its standard bot timeline entries. */
  const round = (pr, n, ago, o) => {
    o = o || {};
    const r = { n, id: 'r' + pr.num + '-' + (pr.rounds.length + 1), kind: o.kind || 'review', sha: o.sha || pr.head, by: o.by || 'bot', reason: o.reason || 'PR marked ready for review', cost: o.cost == null ? 1.31 : o.cost, dur: o.dur || 154, at: now - ago * MIN, status: o.status || 'done', level: o.level || pr.level, summary: o.summary || '', chainStart: n === 1 };
    pr.rounds.push(r); pr.spend += r.cost; pr.chain = { n, by: r.by, reason: r.reason }; pr.reviewedSha = r.sha;
    pr.timeline.push(T(ago + r.dur / 60, r.by, (r.kind === 'fixcheck' ? 'Round ' + n + ' of 3 started: fix check' : 'Round ' + n + ' of 3 started') + ' · ' + r.reason, { run: r.id }));
    if (r.status === 'done') {
      pr.timeline.push(T(ago, 'bot', 'Round ' + n + ' finished' + (r.summary ? ': ' + r.summary : ''), { cost: r.cost, dur: r.dur, run: r.id }));
      pr.timeline.push(T(ago - 0.1, 'bot', 'GitHub comment posted: "Ready for team member review (round ' + n + ')"'));
    }
    return r;
  };
  const opened = (pr, daysAgo, draft) => { pr.openedAt = now - daysAgo * DAY; pr.timeline.unshift(T(daysAgo * 1440, pr.author, draft ? 'Opened the PR as a draft in GitHub' : 'Opened the PR in GitHub', { gh: true })); };

  /* ---------- Not reviewed ---------- */
  let p = P(281, WB, 'feat(sdk): keyboard shortcuts for aligning selected nodes', 'ola', { draft: true, files: 11, add: 342, del: 18 }); opened(p, 0.2, true);
  p.script = { questions: [{ id: 1, text: 'Should the align shortcuts be on by default for existing consumers, or opt-in through a prop?', why: 'On by default changes keyboard behaviour for every app that embeds the editor. The task does not say which one is wanted.', options: ['Opt-in through `enableAlignShortcuts`', 'On by default, with a prop to switch them off'], rec: 0, answer: null }],
    findings: [
      F(1, 'worth', 'Align shortcuts fire while typing in a text field inside a node', 'packages/sdk/src/features/keyboard/use-align-shortcuts.ts', 48, 'confirmed', { scenario: 'Select two nodes, click into a text input rendered inside one of them and press ⌥A. The handler listens on `document` and does not check the event target, so the nodes jump while the user types.', suggestion: 'Return early when the event target is an input, a textarea or a contenteditable element, as `use-delete-shortcut.ts` already does.', before: "function onKeyDown(event: KeyboardEvent) {\n  if (!event.altKey) return;", after: "function onKeyDown(event: KeyboardEvent) {\n  if (!event.altKey || isEditableTarget(event.target)) return;", reason: 'The reproduction dispatches ⌥A from an input inside a node and the align action is called.', evidence: [EV('packages/sdk/src/features/keyboard/use-align-shortcuts.ts', 48, 'if (!event.altKey) return;')], repro: { exit: 0, cmd: 'vitest run .verify/align-in-input.spec.tsx', out: " FAIL  .verify/align-in-input.spec.tsx\n  × does not align while typing\n    expected alignNodes not to be called\n\nexit 0: the bug is reproduced" } }),
      F(2, 'worth', 'Undo restores positions one node at a time instead of as one step', 'packages/sdk/src/features/history/history-slice.ts', 112, 'notproven', { scenario: 'Align five nodes, then press ⌘Z. Each node may need its own undo, because `alignNodes` calls `setNodePosition` in a loop and every call can push a history entry.', suggestion: 'Wrap the loop in `history.batch()`.', reason: 'The loop is there, but `setNodePosition` debounces history entries. The reproduction saw one entry in a synchronous run; with real timers the result may differ. Not proven.', evidence: [EV('packages/sdk/src/features/keyboard/align-nodes.ts', 27, 'for (const node of nodes) setNodePosition(node.id, next(node));')], repro: { exit: 3, cmd: 'vitest run .verify/align-undo.spec.ts', out: " ✓ one history entry after aligning 5 nodes (fake timers)\n\nexit 3 with fake timers only, so the verdict stays Not proven" } }),
      F(3, 'nit', 'Shortcut table in the docs lists ⌥A twice', 'apps/docs/src/content/docs/guides/keyboard-shortcuts.md', 31, 'confirmed', { scenario: 'Rows 31 and 34 both say ⌥A. The second one should be ⌥⇧A (align right).', suggestion: 'Change row 34 to ⌥⇧A.', before: '| ⌥A | Align right |', after: '| ⌥⇧A | Align right |', reason: 'Both rows quote the same shortcut.', evidence: [EV('apps/docs/src/content/docs/guides/keyboard-shortcuts.md', 34, '| ⌥A | Align right |')] })
    ] };
  p = P(274, WB, 'chore(demo): update dependencies in the demo app', '@hk-wang', { fork: true, files: 3, add: 61, del: 58, clickup: null, branch: 'hk-wang:update-deps', ctype: null }); opened(p, 1.4);
  p = P(266, WB, 'fix(sdk): preserve save results and suppress obsolete feedback', '@jordan-fields', { fork: true, files: 6, add: 143, del: 37, clickup: null, branch: 'jordan-fields:fix/save-results', ctype: null }); opened(p, 3.1);
  p = P(256, WB, 'Temporal partner review: @workflowbuilder/temporal (review only, not for merge)', 'marek', { draft: true, files: 48, add: 12, del: 4, clickup: null, branch: 'review/temporal-partner' }); opened(p, 6);
  p = P(38, TPL, 'feat(templates): approval-flow starter template', 'tomek', { draft: true, files: 5, add: 214, del: 0, level: 5, clickup: 'WB-831', branch: 'feat/approval-flow-template', ctype: 'Uses existing parts' }); opened(p, 0.4, true);
  p.script = { questions: [], findings: [
    F(1, 'worth', 'Template id collides with `approval-basic`', 'templates/approval-flow/template.json', 3, 'confirmed', { remedy: 'obvious', scenario: 'Both templates declare `"id": "approval"`. The gallery keeps the first one it loads, so the new template never appears.', suggestion: 'Use `"id": "approval-flow"`.', before: '"id": "approval",', after: '"id": "approval-flow",', reason: 'The reproduction loads the registry and gets one template for the id.', evidence: [EV('templates/approval-flow/template.json', 3, '"id": "approval",'), EV('templates/approval-basic/template.json', 3, '"id": "approval",')], repro: { exit: 0, cmd: 'node .verify/duplicate-id.mjs', out: "registry size 11, expected 12\nduplicate id: approval\n\nexit 0: the bug is reproduced" } }),
    F(2, 'worth', 'Preview image path breaks on case-sensitive file systems', 'templates/approval-flow/index.ts', 12, 'confirmed', { remedy: 'obvious', scenario: 'The import says `./Preview.png` and the file is `preview.png`. It works on macOS and fails in CI and in production builds on Linux.', suggestion: 'Import `./preview.png`.', before: "import preview from './Preview.png';", after: "import preview from './preview.png';", reason: 'The file on disk is lower-case.', evidence: [EV('templates/approval-flow/index.ts', 12, "import preview from './Preview.png';")], repro: { exit: 0, cmd: 'node .verify/case-sensitive-import.mjs', out: "ENOENT: templates/approval-flow/Preview.png\n\nexit 0: the bug is reproduced" } })
  ] };
  p.scriptPatch = { files: [
    { path: 'templates/approval-flow/template.json', finding: 1, before: '{\n  "$schema": "../template.schema.json",\n  "id": "approval",\n  "name": "Approval flow",\n  "nodes": 6\n}', after: '{\n  "$schema": "../template.schema.json",\n  "id": "approval-flow",\n  "name": "Approval flow",\n  "nodes": 6\n}' },
    { path: 'templates/approval-flow/index.ts', finding: 2, before: "import template from './template.json';\nimport preview from './Preview.png';\n\nexport default { ...template, preview };", after: "import template from './template.json';\nimport preview from './preview.png';\n\nexport default { ...template, preview };" }
  ] };

  /* ---------- Agents working (seeded runs move at a slow, realistic pace) ---------- */
  p = P(277, WB, 'feat(sdk): commit property edits when the selection changes', 'piotr', { files: 7, add: 156, del: 22 }); opened(p, 0.05);
  p.timeline.push(T(2.2, 'piotr', 'Marked the PR ready for review in GitHub', { gh: true }));
  p.script = { questions: [], findings: [
    F(1, 'worth', 'Uncommitted text is lost when the selection changes without a blur', 'packages/sdk/src/features/properties-bar/components/node-properties/node-properties.tsx', 100, 'confirmed', { scenario: 'Type into a property field and click another node on the canvas. The canvas click changes the selection before the input blurs, so the panel unmounts with the draft value still in local state.', suggestion: 'Commit the draft in the effect cleanup that runs when `selectedNodeId` changes.', reason: 'The reproduction changes the selection without firing blur and the store keeps the old value.', evidence: [EV('packages/sdk/src/features/properties-bar/components/node-properties/node-properties.tsx', 100, 'onBlur={() => commit(draft)}')], repro: { exit: 0, cmd: 'vitest run .verify/commit-on-selection.spec.tsx', out: " FAIL  expected 'Send email' to be 'Send reminder'\n\nexit 0: the bug is reproduced" } }),
    F(2, 'nit', 'Conditions test checks only the string to number change', 'packages/sdk/src/features/json-form/controls/dynamic-conditions-control/dynamic-conditions-form-field/conditions-form-field.spec.tsx', 77, 'confirmed', { scenario: 'The test covers one type change. Number to boolean and boolean to string go through the same branch and are not asserted.', suggestion: 'Turn the test into `it.each` over the three type changes.', reason: 'Only one case is present in the spec.', evidence: [EV('packages/sdk/src/features/json-form/controls/dynamic-conditions-control/dynamic-conditions-form-field/conditions-form-field.spec.tsx', 77, "it('resets the value when the type changes from string to number'")] })
  ] };
  p = P(270, WB, 'test(e2e): AI Studio end-to-end tests on the full stack', 'tomek', { files: 31, add: 1840, del: 96, level: 4, clickup: 'WB-790', branch: 'test/e2e-ai-studio' }); opened(p, 4);
  round(p, 1, 190, { cost: 1.62, dur: 201, summary: '3 findings, no questions' });
  p.findings = [
    F(1, 'worth', 'Process log is closed on `exit` while output can still arrive', 'apps/e2e/src/stack/child-process.ts', 110, 'confirmed', { decision: { v: 'implement', by: 'tomek', at: now - 150 * MIN, agent: true }, scenario: '`pnpm` (the group leader) can exit before its `tsx` and `node` children, which inherit stdout and stderr. A chunk that arrives after `exit` reaches `log.write` after `log.end()`, and a `WriteStream` with no `error` listener throws ERR_STREAM_WRITE_AFTER_END in the Playwright process.', suggestion: 'Close the log on `close`, after all pipes are closed, and keep `exit` only for the readiness check.', before: "child.once('exit', (code, signal) => {\n  log.end();", after: "child.once('close', () => log.end());\nchild.once('exit', (code, signal) => {", reason: 'The reproduction starts a leader that exits while a grandchild keeps writing; the write after end is thrown.', evidence: [EV('apps/e2e/src/stack/child-process.ts', 109, "child.once('exit', (code, signal) => {\n      log.end();"), EV('apps/e2e/src/stack/child-process.ts', 94, 'log.write(chunk);')], repro: { exit: 0, cmd: 'node --import tsx .verify/write-after-end.mjs', out: "Error [ERR_STREAM_WRITE_AFTER_END]: write after end\n\nexit 0: the bug is reproduced" } }),
    F(2, 'worth', '`stop()` does not kill the group when the leader has already exited', 'apps/e2e/src/stack/child-process.ts', 44, 'confirmed', { decision: { v: 'implement', by: 'tomek', at: now - 150 * MIN, agent: true }, scenario: 'The leader ends by itself and its child lives on. `stop()` sees `exitCode !== null` and returns without signalling the group, so a process stays on port 3101 and the next `pnpm e2e` cannot start.', suggestion: 'Call `signalGroup(child, \'SIGKILL\')` before `resolve()` in the early return.', before: "if (child.exitCode !== null || child.signalCode !== null) {\n  resolve();\n  return;\n}", after: "if (child.exitCode !== null || child.signalCode !== null) {\n  signalGroup(child, 'SIGKILL');\n  resolve();\n  return;\n}", reason: 'The reproduction runs the real `startProcess()`: the leader exits after the ready signal and its child survives `stop()`.', evidence: [EV('apps/e2e/src/stack/child-process.ts', 44, "if (child.exitCode !== null || child.signalCode !== null) {\n      resolve();\n      return;\n    }")], repro: { exit: 0, cmd: 'node --import tsx .verify/stop-leaves-group.mjs', out: "grandchild 48213 still alive after stop()\n\nexit 0: the bug is reproduced" } }),
    F(3, 'nit', '`backend.execution` does not check the response status', 'apps/e2e/src/fixtures.ts', 76, 'confirmed', { decision: { v: 'reject', by: 'tomek', at: now - 149 * MIN, reason: 'The next line parses the body and fails loudly on a non-JSON error page.' }, scenario: 'A 500 from the backend is parsed as JSON and the test fails later with an unrelated message.', suggestion: 'Throw when `!response.ok`.', reason: 'There is no status check in the helper.', evidence: [EV('apps/e2e/src/fixtures.ts', 76, 'const body = await response.json();')] })
  ];
  p.timeline.push(T(150, 'tomek', 'Decided 3 findings: 2 implement, 1 reject'), T(150, 'tomek', 'Implement with agent started for 2 findings'), T(146, 'bot', 'Patch ready: 2 of 2 fixed, reproductions pass', { cost: 0.11, dur: 95 }), T(4.4, 'tomek', 'Pushed the fix 9c41d07 to test/e2e-ai-studio'));
  p.spend += 0.11; p.head = '9c41d07'; p.fixSha = '9c41d07';
  p.patch = { state: 'pushed', rev: 1, fixed: 2, total: 2, repro: 'pass', cost: 0.11, by: 'tomek', sha: '9c41d07', files: [{ path: 'apps/e2e/src/stack/child-process.ts', finding: 1, before: "    child.once('error', (error) => fail(`could not start (${error.message})`));\n    child.once('exit', (code, signal) => {\n      log.end();\n      if (readyText === undefined && code === 0) {\n        succeed();", after: "    child.once('error', (error) => fail(`could not start (${error.message})`));\n    // 'close', not 'exit': stdout and stderr can still deliver data after the process exits.\n    child.once('close', () => log.end());\n    child.once('exit', (code, signal) => {\n      if (readyText === undefined && code === 0) {\n        succeed();" }] };
  p = P(271, WB, 'feat(sdk): plugins can deliver hooks through OptionalHooks', 'marek', { files: 14, add: 402, del: 77, level: 4, clickup: 'WB-802' }); opened(p, 2.5);
  round(p, 1, 95, { cost: 1.48, dur: 176, summary: '2 findings, no questions' });
  p.findings = [
    F(1, 'worth', 'A hook delivered by a plugin through `OptionalHooks` is counted as the app\'s own', 'packages/sdk/src/workflow-builder-root/root-shell.tsx', 31, 'confirmed', { decision: { v: 'implement', by: 'marek', at: now - 6 * MIN, agent: true }, scenario: 'A plugin mounts `<OptionalHooks onSave={...} />`. `root-shell` marks every delivery from that slot as `source: "app"`, so the plugin wins over the real app handler.', suggestion: 'Carry the source through the slot context and mark plugin deliveries as `"plugin"`.', reason: 'The reproduction mounts a plugin handler and an app handler; the plugin one is called.', evidence: [EV('packages/sdk/src/workflow-builder-root/root-shell.tsx', 31, "deliver(hooks, { source: 'app' });")], repro: { exit: 0, cmd: 'vitest run .verify/hook-source.spec.tsx', out: " FAIL  expected app handler to be called\n\nexit 0: the bug is reproduced" } }),
    F(2, 'nit', 'A synchronous exception from `onCleanUp` disappears without a trace', 'packages/sdk/src/hooks/create-workflow-builder-actions.ts', 120, 'confirmed', { decision: { v: 'implement', by: 'marek', at: now - 6 * MIN, agent: true }, scenario: '`onCleanUp` throws synchronously. The `try` has an empty `catch`, the direction change stays applied and nothing is logged.', suggestion: 'Log the error with `console.error` in the catch.', reason: 'The catch block is empty.', evidence: [EV('packages/sdk/src/hooks/create-workflow-builder-actions.ts', 120, '} catch {}')] })
  ];
  p.timeline.push(T(6, 'marek', 'Decided 2 findings: 2 implement'), T(5.9, 'marek', 'Implement with agent started for 2 findings'));
  p = P(253, WB, 'feat(sdk): zoom to fit on Shift+1', 'ola', { files: 4, add: 88, del: 6, clickup: 'WB-771' }); opened(p, 0.02);
  p.timeline.push(T(1.1, 'ola', 'Marked the PR ready for review in GitHub', { gh: true }));

  /* ---------- Action needed ---------- */
  p = P(272, WB, 'feat(sdk): edge endpoints in the colour of the line', 'kasia', { files: 18, add: 611, del: 143, clickup: 'WB-812', branch: 'feat/edge-endpoints' }); opened(p, 1.1);
  round(p, 1, 64, { cost: 1.42, dur: 151, summary: '6 findings, 2 questions' });
  p.findings = F272();
  p.questions = [
    { id: 1, text: 'The PR adds `edgeEndpoint` to the public props of `<WorkflowBuilder.Root>`. After a release it cannot be removed without a major version. Do we accept it?', why: 'The prop is small, documented in the README and the guide, and follows the same pattern as `edgeType`.', options: ['Yes, accept the prop as it is', 'No, keep it internal behind a plugin hook for now'], rec: 0, answer: null },
    { id: 2, text: 'Should the endpoint follow the hover and selected colours of the line, or stay in the base colour?', why: 'The task says "in the colour of the line" and does not mention states. The PR follows hover and selected.', options: ['Follow hover and selected, as the PR does', 'Stay in the base colour', 'Follow selected only'], rec: 0, answer: null }
  ];
  p.sensitive = { status: 'pending', files: [{ path: 'packages/ui/src/index.ts', rule: 'Public exports', note: 'Exports `EdgeEndpointMarker` and the type `EdgeEndpoint`.' }, { path: 'packages/ui/package.json', rule: 'Package manifest', note: 'Adds the `./edge` entry to `exports`.' }] };
  p = P(76, WB, 'feat(sdk): variable enhancement', 'piotr', { files: 22, add: 730, del: 210, clickup: 'WB-655', level: 2, branch: 'feat/variable-enhancement' }); opened(p, 9);
  round(p, 1, 1500, { cost: 1.19, dur: 143, summary: '1 finding, 2 questions', level: 2 });
  p.findings = [F(1, 'nit', 'Variable picker closes when the list scrolls', 'packages/sdk/src/features/variables/variable-picker.tsx', 88, 'unchecked', { scenario: 'With more than 12 variables, scrolling the list fires `onPointerDownOutside` on the scrollbar and closes the picker.', suggestion: 'Ignore pointer events that start on the scrollbar.' })];
  p.questions = [
    { id: 1, text: 'Variables can now reference other variables. Should a cycle (A uses B, B uses A) block saving, or save with a warning?', why: 'The PR saves with a warning. At run time a cycle resolves to an empty string.', options: ['Block saving until the cycle is removed', 'Save with a warning, as the PR does'], rec: 0, answer: null },
    { id: 2, text: 'The old `{{name}}` syntax still works next to the new `{{vars.name}}`. Do we keep both?', why: 'Removing the old syntax breaks saved workflows; keeping it means two ways to write the same thing in the docs.', options: ['Keep both and mark the old one as deprecated', 'Keep both with no deprecation', 'Remove the old syntax in this PR'], rec: 0, answer: null }
  ];
  p = P(269, WB, 'feat(sdk): edge run states and the DS Edge link look', 'marek', { files: 26, add: 904, del: 318, clickup: 'WB-799', branch: 'feat/edge-run-states' }); opened(p, 3.2);
  round(p, 1, 2890, { cost: 1.57, dur: 188, summary: '4 findings, no questions', sha: 'e17a4b0' });
  p.timeline.push(T(2700, 'tomek', "Tomek's review: 2 worth implementing"), T(2600, 'marek', 'Pushed 4 commits (5b0c9d2) · no review started, a push never starts one', { gh: true }), T(215, 'hand', 'Review started by hand'));
  round(p, 1, 210, { cost: 1.33, dur: 162, by: 'hand', reason: 'started by hand', summary: '4 findings, no questions' });
  p.findings = [
    F(1, 'blocking', 'An edge from a node that failed, while the run went on, ends as "out of run"', 'apps/ai-studio/src/components/execution/edge-run-state.tsx', 27, 'confirmed', { opinions: [{ by: 'tomek', v: 'worth', comment: 'Hit this on the demo flow. The failed branch looks like it never ran.', round: 1, carried: true, at: now - 2700 * MIN }, { by: 'piotr', v: 'worth', comment: '', round: 1, at: now - 120 * MIN }], scenario: 'A node fails with `continueOnError`. Its outgoing edge is classified by the status of the source node only, so it is drawn as "out of run" although the next node did run.', suggestion: 'Classify by the target node as well: if the target ran, the edge was taken.', before: "if (source.status === 'failed') return 'out-of-run';", after: "if (source.status === 'failed' && !ran(target)) return 'out-of-run';", reason: 'The reproduction builds a three-node run with a failed middle node and reads the state of the second edge.', evidence: [EV('apps/ai-studio/src/components/execution/edge-run-state.tsx', 27, "if (source.status === 'failed') return 'out-of-run';")], repro: { exit: 0, cmd: 'vitest run .verify/failed-source-edge.spec.ts', out: " FAIL  expected 'out-of-run' to be 'done'\n\nexit 0: the bug is reproduced" } }),
    F(2, 'worth', 'Types `EdgeRunState` and `EdgeLineType` are not exported from the SDK', 'packages/sdk/src/index.ts', 165, 'confirmed', { opinions: [{ by: 'tomek', v: 'worth', comment: 'Plugin authors need both to type `edgeRunState`.', round: 1, carried: true, at: now - 2700 * MIN }, { by: 'piotr', v: 'not', comment: 'They can be inferred from the hook. Exporting makes them public contract.', round: 1, at: now - 120 * MIN }], scenario: 'The guide tells plugin authors to return an `EdgeRunState`. The type lives in an internal file and `index.ts` does not export it.', suggestion: 'Export both types from `packages/sdk/src/index.ts` and add them to the changeset.', reason: 'Neither name appears in `index.ts`.', evidence: [EV('apps/docs/src/content/docs/guides/build-a-plugin.md', 1993, 'edgeRunState: (edge): EdgeRunState =>')] }),
    F(3, 'worth', 'The docs example calls `edgeRunState` with a different signature than the reference plugin', 'apps/docs/src/content/docs/guides/build-a-plugin.md', 1993, 'notproven', { opinions: [{ by: 'piotr', v: 'worth', comment: '', round: 1, at: now - 120 * MIN }], scenario: 'The guide passes `(edge)`; `apps/ai-studio/src/plugin.ts` passes `(edge, nodes)`.', suggestion: 'Make the guide match the reference plugin.', reason: 'Both signatures type-check because the second parameter is optional. Whether the guide is wrong depends on intent.', evidence: [EV('apps/ai-studio/src/plugin.ts', 14, 'edgeRunState: (edge, nodes) =>')] }),
    F(4, 'nit', 'The guard test bans `!important` in all of `apps/ai-studio/src`, not only for edges', 'apps/ai-studio/src/components/execution/no-edge-css-injection.test.ts', 789, 'confirmed', { scenario: 'The glob is `src/**/*.css`. A legitimate `!important` in an unrelated component will fail a test named after edges.', suggestion: 'Narrow the glob to the execution components or rename the test.', reason: 'The glob covers the whole app.', evidence: [EV('apps/ai-studio/src/components/execution/no-edge-css-injection.test.ts', 12, "const files = globSync('src/**/*.css');")] })
  ];
  p.timeline.push(T(120, 'piotr', "Piotr's review: 2 worth implementing, 1 not worth it"), T(119, 'piotr', 'Notified Marek in ClickUp (WB-799)'));
  p.review = { piotr: { notified: true } };
  p = P(264, WB, 'feat(ai-studio): a run hides the canvas grid until Reset', 'ola', { files: 10, add: 130, del: 21, clickup: 'WB-777', branch: 'feat/run-hides-grid' }); opened(p, 2.2);
  round(p, 1, 410, { cost: 1.33, dur: 139, summary: '2 findings, 1 question · review $0.97, verify $0.36' });
  p.findings = [
    F(1, 'worth', 'No test checks that the SDK grid reads `--wb-public-canvas-grid-color`', 'packages/sdk/src/features/diagram/diagram.tsx', 211, 'confirmed', { decision: { v: 'defer', by: 'ola', at: now - 300 * MIN, reason: 'Follow-up WB-840: grid colour contract test.' }, scenario: 'Someone changes `color="var(--wb-public-canvas-grid-color)"` back to the internal token. Every test still passes and the grid stays visible during a run.', suggestion: 'Add a test in `diagram.spec.tsx` that renders the real `Background` and asserts the colour.', reason: '`diagram.spec.tsx` replaces `Background` with `() => null`, so nothing reads the variable in tests.', evidence: [EV('packages/sdk/src/features/diagram/diagram.spec.tsx', 23, "vi.mock('@xyflow/react', () => ({ Background: () => null }))")] }),
    F(2, 'nit', 'Overriding `--wb-ds-ui-bg-canvas-dots` below `:root` no longer changes the grid colour', 'packages/sdk/src/index.css', 20, 'confirmed', { decision: { v: 'reject', by: 'ola', at: now - 300 * MIN, reason: 'Intended: the public variable replaces the internal token. Documented in the changeset.' }, scenario: 'A consumer who themed the grid through the internal token loses the colour after upgrading.', suggestion: 'Mention it in the changeset as a visual change.', reason: 'The default is resolved on `:root` only.', evidence: [EV('packages/sdk/src/index.css', 20, '--wb-public-canvas-grid-color: var(--wb-ds-ui-bg-canvas-dots);')] })
  ];
  p.questions = [{ id: 1, text: 'The PR adds the CSS variable `--wb-public-canvas-grid-color` to the public SDK contract. Do we accept it?', why: 'It follows the same pattern as `--wb-public-snackbar-offset-bottom`.', options: ['Yes, accept the variable as it is', 'No, hide the grid without a new public API'], rec: 0, answer: { by: 'tomek', text: 'Yes, accept the variable as it is', at: now - 320 * MIN } }];
  p.sensitive = { status: 'pending', files: [{ path: 'packages/sdk/package.json', rule: 'Package manifest', note: 'Bumps the peer range of `@xyflow/react`.' }, { path: 'packages/sdk/src/index.ts', rule: 'Public exports', note: 'Re-exports `CANVAS_GRID_COLOR_VAR`.' }] };
  p.timeline.push(T(320, 'tomek', 'Answered 1 question'), T(300, 'ola', 'Decided 2 findings: 1 defer to ClickUp, 1 reject'), T(299.9, 'bot', 'Created ClickUp follow-up WB-840 for 1 deferred finding'));
  p = P(265, WB, 'feat(ui): node run status parts and node template slots', 'piotr', { files: 19, add: 688, del: 204, level: 4, clickup: 'WB-781', branch: 'feat/node-run-status' }); opened(p, 2.8);
  round(p, 1, 520, { cost: 1.71, dur: 196, summary: '3 findings, no questions' });
  p.findings = [
    F(1, 'blocking', 'Clicking a finished, failed or skipped node no longer opens its log', 'apps/ai-studio/src/components/execution/node-run-status.tsx', 56, 'confirmed', { decision: { v: 'implement', by: 'piotr', at: now - 400 * MIN }, scenario: 'After a run, click a node that failed. Before this PR the log panel opened at that node. Now `onClick` is passed only for `running` and `waiting`.', suggestion: 'Pass `onClick` for every status that has a log entry.', reason: 'The reproduction clicks a failed node and `openLog` is not called.', evidence: [EV('apps/ai-studio/src/components/execution/node-run-status.tsx', 56, 'return <StatusPart status={status} />;')], repro: { exit: 0, cmd: 'vitest run .verify/open-log-on-failed.spec.tsx', out: " FAIL  expected openLog to be called with 'node-2'\n\nexit 0: the bug is reproduced" } }),
    F(2, 'worth', 'The NodeRunRing halo hides the focus ring of a selected running node', 'packages/ui/src/components/node/node-panel/node-panel.module.css', 65, 'confirmed', { decision: { v: 'implement', by: 'piotr', at: now - 400 * MIN }, scenario: 'Select a node while it runs. The halo has `z-index: 2` and `inset: -4px`, which covers the 2px selection outline.', suggestion: 'Lower the halo below the panel and offset the outline.', reason: 'Confirmed from the stacking order in the CSS.', evidence: [EV('packages/ui/src/components/node/node-panel/node-panel.module.css', 65, 'z-index: 2;')] }),
    F(3, 'nit', '`useWaitingSince` scans the whole event list on every store change', 'apps/ai-studio/src/components/execution/node-run-status.tsx', 44, 'refuted', { scenario: 'With 2,000 events and 40 nodes each store update scans 80,000 entries.', suggestion: 'Index events by node id.', reason: 'Refuted: the selector is memoised per node and the list is capped at 500 events.', evidence: [EV('apps/ai-studio/src/stores/run-store.ts', 18, 'const MAX_EVENTS = 500;')], repro: { exit: 3, cmd: 'node .verify/waiting-since-bench.mjs', out: "0.4 ms per update at the cap\n\nexit 3: the problem does not happen" } })
  ];
  p.timeline.push(T(400, 'piotr', 'Decided 2 findings: 2 implement'));
  p.scriptPatch = PATCH_265();
  p = P(263, WB, 'feat(ai-studio): log panel keeps Run and Stop in view', 'tomek', { files: 8, add: 174, del: 60, level: 4, clickup: 'WB-779', branch: 'feat/log-panel-controls' }); opened(p, 2.6);
  round(p, 1, 300, { cost: 1.38, dur: 158, summary: '2 findings, no questions' });
  p.findings = [
    F(1, 'worth', 'Run and Stop overlap the log panel below 1100 px', 'apps/ai-studio/src/components/controls/ai-studio-controls.tsx', 86, 'confirmed', { decision: { v: 'implement', by: 'tomek', at: now - 70 * MIN, agent: true }, scenario: 'Open the log panel in a 1024 px window. The controls keep `right: 24px` and sit on top of the panel header.', suggestion: 'Offset the controls by the panel width from the layout store.', reason: 'The reproduction renders at 1024 px and the two rectangles intersect.', evidence: [EV('apps/ai-studio/src/components/controls/ai-studio-controls.tsx', 86, "style={{ right: 24 }}")], repro: { exit: 0, cmd: 'playwright test .verify/controls-overlap.spec.ts', out: "controls and log panel intersect by 212 px\n\nexit 0: the bug is reproduced" } }),
    F(2, 'worth', 'The position does not update on `window.resize`', 'apps/ai-studio/src/components/controls/ai-studio-controls.tsx', 91, 'confirmed', { decision: { v: 'implement', by: 'tomek', at: now - 70 * MIN, agent: true }, scenario: 'Resize the window with the panel open. The offset is read once on mount.', suggestion: 'Subscribe to the layout store instead of reading it once.', reason: 'The value is read in a `useMemo` with an empty dependency list.', evidence: [EV('apps/ai-studio/src/components/controls/ai-studio-controls.tsx', 91, 'const offset = useMemo(() => getPanelWidth(), []);')], repro: { exit: 0, cmd: 'playwright test .verify/controls-resize.spec.ts', out: "offset stays 0 after resize\n\nexit 0: the bug is reproduced" } })
  ];
  p.patch = { state: 'ready', rev: 1, fixed: 2, total: 2, repro: 'pass', cost: 0.11, waiting: null, by: 'tomek', sha: null, note: '', files: [
    { path: 'apps/ai-studio/src/components/controls/ai-studio-controls.tsx', finding: 1, before: "export function AiStudioControls() {\n  const offset = useMemo(() => getPanelWidth(), []);\n\n  return (\n    <div className={styles.controls} style={{ right: 24 }}>\n      <RunButton />\n      <StopButton />\n    </div>\n  );\n}", after: "export function AiStudioControls() {\n  // Subscribes, so the controls move when the panel opens or the window resizes.\n  const panelWidth = useLayoutStore((state) => state.logPanelWidth);\n\n  return (\n    <div className={styles.controls} style={{ right: 24 + panelWidth }}>\n      <RunButton />\n      <StopButton />\n    </div>\n  );\n}" },
    { path: 'apps/ai-studio/src/stores/layout-store.ts', finding: 2, before: "export const useLayoutStore = create<LayoutState>(() => ({\n  logPanelOpen: false,\n}));", after: "export const useLayoutStore = create<LayoutState>(() => ({\n  logPanelOpen: false,\n  logPanelWidth: 0,\n}));" }
  ] };
  p.spend += 0.11;
  p.timeline.push(T(70, 'tomek', 'Decided 2 findings: 2 implement'), T(70, 'tomek', 'Implement with agent started for 2 findings'), T(66, 'bot', 'Patch ready: 2 of 2 fixed, reproductions pass', { cost: 0.11, dur: 102 }));
  p = P(268, WB, 'fix(temporal): heartbeat timeout defaults for long activities', 'marek', { files: 5, add: 71, del: 19, level: 5, clickup: 'WB-795', branch: 'fix/heartbeat-defaults' }); opened(p, 1.9);
  round(p, 1, 240, { cost: 1.26, dur: 147, summary: '1 finding, no questions' });
  p.findings = [F(1, 'worth', 'A zero `heartbeatTimeout` is sent to the server, which treats it as unset', 'packages/temporal/src/workflow/heartbeat.ts', 22, 'confirmed', { remedy: 'obvious', decision: { v: 'implement', by: 'bot', at: now - 236 * MIN, agent: true }, scenario: 'A node config with `heartbeatTimeout: 0` is passed through. The Temporal server reads zero as "no heartbeat timeout", so a stuck activity is noticed only at its start-to-close timeout.', suggestion: 'Drop the field when it is zero and fall back to the profile default.', before: 'heartbeatTimeout: config.heartbeatTimeout,', after: 'heartbeatTimeout: config.heartbeatTimeout || profile.heartbeatTimeout,', reason: 'The reproduction builds activity options with zero and reads them back.', evidence: [EV('packages/temporal/src/workflow/heartbeat.ts', 22, 'heartbeatTimeout: config.heartbeatTimeout,')], repro: { exit: 0, cmd: 'vitest run .verify/zero-heartbeat.spec.ts', out: " FAIL  expected 0 to be '30s'\n\nexit 0: the bug is reproduced" } })];
  p.patch = { state: 'ready', rev: 1, fixed: 1, total: 1, repro: 'pass', cost: 0.09, waiting: 'sensitive', by: 'bot', sha: null, note: '', files: [{ path: 'packages/temporal/src/workflow/heartbeat.ts', finding: 1, sensitive: 'Temporal workflow code', before: "export function activityOptions(config: NodeConfig, profile: Profile) {\n  return {\n    startToCloseTimeout: config.timeout ?? profile.timeout,\n    heartbeatTimeout: config.heartbeatTimeout,\n  };\n}", after: "export function activityOptions(config: NodeConfig, profile: Profile) {\n  return {\n    startToCloseTimeout: config.timeout ?? profile.timeout,\n    // The server treats a zero timeout as unset, so zero falls back to the profile.\n    heartbeatTimeout: config.heartbeatTimeout || profile.heartbeatTimeout,\n  };\n}" }] };
  p.spend += 0.09; p.autoPatches = 1;
  p.timeline.push(T(236, 'bot', 'Autofix started: 1 confirmed finding with an obvious fix'), T(234, 'bot', 'Patch ready: 1 of 1 fixed, reproductions pass', { cost: 0.09, dur: 88 }), T(233.9, 'bot', 'Autofix waiting: the patch touches a sensitive file (packages/temporal/src/workflow/heartbeat.ts). A person must push it.'));
  p = P(239, WB, 'fix(sdk): style boundary for embedded hosts', 'kasia', { files: 33, add: 1210, del: 640, clickup: 'WB-742', branch: 'fix/sdk-style-boundary' }); opened(p, 7);
  round(p, 1, 1700, { cost: 2.94, dur: 412, summary: '3 findings, no questions', sha: 'a41c9e2' });
  p.findings = [
    F(1, 'blocking', 'Host `button` rules leak into the toolbar through `:where()`', 'packages/sdk/src/styles/boundary.css', 14, 'confirmed', { opinions: [{ by: 'tomek', v: 'worth', comment: 'Seen in the partner embed.', round: 1, at: now - 1600 * MIN }], scenario: 'The reset is wrapped in `:where()` and has zero specificity, so any host rule such as `button { border-radius: 0 }` wins inside the editor.', suggestion: 'Scope the reset with the layer `wb-reset` and declare the layer order in the entry CSS.', reason: 'The reproduction mounts the editor in a page with a host button rule and reads the computed style.', evidence: [EV('packages/sdk/src/styles/boundary.css', 14, ':where(.wb-root) button {')], repro: { exit: 0, cmd: 'playwright test .verify/host-button-leak.spec.ts', out: "border-radius is 0px, expected 6px\n\nexit 0: the bug is reproduced" } }),
    F(2, 'worth', 'Portalled menus render outside the boundary element', 'packages/sdk/src/components/menu/menu.tsx', 52, 'confirmed', { scenario: 'Menus portal to `document.body`, where the boundary class is missing, so they take host fonts.', suggestion: 'Portal into the boundary root from context.', reason: 'The portal target is `document.body`.', evidence: [EV('packages/sdk/src/components/menu/menu.tsx', 52, 'createPortal(children, document.body)')] }),
    F(3, 'nit', 'The README still mentions the removed `unstyled` prop', 'packages/sdk/README.md', 140, 'confirmed', { scenario: 'The props table lists `unstyled`, which this PR removes.', suggestion: 'Delete the row.', reason: 'The prop is gone from the types.', evidence: [EV('packages/sdk/README.md', 140, '| `unstyled` | boolean |')] })
  ];
  p.commitsSince = 3; p.head = 'c7d20f4';
  p.timeline.push(T(1600, 'tomek', "Tomek's review: 1 worth implementing"), T(95, 'kasia', 'Pushed 3 commits (c7d20f4) · no review started, a push never starts one', { gh: true }));
  p = P(250, WB, 'feat(ai-studio): starting a run collapses the side panels', 'ola', { files: 12, add: 301, del: 88, level: 5, clickup: 'WB-760', branch: 'feat/run-collapses-panels' }); opened(p, 4.4);
  round(p, 1, 900, { cost: 1.44, dur: 160, summary: '3 findings, no questions', sha: '1f0a3c8' });
  p.timeline.push(T(896, 'bot', 'Autofix started: 3 confirmed findings with an obvious fix'), T(893, 'bot', 'Patch ready: 3 of 3 fixed, reproductions pass', { cost: 0.14, dur: 121 }), T(892.9, 'bot', 'Autofix pushed 77be1d4: every condition held (all fixed, reproductions pass, no sensitive file)'));
  round(p, 2, 888, { kind: 'fixcheck', cost: 0.52, dur: 84, reason: 'after fix 77be1d4', summary: '2 of 3 fixes resolved', sha: '77be1d4' });
  p.timeline.push(T(886, 'bot', 'Autofix started: 1 finding still not resolved'), T(884, 'bot', 'Patch ready: 1 of 1 fixed, reproductions pass', { cost: 0.1, dur: 79 }), T(883.9, 'bot', 'Autofix pushed d93e55a (automatic patch 2 of 2 in this chain)'));
  round(p, 3, 880, { kind: 'fixcheck', cost: 0.47, dur: 77, reason: 'after fix d93e55a', summary: '2 of 3 fixes resolved', sha: 'd93e55a' });
  p.head = 'd93e55a'; p.fixSha = 'd93e55a'; p.autoPatches = 2; p.spend += 0.24;
  p.findings = [
    F(1, 'worth', 'Panels stay collapsed after the run is reset', 'apps/ai-studio/src/hooks/use-run-layout.ts', 41, 'confirmed', { remedy: 'obvious', decision: { v: 'implement', by: 'bot', at: now - 896 * MIN, agent: true }, resolved: true, scenario: 'Reset clears the run and leaves `panelsCollapsed: true`.', suggestion: 'Restore the previous layout on Reset.', reason: 'Confirmed by the reproduction.', evidence: [EV('apps/ai-studio/src/hooks/use-run-layout.ts', 41, 'setPanelsCollapsed(true);')] }),
    F(2, 'worth', 'Fit view runs before the panels finish collapsing', 'apps/ai-studio/src/hooks/use-run-layout.ts', 47, 'confirmed', { remedy: 'obvious', decision: { v: 'implement', by: 'bot', at: now - 896 * MIN, agent: true }, resolved: false, resolvedNote: 'Round 3: the fix waits one frame, but the collapse animation takes 200 ms. The diagram is still fitted into the old viewport.', scenario: '`fitView()` is called in the same tick as the collapse, so the diagram is fitted into the old, narrower viewport.', suggestion: 'Call `fitView()` after the collapse transition ends.', reason: 'Confirmed by the reproduction.', evidence: [EV('apps/ai-studio/src/hooks/use-run-layout.ts', 47, 'fitView({ padding: 0.1 });')], repro: { exit: 0, cmd: 'playwright test .verify/fit-after-collapse.spec.ts', out: "viewport width 912, expected 1440\n\nexit 0: the bug is reproduced" } }),
    F(3, 'nit', 'The keyboard shortcut for Run is not shown in the tooltip', 'apps/ai-studio/src/components/controls/run-button.tsx', 18, 'confirmed', { remedy: 'obvious', decision: { v: 'implement', by: 'bot', at: now - 896 * MIN, agent: true }, resolved: true, scenario: 'The tooltip says "Run" and the shortcut ⌘↵ is documented only in the README.', suggestion: 'Add the shortcut to the tooltip.', reason: 'Confirmed.', evidence: [EV('apps/ai-studio/src/components/controls/run-button.tsx', 18, '<Tooltip content="Run">')] })
  ];
  p = P(262, WB, 'feat(ui): restyle canvas node to DS Node v2 and add BadgeLabel', 'piotr', { files: 84, add: 4120, del: 1877, clickup: 'WB-768', branch: 'feat/ds-node-v2' }); opened(p, 5.5);
  p.timeline.push(T(52, 'piotr', 'Marked the PR ready for review in GitHub', { gh: true }), T(51.9, 'bot', 'Round 1 of 3 started · PR marked ready for review', { run: 'r262-1' }), T(21, 'bot', 'Review stage timed out after 30 min. This round is not counted.', { run: 'r262-1', fail: true, cost: 3.85 }));
  p.rounds.push({ n: 1, id: 'r262-1', kind: 'review', sha: p.head, by: 'bot', reason: 'PR marked ready for review', cost: 3.85, dur: 1851, at: now - 21 * MIN, status: 'failed', level: 3, summary: 'Review timed out', chainStart: true });
  p.chain = { n: 1, by: 'bot', reason: 'PR marked ready for review' }; p.spend += 3.85;
  p.script = { questions: [], findings: [
    F(1, 'worth', 'BadgeLabel truncates without a title, so long labels cannot be read', 'packages/ui/src/components/badge-label/badge-label.tsx', 24, 'confirmed', { scenario: 'A label longer than the node width is cut with an ellipsis. There is no `title` and no tooltip, so the full text is not reachable.', suggestion: 'Set `title={children}` when the content is a string.', before: '<span className={styles.label}>{children}</span>', after: "<span className={styles.label} title={typeof children === 'string' ? children : undefined}>{children}</span>", reason: 'The reproduction renders a 60-character label and finds no accessible full text.', evidence: [EV('packages/ui/src/components/badge-label/badge-label.tsx', 24, '<span className={styles.label}>{children}</span>')], repro: { exit: 0, cmd: 'vitest run .verify/badge-label-title.spec.tsx', out: " FAIL  expected element to have attribute 'title'\n\nexit 0: the bug is reproduced" } }),
    F(2, 'worth', 'Changesets disagree with the declared "SDK minor, UI minor"', '.changeset/node-v2.md', 2, 'confirmed', { scenario: 'The PR description says both packages get a minor. `.changeset/node-v2.md` declares `@workflowbuilder/ui: patch`.', suggestion: 'Change the UI bump to minor.', before: "'@workflowbuilder/ui': patch", after: "'@workflowbuilder/ui': minor", reason: 'The changeset file says patch.', evidence: [EV('.changeset/node-v2.md', 2, "'@workflowbuilder/ui': patch")] }),
    F(3, 'nit', 'Node v2 story still imports the v1 tokens file', 'packages/ui/src/components/node/node.stories.tsx', 6, 'confirmed', { scenario: 'The story imports `tokens-v1.css`, which this PR deletes from the build.', suggestion: 'Import `tokens.css`.', reason: 'The import is still there.', evidence: [EV('packages/ui/src/components/node/node.stories.tsx', 6, "import '../../tokens-v1.css';")] })
  ] };
  p.failed = { stage: 'Review', title: 'Review stage timed out after 30 min', why: 'Very big PRs often do: this one changes 84 files (+4,120 −1,877). This round is not counted.', hint: 'Retry reruns Review and the stages after it, and reuses Checks, Task and Change type. If it times out again, consider splitting the PR.', detail: "stage: review\nattempt: 1 of 1\ntimeout: 1800 s\nsession: 7f3e9a52-0c1b-4e7e-9d1a-52b0c4a1e8d3\nlast event: tool_use Read packages/ui/src/components/node/node-panel/node-panel.tsx (turn 211)\nexit: killed (SIGTERM) after timeout\ncost recorded: $3.85 (usage up to the timeout)" };
  p = P(39, TPL, 'feat(templates): invoice approval with a human gate', 'alek', { files: 6, add: 240, del: 12, level: 1, clickup: 'WB-828', branch: 'feat/invoice-approval', ctype: null }); opened(p, 1.3);
  round(p, 1, 330, { cost: 0.97, dur: 112, summary: '3 findings, no questions', level: 1 });
  p.findings = [
    F(1, 'worth', 'The human gate has no timeout branch', 'templates/invoice-approval/template.json', 88, 'unchecked', { scenario: 'If nobody approves, the workflow waits forever. The other approval templates route to "Escalate" after 48 h.', suggestion: 'Add a timeout edge from the gate to an escalation node.' }),
    F(2, 'worth', 'The amount threshold compares a string to a number', 'templates/invoice-approval/template.json', 54, 'unchecked', { scenario: 'The condition is `amount > 1000`, and `amount` comes from the form as a string, so "900" > 1000 is evaluated by string rules in the runner.', suggestion: 'Set the variable type to number in the form node.' }),
    F(3, 'nit', 'The description says "three steps" and the template has four', 'templates/invoice-approval/README.md', 5, 'unchecked', { scenario: 'The README was written before the notification step was added.', suggestion: 'Say "four steps".' })
  ];

  /* ---------- Ready to merge ---------- */
  p = P(252, WB, 'docs(readme): hero image of a run and the agent-framework paragraph', 'tomek', { files: 3, add: 44, del: 12, clickup: 'WB-764', branch: 'docs/readme-hero', ctype: 'Uses existing parts' }); opened(p, 3.5);
  round(p, 1, 2100, { cost: 0.71, dur: 96, summary: 'no findings' });
  p = P(251, WB, 'docs: align the public pages with the Temporal-first README', 'kasia', { files: 9, add: 212, del: 187, clickup: 'WB-763', branch: 'docs/temporal-first', ctype: 'Uses existing parts' }); opened(p, 3.6);
  round(p, 1, 2000, { cost: 1.08, dur: 131, summary: '2 findings, no questions' });
  p.findings = [
    F(1, 'worth', 'The quick start still links to the removed "Path D" page', 'apps/docs/src/content/docs/get-started/quick-start.md', 41, 'confirmed', { decision: { v: 'implement', by: 'kasia', at: now - 1900 * MIN }, resolved: true, scenario: 'The link returns 404 after this PR.', suggestion: 'Point it to "Run locally".', reason: 'The target file is deleted in this PR.', evidence: [EV('apps/docs/src/content/docs/get-started/quick-start.md', 41, '[Path D](/docs/get-started/path-d/)')] }),
    F(2, 'nit', 'Two pages use "Temporal-first" and one uses "Temporal first"', 'apps/docs/src/content/docs/index.mdx', 12, 'confirmed', { decision: { v: 'reject', by: 'kasia', at: now - 1900 * MIN, reason: 'The heading follows the marketing site on purpose.' }, scenario: 'Spelling differs between pages.', suggestion: 'Use one spelling.', reason: 'Both spellings exist.', evidence: [EV('apps/docs/src/content/docs/index.mdx', 12, '## Temporal first')] })
  ];
  p.timeline.push(T(1900, 'kasia', 'Decided 2 findings: 1 implement, 1 reject'), T(1500, 'kasia', 'Pushed 1 commit (0be77a1) · no review started, a push never starts one', { gh: true }), T(1445, 'hand', 'Review started by hand'));
  round(p, 1, 1440, { cost: 0.89, dur: 104, by: 'hand', reason: 'started by hand', summary: '1 of 1 fixes resolved, nothing new' });
  p = P(278, WB, 'docs(mcp): list readme/temporal/testing in the snapshot table', 'marek', { files: 2, add: 9, del: 1, level: 6, clickup: 'WB-818', branch: 'docs/mcp-snapshot-table', ctype: 'Uses existing parts' }); opened(p, 0.9);
  round(p, 1, 600, { cost: 0.84, dur: 101, summary: '1 finding, no questions' });
  p.findings = [F(1, 'nit', 'The mcp README leaves out `readme/temporal/testing`, which is in the snapshot', 'packages/mcp-server/README.md', 86, 'confirmed', { decision: { v: 'implement', by: 'marek', at: now - 560 * MIN }, resolved: true, opinions: [{ by: 'kasia', v: 'worth', comment: 'Same gap as in #244: the snapshot table and the build drifted apart.', round: 1, at: now - 570 * MIN }], scenario: 'The table lists 11 entries and the build copies 12.', suggestion: 'Add the row.', reason: 'The build script copies the file.', evidence: [EV('packages/mcp-server/scripts/snapshot.ts', 31, "'readme/temporal/testing',")] })];
  p.timeline.push(T(570, 'kasia', "Kasia's review: 1 worth implementing"), T(560, 'marek', 'Decided 1 finding: 1 implement'), T(500, 'marek', 'Pushed 1 commit (4a91f3e) · no review started, a push never starts one', { gh: true }), T(455, 'hand', 'Review started by hand'));
  round(p, 1, 450, { cost: 0.66, dur: 92, by: 'hand', reason: 'started by hand', summary: '1 of 1 fixes resolved, nothing new' });
  p = P(40, TPL, 'fix(templates): typo in the onboarding template description', 'ola', { files: 1, add: 1, del: 1, level: 1, clickup: null, branch: 'fix/onboarding-typo', ctype: null }); opened(p, 0.7);
  round(p, 1, 800, { cost: 0.31, dur: 58, summary: 'no findings', level: 1 });

  /* ---------- Closed in the last days (off the board) ---------- */
  p = P(260, WB, 'fix(sdk): snackbar offset respects the bottom toolbar', 'kasia', { files: 4, add: 52, del: 9, level: 6, clickup: 'WB-775', branch: 'fix/snackbar-offset' }); opened(p, 4, true);
  p.timeline.push(T(3102.3, 'kasia', 'Marked the PR ready for review in GitHub', { gh: true }));
  round(p, 1, 3100, { cost: 1.12, dur: 133, summary: '1 finding, no questions' });
  p.merged = { by: 'kasia', at: now - 1450 * MIN, sha: p.head };
  p.learning = { status: 'done', candidates: 1, cost: 0.07 };
  p.timeline.push(T(1450, 'kasia', 'Squash-merged #260 at ' + p.head), T(1449, 'bot', 'Analyst started: the PR closed at level 6'), T(1448, 'bot', 'Analyst finished: 1 lesson candidate', { cost: 0.07, dur: 41 }));
  p = P(258, WB, 'feat(sdk): experimental minimap themes', 'piotr', { files: 15, add: 480, del: 33, clickup: 'WB-770', branch: 'feat/minimap-themes' }); opened(p, 6);
  round(p, 1, 5000, { cost: 1.36, dur: 149, summary: '4 findings, 1 question' });
  p.closed = { by: 'piotr', at: now - 2900 * MIN };
  p.learning = { status: 'off' };
  p.timeline.push(T(2900, 'piotr', 'Closed the PR in GitHub without merging', { gh: true }));

  const state = {
    v: 4, seededAt: now, prs,
    seedStates: { 281: 'draft', 274: 'never', 253: 'queued', 277: 'running', 270: 'fixcheck', 76: 'questions', 269: 'decide', 264: 'sensitive', 265: 'tofix', 271: 'fixing', 263: 'patch', 268: 'patch', 239: 'newcommits', 250: 'roundsused', 262: 'failed', 252: 'ready', 260: 'merged' },
    factory: { paused: false, pausedBy: null, pauseReason: '', pausedAt: null, budget: 50, spent: 4.76, slots: 2 },
    team: TEAM0.map(t => Object.assign({}, t)),
    models: { reviewer: 'claude-opus-4-5', verifier: 'claude-sonnet-4-5', implementer: 'claude-sonnet-4-5', judge: 'claude-haiku-4-5', analyst: 'claude-sonnet-4-5' },
    defaultLevel: 3,
    levels: {
      1: { brief: 'Read the diff only. Report what is visibly wrong.', maxFindings: 4, maxQuestions: 0, reviewTimeout: 30, models: { reviewer: 'claude-sonnet-4-5' } },
      2: { brief: 'Use the task and the checks to judge intent.', maxFindings: 7, maxQuestions: 3 },
      3: {}, 4: {}, 5: { autofixMax: 2 }, 6: {}
    },
    repos: {
      [WB]: { name: WB, defaultLevel: 3, defaultBranch: 'main', install: 'pnpm install --frozen-lockfile --ignore-scripts', clickupSpace: 'Workflow Builder',
        sensitive: [
          { pattern: 'packages/(sdk|ui|temporal)/src/index.ts', reason: 'Public exports: the published API of a package.' },
          { pattern: 'packages/*/package.json', reason: 'Package manifests of published packages.' },
          { pattern: 'packages/temporal/src/workflow/', reason: 'Temporal workflow code must replay older histories.' },
          { pattern: 'apps/backend/drizzle/', reason: 'Database migrations cannot be undone after deploy.' },
          { pattern: 'deploy/', reason: 'Production deployment files.' },
          { pattern: '.github/workflows/', reason: 'CI and release workflows.' },
          { pattern: 'CLAUDE.md', reason: 'Instructions that agents follow in this repository.' },
          { pattern: '.claude/', reason: 'Agent commands and settings.' }
        ],
        ctypeRules: { existing: 'apps/docs/**, **/*.md, **/*.spec.ts(x), **/*.test.ts(x)', oneWay: 'apps/backend/drizzle/**, packages/*/src/index.ts, deploy/**', sizeLines: 800 } },
      [TPL]: { name: TPL, defaultLevel: 1, defaultBranch: 'main', install: 'pnpm install --frozen-lockfile', clickupSpace: 'Workflow Builder',
        sensitive: [{ pattern: 'template.schema.json', reason: 'Every template is validated against this schema.' }, { pattern: '.github/workflows/', reason: 'CI and release workflows.' }],
        ctypeRules: { existing: '**/*.md', oneWay: 'template.schema.json', sizeLines: 400 } }
    },
    integrations: { ghComment: true, github: { app: 'wb-review-bot', installed: now - 24 * DAY, webhookOk: true, lastDelivery: now - 1.1 * MIN, failed24h: 0 }, clickup: { connected: true, workspace: 'Synergy Codes', keyOwner: 'Alek N.', lastCall: now - 119 * MIN } },
    instructions: INSTR().map(f => { f.versions.forEach(v => { v.at = now + v.at; }); return f; }),
    trials: [
      { id: 't1', pr: 264, level: 3, file: 'review-rules', a: 2, b: 3, status: 'done', at: now - 5.2 * DAY, by: 'hand', costA: 1.21, costB: 1.33, durA: 128, durB: 139, both: ['No test checks that the SDK grid reads `--wb-public-canvas-grid-color`'], onlyA: ['Variable name is long'], onlyB: ['The changeset does not mention the new public CSS variable'] }
    ],
    candidates: [
      { id: 'c1', title: 'Fix at the source, not at the consumer', rule: 'If a PR works around a visual or geometric mismatch with a wrapper or a CSS override in one place of use, check whether the same component from `packages/ui` renders wrongly elsewhere too. If it does, the finding is "fix it in the component".', why: 'In #192 a palette-only override hid a bug that came back in the properties bar two PRs later.', prs: [192], status: 'proposed', at: now - 3 * DAY },
      { id: 'c2', title: 'Snapshot tables must be generated or tested', rule: 'When a README table lists files that a build script copies, ask for a test that compares the table with the script, or for the table to be generated.', why: 'In #244 the docs table and the snapshot build drifted apart; a reviewer caught it by hand.', prs: [244], status: 'proposed', at: now - 2 * DAY },
      { id: 'c3', title: 'Public CSS variables need a default on `:root` and a contract test', rule: 'For every new `--wb-public-*` variable, check that it has a default on `:root` and that one test reads it through the real component, not through a mock.', why: 'Both #260 and #233 added a public variable that nothing read in tests.', prs: [260, 233], status: 'proposed', at: now - 1448 * MIN }
    ],
    lessons: [
      { id: 'l1', title: 'Changesets must match the declared bump', by: 'alek', at: now - 8 * DAY, prs: [201, 218], version: 1 },
      { id: 'l2', title: 'A guard test must fail without the change', by: 'tomek', at: now - 3 * DAY, prs: [229, 236, 241], version: 2 }
    ],
    analyses: [
      { pr: 260, title: 'fix(sdk): snackbar offset respects the bottom toolbar', closed: 'merged', at: now - 1448 * MIN, status: 'done', cost: 0.07, result: '1 lesson candidate', by: 'bot' },
      { pr: 258, title: 'feat(sdk): experimental minimap themes', closed: 'closed', at: now - 2900 * MIN, status: 'none', cost: 0, result: 'Not analysed: level 3 has no learning', by: null },
      { pr: 244, title: 'docs(mcp): describe the docs snapshot', closed: 'merged', at: now - 2 * DAY, status: 'done', cost: 0.07, result: '1 lesson candidate', by: 'hand' }
    ],
    audit: [
      { at: now - 26 * MIN, actor: 'tomek', area: 'Budget & status', text: 'Resumed the factory', diff: [{ k: 'Status', from: 'Paused: deploy of the docs site', to: 'Running' }] },
      { at: now - 58 * MIN, actor: 'tomek', area: 'Budget & status', text: 'Paused the factory', diff: [{ k: 'Status', from: 'Running', to: 'Paused: deploy of the docs site' }] },
      { at: now - 1448 * MIN, actor: 'bot', area: 'Learning', text: 'Analyst proposed 1 lesson candidate from #260', diff: [{ k: 'Candidates', from: '2', to: '3' }] },
      { at: now - 2 * DAY, actor: 'kasia', area: 'Repositories', text: 'Added a sensitive file pattern in workflowbuilder', diff: [{ k: 'Sensitive files', from: '7 patterns', to: '8 patterns: + .claude/' }] },
      { at: now - 3 * DAY, actor: 'tomek', area: 'Learning', text: 'Accepted the lesson "A guard test must fail without the change"', diff: [{ k: 'lessons.md', from: 'version 1', to: 'version 2' }] },
      { at: now - 4 * DAY, actor: 'alek', area: 'Review levels', text: 'Changed the default level', diff: [{ k: 'Default level', from: '1 · Diff only', to: '3 · Verified' }] },
      { at: now - 5 * DAY, actor: 'alek', area: 'Instructions', text: 'Activated review-rules.md version 3', diff: [{ k: 'review-rules.md', from: 'version 2', to: 'version 3: Flag public API changes without a changeset' }] },
      { at: now - 6 * DAY, actor: 'kasia', area: 'Instructions', text: 'Activated repo-knowledge.md version 2', diff: [{ k: 'repo-knowledge.md', from: 'version 1', to: 'version 2: Temporal replay contract' }] },
      { at: now - 7 * DAY, actor: 'alek', area: 'Models', text: 'Changed the verifier model', diff: [{ k: 'Verifier', from: 'claude-opus-4-5', to: 'claude-sonnet-4-5' }] },
      { at: now - 9 * DAY, actor: 'piotr', area: 'Team', text: 'Added Marek to the team', diff: [{ k: 'Team', from: '5 people', to: '6 people: + Marek (marek-dab)' }] },
      { at: now - 11 * DAY, actor: 'alek', area: 'Budget & status', text: 'Changed the daily budget', diff: [{ k: 'Daily budget', from: '$30.00', to: '$50.00' }] }
    ],
    jobs: [], activity: [
      { id: 'r264-1', pr: 264, what: 'Round 1', by: 'bot', at: now - 410 * MIN, cost: 1.33, dur: 139, status: 'done' },
      { id: 'r263-1', pr: 263, what: 'Round 1', by: 'bot', at: now - 300 * MIN, cost: 1.38, dur: 158, status: 'done' },
      { id: 'r268-1', pr: 268, what: 'Round 1', by: 'bot', at: now - 240 * MIN, cost: 1.26, dur: 147, status: 'done' },
      { id: 'r269-2', pr: 269, what: 'Round 1', by: 'hand', at: now - 210 * MIN, cost: 1.33, dur: 162, status: 'done' }
    ]
  };
  /* Seeded live runs: slow pace so the board keeps these states for a few minutes. */
  S = state;
  startRun(prs[277], 'review', { by: 'bot', reason: 'PR marked ready for review', speed: 40, ago: 240000, silent: true });
  startRun(prs[270], 'fixcheck', { by: 'bot', reason: 'after fix 9c41d07', speed: 40, ago: 200000, silent: true });
  startRun(prs[271], 'fix', { by: 'marek', speed: 40, ago: 160000, silent: true });
  startRun(prs[253], 'review', { by: 'bot', reason: 'PR marked ready for review', silent: true, waitFor: [277, 270] });
  return state;
}
