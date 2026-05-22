<script lang="ts">
  // Trunk Inspector — a modal that shows the membership of one MS/TP
  // segment. Same shape a tech sees on a Niagara JACE's BACnet diagnostic
  // tab or by running BACnet Explorer's "device list" against the trunk.
  //
  // Columns: MAC | Device Instance | Label | Kind | Token | Time-on-token
  //
  // The "Token" column lights up cyan for whichever device currently
  // owns the token — same color as the canvas highlight, so a user can
  // visually tie the inspector row to the glowing node on the canvas.

  import { onMount } from 'svelte';
  import {
    trunkInspectorStore,
    closeTrunkInspector,
  } from './trunkInspectorStore.svelte';
  import { defaultDeviceInstance, formatMstpDevice } from '@bas/core';

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && trunkInspectorStore.activeTrunkId) {
        closeTrunkInspector();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const trunkId = $derived(trunkInspectorStore.activeTrunkId);
  const trunkState = $derived.by(() => {
    void trunkInspectorStore.tick;
    if (!trunkId) return null;
    return trunkInspectorStore.byTrunkId.get(trunkId) ?? null;
  });
  const findings = $derived.by(() => {
    void trunkInspectorStore.tick;
    if (!trunkId) return [];
    return trunkInspectorStore.findingsByTrunkId.get(trunkId) ?? [];
  });

  function formatHold(s: number): string {
    if (s < 0.01) return '0 ms';
    if (s < 1) return `${Math.round(s * 1000)} ms`;
    return `${s.toFixed(2)} s`;
  }
</script>

{#if trunkId}
  <div
    class="trunk-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) closeTrunkInspector();
    }}
  >
    <div class="trunk-modal" role="dialog" aria-label="MS/TP trunk inspector">
      <header class="head">
        <strong>MS/TP Trunk Inspector</strong>
        {#if trunkState}
          <span class="meta">
            {trunkState.devices.length} device{trunkState.devices.length === 1 ? '' : 's'}
            · {trunkState.baud} baud
            · {trunkState.rotations} rotation{trunkState.rotations === 1 ? '' : 's'}
          </span>
        {/if}
        <button type="button" class="close" onclick={closeTrunkInspector} title="Close (Esc)">✕</button>
      </header>

      {#if findings.length > 0}
        <div class="findings">
          {#each findings as f (f.id + (f.nodeIds ?? []).join(','))}
            <div class="finding sev-{f.severity}" title={f.description}>
              <span class="sev-glyph">{f.severity === 'error' ? '⛔' : f.severity === 'warning' ? '⚠' : 'ℹ'}</span>
              <div class="finding-body">
                <strong>{f.title}</strong>
                <span class="finding-desc">{f.description}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#if !trunkState}
        <div class="empty">Trunk not active — wire two or more devices with MS/TP and start the sim.</div>
      {:else if trunkState.devices.length === 0}
        <div class="empty">No devices on this trunk yet.</div>
      {:else}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>MAC</th>
                <th>Device Instance</th>
                <th>Label</th>
                <th class="token-col">Token</th>
                <th class="num">Time on token</th>
              </tr>
            </thead>
            <tbody>
              {#each trunkState.devices as d, i (d.nodeId)}
                {@const holds = i === trunkState.tokenIndex}
                <tr class:holds-token={holds}>
                  <td class="mono">{d.mac}</td>
                  <td class="mono">{d.deviceInstance ?? defaultDeviceInstance(d.mac)}</td>
                  <td>{d.label}{d.mac === 0 ? ' (supervisor)' : ''}</td>
                  <td class="token-col">
                    {#if holds}
                      <span class="token-dot" title={formatMstpDevice(d)}>●</span>
                    {/if}
                  </td>
                  <td class="num mono">
                    {holds ? formatHold(trunkState.timeOnToken) : '—'}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <footer class="foot">
          <p class="hint">
            MS/TP passes a token around the ring in MAC-address order. Only the
            token-holder can transmit — that's why polling on a busy trunk shows
            up as round-robin in the packet log. Token rotates in ~{(trunkState.devices.length * (0.05 * (38400 / Math.max(9600, trunkState.baud)))).toFixed(2)}s at this baud + device count.
          </p>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .trunk-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 80;
  }

  .trunk-modal {
    width: min(46rem, calc(100% - 2rem));
    max-height: calc(100vh - 4rem);
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    background: Canvas;
    color: CanvasText;
    box-shadow: 0 18px 38px rgba(0, 0, 0, 0.45);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.65rem 1rem;
    background: color-mix(in srgb, Canvas 88%, CanvasText 6%);
    border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
  }

  .head strong {
    font-family: system-ui, sans-serif;
    font-size: 0.95rem;
  }

  .meta {
    font-size: 0.78rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .close {
    margin-left: auto;
    background: transparent;
    border: 0;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    cursor: pointer;
    font-size: 1.05rem;
    line-height: 1;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
  }

  .close:hover {
    background: color-mix(in srgb, CanvasText 10%, transparent);
    color: CanvasText;
  }

  .empty {
    padding: 1.6rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-style: italic;
    font-family: system-ui, sans-serif;
    text-align: center;
  }

  .table-wrap {
    flex: 1;
    overflow-y: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }

  th, td {
    text-align: left;
    padding: 0.4rem 0.7rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 6%, transparent);
  }

  th {
    background: color-mix(in srgb, Canvas 95%, CanvasText 3%);
    font-weight: 600;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    position: sticky;
    top: 0;
  }

  .mono {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-variant-numeric: tabular-nums;
  }

  .num {
    text-align: right;
  }

  .token-col {
    text-align: center;
    width: 4rem;
  }

  .token-dot {
    color: #06b6d4;
    font-size: 1.05rem;
    text-shadow: 0 0 6px rgba(6, 182, 212, 0.65);
  }

  tr.holds-token {
    background: color-mix(in srgb, #06b6d4 10%, transparent);
  }

  .foot {
    padding: 0.65rem 1rem;
    border-top: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
    background: color-mix(in srgb, Canvas 96%, CanvasText 2%);
  }

  .hint {
    margin: 0;
    font-size: 0.78rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    line-height: 1.45;
  }

  .findings {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.65rem 1rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
    background: color-mix(in srgb, Canvas 97%, CanvasText 2%);
  }

  .finding {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    padding: 0.45rem 0.6rem;
    border-radius: 6px;
    font-size: 0.78rem;
    line-height: 1.4;
  }

  .finding.sev-error {
    background: color-mix(in srgb, #e74c3c 12%, transparent);
    border-left: 3px solid #e74c3c;
  }
  .finding.sev-warning {
    background: color-mix(in srgb, #f39c12 12%, transparent);
    border-left: 3px solid #f39c12;
  }
  .finding.sev-info {
    background: color-mix(in srgb, #3498db 10%, transparent);
    border-left: 3px solid #3498db;
  }

  .sev-glyph {
    font-size: 0.95rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .finding-body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .finding-body strong {
    font-family: system-ui, sans-serif;
    font-size: 0.83rem;
  }

  .finding-desc {
    color: color-mix(in srgb, CanvasText 75%, transparent);
    font-family: system-ui, sans-serif;
  }
</style>
