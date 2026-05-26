<script lang="ts">
  // Terminal Inspector — multimeter-style read of every controller terminal.
  //
  // Surfaces the per-terminal raw electrical signal (mA, V, Ω, dry-contact)
  // that the sensor is putting on the wire, side-by-side with the
  // engineering value the controller is decoding it to. The user picks the
  // terminal's input type (Pt1000 vs 10kΩ vs 0-10V vs 4-20mA etc.). When the
  // sensor signal kind doesn't match what the terminal expects, the
  // controller doesn't error — it silently produces a wrong-but-plausible
  // value, and this panel is where that mismatch becomes visible.
  //
  // This is the signal-fidelity payoff: the tech can wire the right sensor,
  // mis-configure the terminal, see the bad scaled value, see the raw value
  // is sensible, and learn that "wrong reading" doesn't always mean "bad
  // sensor."

  import {
    programStore,
    closeTerminals,
  } from './cli/programStore.svelte';
  import { controllerBridge } from './cli/controllerBridge.svelte';
  import {
    terminalConfigStore,
    setTerminalConfig,
    clearTerminalConfig,
    INPUT_TYPE_LABELS,
    INPUT_TYPE_ORDER,
  } from './terminalConfigStore.svelte';
  import type { TerminalInputType, SignalKind, RawSignal, ScaledReading } from '@bas/core';

  type TerminalRow = {
    terminalId: string;
    raw: RawSignal;
    scaled: ScaledReading;
    inputType: TerminalInputType;
    engMin: number;
    engMax: number;
    sensorNodeId?: string;
    hasOverride: boolean;
    isPrimary: boolean;
  };

  function buildRows(): TerminalRow[] {
    // Touch tick + rev so this re-derives every sim tick and every
    // override mutation. Reading the values is enough.
    void controllerBridge.tick;
    void terminalConfigStore.rev;
    const ctrlId = programStore.activeTerminalsControllerId;
    if (!ctrlId) return [];
    const snapshots = controllerBridge.terminalSignalsByCtrl.get(ctrlId);
    if (!snapshots) return [];
    const overrides = terminalConfigStore.byCtrl[ctrlId] ?? {};
    const rows: TerminalRow[] = [];
    for (const [terminalId, snap] of snapshots) {
      rows.push({
        terminalId,
        raw: snap.raw,
        scaled: snap.scaled,
        inputType: snap.config.inputType,
        engMin: snap.config.engMin,
        engMax: snap.config.engMax,
        sensorNodeId: snap.sensorNodeId,
        hasOverride: !!overrides[terminalId],
        isPrimary: !!snap.isPrimary,
      });
    }
    // Stable order: UI-1, UI-2, AI-1, BI-1, ... (kind then channel)
    rows.sort((a, b) => a.terminalId.localeCompare(b.terminalId, undefined, { numeric: true }));
    return rows;
  }

  const rows = $derived(buildRows());

  function fmtRaw(r: RawSignal): string {
    if (!Number.isFinite(r.value)) return r.kind === 'resistance-ohms' ? '∞ Ω' : 'NaN';
    switch (r.kind) {
      case 'current-ma':
        return `${r.value.toFixed(2)} mA`;
      case 'voltage-v':
        return `${r.value.toFixed(3)} V`;
      case 'resistance-ohms':
        if (r.value >= 10000) return `${(r.value / 1000).toFixed(2)} kΩ`;
        return `${r.value.toFixed(1)} Ω`;
      case 'binary':
        return r.value === 1 ? 'CLOSED' : 'OPEN';
      case 'bacnet-network':
        return `${r.value.toFixed(2)} (digital)`;
    }
  }

  function fmtScaled(s: ScaledReading): string {
    if (!Number.isFinite(s.value)) return 'NaN';
    return s.value.toFixed(2);
  }

  function rawKindLabel(k: SignalKind): string {
    switch (k) {
      case 'current-ma':
        return 'Current loop';
      case 'voltage-v':
        return 'Voltage';
      case 'resistance-ohms':
        return 'Resistive';
      case 'binary':
        return 'Dry contact';
      case 'bacnet-network':
        return 'Network';
    }
  }

  function onChangeType(controllerId: string, terminalId: string, value: string): void {
    if (!value) return;
    setTerminalConfig(controllerId, terminalId, { inputType: value as TerminalInputType });
  }

  function onResetTerminal(controllerId: string, terminalId: string): void {
    clearTerminalConfig(controllerId, terminalId);
  }
