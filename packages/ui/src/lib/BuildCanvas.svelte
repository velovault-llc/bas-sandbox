<script lang="ts">
  import {
    Background,
    Controls,
    MiniMap,
    Panel,
    SvelteFlow,
    SvelteFlowProvider,
    type Edge,
    type Node,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import BasNode from './BasNode.svelte';

  const nodeTypes = { bas: BasNode };

  type Kind = 'supervisor' | 'controller' | 'sensor' | 'safety';

  type PaletteItem = {
    kind: Kind;
    label: string;
    defaultName: string;
    icon: string;
    description: string;
  };

  const PALETTE: PaletteItem[] = [
    {
      kind: 'supervisor',
      label: 'Engine / Supervisor',
      defaultName: 'NAE-1',
      icon: '◉',
      description:
        'Engine / supervisor (NAE/NCE/SNE). Top of the network — holds the site database and routes traffic.',
    },
    {
      kind: 'controller',
      label: 'Controller',
      defaultName: 'FEC-1',
      icon: '◈',
      description: 'Field or zone controller (FEC/FAC/VMA/VAV). Runs equipment logic, downstream of a supervisor.',
    },
    {
      kind: 'sensor',
      label: 'Sensor',
      defaultName: 'ZN-T-1',
      icon: '◇',
      description: 'Zone temp, supply temp, pressure, flow, etc. Hardwired input to a controller.',
    },
    {
      kind: 'safety',
      label: 'Safety',
      defaultName: 'FZ-1',
      icon: '⚠',
      description: 'Freezestat, high-static cutout, smoke detector, etc. Hardwired safety device.',
    },
  ];

  let nodes = $state.raw<Node[]>([
    {
      id: 'demo-1',
      type: 'bas',
      position: { x: 280, y: 60 },
      data: { kind: 'supervisor', label: 'NAE-1' },
    },
    {
      id: 'demo-2',
      type: 'bas',
      position: { x: 280, y: 210 },
      data: { kind: 'controller', label: 'FEC-1' },
    },
    {
      id: 'demo-3',
      type: 'bas',
      position: { x: 70, y: 360 },
      data: { kind: 'controller', label: 'VAV-1' },
    },
    {
      id: 'demo-4',
      type: 'bas',
      position: { x: 290, y: 360 },
      data: { kind: 'sensor', label: 'ZN-T-1' },
    },
    {
      id: 'demo-5',
      type: 'bas',
      position: { x: 510, y: 360 },
      data: { kind: 'safety', label: 'FZ-1' },
    },
  ]);

  let edges = $state.raw<Edge[]>([
    { id: 'e1-2', source: 'demo-1', target: 'demo-2' },
    { id: 'e2-3', source: 'demo-2', target: 'demo-3' },
    { id: 'e2-4', source: 'demo-2', target: 'demo-4' },
    { id: 'e2-5', source: 'demo-2', target: 'demo-5' },
  ]);

  // Per-kind counter so default names auto-increment ("VAV-1", "VAV-2", ...).
  // Pre-seeded to match the demo topology placed above.
  const counters: Record<string, number> = {
    supervisor: 1,
    controller: 2,
    sensor: 1,
    safety: 1,
  };

  function nextName(kind: Kind): string {
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
    const kind = event.dataTransfer?.getData('application/bas-node-kind') as Kind | undefined;
    if (!kind) return;
    const item = PALETTE.find((p) => p.kind === kind);
    if (!item) return;

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

  // ============ Sim loop ============

  let running = $state(false);
  let tick = $state(0);
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const TICK_MS = 1000;

  function tempReading(): string {
    return `${(65 + Math.random() * 15).toFixed(1)} °F`;
  }

  function pressureReading(): string {
    return `${(0.2 + Math.random() * 1.8).toFixed(2)} in WC`;
  }

  function controllerReading(): string {
    const damper = Math.floor(Math.random() * 100);
    return `Out ${damper}%`;
  }

  function sensorValue(label: string): string {
    // Crude heuristic: labels containing P / "Press" / "PS" hint at pressure
    if (/(^|[-_ ])(p|ps|press)([-_ ]|$)/i.test(label)) return pressureReading();
    return tempReading();
  }

  function safetyValue(label: string): { value: string; status: 'idle' | 'tripped' } {
    // 96% OK, 4% TRIPPED — adds occasional drama in the demo
    if (Math.random() < 0.04) return { value: `⚠ ${label} TRIPPED`, status: 'tripped' };
    return { value: '✓ OK', status: 'idle' };
  }

  function tickOnce() {
    tick++;
    nodes = nodes.map((n) => {
      const data = n.data as { kind: Kind; label: string; runtime?: unknown };
      let value: string;
      let status: 'idle' | 'polling' | 'responded' | 'tripped' = 'responded';
      switch (data.kind) {
        case 'supervisor':
          value = `uptime t=${tick}s`;
          status = 'idle';
          break;
        case 'controller':
          value = controllerReading();
          status = 'polling';
          break;
        case 'sensor':
          value = sensorValue(data.label);
          break;
        case 'safety': {
          const s = safetyValue(data.label);
          value = s.value;
          status = s.status;
          break;
        }
        default:
          value = 'idle';
      }
      return {
        ...n,
        data: { ...data, runtime: { value, status } },
      };
    });
  }

  function start() {
    if (running) return;
    running = true;
    edges = edges.map((e) => ({ ...e, animated: true }));
    tickOnce();
    intervalId = setInterval(tickOnce, TICK_MS);
  }

  function stop() {
    running = false;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    edges = edges.map((e) => ({ ...e, animated: false }));
  }

  function resetSim() {
    stop();
    tick = 0;
    nodes = nodes.map((n) => {
      const data = n.data as Record<string, unknown>;
      const { runtime: _runtime, ...rest } = data;
      return { ...n, data: rest };
    });
  }

  function clearAll() {
    if (!confirm('Clear all nodes and connections?')) return;
    stop();
    tick = 0;
    nodes = [];
    edges = [];
    for (const k of Object.keys(counters)) counters[k] = 0;
  }

  // Auto-cleanup
  $effect(() => {
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  });
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
        <Panel position="top-right">
          <div class="sim-panel">
            {#if !running}
              <button type="button" class="run" onclick={start} disabled={nodes.length === 0}>
                ▶ Run
              </button>
            {:else}
              <button type="button" class="stop" onclick={stop}> ■ Stop </button>
            {/if}
            <button
              type="button"
              class="reset-sim"
              onclick={resetSim}
              disabled={tick === 0 && !running}
            >
              Reset
            </button>
            <span class="tick">t = {tick}s</span>
          </div>
        </Panel>
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
  .item.kind-controller {
    --accent: #9c8cff;
  }
  .item.kind-sensor {
    --accent: #f39c12;
  }
  .item.kind-safety {
    --accent: #e74c3c;
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

  :global(.flow .svelte-flow__background) {
    background: Canvas;
  }

  .sim-panel {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    background: color-mix(in srgb, Canvas 90%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
    font-size: 0.82rem;
  }

  .sim-panel button {
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: Canvas;
    color: CanvasText;
    font: inherit;
    font-size: 0.82rem;
    padding: 0.25rem 0.7rem;
    border-radius: 4px;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }

  .sim-panel button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .sim-panel button.run {
    border-color: #2ecc71;
    color: #2ecc71;
  }

  .sim-panel button.run:hover:not(:disabled) {
    background: color-mix(in srgb, #2ecc71 12%, Canvas);
  }

  .sim-panel button.stop {
    border-color: #e74c3c;
    color: #e74c3c;
  }

  .sim-panel button.stop:hover:not(:disabled) {
    background: color-mix(in srgb, #e74c3c 12%, Canvas);
  }

  .sim-panel .tick {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-variant-numeric: tabular-nums;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    padding: 0 0.25rem;
  }
</style>
