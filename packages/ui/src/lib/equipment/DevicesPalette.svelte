<script lang="ts">
  import {
    controllerCatalogByVendor,
    sensorCatalogBySubject,
    safetyCatalogByKind,
    expansionsByVendor,
    actuatorCatalogByKind,
    equipmentCatalogByKind,
    formatPointBreakdown,
    type ControllerModel,
    type SensorModel,
    type SafetyDevice,
    type SensorSubject,
    type SafetyKind,
    type ExpansionModule,
    type ActuatorModel,
    type ActuatorKind,
    type EquipmentModel,
    type EquipmentKind,
  } from '@bas/core';
  import { selectionStore, devicesNavStore } from '../canvasStore.svelte';

  type DeviceTab = 'controllers' | 'sensors' | 'safeties' | 'expansions' | 'actuators' | 'equipment';
  let tab = $state<DeviceTab>('controllers');

  // React to "show me X" signals from the scenario panel: switch sub-tab,
  // then highlight + scroll-into-view the requested model.
  let highlightModelId = $state<string | null>(null);
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const pulse = devicesNavStore.pulse;
    if (pulse === 0 || !devicesNavStore.tab) return;
    tab = devicesNavStore.tab;
    const modelId = devicesNavStore.modelId;
    if (modelId) {
      highlightModelId = modelId;
      // Wait for DOM render, then scroll
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-model-id="${modelId}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      if (highlightTimer) clearTimeout(highlightTimer);
      highlightTimer = setTimeout(() => {
        highlightModelId = null;
      }, 2500);
    }
  });

  const controllerGroups = $derived.by(() => {
    const map = controllerCatalogByVendor();
    return Array.from(map.entries()).map(([vendor, models]) => ({ vendor, models }));
  });
  const sensorGroups = $derived.by(() => {
    const map = sensorCatalogBySubject();
    return Array.from(map.entries()).map(([subject, models]) => ({ subject, models }));
  });
  const safetyGroups = $derived.by(() => {
    const map = safetyCatalogByKind();
    return Array.from(map.entries()).map(([kind, devices]) => ({ kind, devices }));
  });
  const expansionGroups = $derived.by(() => {
    const map = expansionsByVendor();
    return Array.from(map.entries()).map(([vendor, modules]) => ({ vendor, modules }));
  });
  const actuatorGroups = $derived.by(() => {
    const map = actuatorCatalogByKind();
    return Array.from(map.entries()).map(([kind, models]) => ({ kind, models }));
  });
  const equipmentGroups = $derived.by(() => {
    const map = equipmentCatalogByKind();
    return Array.from(map.entries()).map(([kind, models]) => ({ kind, models }));
  });

  function onDragController(event: DragEvent, model: ControllerModel): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('application/bas-node-kind', 'controller');
    event.dataTransfer.setData('application/bas-controller-vendor', model.id);
    event.dataTransfer.effectAllowed = 'move';
  }
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
  function onDragExpansion(event: DragEvent, module: ExpansionModule): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('application/bas-node-kind', 'expansion');
    event.dataTransfer.setData('application/bas-expansion-model', module.id);
    event.dataTransfer.effectAllowed = 'move';
  }
  function onDragActuator(event: DragEvent, model: ActuatorModel): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('application/bas-node-kind', 'actuator');
    event.dataTransfer.setData('application/bas-actuator-model', model.id);
    event.dataTransfer.effectAllowed = 'move';
  }
  function onDragEquipment(event: DragEvent, model: EquipmentModel): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('application/bas-node-kind', 'equipment');
    event.dataTransfer.setData('application/bas-equipment-model', model.id);
    event.dataTransfer.effectAllowed = 'move';
  }

  function isExpansionCompatible(m: ExpansionModule): boolean {
    const v = selectionStore.selectedControllerVendor;
    if (!v) return true; // no controller selected — show all
    return m.compatibleWith.includes(v);
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

  function actuatorKindLabel(k: ActuatorKind): string {
    return {
      'damper-modulating': 'Modulating damper',
      'damper-binary': '2-position damper',
      'valve-modulating': 'Modulating valve',
      'valve-floating': 'Floating valve (3-point)',
      'valve-binary': '2-position valve',
      vfd: 'Variable frequency drive',
      contactor: 'Contactor / motor starter',
      'pump-relay': 'Pump relay',
    }[k];
  }

  function equipmentKindLabel(k: EquipmentKind): string {
    return {
      'vav-box': 'VAV boxes',
      ahu: 'Air handlers (AHU)',
      rtu: 'Rooftop units (RTU)',
      fcu: 'Fan coil units (FCU)',
      pump: 'Pumps',
      boiler: 'Boilers',
      chiller: 'Chillers',
      'cooling-tower': 'Cooling towers',
    }[k];
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

  function langClass(lang: ControllerModel['programmingLanguage']): string {
    if (lang.includes('IEC')) return 'lang-iec';
    if (lang.includes('CCT')) return 'lang-cct';
    if (lang.includes('Niagara')) return 'lang-niagara';
    if (lang.includes('PPCL')) return 'lang-ppcl';
    if (lang.includes('Distech')) return 'lang-distech';
    if (lang.includes('Reliable')) return 'lang-reliable';
    return 'lang-other';
  }
</script>

<section class="devices-palette" aria-label="Equipment catalog">
  <header class="head">
    <h3>Devices</h3>
    <p class="hint">
      Drag any model onto the canvas. ST programs only run natively on IEC 61131-3 controllers
      (green pills under Controllers).
    </p>
  </header>

  <div class="tabs">
    <button type="button" class:active={tab === 'controllers'} onclick={() => (tab = 'controllers')}>
      Controllers
    </button>
    <button type="button" class:active={tab === 'sensors'} onclick={() => (tab = 'sensors')}>
      Sensors
    </button>
    <button type="button" class:active={tab === 'safeties'} onclick={() => (tab = 'safeties')}>
      Safeties
    </button>
    <button type="button" class:active={tab === 'expansions'} onclick={() => (tab = 'expansions')}>
      Expansion
    </button>
    <button type="button" class:active={tab === 'actuators'} onclick={() => (tab = 'actuators')}>
      Actuators
    </button>
    <button type="button" class:active={tab === 'equipment'} onclick={() => (tab = 'equipment')}>
      Equipment
    </button>
  </div>

  {#if tab === 'controllers'}
    {#each controllerGroups as group (group.vendor)}
      <details class="group" open>
        <summary>
          <span class="group-name">{group.vendor}</span>
          <span class="group-count">{group.models.length}</span>
        </summary>
        <ul>
          {#each group.models as m (m.id)}
            <li
              class="model"
              class:highlight={highlightModelId === m.id}
              data-model-id={m.id}
              draggable="true"
              ondragstart={(e) => onDragController(e, m)}
              title={m.notes}
            >
              <div class="model-head">
                <strong class="mono">{m.model}</strong>
                <span class="role">{m.role}</span>
              </div>
              <div class="meta">
                <span class="pill {langClass(m.programmingLanguage)}" class:portable={m.stPortable}>
                  {m.programmingLanguage}
                </span>
                <span class="pts">{m.maxPoints} pts</span>
              </div>
              {#if m.points && formatPointBreakdown(m.points)}
                <div class="breakdown">{formatPointBreakdown(m.points)}</div>
              {/if}
              <div class="proto-row">
                {#each m.protocols as p}
                  <span class="proto">{p}</span>
                {/each}
              </div>
            </li>
          {/each}
        </ul>
      </details>
    {/each}
  {:else if tab === 'sensors'}
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
              class:highlight={highlightModelId === m.id}
              data-model-id={m.id}
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
  {:else if tab === 'safeties'}
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
              class:highlight={highlightModelId === d.id}
              data-model-id={d.id}
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
  {:else if tab === 'expansions'}
    <!-- Expansions tab: read-only catalog for now. Future: draggable child-of-parent nodes. -->
    <p class="hint">
      Drag a module onto the canvas, then wire it to a parent controller from the same vendor.
      Adds its I/O to the parent's point count.
    </p>
    {#each expansionGroups as group (group.vendor)}
      <details class="group" open>
        <summary>
          <span class="group-name">{group.vendor}</span>
          <span class="group-count">{group.modules.length}</span>
        </summary>
        <ul>
          {#each group.modules as m (m.id)}
            {@const compat = isExpansionCompatible(m)}
            <li
              class="model expansion-item"
              class:incompat={!compat}
              draggable={compat}
              ondragstart={(e) => compat && onDragExpansion(e, m)}
              title={compat ? m.notes : `Not compatible with the selected controller (clip-on to ${m.compatibleWith.join(', ')} only)`}
            >
              <div class="model-head">
                <strong class="mono">{m.model}</strong>
                <span class="role">{m.family}</span>
              </div>
              <div class="meta">
                {#if formatPointBreakdown(m.addedPoints)}
                  <span class="pill expansion-pill">+ {formatPointBreakdown(m.addedPoints)}</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </details>
    {/each}
  {:else if tab === 'actuators'}
    <p class="hint">
      Drag onto the canvas. Actuators receive the controller's AO/BO command and produce physical motion.
      Models with position feedback close the loop back to a UI/AI input.
    </p>
    {#each actuatorGroups as group (group.kind)}
      <details class="group" open>
        <summary>
          <span class="group-name">{actuatorKindLabel(group.kind)}</span>
          <span class="group-count">{group.models.length}</span>
        </summary>
        <ul>
          {#each group.models as a (a.id)}
            <li
              class="model"
              draggable="true"
              ondragstart={(e) => onDragActuator(e, a)}
              title={a.notes}
              data-model-id={a.id}
              class:highlight={highlightModelId === a.id}
            >
              <div class="model-head">
                <strong>{a.vendor}</strong>
                <span class="role mono">{a.model}</span>
              </div>
              <div class="meta">
                <span class="pill">{a.signal}</span>
                <span class="pill">{a.strokeSeconds}s stroke</span>
                <span class="pill">fail-{a.failSafe}</span>
                {#if a.hasPositionFeedback}
                  <span class="pill">+ feedback</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </details>
    {/each}
  {:else}
    <p class="hint">
      Drag a unit onto the canvas. Equipment defines what the actuators move (a damper inside a VAV box,
      a coil inside an AHU) and what the sensors measure.
    </p>
    {#each equipmentGroups as group (group.kind)}
      <details class="group" open>
        <summary>
          <span class="group-name">{equipmentKindLabel(group.kind)}</span>
          <span class="group-count">{group.models.length}</span>
        </summary>
        <ul>
          {#each group.models as e (e.id)}
            <li
              class="model"
              draggable="true"
              ondragstart={(ev) => onDragEquipment(ev, e)}
              title={e.notes}
              data-model-id={e.id}
              class:highlight={highlightModelId === e.id}
            >
              <div class="model-head">
                <strong>{e.vendor}</strong>
                <span class="role mono">{e.model}</span>
              </div>
              <div class="meta">
                <span class="pill">{e.category}</span>
                <span class="pill">{e.capacity}</span>
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
    padding: 0.3rem 0.15rem;
    font-size: 0.72rem;
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

  .model.expansion-item {
    border-left: 3px solid #4a9eff;
  }

  .model.incompat {
    opacity: 0.32;
    cursor: not-allowed;
    filter: grayscale(0.7);
  }

  .model.incompat:hover {
    background: transparent;
  }

  .model.highlight {
    background: color-mix(in srgb, #4a9eff 18%, transparent);
    border-left: 3px solid #4a9eff;
    animation: pulseHighlight 1.4s ease;
  }

  @keyframes pulseHighlight {
    0%   { background: color-mix(in srgb, #4a9eff 40%, transparent); }
    100% { background: color-mix(in srgb, #4a9eff 18%, transparent); }
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

  .model-head .mono,
  .model-head code {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.78rem;
  }

  .role {
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
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

  .pts {
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-variant-numeric: tabular-nums;
    margin-left: auto;
  }

  .breakdown {
    margin-top: 0.2rem;
    font-size: 0.62rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .proto-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
    margin-top: 0.25rem;
  }

  .proto {
    font-size: 0.6rem;
    padding: 0.02rem 0.35rem;
    border-radius: 3px;
    background: color-mix(in srgb, CanvasText 7%, transparent);
    color: color-mix(in srgb, CanvasText 65%, transparent);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
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

  .pill.portable {
    background: color-mix(in srgb, #2ecc71 18%, transparent);
    color: color-mix(in srgb, #2ecc71 90%, CanvasText);
    border: 1px solid color-mix(in srgb, #2ecc71 40%, transparent);
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

  .pill.expansion-pill {
    background: color-mix(in srgb, #4a9eff 14%, transparent);
    color: color-mix(in srgb, #4a9eff 90%, CanvasText);
  }

  .range,
  .acc {
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }
</style>
