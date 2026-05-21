<script lang="ts">
  import {
    controllerCatalogByVendor,
    formatPointBreakdown,
    type ControllerModel,
  } from '@bas/core';

  const grouped = $derived.by(() => {
    const map = controllerCatalogByVendor();
    return Array.from(map.entries()).map(([vendor, models]) => ({ vendor, models }));
  });

  let collapsedVendors = $state<Record<string, boolean>>({});

  function toggleVendor(v: string): void {
    collapsedVendors[v] = !collapsedVendors[v];
  }

  function onDragStart(event: DragEvent, model: ControllerModel): void {
    if (!event.dataTransfer) return;
    // Reuse the existing "drop a controller" pathway: kind=controller +
    // vendor id as a secondary payload BuildCanvas reads in onCanvasDrop.
    event.dataTransfer.setData('application/bas-node-kind', 'controller');
    event.dataTransfer.setData('application/bas-controller-vendor', model.id);
    event.dataTransfer.effectAllowed = 'move';
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

<section class="vendor-palette" aria-label="Vendor controller catalog">
  <header class="cat-head">
    <h3>Vendor catalog</h3>
    <p class="hint">Drag any model onto the canvas. ST programs only run natively on IEC 61131-3 gear (green pills).</p>
  </header>

  {#each grouped as group (group.vendor)}
    {@const collapsed = !!collapsedVendors[group.vendor]}
    <details class="vendor-group" open={!collapsed}>
      <summary onclick={() => toggleVendor(group.vendor)}>
        <span class="vendor-name">{group.vendor}</span>
        <span class="vendor-count">{group.models.length}</span>
      </summary>
      <ul class="model-list">
        {#each group.models as model (model.id)}
          <li
            class="model"
            draggable="true"
            ondragstart={(e) => onDragStart(e, model)}
            title={model.notes}
          >
            <div class="model-head">
              <strong class="model-name">{model.model}</strong>
              <span class="model-role">{model.role}</span>
            </div>
            <div class="model-meta">
              <span class="lang-pill {langClass(model.programmingLanguage)}" class:portable={model.stPortable}>
                {model.programmingLanguage}
              </span>
              <span class="pts">{model.maxPoints} pts</span>
            </div>
            {#if model.points && formatPointBreakdown(model.points)}
              <div class="point-breakdown">{formatPointBreakdown(model.points)}</div>
            {/if}
            <div class="proto-row">
              {#each model.protocols as p}
                <span class="proto">{p}</span>
              {/each}
            </div>
          </li>
        {/each}
      </ul>
    </details>
  {/each}
</section>

<style>
  .vendor-palette {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.25rem 0;
  }

  .cat-head h3 {
    margin: 0 0 0.2rem 0;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .cat-head .hint {
    margin: 0 0 0.4rem 0;
    font-size: 0.75rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    line-height: 1.35;
  }

  .vendor-group {
    border: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, Canvas 95%, CanvasText 3%);
  }

  .vendor-group summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }

  .vendor-group summary::-webkit-details-marker {
    display: none;
  }

  .vendor-group summary::before {
    content: '▸';
    margin-right: 0.4rem;
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    transition: transform 120ms ease;
  }

  .vendor-group[open] summary::before {
    transform: rotate(90deg);
    display: inline-block;
  }

  .vendor-name {
    font-weight: 600;
    font-size: 0.82rem;
    flex: 1;
  }

  .vendor-count {
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-variant-numeric: tabular-nums;
    padding: 0.05rem 0.4rem;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    border-radius: 8px;
  }

  .model-list {
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

  .model:active {
    cursor: grabbing;
  }

  .model-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.4rem;
  }

  .model-name {
    font-size: 0.8rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .model-role {
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .model-meta {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.2rem;
  }

  .lang-pill {
    font-size: 0.65rem;
    padding: 0.05rem 0.4rem;
    border-radius: 8px;
    background: color-mix(in srgb, CanvasText 10%, transparent);
    color: color-mix(in srgb, CanvasText 80%, transparent);
    border: 1px solid transparent;
  }

  .lang-pill.portable {
    background: color-mix(in srgb, #2ecc71 18%, transparent);
    color: color-mix(in srgb, #2ecc71 90%, CanvasText);
    border-color: color-mix(in srgb, #2ecc71 40%, transparent);
  }

  .pts {
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-variant-numeric: tabular-nums;
    margin-left: auto;
  }

  .point-breakdown {
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
</style>
