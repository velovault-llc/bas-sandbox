<script lang="ts">
  import {
    VENDOR_CATALOG,
    SENSOR_CATALOG,
    SAFETY_CATALOG,
    formatPointBreakdown,
    type ControllerModel,
    type SensorModel,
    type SafetyDevice,
  } from '@bas/core';
  import {
    modelPickerStore,
    closeModelPicker,
    type PendingKind,
  } from '../canvasStore.svelte';

  let query = $state('');

  type ListItem =
    | { type: 'controller'; m: ControllerModel }
    | { type: 'sensor'; m: SensorModel }
    | { type: 'safety'; m: SafetyDevice };

  const items = $derived.by((): ListItem[] => {
    const kind = modelPickerStore.pending?.kind;
    if (!kind) return [];
    if (kind === 'controller') return VENDOR_CATALOG.map((m) => ({ type: 'controller' as const, m }));
    if (kind === 'sensor') return SENSOR_CATALOG.map((m) => ({ type: 'sensor' as const, m }));
    return SAFETY_CATALOG.map((m) => ({ type: 'safety' as const, m }));
  });

  const filtered = $derived.by((): ListItem[] => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      if (it.type === 'controller') {
        const m = it.m;
        return [m.vendor, m.model, m.family, m.programmingLanguage].some((s) => s.toLowerCase().includes(q));
      }
      if (it.type === 'sensor') {
        const m = it.m;
        return [m.vendor, m.model, m.subject, m.signal, m.mounting].some((s) => s.toLowerCase().includes(q));
      }
      const m = it.m;
      return [m.vendor, m.model, m.kind].some((s) => s.toLowerCase().includes(q));
    });
  });

  function pick(modelId: string | null): void {
    modelPickerStore.pending?.resolve(modelId);
    closeModelPicker();
    query = '';
  }

  function cancel(): void {
    modelPickerStore.pending?.cancel();
    closeModelPicker();
    query = '';
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && modelPickerStore.pending) cancel();
  }

  function kindHeader(k: PendingKind): string {
    return { controller: 'Pick a controller model', sensor: 'Pick a sensor model', safety: 'Pick a safety device' }[k];
  }
</script>

<svelte:window onkeydown={onKey} />

