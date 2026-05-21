<script lang="ts">
  import { getContext } from 'svelte';
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { SENSOR_TEMPLATE_BY_ID, type SensorSignal } from './sim/sensorModels';
  import { findControllerModel, generateTerminals, fixedOnboardPoints, type TerminalLabel } from '@bas/core';

  /** Cap above which we abandon per-terminal handles and fall back to the
   *  generic top/bottom pair. Beckhoff CX9020 (1024 bus terminals) would
   *  otherwise paint an unreadable column of dots. */
  const TERMINAL_HANDLE_CAP = 24;

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
    /** Sensor-only: signal type. Drives subtitle + future poll-cadence sim. */
    signal?: SensorSignal;
    /** Sensor-only: seconds since the supervisor last heard a fresh reading.
     *  Set by BuildCanvas while a comm fault is active. Drives the stale badge. */
    staleSec?: number;
    /** Controller-only: high/low alarm thresholds (°F). Crossing flips alarm. */
    highAlarm?: number;
    lowAlarm?: number;
    /** Controller-only: current alarm state (set by BuildCanvas each tick). */
    alarm?: 'normal' | 'high' | 'low';
    /** Controller-only: manual override value (0..1) bypassing PI loop. */
    manualOverride?: number;
    /** Sensor-only: seconds since the last supervisor poll. Set each tick by
     *  BuildCanvas, equals tick % pollSec of the chosen signal template. */
    ageSinceLastPollSec?: number;
    /** Controller-only: id from VENDOR_CATALOG. Drives subtitle + ST-portability
     *  hint + vendor info in `show config`. Null = generic controller. */
    vendorModelId?: string;
    /** Sensor-only: id from SENSOR_CATALOG (real-world model). */
    sensorModelId?: string;
    /** Safety-only: id from SAFETY_CATALOG (real-world model). */
    safetyModelId?: string;
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

  // Per-terminal handles: when this is a controller with a known vendor
  // model and a small-enough fixed onboard point count, derive a handle
  // for each terminal so wires land on UI-1, BO-3, AO-2 etc. like a real
  // controller's terminal block. Above the cap, we keep the generic
  // top/bottom handle pair (modular IPCs would otherwise show ~1000 dots).
  const terminals = $derived.by((): { inputs: TerminalLabel[]; outputs: TerminalLabel[] } | null => {
    if (data.kind !== 'controller' || !data.vendorModelId) return null;
    const model = findControllerModel(data.vendorModelId);
    if (!model || !model.points) return null;
    if (fixedOnboardPoints(model.points) === 0) return null;
    if (fixedOnboardPoints(model.points) > TERMINAL_HANDLE_CAP) return null;
    const all = generateTerminals(model.points);
    return {
      inputs: all.filter((t) => t.direction === 'in'),
      outputs: all.filter((t) => t.direction === 'out'),
    };
  });

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

  /** Subtitle for a sensor — prefers any import-supplied subtitle (mac / instance
   *  from the dbexport), otherwise synthesizes one from the chosen signal
   *  template ("Pt1000 RTD · -40 to 250 °F"). */
  const effectiveSubtitle = $derived.by(() => {
    if (data.subtitle) return data.subtitle;
    if (data.kind === 'sensor' && data.signal) {
      const tpl = SENSOR_TEMPLATE_BY_ID.get(data.signal);
      if (tpl) {
        const range = `${tpl.range[0]} to ${tpl.range[1]} ${tpl.units}`.trim();
        return `${tpl.label} · ${range}`;
      }
    }
    return undefined;
  });
</script>

<div
  class="bas-node kind-{data.kind}"
  class:has-runtime={!!data.runtime}
  class:is-tripped={data.runtime?.status === 'tripped'}
  class:is-wired={physicsWired}
  class:has-fault={!!data.fault && data.fault !== 'normal'}
  class:is-offline={isOffline}
