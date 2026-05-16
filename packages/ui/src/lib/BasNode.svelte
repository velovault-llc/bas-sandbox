<script lang="ts">
  import { getContext } from 'svelte';
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';

  type BasNodeKind = 'supervisor' | 'controller' | 'sensor' | 'safety';

  type BasNodeData = {
    label: string;
    kind: BasNodeKind;
    note?: string;
    /** Optional runtime state surfaced when the sim is running. */
    runtime?: {
      value: string;
      status?: 'idle' | 'polling' | 'responded' | 'tripped';
    };
    /** Set on imported engine nodes — number of controllers we imported under them. */
    childCount?: number;
    /** Total objects (points + equipment) in the imported engine's subtree. */
    objectCount?: number;
    /** True when imported children are hidden. Flipped by clicking the supervisor. */
    collapsed?: boolean;
    /** Set on imported controllers to point at the engine they belong to. */
    importedFromEngine?: string;
    /** Network / identity metadata pulled off the parsed .dbexport. */
    subtitle?: string;
    meta?: Record<string, string | undefined>;
    /** Sensor-only: current fault mode. Drives node tinting + a small badge. */
    fault?: 'normal' | 'open' | 'short' | 'stuck' | 'drift';
  };

  /** Human label + glyph for each fault, used on the node badge. */
  const FAULT_LABEL: Record<NonNullable<BasNodeData['fault']>, { glyph: string; text: string }> = {
    normal: { glyph: '', text: '' },
    open: { glyph: '⊘', text: 'OPEN' },
    short: { glyph: '⊗', text: 'SHORT' },
    stuck: { glyph: '⏸', text: 'STUCK' },
    drift: { glyph: '~', text: 'DRIFT' },
  };

  // @xyflow/svelte's NodeProps is parameterized by Node; we keep typing loose
  // and validate via the discriminated `kind` union on data.
  let { id, data }: NodeProps & { data: BasNodeData } = $props();

  // Set of node ids that are wired to the physics sim (from BuildCanvas context).
  const getWiredIds = getContext<() => Set<string>>('basWiredIds');
  const physicsWired = $derived(getWiredIds ? getWiredIds().has(id) : false);

  // Set of node ids that are unreachable from any supervisor (broken trunk).
  const getOfflineIds = getContext<() => Set<string>>('basOfflineIds');
  const isOffline = $derived(getOfflineIds ? getOfflineIds().has(id) : false);

  // Inline-rename plumbing. BuildCanvas tracks which node id is being renamed
  // and provides commit/cancel handlers via context.
  const getRenamingId = getContext<() => string | null>('basRenamingNodeId');
  const commitRename = getContext<(id: string, newLabel: string) => void>('basCommitRename');
  const cancelRename = getContext<() => void>('basCancelRename');
  const isEditing = $derived(getRenamingId ? getRenamingId() === id : false);

  let editValue = $state('');

  // Reset the field text whenever we enter edit mode so it shows the current label.
  $effect(() => {
    if (isEditing) editValue = data.label;
  });

  function focusAndSelect(el: HTMLInputElement) {
    el.focus();
    el.select();
  }

  function onEditKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(id, editValue.trim() || data.label);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  function onEditBlur() {
    commitRename(id, editValue.trim() || data.label);
  }

  const ICONS: Record<BasNodeKind, string> = {
    supervisor: '◉',
    controller: '◈',
    sensor: '◇',
    safety: '⚠',
  };

  const KIND_LABEL: Record<BasNodeKind, string> = {
    supervisor: 'Supervisor',
    controller: 'Controller',
    sensor: 'Sensor',
    safety: 'Safety',
  };
</script>

<div
  class="bas-node kind-{data.kind}"
  class:has-runtime={!!data.runtime}
  class:is-tripped={data.runtime?.status === 'tripped'}
  class:is-wired={physicsWired}
  class:has-fault={!!data.fault && data.fault !== 'normal'}
  class:is-offline={isOffline}
