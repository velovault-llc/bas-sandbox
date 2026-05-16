<script lang="ts">
  import {
    Background,
    Controls,
    MiniMap,
    SvelteFlow,
    SvelteFlowProvider,
    type Edge,
    type Node,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import BasNode from './BasNode.svelte';

  const nodeTypes = { bas: BasNode };

  type PaletteItem = {
    kind: 'supervisor' | 'field-controller' | 'unitary-controller' | 'sensor';
    label: string;
    defaultName: string;
    icon: string;
    description: string;
  };

  const PALETTE: PaletteItem[] = [
    {
      kind: 'supervisor',
      label: 'Supervisor',
      defaultName: 'NAE-1',
      icon: '◉',
      description:
        'Network Automation Engine (NAE/NCE/SNE). Hosts the site database and routes traffic.',
    },
    {
      kind: 'field-controller',
      label: 'Field Controller',
      defaultName: 'FEC-1',
      icon: '◈',
      description:
        'Field Equipment Controller (FEC/FAC). Sits on a field bus, runs equipment logic.',
    },
    {
      kind: 'unitary-controller',
      label: 'Unitary Controller',
      defaultName: 'VAV-1',
      icon: '▢',
      description: 'Zone-level controller (VMA/VAV/UNT). Drives one piece of unitary equipment.',
    },
    {
      kind: 'sensor',
      label: 'Sensor',
      defaultName: 'ZN-T-1',
      icon: '◇',
      description: 'Hard-wired sensor (zone temp, supply temp, pressure, flow, etc.).',
    },
  ];

  let nodes = $state.raw<Node[]>([
    {
      id: 'demo-1',
      type: 'bas',
      position: { x: 240, y: 60 },
      data: { kind: 'supervisor', label: 'NAE-1' },
    },
    {
      id: 'demo-2',
      type: 'bas',
      position: { x: 240, y: 200 },
      data: { kind: 'field-controller', label: 'FEC-1' },
    },
    {
      id: 'demo-3',
      type: 'bas',
      position: { x: 100, y: 340 },
      data: { kind: 'unitary-controller', label: 'VAV-1' },
    },
    {
      id: 'demo-4',
      type: 'bas',
      position: { x: 380, y: 340 },
      data: { kind: 'unitary-controller', label: 'VAV-2' },
    },
  ]);

  let edges = $state.raw<Edge[]>([
    { id: 'e1-2', source: 'demo-1', target: 'demo-2' },
    { id: 'e2-3', source: 'demo-2', target: 'demo-3' },
    { id: 'e2-4', source: 'demo-2', target: 'demo-4' },
  ]);

  // Per-kind counter so default names auto-increment ("VAV-1", "VAV-2", ...).
  // Pre-seeded to match the demo nodes placed in the initial `nodes` state.
  const counters: Record<string, number> = {
    supervisor: 1,
    'field-controller': 1,
    'unitary-controller': 2,
    sensor: 0,
  };

  function nextName(kind: PaletteItem['kind']): string {
    const item = PALETTE.find((p) => p.kind === kind);
    if (!item) return kind;
    const stem = item.defaultName.replace(/-\d+$/, '');
    counters[kind] = (counters[kind] ?? 0) + 1;
    return `${stem}-${counters[kind]}`;
  }

  let nextId = 100;

  function onPaletteDragStart(event: DragEvent, kind: string) {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('application/bas-node-kind', kind);
    event.dataTransfer.effectAllowed = 'move';
  }

  function onCanvasDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function onCanvasDrop(event: DragEvent) {
    event.preventDefault();
    const kind = event.dataTransfer?.getData('application/bas-node-kind');
    if (!kind) return;
    const item = PALETTE.find((p) => p.kind === kind);
    if (!item) return;

    // Position relative to the flow container; close enough for v0.1 without
    // accounting for current pan/zoom. The Controls panel lets users re-pan.
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const position = {
      x: event.clientX - rect.left - 80,
      y: event.clientY - rect.top - 25,
    };

    const id = `n${nextId++}`;
    nodes = [
      ...nodes,
      {
        id,
        type: 'bas',
        position,
        data: { kind: item.kind, label: nextName(item.kind) },
      },
    ];
  }

  function clearAll() {
    if (!confirm('Clear all nodes and connections?')) return;
    nodes = [];
    edges = [];
    for (const k of Object.keys(counters)) counters[k] = 0;
  }
</script>

<div class="build">
  <SvelteFlowProvider>
    <aside class="palette">
      <div class="palette-head">
        <h3>Equipment</h3>
        <p class="hint">Drag onto canvas. Wire by dragging between handles.</p>
      </div>
      <ul class="items">
        {#each PALETTE as item (item.kind)}
          <li
            class="item kind-{item.kind}"
            draggable="true"
            ondragstart={(e) => onPaletteDragStart(e, item.kind)}
            title={item.description}
          >
            <span class="icon">{item.icon}</span>
            <div class="text">
              <strong>{item.label}</strong>
              <span class="ex">e.g. {item.defaultName}</span>
            </div>
          </li>
        {/each}
      </ul>

      <div class="palette-foot">
        <button type="button" class="clear" onclick={clearAll}>Clear canvas</button>
        <p class="meta">{nodes.length} nodes · {edges.length} wires</p>
      </div>
    </aside>

    <div
      class="flow"
      role="region"
      aria-label="Topology canvas"
      ondrop={onCanvasDrop}
      ondragover={onCanvasDragOver}
    >
      <SvelteFlow bind:nodes bind:edges {nodeTypes} fitView>
        <Background />
        <Controls />
        <MiniMap zoomable pannable />
      </SvelteFlow>
    </div>
  </SvelteFlowProvider>
</div>

<style>
  .build {
    display: grid;
    grid-template-columns: 16rem 1fr;
    height: 72vh;
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    border-radius: 6px;
    overflow: hidden;
    background: Canvas;
  }

  .palette {
    border-right: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    padding: 0.85rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .palette-head h3 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    margin: 0 0 0.35rem 0;
  }

  .hint {
    font-size: 0.78rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    margin: 0 0 0.75rem 0;
    line-height: 1.35;
  }

  .items {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .item {
    --accent: #888;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.5rem 0.6rem;
    background: color-mix(in srgb, var(--accent) 8%, Canvas);
    border: 1.5px solid var(--accent);
    border-radius: 5px;
    cursor: grab;
    user-select: none;
  }

  .item:active {
    cursor: grabbing;
  }

  .item .icon {
    font-size: 1.1rem;
    color: var(--accent);
    line-height: 1;
  }

  .item .text {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }

  .item strong {
    font-size: 0.83rem;
    font-weight: 500;
  }

  .item .ex {
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .item.kind-supervisor {
    --accent: #4a9eff;
  }
  .item.kind-field-controller {
    --accent: #9c8cff;
  }
  .item.kind-unitary-controller {
    --accent: #2ecc71;
  }
  .item.kind-sensor {
    --accent: #f39c12;
  }

  .palette-foot {
    margin-top: auto;
    padding-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .clear {
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.78rem;
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
  }

  .clear:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
  }

  .meta {
    font-size: 0.72rem;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .flow {
    position: relative;
  }

  /* xyflow renders fine in both light and dark; tweak the background dots */
  :global(.flow .svelte-flow__background) {
    background: Canvas;
  }
</style>