>
  <!-- Network trunk in (always rendered). Controllers receive supervisor
       traffic via the top edge; sensors/safeties receive their hardwired
       cable from a controller's left/right terminal. -->
  <Handle type="target" position={Position.Top} id="net-in" />

  {#if terminals}
    {#each terminals.inputs as t, i (t.id)}
      {@const topPct = 18 + (i / Math.max(1, terminals.inputs.length - 1)) * 70}
      <Handle
        type="target"
        position={Position.Left}
        id={t.id}
        style="top: {topPct}%;"
        class="term term-{t.kind}"
        title={t.id}
      />
    {/each}
    {#each terminals.outputs as t, i (t.id)}
      {@const topPct = 18 + (i / Math.max(1, terminals.outputs.length - 1)) * 70}
      <Handle
        type="source"
        position={Position.Right}
        id={t.id}
        style="top: {topPct}%;"
        class="term term-{t.kind}"
        title={t.id}
      />
    {/each}
    <!-- Color legend chip — surfaces the UI/AI/BI -> blue/orange/green
         scheme without permanent label clutter on the node face. -->
    <div class="term-legend" title="Terminal color key">
      <span class="legend-dot legend-UI"></span><span class="legend-text">UI/UO</span>
      <span class="legend-dot legend-AI"></span><span class="legend-text">AI/AO</span>
      <span class="legend-dot legend-BI"></span><span class="legend-text">BI/BO</span>
    </div>
  {/if}

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
    {:else if typeof data.manualOverride === 'number'}
      <span
        class="override-badge"
        title="Actuator manually commanded — PI loop bypassed at {Math.round(
          data.manualOverride * 100,
        )}%"
      >
        ◉ OVRD {Math.round(data.manualOverride * 100)}%
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
    {#if effectiveSubtitle}
      <div
        class="subtitle"
        title={data.subtitle ? 'From the parsed .dbexport' : 'Sensor signal template'}
      >
        {effectiveSubtitle}
      </div>
    {/if}
  {/if}
  {#if data.runtime}
    <div class="runtime">
      {data.runtime.value}
      {#if isOffline && typeof data.staleSec === 'number' && data.staleSec > 0}
        <span class="stale-age" title="Wall-seconds since last good reading"
          >stale {data.staleSec}s</span
        >
      {:else if data.kind === 'sensor' && typeof data.ageSinceLastPollSec === 'number'}
        <span class="poll-age" title="Wall-seconds since last poll on this signal type"
          >polled {data.ageSinceLastPollSec}s ago</span
        >
      {/if}
    </div>
  {/if}
  {#if data.kind === 'controller' && data.alarm && data.alarm !== 'normal'}
    <div class="alarm-badge alarm-{data.alarm}" title="Zone temp out of band">
      {data.alarm === 'high' ? '▲ HIGH TEMP' : '▼ LOW TEMP'}
    </div>
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

  <!-- Network trunk out — downstream MS/TP or hardwired cable from this
       controller to downstream devices (sensors, sub-controllers). -->
  <Handle type="source" position={Position.Bottom} id="net-out" />
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
    position: relative;
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

  .override-badge {
    margin-left: auto;
    font-size: 0.62rem;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    background: color-mix(in srgb, #f39c12 22%, transparent);
    color: #f39c12;
    border: 1px solid color-mix(in srgb, #f39c12 55%, transparent);
    font-weight: 600;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .stale-age {
    margin-left: 0.4rem;
    font-size: 0.65rem;
    color: color-mix(in srgb, #e74c3c 90%, CanvasText);
    font-variant-numeric: tabular-nums;
  }

  .poll-age {
    margin-left: 0.4rem;
    font-size: 0.62rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-variant-numeric: tabular-nums;
  }

  .alarm-badge {
    margin-top: 0.25rem;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
    font-weight: 600;
    text-align: center;
    letter-spacing: 0.04em;
    animation: alarm-flash 1.2s ease-in-out infinite alternate;
  }

  .alarm-badge.alarm-high {
    background: color-mix(in srgb, #e74c3c 22%, transparent);
    color: #e74c3c;
    border: 1px solid color-mix(in srgb, #e74c3c 55%, transparent);
  }

  .alarm-badge.alarm-low {
    background: color-mix(in srgb, #4a9eff 22%, transparent);
    color: #4a9eff;
    border: 1px solid color-mix(in srgb, #4a9eff 55%, transparent);
  }

  @keyframes alarm-flash {
    from {
      opacity: 0.7;
    }
    to {
      opacity: 1;
    }
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
  /* Per-terminal handles + their tiny terminal labels. When the controller
     has fixed onboard I/O (FEC2611's 7 UI + 4 BI + 2 AO + 4 BO), the node
     paints them down the left/right edges like a real controller's
     terminal block. Color-coded by ASHRAE point type. */
  :global(.bas-node .term) {
    width: 9px !important;
    height: 9px !important;
    border: 1.5px solid color-mix(in srgb, CanvasText 35%, transparent) !important;
    background: Canvas !important;
  }

  :global(.bas-node .term-UI),
  :global(.bas-node .term-UO) {
    border-color: #4a9eff !important;
    background: color-mix(in srgb, #4a9eff 25%, Canvas) !important;
  }

  :global(.bas-node .term-AI),
  :global(.bas-node .term-AO) {
    border-color: #f39c12 !important;
    background: color-mix(in srgb, #f39c12 25%, Canvas) !important;
  }

  :global(.bas-node .term-BI),
  :global(.bas-node .term-BO) {
    border-color: #2ecc71 !important;
    background: color-mix(in srgb, #2ecc71 25%, Canvas) !important;
  }

  /* Native title-attribute tooltip handles the per-handle reveal. The
     small legend chip below sits at the bottom-right corner of the node
     face so users can map dot color -> point type at a glance without
     hovering each one. */
  .term-legend {
    position: absolute;
    right: 0.4rem;
    bottom: 0.35rem;
    display: flex;
    align-items: center;
    gap: 0.18rem;
    padding: 0.1rem 0.35rem;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    border-radius: 10px;
    font-size: 0.58rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    line-height: 1;
    opacity: 0.5;
    transition: opacity 120ms ease;
    pointer-events: auto;
  }

  .term-legend:hover {
    opacity: 1;
  }

  .legend-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .legend-UI {
    background: #4a9eff;
  }
  .legend-AI {
    background: #f39c12;
  }
  .legend-BI {
    background: #2ecc71;
  }

  .legend-text {
    margin-right: 0.25rem;
  }
  .legend-text:last-of-type {
    margin-right: 0;
  }
</style>
