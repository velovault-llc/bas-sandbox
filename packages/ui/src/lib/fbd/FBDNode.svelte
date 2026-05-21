<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { BLOCK_LIBRARY } from '@bas/core';

  // Each FBD node carries: blockType (key into BLOCK_LIBRARY) + params (instance config).
  type FbdNodeData = {
    blockType: string;
    params?: Record<string, number | string | boolean>;
  };

  let { data }: NodeProps & { data: FbdNodeData } = $props();

  const def = $derived(BLOCK_LIBRARY[data.blockType]);
  const inputs = $derived(def?.inputs ?? []);
  const outputs = $derived(def?.outputs ?? []);

  function paramSummary(): string {
    if (!def?.params || !data.params) return '';
    const parts: string[] = [];
    for (const p of def.params) {
      const v = data.params[p.name];
      if (v !== undefined) parts.push(`${p.name}=${v}`);
    }
    return parts.join(' · ');
  }

  const summary = $derived(paramSummary());
</script>

<div class="fbd-node category-{def?.category ?? 'unknown'}" title={def?.description}>
  {#each inputs as port, i (port.name)}
    {@const top = inputs.length === 1 ? 50 : 22 + i * (60 / Math.max(1, inputs.length - 1))}
    <Handle
      type="target"
      position={Position.Left}
      id={port.name}
      style="top: {top}%;"
      class="handle-{port.type}"
    />
    <span class="port-label port-in" style:top="{top}%">{port.label ?? port.name}</span>
  {/each}

  <div class="node-body">
    <div class="node-title">{def?.displayName ?? data.blockType}</div>
    {#if summary}
      <div class="node-params">{summary}</div>
    {/if}
  </div>

  {#each outputs as port, i (port.name)}
    {@const top = outputs.length === 1 ? 50 : 22 + i * (60 / Math.max(1, outputs.length - 1))}
    <Handle
      type="source"
      position={Position.Right}
      id={port.name}
      style="top: {top}%;"
      class="handle-{port.type}"
    />
    <span class="port-label port-out" style:top="{top}%">{port.label ?? port.name}</span>
  {/each}
</div>

<style>
  .fbd-node {
    position: relative;
    min-width: 7rem;
    min-height: 3.2rem;
    border: 1.5px solid color-mix(in srgb, CanvasText 30%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, Canvas 92%, CanvasText 4%);
    color: CanvasText;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.78rem;
    padding: 0.4rem 0.75rem;
  }

  .fbd-node.category-io {
    border-color: #4a9eff;
  }
  .fbd-node.category-math {
    border-color: #f39c12;
  }
  .fbd-node.category-logic {
    border-color: #9b59b6;
  }
  .fbd-node.category-compare {
    border-color: #16a085;
  }
  .fbd-node.category-select {
    border-color: #e67e22;
  }
  .fbd-node.category-loop {
    border-color: #2ecc71;
  }

  .node-body {
    text-align: center;
  }

  .node-title {
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: 0.78rem;
  }

  .node-params {
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    margin-top: 0.15rem;
  }

  .port-label {
    position: absolute;
    font-size: 0.6rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    pointer-events: none;
    transform: translateY(-50%);
  }

  .port-in {
    left: 0.45rem;
  }

  .port-out {
    right: 0.45rem;
  }

  :global(.fbd-node .svelte-flow__handle) {
    width: 10px;
    height: 10px;
    border: 1.5px solid color-mix(in srgb, CanvasText 40%, transparent);
    background: Canvas;
  }

  :global(.fbd-node .svelte-flow__handle.handle-bool) {
    border-radius: 2px;
    background: color-mix(in srgb, #9b59b6 30%, Canvas);
  }

  :global(.fbd-node .svelte-flow__handle.handle-real),
  :global(.fbd-node .svelte-flow__handle.handle-int) {
    background: color-mix(in srgb, #4a9eff 30%, Canvas);
  }
</style>
