<script lang="ts">
  import {
    Background,
    SvelteFlow,
    type Connection,
    type Edge,
    type Node,
    type NodeTypes,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import { BLOCK_LIBRARY, type FbdGraph } from '@bas/core';
  import {
    getProgram,
    programStore,
    setProgramGraph,
    closeFbd,
  } from '../cli/programStore.svelte';
  import FBDNode from './FBDNode.svelte';

  const nodeTypes: NodeTypes = { fbd: FBDNode };

  // Local SvelteFlow state — separate from the topology canvas's state.
  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let dirty = $state(false);
  let compileMsg = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  let nextId = 0;
  let loadedFor = $state<string | null>(null);

  // Hydrate from the active controller's stored graph when the active id
  // CHANGES. Tracking `loadedFor` guards against the effect re-running on
  // every internal SvelteFlow node-position mutation.
  $effect(() => {
    const id = programStore.activeFbdControllerId;
    if (!id || id === loadedFor) return;
    loadedFor = id;
    const existing = getProgram(id)?.fbdGraph;
    if (existing) {
      const { fbdNodes, fbdEdges, maxId } = graphToFlow(existing);
      nodes = fbdNodes;
      edges = fbdEdges;
      nextId = maxId + 1;
    } else {
      // Seed with a minimal scaffold so the canvas isn't blank.
      const seeded = [
        node('INPUT', { x: 60, y: 80 }, { source: 'sensed' }),
        node('INPUT', { x: 60, y: 200 }, { source: 'setpoint' }),
        node('SUB', { x: 280, y: 140 }),
        node('PID', { x: 460, y: 140 }, { Kp: 0.3, Ki: 0.001, Kd: 0 }),
        node('OUTPUT', { x: 680, y: 140 }, { target: 'actuator' }),
      ];
      nodes = seeded;
      edges = [
        flowEdge(seeded[0].id, 'q', seeded[2].id, 'a'),
        flowEdge(seeded[1].id, 'q', seeded[2].id, 'b'),
        flowEdge(seeded[2].id, 'q', seeded[3].id, 'error'),
        flowEdge(seeded[3].id, 'q', seeded[4].id, 'in'),
      ];
    }
    dirty = false;
    compileMsg = null;
  });

  function node(
    blockType: string,
    position: { x: number; y: number },
    params: Record<string, number | string | boolean> = {},
  ): Node {
    const id = `n${nextId++}`;
    return { id, type: 'fbd', position, data: { blockType, params } };
  }

  function flowEdge(sourceId: string, sourceHandle: string, targetId: string, targetHandle: string): Edge {
    return {
      id: `e${sourceId}-${sourceHandle}->${targetId}-${targetHandle}`,
      source: sourceId,
      sourceHandle,
      target: targetId,
      targetHandle,
    };
  }

  function onConnect(connection: Connection): void {
    if (!connection.source || !connection.target) return;
    const next = [
      ...edges,
      flowEdge(
        connection.source,
        connection.sourceHandle ?? 'q',
        connection.target,
        connection.targetHandle ?? 'in',
      ),
    ];
    edges = next;
    dirty = true;
  }

  function onPaletteDragStart(event: DragEvent, blockType: string): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('application/bas-fbd-block', blockType);
    event.dataTransfer.effectAllowed = 'move';
  }

  function onCanvasDrop(event: DragEvent): void {
    event.preventDefault();
    const blockType = event.dataTransfer?.getData('application/bas-fbd-block');
    if (!blockType || !(blockType in BLOCK_LIBRARY)) return;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const viewport = target.querySelector('.svelte-flow__viewport') as HTMLElement | null;
    let tx = 0, ty = 0, zoom = 1;
    if (viewport) {
      const m = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
      tx = m.e; ty = m.f; zoom = m.a || 1;
    }
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const position = { x: (screenX - tx) / zoom - 50, y: (screenY - ty) / zoom - 25 };
    nodes = [...nodes, node(blockType, position, defaultParams(blockType))];
    dirty = true;
  }

  function onCanvasDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function defaultParams(blockType: string): Record<string, number | string | boolean> {
    const def = BLOCK_LIBRARY[blockType];
    const out: Record<string, number | string | boolean> = {};
    if (!def?.params) return out;
    for (const p of def.params) out[p.name] = p.default;
    return out;
  }

  function compileAndSave(): void {
    const id = programStore.activeFbdControllerId;
    if (!id) return;
    const graph = flowToGraph();
    const prog = setProgramGraph(id, graph);
    if (prog.error) {
      compileMsg = { kind: 'error', text: prog.error };
    } else {
      compileMsg = { kind: 'ok', text: `compiled · ${prog.source.split('\n').length} lines` };
      dirty = false;
    }
  }

  function flowToGraph(): FbdGraph {
    return {
      nodes: nodes.map((n) => {
        const d = n.data as { blockType: string; params?: Record<string, number | string | boolean> };
        return { id: n.id, blockType: d.blockType, params: d.params };
      }),
      edges: edges.map((e) => ({
        from: { nodeId: e.source, port: e.sourceHandle ?? 'q' },
        to: { nodeId: e.target, port: e.targetHandle ?? 'in' },
      })),
    };
  }

  function graphToFlow(g: FbdGraph): { fbdNodes: Node[]; fbdEdges: Edge[]; maxId: number } {
    const fbdNodes: Node[] = [];
    let maxId = -1;
    for (const n of g.nodes) {
      const numericId = parseInt(n.id.replace(/^n/, ''), 10);
      if (Number.isFinite(numericId) && numericId > maxId) maxId = numericId;
      fbdNodes.push({
        id: n.id,
        type: 'fbd',
        position: positionForReimport(n.id, fbdNodes.length),
        data: { blockType: n.blockType, params: n.params },
      });
    }
    const fbdEdges: Edge[] = g.edges.map((e) =>
      flowEdge(e.from.nodeId, e.from.port, e.to.nodeId, e.to.port),
    );
    return { fbdNodes, fbdEdges, maxId };
  }

  function positionForReimport(_id: string, idx: number): { x: number; y: number } {
    // Lay out re-imported graphs in a left-to-right grid until we add proper layout persistence.
    return { x: 80 + (idx % 5) * 180, y: 80 + Math.floor(idx / 5) * 120 };
  }

  // Group the block library by category for the palette
  const paletteGroups = $derived.by(() => {
    const groups = new Map<string, { id: string; displayName: string }[]>();
    for (const def of Object.values(BLOCK_LIBRARY)) {
      if (!groups.has(def.category)) groups.set(def.category, []);
      groups.get(def.category)!.push({ id: def.id, displayName: def.displayName });
    }
    return Array.from(groups.entries()).map(([cat, items]) => ({ cat, items }));
  });

  function onClose(): void {
    closeFbd();
  }