>
  <Handle type="target" position={Position.Top} />

  <div class="header">
    <span class="icon">{ICONS[data.kind]}</span>
    <span class="kind">
      {KIND_LABEL[data.kind]}
      {#if data.note}<em class="note-tag">{data.note}</em>{/if}
    </span>
    {#if isOffline}
      <span class="offline-badge" title="Unreachable — broken trunk upstream">⌀ OFFLINE</span>
    {:else if data.fault && data.fault !== 'normal'}
      <span class="fault-badge" title="Sensor fault: {FAULT_LABEL[data.fault].text}">
        {FAULT_LABEL[data.fault].glyph}
        {FAULT_LABEL[data.fault].text}
      </span>
    {:else if physicsWired}
      <span class="wired" title="Physics wired">⚡</span>
    {/if}
  </div>
  {#if isEditing}
    <input
      class="label label-edit"
      type="text"
      bind:value={editValue}
      onkeydown={onEditKey}
      onblur={onEditBlur}
      use:focusAndSelect
      aria-label="Rename node"
    />
  {:else}
    <div class="label" title="Double-click to rename">{data.label}</div>
    {#if data.subtitle}
      <div class="subtitle" title="From the parsed .dbexport">{data.subtitle}</div>
    {/if}
  {/if}
  {#if data.runtime}
    <div class="runtime">{data.runtime.value}</div>
  {/if}
  {#if data.childCount !== undefined && data.childCount > 0}
    <div class="children-toggle" title={data.collapsed ? 'Click to expand' : 'Click to collapse'}>
      {data.collapsed ? '▶' : '▼'}
      {data.childCount}
      {data.childCount === 1 ? 'controller' : 'controllers'}
      {#if data.objectCount && data.objectCount > 0}
        <span class="pt-count">· {data.objectCount.toLocaleString()} pts</span>
      {/if}
    </div>
  {/if}

  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .bas-node {
    --accent: #888;
    /* Solid Canvas first so wires routing behind the node are fully covered,
       then a thin accent overlay for the kind tint. */
    background:
      linear-gradient(
        color-mix(in srgb, var(--accent) 10%, transparent),
        color-mix(in srgb, var(--accent) 10%, transparent)
      ),
      Canvas;
    border: 1.5px solid var(--accent);
    border-radius: 6px;
    padding: 0.45rem 0.7rem;
    color: CanvasText;
    font-family: system-ui, sans-serif;
    font-size: 0.82rem;
    min-width: 10rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    transition: box-shadow 200ms ease;
    /* Lift nodes above the edge layer so wires never appear to cross through. */
    position: relative;
    z-index: 2;
  }

  .bas-node.has-runtime {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .bas-node.is-wired {
    border-color: #f59e0b;
    box-shadow: 0 0 0 2px color-mix(in srgb, #f59e0b 45%, transparent);
  }

  .bas-node.is-tripped {
    box-shadow: 0 0 0 3px #e74c3c;
    animation: pulse 0.8s ease-in-out infinite alternate;
  }

  /* Sensor with an active fault gets a dashed red ring to read as "untrusted." */
  .bas-node.has-fault {
    border-style: dashed;
    border-color: #e74c3c;
    box-shadow: 0 0 0 2px color-mix(in srgb, #e74c3c 30%, transparent);
  }

  /* Unreachable nodes (broken trunk severs them from any supervisor) go
     muted + dashed gray. Distinct from a sensor fault (which is red). */
  .bas-node.is-offline {
    border-style: dashed;
    border-color: color-mix(in srgb, CanvasText 40%, transparent);
    opacity: 0.55;
    /* Override fault/wired/runtime glow rings so the offline state reads cleanly. */
    box-shadow: none;
  }

  .fault-badge {
    margin-left: auto;
    font-size: 0.62rem;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    background: color-mix(in srgb, #e74c3c 22%, transparent);
    color: #e74c3c;
    font-weight: 600;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .offline-badge {
    margin-left: auto;
    font-size: 0.62rem;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    background: color-mix(in srgb, CanvasText 14%, transparent);
    color: color-mix(in srgb, CanvasText 75%, transparent);
    font-weight: 600;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  @keyframes pulse {
    from {
      box-shadow: 0 0 0 3px #e74c3c;
    }
    to {
      box-shadow: 0 0 0 6px color-mix(in srgb, #e74c3c 40%, transparent);
    }
  }

  .kind-supervisor {
    --accent: #4a9eff;
  }
  .kind-controller {
    --accent: #9c8cff;
  }
  .kind-sensor {
    --accent: #f39c12;
  }
  .kind-safety {
    --accent: #e74c3c;
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

  .wired {
    margin-left: auto;
    color: #f59e0b;
    font-size: 0.85rem;
    line-height: 1;
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

  .subtitle {
    margin-top: 0.15rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
    color: color-mix(in srgb, var(--accent) 80%, CanvasText);
    opacity: 0.85;
  }

  .label-edit {
    background: Canvas;
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 0.1rem 0.3rem;
    color: CanvasText;
    width: 100%;
    box-sizing: border-box;
    outline: none;
  }

  .label-edit:focus {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
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

  .note-tag {
    font-style: normal;
    font-size: 0.62rem;
    padding: 0.05rem 0.3rem;
    margin-left: 0.3rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    text-transform: none;
    letter-spacing: 0;
  }

  .children-toggle {
    margin-top: 0.25rem;
    padding: 0.1rem 0.4rem;
    background: color-mix(in srgb, var(--accent) 12%, Canvas);
    border: 1px dashed color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: 3px;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.72rem;
    color: var(--accent);
    cursor: pointer;
    user-select: none;
    text-align: center;
  }

  .pt-count {
    opacity: 0.75;
    margin-left: 0.15rem;
  }

  /* xyflow handles render with their own classes; tweak a bit for visibility */
  :global(.bas-node .svelte-flow__handle) {
    width: 8px;
    height: 8px;
    background: var(--accent);
    border: 2px solid Canvas;
  }
</style>
