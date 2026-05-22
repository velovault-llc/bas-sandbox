<script lang="ts">
  // SpecLang editor — plain-English BAS programming.
  //
  // Left palette: tile catalog grouped by category (trigger / action /
  // subject / actuator / operator / value / literal).
  // Center: list of rules. Each rule = a row of tiles. Click a tile in
  // the palette to append it to the active rule.
  // Right (toggle): the compiled ST source the sim actually runs.
  //
  // Click-to-append for v1 — drag/drop is v1.1. Tiles are removable
  // via per-tile ✕. Value tiles get a small inline number input so the
  // user can set 72°F / 20% / 800 ppm etc.

  import {
    tileCatalogByKind,
    compileSpecLang,
    type Tile,
    type SpecRule,
    type SpecProgram,
    type TileKind,
    type TileTemplate,
  } from '@bas/core';
  import {
    programStore,
    closeSpecLang,
    setProgramSpec,
  } from '../cli/programStore.svelte';

  const palette = tileCatalogByKind();
  const CATEGORY_ORDER: TileKind[] = ['trigger', 'action', 'subject', 'actuator', 'operator', 'value', 'literal'];
  const CATEGORY_LABEL: Record<TileKind, string> = {
    trigger: 'Triggers',
    action: 'Actions',
    subject: 'Subjects (inputs)',
    actuator: 'Actuators (outputs)',
    operator: 'Operators',
    value: 'Values',
    literal: 'Literals',
  };
  const CATEGORY_COLOR: Record<TileKind, string> = {
    trigger: '#27ae60',
    action: '#f39c12',
    subject: '#3498db',
    actuator: '#9b59b6',
    operator: '#e67e22',
    value: '#16a085',
    literal: '#7f8c8d',
  };

  // Live program state — initialized from the persisted store.
  const ctrlId = $derived(programStore.activeSpecLangControllerId);
  const ctrlLabel = $derived(programStore.activeSpecLangControllerLabel ?? '');
  let rules = $state<SpecRule[]>([]);
  let activeRuleId = $state<string | null>(null);
  let showCompiled = $state(false);

  // Re-hydrate from store when the active controller changes.
  $effect(() => {
    if (!ctrlId) return;
    const existing = programStore.byId[ctrlId];
    if (existing?.specProgram) {
      rules = existing.specProgram.rules.map((r) => ({ ...r, tiles: [...r.tiles] }));
    } else {
      rules = [];
    }
    activeRuleId = rules[0]?.id ?? null;
  });

  const program = $derived<SpecProgram>({ rules });
  const compileResult = $derived(compileSpecLang(program));

  function nextId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function addRule(): void {
    const r: SpecRule = { id: nextId('r'), tiles: [] };
    rules = [...rules, r];
    activeRuleId = r.id;
  }

  function deleteRule(id: string): void {
    rules = rules.filter((r) => r.id !== id);
    if (activeRuleId === id) activeRuleId = rules[0]?.id ?? null;
  }

  function appendTile(template: TileTemplate): void {
    if (!activeRuleId) {
      addRule();
    }
    const targetId = activeRuleId;
    if (!targetId) return;
    const tile: Tile = {
      id: nextId('t'),
      kind: template.kind,
      token: template.token,
      display: template.display,
      numericValue: template.defaultNumeric,
      units: template.defaultUnits,
    };
    rules = rules.map((r) =>
      r.id === targetId ? { ...r, tiles: [...r.tiles, tile] } : r,
    );
  }

  function removeTile(ruleId: string, tileId: string): void {
    rules = rules.map((r) =>
      r.id === ruleId ? { ...r, tiles: r.tiles.filter((t) => t.id !== tileId) } : r,
    );
  }

  function updateTileValue(ruleId: string, tileId: string, value: number): void {
    rules = rules.map((r) => {
      if (r.id !== ruleId) return r;
      return {
        ...r,
        tiles: r.tiles.map((t) => (t.id === tileId ? { ...t, numericValue: value } : t)),
      };
    });
  }

  /** Push the assembled program to the controller's live runtime. */
  function deployToController(): void {
    if (!ctrlId) return;
    setProgramSpec(ctrlId, { rules });
  }

  function renderTileLabel(tile: Tile): string {
    if (tile.kind === 'value') {
      return `${tile.numericValue ?? 0} ${tile.units ?? ''}`.trim();
    }
    return tile.display;
  }
</script>

