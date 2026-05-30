<script lang="ts">
  // BACnet object inspector overlay.
  //
  // Shows the live BACnet object list a supervisor would see when it
  // discovers this controller. Same view a tech gets in YABE / Niagara
  // Spy / Distech ECx — but vendor-neutral and educational. Each row is
  // an object id (AI:3), the ObjectName from the Point Assignment, the
  // PresentValue (live, refreshes each sim tick), and the units.
  //
  // Future: clickable object → ReadProperty trace, WriteProperty button,
  // notification-class subscriptions. For v1 it's a read-only browser.

  import { onMount } from 'svelte';
  import {
    synthesizeBacnetObjects,
    type BacnetObject,
    type BacnetObjectType,
  } from '@bas/core';
  import { programStore, closeBacnet } from '../cli/programStore.svelte';
  import { controllerBridge } from '../cli/controllerBridge.svelte';
  import { canvasSnapshot } from '../canvasStore.svelte';

  // Escape closes — same recovery hatch as SpecLang.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && programStore.activeBacnetControllerId) {
        closeBacnet();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const ctrlId = $derived(programStore.activeBacnetControllerId);
  const ctrlLabel = $derived(programStore.activeBacnetControllerLabel ?? '');

  const objects = $derived.by<BacnetObject[]>(() => {
    // Touch the bridge tick so this re-runs every sim tick.
    void controllerBridge.tick;
    if (!ctrlId) return [];
    const node = canvasSnapshot.nodes.find((n) => n.id === ctrlId);
    if (!node) return [];
    const data = node.data as { vendorModelId?: string };
    const prog = programStore.byId[ctrlId];
    // Pull per-terminal signal-layer faults from the bridge so the panel
    // surfaces reliability / FAULT bit exactly as a supervisor polling
    // this device would see them.
    const snaps = controllerBridge.terminalSignalsByCtrl.get(ctrlId);
    const terminalFaults = new Map<string, import('@bas/core').SignalFault>();
    if (snaps) {
      for (const [terminalId, snap] of snaps) {
        const f = snap.scaled.fault;
        if (f) terminalFaults.set(terminalId, f);
      }
    }
    return synthesizeBacnetObjects({
      vendorModelId: data.vendorModelId,
      bindings: prog?.bindings,
      envInputs: controllerBridge.envInputsByCtrl.get(ctrlId),
      envOutputs: controllerBridge.envOutputsByCtrl.get(ctrlId),
      terminalFaults: terminalFaults.size > 0 ? terminalFaults : undefined,
    });
  });

  // Group by type for the panel layout.
  const grouped = $derived.by(() => {
    const map = new Map<BacnetObjectType, BacnetObject[]>();
    for (const o of objects) {
      const arr = map.get(o.type) ?? [];
      arr.push(o);
      map.set(o.type, arr);
    }
    return Array.from(map.entries());
  });

  const TYPE_LABEL: Record<BacnetObjectType, string> = {
    'analog-input': 'Analog Inputs (AI)',
    'analog-output': 'Analog Outputs (AO)',
    'analog-value': 'Analog Values (AV)',
    'binary-input': 'Binary Inputs (BI)',
    'binary-output': 'Binary Outputs (BO)',
    'binary-value': 'Binary Values (BV)',
    'multistate-value': 'Multi-state Values (MSV)',
  };

  const TYPE_COLOR: Record<BacnetObjectType, string> = {
    'analog-input': '#3498db',
    'analog-output': '#9b59b6',
    'analog-value': '#16a085',
    'binary-input': '#2ecc71',
    'binary-output': '#e67e22',
    'binary-value': '#27ae60',
    'multistate-value': '#7f8c8d',
  };

  function formatValue(o: BacnetObject): string {
    if (typeof o.presentValue === 'boolean') return o.presentValue ? 'TRUE' : 'FALSE';
    const v = o.presentValue;
    if (Math.abs(v) < 0.01) return '0';
    if (Math.abs(v) < 10) return v.toFixed(2);
    if (Math.abs(v) < 100) return v.toFixed(1);
    return v.toFixed(0);
  }
</script>

