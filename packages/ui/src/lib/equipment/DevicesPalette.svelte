<script lang="ts">
  import {
    sensorCatalogBySubject,
    safetyCatalogByKind,
    type SensorModel,
    type SafetyDevice,
    type SensorSubject,
    type SafetyKind,
  } from '@bas/core';

  type DeviceTab = 'sensors' | 'safeties';
  let tab = $state<DeviceTab>('sensors');

  const sensorGroups = $derived.by(() => {
    const map = sensorCatalogBySubject();
    return Array.from(map.entries()).map(([subject, models]) => ({ subject, models }));
  });
  const safetyGroups = $derived.by(() => {
    const map = safetyCatalogByKind();
    return Array.from(map.entries()).map(([kind, devices]) => ({ kind, devices }));
  });

  function onDragSensor(event: DragEvent, model: SensorModel): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('application/bas-node-kind', 'sensor');
    event.dataTransfer.setData('application/bas-sensor-model', model.id);
    event.dataTransfer.effectAllowed = 'move';
  }
  function onDragSafety(event: DragEvent, device: SafetyDevice): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('application/bas-node-kind', 'safety');
    event.dataTransfer.setData('application/bas-safety-model', device.id);
    event.dataTransfer.effectAllowed = 'move';
  }

  function subjectLabel(s: SensorSubject): string {
    return {
      temp: 'Temperature',
      'pressure-static': 'Static pressure',
      'pressure-differential': 'Diff pressure',
      'air-flow': 'Air flow',
      humidity: 'Humidity',
      co2: 'CO₂',
      occupancy: 'Occupancy',
      current: 'Current sensing',
      'damper-position': 'Damper feedback',
      'valve-position': 'Valve feedback',
    }[s];
  }

  function kindLabel(k: SafetyKind): string {
    return {
      freezestat: 'Freezestat (low-limit)',
      'high-static-cutout': 'High static cutout',
      'duct-smoke': 'Duct smoke detector',
      'high-limit': 'High-limit thermostat',
      'low-water-cutoff': 'Low-water cutoff',
      'flow-switch': 'Air flow proving',
      'differential-pressure-switch': 'Diff pressure switch',
      vibration: 'Vibration switch',
      'emergency-stop': 'Emergency stop',
      'fire-alarm-shutdown': 'Fire alarm shutdown',
    }[k];
  }
</script>

<section class="devices-palette" aria-label="Real-world device catalog">
  <header class="head">
    <h3>Devices</h3>
    <p class="hint">Drag a sensor or safety onto the canvas. Each model carries its real-world signal type, range, accuracy, and (for safeties) trip set point + reset behavior.</p>
  </header>

  <div class="tabs">
    <button type="button" class:active={tab === 'sensors'} onclick={() => (tab = 'sensors')}>Sensors</button>
    <button type="button" class:active={tab === 'safeties'} onclick={() => (tab = 'safeties')}>Safeties</button>
  </div>

  {#if tab === 'sensors'}
    {#each sensorGroups as group (group.subject)}
      <details class="group" open>
        <summary>
          <span class="group-name">{subjectLabel(group.subject)}</span>
          <span class="group-count">{group.models.length}</span>
        </summary>
        <ul>
          {#each group.models as m (m.id)}
            <li
              class="model"
              draggable="true"
              ondragstart={(e) => onDragSensor(e, m)}
              title={m.notes}
            >
              <div class="model-head">
                <strong>{m.vendor}</strong>
                <span class="muted">·</span>
                <code>{m.model}</code>
              </div>
              <div class="meta">
                <span class="pill signal">{m.signal}</span>
                <span class="pill mount">{m.mounting}</span>
                <span class="range">{m.range[0]}–{m.range[1]} {m.units}</span>
                <span class="acc">{m.accuracy}</span>
              </div>
            </li>
          {/each}
        </ul>
      </details>
    {/each}
  {:else}
    {#each safetyGroups as group (group.kind)}
      <details class="group" open>
        <summary>
          <span class="group-name">{kindLabel(group.kind)}</span>
          <span class="group-count">{group.devices.length}</span>
        </summary>
        <ul>
          {#each group.devices as d (d.id)}
            <li
              class="model safety"
              draggable="true"
              ondragstart={(e) => onDragSafety(e, d)}
              title={d.notes}
            >
              <div class="model-head">
                <strong>{d.vendor}</strong>
                <span class="muted">·</span>
                <code>{d.model}</code>
              </div>
              <div class="meta">
                <span class="pill" class:nc-pill={d.normalState === 'NC'} class:no-pill={d.normalState === 'NO'}>
                  {d.normalState}
                </span>
                <span class="pill reset" class:manual={d.resetBehavior === 'manual'}>
                  {d.resetBehavior} reset
                </span>
                {#if d.tripPoint}
                  <span class="range">trip @ {d.tripPoint.value} {d.tripPoint.units}</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </details>
    {/each}
  {/if}
</section>

<style>
  .devices-palette {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.25rem 0;
  }

  .head h3 {
    margin: 0 0 0.2rem 0;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .head .hint {
    margin: 0 0 0.4rem 0;
    font-size: 0.75rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    line-height: 1.35;
  }

  .tabs {
    display: flex;
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
    overflow: hidden;
  }

  .tabs button {
    flex: 1;
    background: transparent;
    border: 0;
    color: inherit;
    padding: 0.35rem;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .tabs button.active {
    background: color-mix(in srgb, CanvasText 12%, transparent);
    font-weight: 600;
  }

  .group {
    border: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, Canvas 95%, CanvasText 3%);
  }

  .group summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }

  .group summary::-webkit-details-marker {
    display: none;
  }

  .group summary::before {
    content: '▸';
    margin-right: 0.4rem;
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    transition: transform 120ms ease;
  }

  .group[open] summary::before {
    transform: rotate(90deg);
    display: inline-block;
  }

  .group-name {
    font-weight: 600;
    font-size: 0.82rem;
    flex: 1;
  }

  .group-count {
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    padding: 0.05rem 0.4rem;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    border-radius: 8px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .model {
    border-top: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
    padding: 0.4rem 0.6rem;
    cursor: grab;
    transition: background 100ms ease;
  }

  .model:hover {
    background: color-mix(in srgb, CanvasText 5%, transparent);
  }

  .model.safety {
    border-left: 3px solid #e74c3c;
  }

  .model-head {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .model-head strong {
    font-size: 0.78rem;
  }

  .model-head code {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }

  .muted {
    color: color-mix(in srgb, CanvasText 45%, transparent);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.2rem;
    font-size: 0.65rem;
  }

  .pill {
    padding: 0.02rem 0.35rem;
    border-radius: 8px;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    color: color-mix(in srgb, CanvasText 80%, transparent);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .pill.signal {
    background: color-mix(in srgb, #4a9eff 18%, transparent);
    color: color-mix(in srgb, #4a9eff 90%, CanvasText);
  }

  .pill.mount {
    background: color-mix(in srgb, #2ecc71 18%, transparent);
    color: color-mix(in srgb, #2ecc71 90%, CanvasText);
  }

  .pill.nc-pill {
    background: color-mix(in srgb, #2ecc71 22%, transparent);
    color: color-mix(in srgb, #2ecc71 95%, CanvasText);
  }

  .pill.no-pill {
    background: color-mix(in srgb, #f39c12 22%, transparent);
    color: color-mix(in srgb, #f39c12 95%, CanvasText);
  }

  .pill.reset.manual {
    background: color-mix(in srgb, #e74c3c 22%, transparent);
    color: color-mix(in srgb, #e74c3c 95%, CanvasText);
  }

  .range,
  .acc {
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }
</style>