</script>

{#if programStore.activeTerminalsControllerId}
  <aside class="terminals-panel" aria-label="Controller terminals signal inspector">
    <header class="head">
      <div class="title-row">
        <span class="title">📐 Terminals</span>
        <span class="ctrl-label">{programStore.activeTerminalsControllerLabel}</span>
      </div>
      <button type="button" class="icon-btn" onclick={closeTerminals} title="Close terminals inspector">
        ✕
      </button>
    </header>

    <div class="body">
      {#if rows.length === 0}
        <p class="empty">
          No wired sensors detected on this controller yet. Wire a sensor to one of its UI / AI /
          BI terminals and start the sim — the signal at each terminal appears here in real time.
        </p>
      {:else}
        <table class="terminals-table">
          <thead>
            <tr>
              <th class="col-term">Terminal</th>
              <th class="col-config">Configured as</th>
              <th class="col-raw">Raw signal</th>
              <th class="col-scaled">Scaled (eng)</th>
              <th class="col-status">Status</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.terminalId)}
              {@const mismatch = row.scaled.mismatch === true}
              {@const fault = row.scaled.fault}
              <tr class:mismatch={mismatch && !row.isPrimary} class:faulted={!!fault && !row.isPrimary} class:primary={row.isPrimary}>
                <td class="col-term">
                  <code>{row.terminalId}</code>
                  {#if row.isPrimary}
                    <span class="primary-tag" title="This terminal is wired to the controller's primary physics-target sensor. The thermal sim owns its engineering value (with the legacy drift / calibration / noise / stuck faults applied). The raw + scaled values shown here are what the signal layer WOULD produce — useful as a multimeter reference — but changing the input type for this terminal won't affect what the program actually reads.">primary</span>
                  {/if}
                </td>
                <td class="col-config">
                  <select
                    aria-label="Input type for {row.terminalId}"
                    value={row.inputType}
                    onchange={(e) =>
                      onChangeType(
                        programStore.activeTerminalsControllerId!,
                        row.terminalId,
                        (e.currentTarget as HTMLSelectElement).value,
                      )}
                  >
                    {#each INPUT_TYPE_ORDER as it (it)}
                      <option value={it}>{INPUT_TYPE_LABELS[it]}</option>
                    {/each}
                  </select>
                  {#if row.hasOverride}
                    <button
                      type="button"
                      class="reset-btn"
                      title="Reset to the input type matching the wired sensor"
                      onclick={() =>
                        onResetTerminal(programStore.activeTerminalsControllerId!, row.terminalId)}
                    >
                      ↺
                    </button>
                  {/if}
                </td>
                <td class="col-raw">
                  <span class="raw-value" title={rawKindLabel(row.raw.kind)}>
                    {fmtRaw(row.raw)}
                  </span>
                </td>
                <td class="col-scaled">
                  <span class="scaled-value" class:warn={mismatch || !!fault}>
                    {fmtScaled(row.scaled)}
                  </span>
                  <span class="span-hint">[{row.engMin.toFixed(0)} – {row.engMax.toFixed(0)}]</span>
                </td>
                <td class="col-status">
                  {#if row.isPrimary}
                    <span class="badge primary" title="Thermal-sim owned. The program reads this sensor's value via T_sensed (which has its own drift / calibration / noise / stuck pipeline). The raw + scaled shown here are a signal-layer view — descriptive, not authoritative.">SIM</span>
                  {:else if fault === 'open-circuit'}
                    <span class="badge bad" title="The sensor or wire is open. The controller is pinning at the fault rail.">OPEN</span>
                  {:else if fault === 'short-circuit'}
                    <span class="badge bad" title="The wire is shorted. The controller is reading the fault rail.">SHORT</span>
                  {:else if fault === 'over-range'}
                    <span class="badge warn" title="Signal exceeded the live range. Reads pegged at engMax.">OVER</span>
                  {:else if fault === 'under-range'}
                    <span class="badge warn" title="Signal below the live range — often a sign the wire is broken on a 4-20mA / 2-10V loop.">UNDER</span>
                  {:else if mismatch}
                    <span class="badge mismatch" title="The sensor's signal kind doesn't match what this terminal is configured for. The reading is wrong but plausible — this is the silent-misconfiguration failure mode.">MISMATCH</span>
                  {:else}
                    <span class="badge ok">OK</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

        <p class="legend">
          <strong>Raw</strong> = what a multimeter clipped to the wire reads.
          <strong>Scaled</strong> = the engineering value the controller program sees after
          interpreting the wire through the configured input type. When MISMATCH appears,
          the controller is happily producing a wrong number — exactly what a real
          mis-configured terminal would do.
        </p>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .terminals-panel {
    position: absolute;
    right: 1rem;
    top: 4.5rem;
    bottom: 1rem;
    width: 36rem;
    max-width: calc(100vw - 2rem);
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, Canvas 96%, CanvasText 3%);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    z-index: 45;
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    background: color-mix(in srgb, Canvas 88%, CanvasText 6%);
  }

  .title-row {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    overflow: hidden;
  }

  .title {
    font-weight: 600;
    font-size: 0.9rem;
  }

  .ctrl-label {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.78rem;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .icon-btn {
    background: transparent;
    border: 0;
    color: CanvasText;
    font-size: 0.95rem;
    cursor: pointer;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
  }

  .icon-btn:hover {
    background: color-mix(in srgb, CanvasText 8%, transparent);
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
  }

  .empty {
    margin: 0;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .terminals-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }

  .terminals-table th {
    text-align: left;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.68rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    padding: 0.3rem 0.45rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
  }

  .terminals-table td {
    padding: 0.4rem 0.45rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 6%, transparent);
    vertical-align: middle;
  }

  .terminals-table tr.mismatch td {
    background: color-mix(in srgb, #f1c40f 7%, transparent);
  }

  .terminals-table tr.faulted td {
    background: color-mix(in srgb, #e74c3c 8%, transparent);
  }

  .col-term code {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.78rem;
    color: color-mix(in srgb, #4a9eff 95%, CanvasText);
  }

  .col-config select {
    width: 100%;
    max-width: 13rem;
    font: inherit;
    font-size: 0.74rem;
    padding: 0.15rem 0.35rem;
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, Canvas 90%, CanvasText 4%);
    color: CanvasText;
  }

  .reset-btn {
    margin-left: 0.3rem;
    background: transparent;
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    border-radius: 4px;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    font: inherit;
    font-size: 0.7rem;
    cursor: pointer;
    padding: 0.05rem 0.35rem;
  }

  .reset-btn:hover {
    background: color-mix(in srgb, CanvasText 8%, transparent);
    color: CanvasText;
  }

  .raw-value,
  .scaled-value {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }

  .scaled-value.warn {
    color: color-mix(in srgb, #e67e22 95%, CanvasText);
    font-weight: 600;
  }

  .span-hint {
    margin-left: 0.4rem;
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .badge {
    display: inline-block;
    padding: 0.1rem 0.45rem;
    border-radius: 8px;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .badge.ok {
    background: color-mix(in srgb, #2ecc71 18%, transparent);
    color: color-mix(in srgb, #2ecc71 92%, CanvasText);
  }

  .badge.bad {
    background: color-mix(in srgb, #e74c3c 22%, transparent);
    color: color-mix(in srgb, #e74c3c 95%, CanvasText);
  }

  .badge.warn {
    background: color-mix(in srgb, #e67e22 22%, transparent);
    color: color-mix(in srgb, #e67e22 95%, CanvasText);
  }

  .badge.mismatch {
    background: color-mix(in srgb, #f1c40f 25%, transparent);
    color: color-mix(in srgb, #b7950b 95%, CanvasText);
  }

  .badge.primary {
    background: color-mix(in srgb, #4a9eff 18%, transparent);
    color: color-mix(in srgb, #4a9eff 95%, CanvasText);
  }

  .terminals-table tr.primary td {
    background: color-mix(in srgb, #4a9eff 4%, transparent);
  }

  .primary-tag {
    margin-left: 0.35rem;
    padding: 0.04rem 0.35rem;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-radius: 6px;
    background: color-mix(in srgb, #4a9eff 18%, transparent);
    color: color-mix(in srgb, #4a9eff 95%, CanvasText);
    font-weight: 600;
    vertical-align: middle;
  }

  .legend {
    margin: 0.85rem 0 0 0;
    font-size: 0.75rem;
    line-height: 1.5;
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }

  .legend strong {
    color: CanvasText;
  }
</style>
