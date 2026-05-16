<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';

  type BasNodeKind = 'supervisor' | 'field-controller' | 'unitary-controller' | 'sensor';

  type BasNodeData = {
    label: string;
    kind: BasNodeKind;
    note?: string;
    /** Optional runtime state surfaced when the sim is running. */
    runtime?: {
      value: string;
      status?: 'idle' | 'polling' | 'responded';
    };
  };

  // @xyflow/svelte's NodeProps is parameterized by Node; we keep typing loose
  // and validate via the discriminated `kind` union on data.
  let { data }: NodeProps & { data: BasNodeData } = $props();

  const ICONS: Record<BasNodeKind, string> = {
    supervisor: '◉',
    'field-controller': '◈',
    'unitary-controller': '▢',
    sensor: '◇',
  };

  const KIND_LABEL: Record<BasNodeKind, string> = {
    supervisor: 'Supervisor',
    'field-controller': 'Field Controller',
    'unitary-controller': 'Unitary Controller',
    sensor: 'Sensor',
  };
</script>

<div class="bas-node kind-{data.kind}" class:has-runtime={!!data.runtime}>
  <Handle type="target" position={Position.Top} />

  <div class="header">
    <span class="icon">{ICONS[data.kind]}</span>
    <span class="kind">{KIND_LABEL[data.kind]}</span>
  </div>
  <div class="label">{data.label}</div>
  {#if data.runtime}
    <div class="runtime">{data.runtime.value}</div>
  {/if}
  {#if data.note}
    <div class="note">{data.note}</div>
  {/if}

  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .bas-node {
    --accent: #888;
    background: color-mix(in srgb, var(--accent) 8%, Canvas);
    border: 1.5px solid var(--accent);
    border-radius: 6px;
    padding: 0.45rem 0.7rem;
    color: CanvasText;
    font-family: system-ui, sans-serif;
    font-size: 0.82rem;
    min-width: 10rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    transition: box-shadow 200ms ease;
  }

  .bas-node.has-runtime {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .kind-supervisor {
    --accent: #4a9eff;
  }
  .kind-field-controller {
    --accent: #9c8cff;
  }
  .kind-unitary-controller {
    --accent: #2ecc71;
  }
  .kind-sensor {
    --accent: #f39c12;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
    margin-bottom: 0.15rem;
  }

  .icon {
    font-size: 0.95rem;
    line-height: 1;
  }

  .label {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.9rem;
    color: CanvasText;
  }

  .runtime {
    margin-top: 0.25rem;
    padding: 0.15rem 0.4rem;
    background: color-mix(in srgb, var(--accent) 18%, Canvas);
    border-radius: 3px;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.78rem;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .note {
    margin-top: 0.2rem;
    font-size: 0.72rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
  }

  /* xyflow handles render with their own classes; tweak a bit for visibility */
  :global(.bas-node .svelte-flow__handle) {
    width: 8px;
    height: 8px;
    background: var(--accent);
    border: 2px solid Canvas;
  }
</style>