{#if ctrlId}
  <div
    class="bacnet-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) closeBacnet();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') closeBacnet();
    }}
    tabindex="-1"
  >
    <div class="bacnet-overlay" role="dialog" aria-label="BACnet object inspector">
      <header class="head">
        <div class="head-title">
          <strong>BACnet Objects</strong>
          <span class="muted">— what a supervisor sees from</span>
          <span class="ctrl-label">{ctrlLabel}</span>
          <span class="object-count">{objects.length} objects</span>
        </div>
        <div class="head-actions">
          <button type="button" class="close" onclick={closeBacnet} title="Close (Esc)">✕</button>
        </div>
      </header>

      <div class="body">
        {#if objects.length === 0}
          <div class="empty">
            <p>No objects to show.</p>
            <p class="muted small">
              Run the sim at least once so env values flow. Add a vendor model
              to the controller (currently shows the catalog defaults) and
              bind some Point Assignments to label the objects.
            </p>
          </div>
        {/if}

        {#each grouped as [type, objs] (type)}
          <section class="bacnet-section" style:--c={TYPE_COLOR[type]}>
            <h4>
              <span class="dot"></span>
              {TYPE_LABEL[type]}
              <span class="count">{objs.length}</span>
            </h4>
            <table class="bacnet-table">
              <thead>
                <tr>
                  <th class="col-id">Object ID</th>
                  <th class="col-name">ObjectName</th>
                  <th class="col-value">PresentValue</th>
                  <th class="col-units">Units</th>
                  <th class="col-reliability">Reliability</th>
                  <th class="col-term">Terminal</th>
                </tr>
              </thead>
              <tbody>
                {#each objs as o (o.id)}
                  {@const isFaulted = !!o.reliability && o.reliability !== 'no-fault-detected'}
                  <tr title={o.description ?? ''} class:faulted={isFaulted}>
                    <td class="mono col-id"><span class="badge" style:--c={TYPE_COLOR[type]}>{o.id}</span></td>
                    <td class="col-name">{o.name}</td>
                    <td class="mono col-value" class:bool-true={o.presentValue === true} class:bool-false={o.presentValue === false} class:fault-value={isFaulted}>
                      {formatValue(o)}
                      {#if isFaulted}
                        <span class="fault-badge" title="Status_Flags FAULT bit is set. A supervisor polling this object would alarm.">FAULT</span>
                      {/if}
                    </td>
                    <td class="muted col-units">{o.units ?? ''}</td>
                    <td class="mono col-reliability">
                      {#if o.reliability && o.reliability !== 'no-fault-detected'}
                        <span class="reliability-tag" title="ASHRAE 135 Reliability property = {o.reliability}. The wire-level fault the controller's analog front-end detected.">{o.reliability}</span>
                      {:else}
                        <span class="muted">—</span>
                      {/if}
                    </td>
                    <td class="mono col-term muted">{o.terminalId ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </section>
        {/each}

        <footer class="overlay-foot muted small">
          The supervisor's view. Each row above is exactly what a remote BAS
          gateway (a Tridium JACE, a JCI NAE, a YABE explorer) would discover
          via Who-Is + ReadPropertyMultiple. Values refresh every sim tick.
        </footer>
      </div>
    </div>
  </div>
{/if}

<style>
  .bacnet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: stretch;
    padding: 1rem;
  }
  .bacnet-overlay {
    position: relative;
    flex: 1;
    background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 1rem;
    background: color-mix(in srgb, Canvas 88%, CanvasText 6%);
    border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
  }
  .head-title { display: flex; align-items: baseline; gap: 0.4rem; }
  .head-title strong { font-size: 1rem; }
  .muted { color: color-mix(in srgb, CanvasText 55%, transparent); font-size: 0.85rem; }
  .ctrl-label { font-family: ui-monospace, Menlo, monospace; font-size: 0.85rem; color: color-mix(in srgb, CanvasText 85%, transparent); }
  .object-count {
    margin-left: 0.5rem;
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border-radius: 10px;
    background: color-mix(in srgb, #16a085 18%, transparent);
    color: #16a085;
    border: 1px solid color-mix(in srgb, #16a085 50%, transparent);
  }
  .close {
    border: 1px solid color-mix(in srgb, #e74c3c 50%, transparent);
    background: transparent;
    color: #e74c3c;
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }
  .close:hover { background: color-mix(in srgb, #e74c3c 12%, transparent); }

  .body {
    flex: 1;
    padding: 0.8rem 1.2rem 1rem;
    overflow-y: auto;
  }

  .empty {
    padding: 1.5rem;
    text-align: center;
  }
  .small { font-size: 0.78rem; }

  .bacnet-section { margin-bottom: 1rem; }
  .bacnet-section h4 {
    margin: 0 0 0.35rem;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--c);
  }
  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--c);
    display: inline-block;
  }
  .count {
    margin-left: 0.3rem;
    font-size: 0.7rem;
    padding: 0.05rem 0.35rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--c) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
  }

  .bacnet-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  .bacnet-table thead {
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .bacnet-table th, .bacnet-table td {
    padding: 0.25rem 0.55rem;
    text-align: left;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
  }
  .bacnet-table tbody tr:hover {
    background: color-mix(in srgb, CanvasText 4%, transparent);
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.78rem;
  }
  .col-id { width: 5rem; }
  .col-name { width: auto; }
  .col-value { width: 7rem; text-align: right; font-variant-numeric: tabular-nums; }
  .col-units { width: 3rem; }
  .col-reliability { width: 7rem; text-align: left; }
  .col-term { width: 4.5rem; text-align: right; }

  /* Fault row + value styling. When the AI's reliability is non-default
     the controller would expose a FAULT bit on Status_Flags; we tint the
     value column red, append a FAULT badge, and surface the reliability
     enum as a pill in its own column. */
  .bacnet-table tbody tr.faulted td {
    background: color-mix(in srgb, #e74c3c 8%, transparent);
  }

  .fault-value {
    color: color-mix(in srgb, #e74c3c 95%, CanvasText);
  }

  .fault-badge {
    margin-left: 0.4rem;
    padding: 0.05rem 0.4rem;
    border-radius: 8px;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    background: color-mix(in srgb, #e74c3c 22%, transparent);
    color: color-mix(in srgb, #e74c3c 95%, CanvasText);
    vertical-align: middle;
  }

  .reliability-tag {
    display: inline-block;
    padding: 0.05rem 0.4rem;
    border-radius: 6px;
    font-size: 0.7rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    background: color-mix(in srgb, #e74c3c 18%, transparent);
    color: color-mix(in srgb, #e74c3c 95%, CanvasText);
    font-weight: 600;
  }

  .badge {
    display: inline-block;
    padding: 0.05rem 0.4rem;
    border-radius: 4px;
    background: color-mix(in srgb, var(--c) 15%, transparent);
    color: var(--c);
    border: 1px solid color-mix(in srgb, var(--c) 50%, transparent);
    font-weight: 600;
  }
  .bool-true { color: #2ecc71; }
  .bool-false { color: color-mix(in srgb, CanvasText 50%, transparent); }

  .overlay-foot {
    margin-top: 1rem;
    padding: 0.6rem;
    border-top: 1px dashed color-mix(in srgb, CanvasText 18%, transparent);
    font-style: italic;
  }
</style>
