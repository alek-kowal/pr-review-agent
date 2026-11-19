import { Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import { copy } from '@/copy/index.ts';
import type { PipelineStageKey, PipelineStageView } from '@/lib/api-types.ts';
import { cn } from '@/lib/utils.ts';

const t = copy.pipeline;

const NODE_WIDTH = 150;
const NODE_HEIGHT = 56;

/** Where each stage sits: the round on the top row, Implement and after it below. */
const POSITIONS: Record<PipelineStageKey, { x: number; y: number }> = {
  checks: { x: 0, y: 0 },
  task: { x: 180, y: 0 },
  change_type: { x: 360, y: 0 },
  review: { x: 540, y: 0 },
  verify: { x: 720, y: 0 },
  implement: { x: 360, y: 110 },
  fix_check: { x: 540, y: 110 },
  analyst: { x: 720, y: 110 },
};

const EDGES: [PipelineStageKey, PipelineStageKey][] = [
  ['checks', 'task'],
  ['task', 'change_type'],
  ['change_type', 'review'],
  ['review', 'verify'],
  ['verify', 'implement'],
  ['implement', 'fix_check'],
];

type StageData = { stage: PipelineStageView; selected: boolean; onPick: (key: string) => void };
type StageNode = Node<StageData, 'stage'>;

/** One stage: a button, so a click or Enter on it opens the stage's Sheet. */
function StageNodeView({ data }: NodeProps<StageNode>) {
  const { stage, selected, onPick } = data;
  const label = t.stages[stage.key] ?? stage.key;
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button
        type="button"
        aria-label={t.node(label, stage.onFrom)}
        aria-pressed={selected}
        onClick={() => onPick(stage.key)}
        // React Flow turns pointer events off on a node that is neither draggable nor selectable.
        style={{ pointerEvents: 'all' }}
        className={cn(
          'flex h-14 w-[150px] flex-col items-start justify-center rounded-md border bg-surface px-3 text-left shadow-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
          selected ? 'border-brand' : 'border-border hover:border-text-3',
        )}
      >
        <span className="flex w-full items-center justify-between gap-2 text-sm font-medium">
          {label}
          <span className="rounded bg-surface-2 px-1.5 text-[11px] text-text-2">
            {t.nodeLevel(stage.onFrom)}
          </span>
        </span>
        <span className="truncate text-xs text-text-3">
          {stage.role ? (stage.model?.model ?? stage.role) : t.runsAs.code}
        </span>
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

const NODE_TYPES = { stage: StageNodeView };

/**
 * The read-only pipeline diagram (S-22-T10): no dragging, connecting, selecting or deleting.
 * Each node is a button labelled with the level where the stage turns on.
 */
export function PipelineDiagram({
  stages,
  selected,
  onPick,
}: {
  stages: readonly PipelineStageView[];
  selected: string | null;
  onPick: (key: string) => void;
}) {
  const nodes = useMemo<StageNode[]>(
    () =>
      stages.map((stage) => ({
        id: stage.key,
        type: 'stage',
        position: POSITIONS[stage.key] ?? { x: 0, y: 0 },
        // Fixed size, so the nodes show before React Flow measures them.
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        data: { stage, selected: stage.key === selected, onPick },
      })),
    [stages, selected, onPick],
  );
  const edges = useMemo<Edge[]>(() => {
    const present = new Set(stages.map((s) => s.key));
    return EDGES.filter(([a, b]) => present.has(a) && present.has(b)).map(([a, b]) => ({
      id: `${a}-${b}`,
      source: a,
      target: b,
    }));
  }, [stages]);

  return (
    <div className="h-64 w-full" role="group" aria-label={t.diagramLabel}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        fitView
        // The attribution link's own grey (#999) is below AA in both themes; `!` beats React
        // Flow's unlayered stylesheet.
        className="[&_.react-flow\_\_attribution_a]:text-text-3!"
      />
    </div>
  );
}