</script>

<div class="fbd-panel" role="dialog" aria-label="Block diagram editor">
  <header class="fbd-head">
    <div class="title-row">
      <span class="dot"></span>
      <strong>{programStore.activeFbdControllerLabel ?? 'CTRL'}</strong>
      <span class="muted">— block diagram</span>
      {#if dirty}<span class="dirty">●</span>{/if}
    </div>
    <div class="actions">
      <button type="button" class="primary" onclick={compileAndSave}>
        Compile &amp; save
      </button>
      <button type="button" class="close-btn" onclick={onClose} title="Close (Esc)">✕</button>
    </div>
  </header>

  <div class="fbd-body">
    <aside class="palette" aria-label="Block palette">
      {#each paletteGroups as group (group.cat)}
        <div class="cat">
          <h4>{group.cat}</h4>
          <ul>
            {#each group.items as item (item.id)}
              <li
                draggable="true"
                ondragstart={(e) => onPaletteDragStart(e, item.id)}
                title={BLOCK_LIBRARY[item.id]?.description}
              >
                {item.displayName}
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </aside>

    <div class="canvas-wrap" role="region" aria-label="Block diagram canvas" ondragover={onCanvasDragOver} ondrop={onCanvasDrop}>
      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        onconnect={onConnect}
        fitView
        deleteKey={['Backspace', 'Delete']}
      >
        <Background />
      </SvelteFlow>
    </div>
  </div>

  {#if compileMsg}
    <div class="status status-{compileMsg.kind}">
      {compileMsg.kind === 'ok' ? '✓' : '%'} {compileMsg.text}
    </div>
  {/if}
</div>

<style>
  .fbd-panel {
    position: absolute;
    inset: 1rem;
    z-index: 60;
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, Canvas 96%, CanvasText 3%);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .fbd-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.85rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    background: color-mix(in srgb, Canvas 88%, CanvasText 6%);
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.88rem;
  }

  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: #2ecc71;
    box-shadow: 0 0 6px #2ecc7180;
  }

  .muted {
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-weight: normal;
  }

  .dirty {
    color: #f39c12;
    font-size: 1.1rem;
    line-height: 1;
  }

  .actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }

  .primary {
    background: #4a9eff;
    border: 0;
    color: white;
    padding: 0.3rem 0.75rem;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .primary:hover:not(:disabled) {
    background: color-mix(in srgb, #4a9eff 88%, Canvas);
  }

  .primary:disabled {
    background: color-mix(in srgb, #4a9eff 40%, Canvas);
    cursor: default;
  }

  .close-btn {
    background: transparent;
    border: 0;
    color: CanvasText;
    font-size: 1rem;
    cursor: pointer;
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: color-mix(in srgb, CanvasText 8%, transparent);
  }

  .fbd-body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .palette {
    width: 11rem;
    flex-shrink: 0;
    border-right: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    padding: 0.55rem;
    overflow-y: auto;
    background: color-mix(in srgb, Canvas 92%, CanvasText 4%);
  }

  .palette h4 {
    margin: 0.55rem 0 0.25rem 0;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }

  .palette h4:first-child {
    margin-top: 0;
  }

  .palette ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .palette li {
    background: color-mix(in srgb, Canvas 95%, CanvasText 5%);
    border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    cursor: grab;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .palette li:hover {
    background: color-mix(in srgb, CanvasText 8%, Canvas);
  }

  .palette li:active {
    cursor: grabbing;
  }

  .canvas-wrap {
    flex: 1;
    min-width: 0;
    position: relative;
  }

  .status {
    padding: 0.35rem 0.85rem;
    font-size: 0.78rem;
    border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
  }

  .status-ok {
    background: color-mix(in srgb, #2ecc71 14%, transparent);
    color: color-mix(in srgb, #2ecc71 90%, CanvasText);
  }

  .status-error {
    background: color-mix(in srgb, #e74c3c 14%, transparent);
    color: color-mix(in srgb, #e74c3c 90%, CanvasText);
  }
</style>