{#if modelPickerStore.pending}
  {@const kind = modelPickerStore.pending.kind}
  <div class="picker-backdrop" onclick={cancel} role="presentation"></div>
  <div class="picker" role="dialog" aria-labelledby="picker-title">
    <header class="picker-head">
      <h3 id="picker-title">{kindHeader(kind)}</h3>
      <button type="button" class="close" onclick={cancel} title="Cancel (Esc)">✕</button>
    </header>

    <div class="search-row">
      <input
        type="text"
        placeholder="Search by vendor, model, signal type, family…"
        bind:value={query}
        autofocus
      />
      <span class="muted">{filtered.length} of {items.length}</span>
    </div>

    <div class="list">
      <button type="button" class="generic-row" onclick={() => pick(null)}>
        <strong>○ Generic placeholder</strong>
        <span class="muted">No real-world model — for rapid sketching only. Use the catalog when possible.</span>
      </button>

      {#each filtered as it (it.type === 'controller' ? it.m.id : it.type === 'sensor' ? it.m.id : it.m.id)}
        {#if it.type === 'controller'}
          <button type="button" class="row" onclick={() => pick(it.m.id)}>
            <div class="row-head">
              <strong>{it.m.vendor}</strong>
              <code>{it.m.model}</code>
              <span class="pill role">{it.m.role}</span>
            </div>
            <div class="row-meta">
              <span class="pill lang" class:portable={it.m.stPortable}>{it.m.programmingLanguage}</span>
              <span class="pts">{it.m.maxPoints} pts{it.m.points && formatPointBreakdown(it.m.points) ? ` · ${formatPointBreakdown(it.m.points)}` : ''}</span>
              <span class="muted">{it.m.protocols.join(', ')}</span>
            </div>
          </button>
        {:else if it.type === 'sensor'}
          <button type="button" class="row" onclick={() => pick(it.m.id)}>
            <div class="row-head">
              <strong>{it.m.vendor}</strong>
              <code>{it.m.model}</code>
              <span class="pill">{it.m.subject}</span>
            </div>
            <div class="row-meta">
              <span class="pill signal">{it.m.signal}</span>
              <span class="pill mount">{it.m.mounting}</span>
              <span class="muted">{it.m.range[0]}–{it.m.range[1]} {it.m.units} · {it.m.accuracy}</span>
            </div>
          </button>
        {:else}
          <button type="button" class="row" onclick={() => pick(it.m.id)}>
            <div class="row-head">
              <strong>{it.m.vendor}</strong>
              <code>{it.m.model}</code>
              <span class="pill">{it.m.kind}</span>
            </div>
            <div class="row-meta">
              <span class="pill" class:nc={it.m.normalState === 'NC'} class:no={it.m.normalState === 'NO'}>
                {it.m.normalState}
              </span>
              <span class="pill" class:manual={it.m.resetBehavior === 'manual'}>
                {it.m.resetBehavior} reset
              </span>
              {#if it.m.tripPoint}
                <span class="muted">trip @ {it.m.tripPoint.value} {it.m.tripPoint.units}</span>
              {/if}
            </div>
          </button>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  .picker-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 100;
    backdrop-filter: blur(2px);
  }

  .picker {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(680px, calc(100vw - 2rem));
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background: Canvas;
    color: CanvasText;
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    border-radius: 10px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
    z-index: 101;
    overflow: hidden;
  }

  .picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 1rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    background: color-mix(in srgb, Canvas 92%, CanvasText 4%);
  }

  .picker-head h3 {
    margin: 0;
    font-size: 1rem;
  }

  .close {
    background: transparent;
    border: 0;
    color: inherit;
    font-size: 1.1rem;
    cursor: pointer;
    padding: 0.2rem 0.45rem;
    border-radius: 4px;
  }

  .close:hover {
    background: color-mix(in srgb, CanvasText 10%, transparent);
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.55rem 1rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
  }

  .search-row input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    border-radius: 5px;
    background: Canvas;
    color: inherit;
    font: inherit;
    font-size: 0.88rem;
  }

  .muted {
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-size: 0.8rem;
  }

  .list {
    overflow-y: auto;
    padding: 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .generic-row {
    text-align: left;
    background: color-mix(in srgb, CanvasText 5%, transparent);
    border: 1px dashed color-mix(in srgb, CanvasText 25%, transparent);
    border-radius: 6px;
    padding: 0.55rem 0.7rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    color: inherit;
    font: inherit;
  }

  .generic-row:hover {
    background: color-mix(in srgb, CanvasText 10%, transparent);
  }

  .row {
    text-align: left;
    background: Canvas;
    border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
    border-radius: 6px;
    padding: 0.55rem 0.7rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    color: inherit;
    font: inherit;
  }

  .row:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
    border-color: color-mix(in srgb, CanvasText 30%, transparent);
  }

  .row-head {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .row-head strong {
    font-size: 0.88rem;
  }

  .row-head code {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.78rem;
    color: color-mix(in srgb, CanvasText 75%, transparent);
  }

  .row-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: center;
    font-size: 0.7rem;
  }

  .pill {
    padding: 0.05rem 0.4rem;
    border-radius: 8px;
    background: color-mix(in srgb, CanvasText 9%, transparent);
    color: color-mix(in srgb, CanvasText 80%, transparent);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .pill.role {
    background: color-mix(in srgb, #4a9eff 15%, transparent);
    color: color-mix(in srgb, #4a9eff 90%, CanvasText);
  }

  .pill.lang.portable {
    background: color-mix(in srgb, #2ecc71 18%, transparent);
    color: color-mix(in srgb, #2ecc71 92%, CanvasText);
  }

  .pill.signal {
    background: color-mix(in srgb, #4a9eff 18%, transparent);
    color: color-mix(in srgb, #4a9eff 90%, CanvasText);
  }

  .pill.mount {
    background: color-mix(in srgb, #2ecc71 18%, transparent);
    color: color-mix(in srgb, #2ecc71 90%, CanvasText);
  }

  .pill.nc {
    background: color-mix(in srgb, #2ecc71 22%, transparent);
    color: color-mix(in srgb, #2ecc71 95%, CanvasText);
  }

  .pill.no {
    background: color-mix(in srgb, #f39c12 22%, transparent);
    color: color-mix(in srgb, #f39c12 95%, CanvasText);
  }

  .pill.manual {
    background: color-mix(in srgb, #e74c3c 22%, transparent);
    color: color-mix(in srgb, #e74c3c 95%, CanvasText);
  }

  .pts {
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-variant-numeric: tabular-nums;
  }
</style>