{#if ctrlId}
  <div class="speclang-overlay" role="dialog" aria-label="SpecLang plain-English editor">
    <header class="head">
      <div class="head-title">
        <strong>SpecLang</strong>
        <span class="muted">— plain-English programming for</span>
        <span class="ctrl-label">{ctrlLabel}</span>
      </div>
      <div class="head-actions">
        <button type="button" class="action" onclick={() => (showCompiled = !showCompiled)} title="Toggle the compiled ST view">
          {showCompiled ? '◀ Hide ST' : 'Show ST ▶'}
        </button>
        <button type="button" class="deploy" onclick={deployToController} disabled={!compileResult.ok} title={compileResult.ok ? 'Push this program to the controller runtime' : 'Fix the rule errors first'}>
          ⤓ Download to controller
        </button>
        <button type="button" class="close" onclick={closeSpecLang} title="Close editor (program kept)">
          ✕
        </button>
      </div>
    </header>

    <div class="body" class:with-st={showCompiled}>
      <aside class="palette" aria-label="Tile palette">
        {#each CATEGORY_ORDER as kind (kind)}
          {@const tiles = palette.get(kind) ?? []}
          {#if tiles.length > 0}
            <section class="palette-section" style:--c={CATEGORY_COLOR[kind]}>
              <h4>{CATEGORY_LABEL[kind]}</h4>
              <div class="palette-tiles">
                {#each tiles as t (t.token)}
                  <button
                    type="button"
                    class="tile pal kind-{kind}"
                    title={t.description}
                    onclick={() => appendTile(t)}
                  >
                    {t.display}
                  </button>
                {/each}
              </div>
            </section>
          {/if}
        {/each}
      </aside>

      <main class="rules-area">
        <div class="rules-head">
          <h3>Program rules</h3>
          <button type="button" class="add-rule" onclick={addRule}>+ Add rule</button>
        </div>

        {#if rules.length === 0}
          <p class="empty-state">
            No rules yet. Click <strong>+ Add rule</strong> above, then click tiles in the palette to assemble a sentence like
            <em>"When zone temp exceeds cooling setpoint by 1°F → Open primary damper to 100%."</em>
          </p>
        {/if}

        <ol class="rules-list">
          {#each rules as rule (rule.id)}
            {@const err = compileResult.errors.get(rule.id)}
            <li class="rule" class:active={activeRuleId === rule.id} class:has-error={!!err}>
              <button
                type="button"
                class="rule-select"
                onclick={() => (activeRuleId = rule.id)}
                title="Click to make this the active rule for tile appends"
              >
                {activeRuleId === rule.id ? '▶' : '·'}
              </button>
              <div class="rule-body">
                {#if rule.tiles.length === 0}
                  <span class="rule-empty">Click a TRIGGER tile (When / While) to start this rule.</span>
                {/if}
                <div class="rule-tiles">
                  {#each rule.tiles as tile (tile.id)}
                    <span class="tile placed kind-{tile.kind}" style:--c={CATEGORY_COLOR[tile.kind]}>
                      {#if tile.kind === 'value'}
                        <input
                          type="number"
                          class="value-input"
                          value={tile.numericValue ?? 0}
                          onchange={(e) => updateTileValue(rule.id, tile.id, Number((e.currentTarget as HTMLInputElement).value))}
                          step="any"
                        />
                        <span class="value-units">{tile.units ?? ''}</span>
                      {:else}
                        {renderTileLabel(tile)}
                      {/if}
                      <button
                        type="button"
                        class="tile-remove"
                        title="Remove this tile"
                        onclick={() => removeTile(rule.id, tile.id)}
                      >✕</button>
                    </span>
                  {/each}
                </div>
                {#if err}
                  <div class="rule-error">⚠ {err}</div>
                {/if}
              </div>
              <button
                type="button"
                class="rule-delete"
                title="Delete this rule"
                onclick={() => deleteRule(rule.id)}
              >✕</button>
            </li>
          {/each}
        </ol>
      </main>

      {#if showCompiled}
        <aside class="st-view" aria-label="Compiled Structured Text">
          <h4>Compiled ST <span class="muted">(what the sim runs)</span></h4>
          {#if compileResult.source}
            <pre>{compileResult.source}</pre>
          {:else}
            <p class="muted">Empty program. Add rules to see the compiled output.</p>
          {/if}
        </aside>
      {/if}
    </div>
  </div>
{/if}

<style>
  .speclang-overlay {
    position: absolute;
    inset: 1rem;
    z-index: 50;
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
  .head-title {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }
  .head-title strong { font-size: 1rem; }
  .muted { color: color-mix(in srgb, CanvasText 55%, transparent); font-size: 0.85rem; }
  .ctrl-label { font-family: ui-monospace, Menlo, monospace; font-size: 0.85rem; color: color-mix(in srgb, CanvasText 85%, transparent); }
  .head-actions { display: flex; gap: 0.4rem; }
  .head-actions button {
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    background: transparent;
    color: CanvasText;
    padding: 0.3rem 0.7rem;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
  }
  .head-actions .deploy {
    border-color: #16a085;
    color: #16a085;
  }
  .head-actions .deploy:hover:not(:disabled) {
    background: color-mix(in srgb, #16a085 18%, transparent);
  }
  .head-actions .deploy:disabled { opacity: 0.4; cursor: not-allowed; }
  .head-actions .close { border-color: #e74c3c; color: #e74c3c; }
  .head-actions .close:hover { background: color-mix(in srgb, #e74c3c 12%, transparent); }

  .body {
    flex: 1;
    display: grid;
    grid-template-columns: 18rem 1fr;
    min-height: 0;
  }
  .body.with-st {
    grid-template-columns: 18rem 1fr 22rem;
  }

  .palette {
    overflow-y: auto;
    padding: 0.8rem;
    border-right: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    background: color-mix(in srgb, Canvas 94%, CanvasText 2%);
  }
  .palette-section { margin-bottom: 1rem; }
  .palette-section h4 {
    margin: 0 0 0.4rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--c, color-mix(in srgb, CanvasText 70%, transparent));
  }
  .palette-tiles { display: flex; flex-wrap: wrap; gap: 0.3rem; }

  .tile {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.55rem;
    border-radius: 14px;
    font-size: 0.85rem;
    cursor: pointer;
    font-family: inherit;
    line-height: 1.2;
    border: 1px solid var(--c);
    background: color-mix(in srgb, var(--c) 12%, transparent);
    color: var(--c);
    transition: background 0.12s ease;
  }
  .tile:hover { background: color-mix(in srgb, var(--c) 25%, transparent); }
  .tile.kind-trigger  { --c: #27ae60; }
  .tile.kind-action   { --c: #f39c12; }
  .tile.kind-subject  { --c: #3498db; }
  .tile.kind-actuator { --c: #9b59b6; }
  .tile.kind-operator { --c: #e67e22; }
  .tile.kind-value    { --c: #16a085; }
  .tile.kind-literal  { --c: #7f8c8d; }
  .tile.placed { padding-right: 0.3rem; }
  .tile-remove {
    background: transparent;
    border: none;
    color: inherit;
    font-size: 0.7rem;
    cursor: pointer;
    padding: 0 0.2rem;
    opacity: 0.6;
  }
  .tile-remove:hover { opacity: 1; }

  .value-input {
    width: 4ch;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    text-align: right;
    -moz-appearance: textfield;
  }
  .value-input::-webkit-outer-spin-button,
  .value-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .value-units { color: inherit; opacity: 0.85; }

  .rules-area {
    padding: 1rem 1.2rem;
    overflow-y: auto;
  }
  .rules-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; }
  .rules-head h3 { margin: 0; font-size: 0.95rem; }
  .add-rule {
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    background: transparent;
    color: CanvasText;
    padding: 0.3rem 0.8rem;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
  }
  .add-rule:hover { background: color-mix(in srgb, CanvasText 8%, transparent); }

  .empty-state {
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-size: 0.88rem;
    padding: 1.2rem;
    background: color-mix(in srgb, CanvasText 4%, transparent);
    border: 1px dashed color-mix(in srgb, CanvasText 25%, transparent);
    border-radius: 6px;
  }

  .rules-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .rule {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, Canvas 98%, transparent);
  }
  .rule.active { border-color: #27ae60; box-shadow: 0 0 0 2px color-mix(in srgb, #27ae60 25%, transparent); }
  .rule.has-error { border-color: #e74c3c; }
  .rule-select {
    background: transparent; border: none; cursor: pointer; color: inherit;
    font-size: 1rem; padding: 0; width: 1.2rem; text-align: center;
  }
  .rule-body { flex: 1; min-width: 0; }
  .rule-tiles { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .rule-empty { color: color-mix(in srgb, CanvasText 50%, transparent); font-size: 0.85rem; font-style: italic; }
  .rule-error {
    color: #e74c3c;
    font-size: 0.78rem;
    margin-top: 0.35rem;
  }
  .rule-delete {
    background: transparent; border: none; cursor: pointer;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    font-size: 0.85rem; padding: 0 0.3rem;
  }
  .rule-delete:hover { color: #e74c3c; }

  .st-view {
    overflow-y: auto;
    padding: 0.8rem 1rem;
    border-left: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    background: color-mix(in srgb, Canvas 92%, CanvasText 4%);
  }
  .st-view h4 { margin: 0 0 0.5rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; }
  .st-view pre {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.78rem;
    line-height: 1.4;
    white-space: pre-wrap;
    color: color-mix(in srgb, CanvasText 90%, transparent);
  }
</style>
