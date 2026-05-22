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

  import { onMount } from 'svelte';
  import {
    tileCatalogByKind,
    compileSpecLang,
    findControllerModel,
    findSensorModel,
    type Tile,
    type SpecRule,
    type SpecProgram,
    type TileKind,
    type TileTemplate,
    type PointBinding,
    type ControllerBindings,
  } from '@bas/core';
  import {
    programStore,
    closeSpecLang,
    setProgramSpec,
    setProgramBindings,
  } from '../cli/programStore.svelte';
  import { canvasSnapshot } from '../canvasStore.svelte';

  // Escape-key closer — guarantees a recovery path even if the ✕ button
  // is somehow blocked by an overlapping element.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && programStore.activeSpecLangControllerId) {
        closeSpecLang();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
  let showPoints = $state(true); // Point Assignments visible by default — it's the first step

  // Local mirror of the saved bindings so dropdown edits are responsive.
  // Synced to programStore via the same loadedForCtrl effect below.
  let bindings = $state<PointBinding[]>([]);

  // Role catalogs — derived from the tile palette so adding a new subject
  // tile automatically exposes it as an assignable role.
  // Skip internal subjects (setpoints, schedules) — they're controller
  // config values, not physical inputs, so they shouldn't appear in the
  // Point Assignment role dropdowns.
  const subjectRoles = $derived(
    (palette.get('subject') ?? [])
      .filter((t) => !t.internal)
      .map((t) => ({ token: t.token, display: t.display, description: t.description })),
  );
  const actuatorRoles = $derived(
    (palette.get('actuator') ?? []).map((t) => ({ token: t.token, display: t.display, description: t.description })),
  );

  /** What's wired to a given target terminal on the active controller. */
  function sensorOnTerminal(terminalId: string): { sensorNodeId: string; sensorLabel: string; sensorSubtitle: string } | null {
    if (!ctrlId) return null;
    for (const e of canvasSnapshot.edges) {
      if (e.target !== ctrlId) continue;
      if (e.targetHandle !== terminalId) continue;
      const sensor = canvasSnapshot.nodes.find((n) => n.id === e.source);
      if (!sensor) continue;
      const data = sensor.data as { label?: string; sensorModelId?: string };
      const senModel = data.sensorModelId ? findSensorModel(data.sensorModelId) : undefined;
      return {
        sensorNodeId: sensor.id,
        sensorLabel: data.label ?? sensor.id,
        sensorSubtitle: senModel ? `${senModel.vendor} ${senModel.model} · ${senModel.subject}` : 'unknown sensor',
      };
    }
    return null;
  }

  /** Build the full input-terminal list from the controller's model. Lists
   *  every UI/AI/BI channel — wired or not — so the user can pre-assign a
   *  role to a terminal that hasn't been wired yet (the "plan the point
   *  list before the install" flow real commissioning agents follow). */
  const inputTerminals = $derived.by(() => {
    if (!ctrlId) return [];
    const node = canvasSnapshot.nodes.find((n) => n.id === ctrlId);
    if (!node) return [];
    const vendorModelId = (node.data as { vendorModelId?: string }).vendorModelId;
    const model = vendorModelId ? findControllerModel(vendorModelId) : undefined;
    // Fallback for generic controllers (no vendor pick): permissive 8/4/4 mix.
    const counts = (model?.points ?? { UI: 8, AI: 4, BI: 4 }) as Record<string, number | undefined>;
    const out: string[] = [];
    for (const kind of ['UI', 'AI', 'BI'] as const) {
      const n = counts[kind] ?? 0;
      for (let i = 1; i <= n; i++) out.push(`${kind}-${i}`);
    }
    return out;
  });

  /** Output terminals (UO/AO/BO). Same logic — list all, wired or not. */
  const outputTerminals = $derived.by(() => {
    if (!ctrlId) return [];
    const node = canvasSnapshot.nodes.find((n) => n.id === ctrlId);
    if (!node) return [];
    const vendorModelId = (node.data as { vendorModelId?: string }).vendorModelId;
    const model = vendorModelId ? findControllerModel(vendorModelId) : undefined;
    const counts = (model?.points ?? { UO: 0, AO: 4, BO: 4 }) as Record<string, number | undefined>;
    const out: string[] = [];
    for (const kind of ['UO', 'AO', 'BO'] as const) {
      const n = counts[kind] ?? 0;
      for (let i = 1; i <= n; i++) out.push(`${kind}-${i}`);
    }
    return out;
  });

  function bindingFor(terminalId: string): PointBinding | undefined {
    return bindings.find((b) => b.terminalId === terminalId);
  }

  function setBindingRole(terminalId: string, role: string, sensorNodeId?: string): void {
    const next = bindings.filter((b) => b.terminalId !== terminalId);
    // Also clear any prior binding that used this role on a different
    // terminal — a role can only be claimed by ONE point at a time.
    const cleaned = next.filter((b) => b.role !== role);
    if (role && role !== '__unassigned__') {
      cleaned.push({ terminalId, role, sourceNodeId: sensorNodeId });
    }
    bindings = cleaned;
    if (ctrlId) setProgramBindings(ctrlId, { bindings: cleaned });
  }

  // Re-hydrate from store when the active controller changes.
  // CRITICAL: compute `nextRules` once and assign both `rules` and
  // `activeRuleId` from it. Reading `rules` after writing it inside the
  // effect would add it as a tracked dep — then writing to it would
  // re-fire the effect forever (Svelte throws effect_update_depth_exceeded
  // and locks up reactivity, which silently breaks every click handler
  // including the close button).
  let loadedForCtrl = $state<string | null>(null);
  $effect(() => {
    const id = ctrlId;
    if (!id) {
      loadedForCtrl = null;
      return;
    }
    if (id === loadedForCtrl) return;
    loadedForCtrl = id;
    const existing = programStore.byId[id];
    const nextRules: SpecRule[] = existing?.specProgram
      ? existing.specProgram.rules.map((r) => ({ ...r, tiles: [...r.tiles] }))
      : [];
    const nextBindings: PointBinding[] = existing?.bindings?.bindings
      ? existing.bindings.bindings.map((b) => ({ ...b }))
      : [];
    rules = nextRules;
    bindings = nextBindings;
    activeRuleId = nextRules[0]?.id ?? null;
  });

  const program = $derived<SpecProgram>({ rules });
  const currentBindings = $derived<ControllerBindings>({ bindings });
  const compileResult = $derived(compileSpecLang(program, currentBindings));

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

  /** Swap a tile with its left neighbor within the same rule (no-op at
   *  position 0). Powers the ← arrow button on each placed tile. */
  function moveTileLeft(ruleId: string, tileId: string): void {
    rules = rules.map((r) => {
      if (r.id !== ruleId) return r;
      const idx = r.tiles.findIndex((t) => t.id === tileId);
      if (idx <= 0) return r;
      const next = [...r.tiles];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return { ...r, tiles: next };
    });
  }

  /** Swap a tile with its right neighbor within the same rule (no-op at
   *  the end). Powers the → arrow button on each placed tile. */
  function moveTileRight(ruleId: string, tileId: string): void {
    rules = rules.map((r) => {
      if (r.id !== ruleId) return r;
      const idx = r.tiles.findIndex((t) => t.id === tileId);
      if (idx < 0 || idx >= r.tiles.length - 1) return r;
      const next = [...r.tiles];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return { ...r, tiles: next };
    });
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
  let deployToast = $state<{ msg: string; at: number } | null>(null);
  function deployToController(): void {
    if (!ctrlId) return;
    const prog = setProgramSpec(ctrlId, { rules });
    const errBits = prog.error ? ` (compile error: ${prog.error})` : '';
    const okBits = `${rules.length} rule${rules.length === 1 ? '' : 's'} · ${ctrlLabel}`;
    deployToast = {
      msg: prog.compiled ? `✓ Downloaded — ${okBits}` : `⚠ Stored but not running — ${okBits}${errBits}`,
      at: Date.now(),
    };
    // Auto-hide after 4 seconds.
    setTimeout(() => {
      if (deployToast && Date.now() - deployToast.at >= 3900) deployToast = null;
    }, 4000);
  }


  function renderTileLabel(tile: Tile): string {
    if (tile.kind === 'value') {
      return `${tile.numericValue ?? 0} ${tile.units ?? ''}`.trim();
    }
    return tile.display;
  }
</script>

{#if ctrlId}
  <div
    class="speclang-backdrop"
    role="presentation"
    onclick={(e) => {
      // Click on the backdrop (but not inside the overlay) → close
      if (e.target === e.currentTarget) {
        closeSpecLang();
      }
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') closeSpecLang();
    }}
    tabindex="-1"
  >
  <div class="speclang-overlay" role="dialog" aria-label="SpecLang plain-English editor">
    <header class="head">
      <div class="head-title">
        <strong>SpecLang</strong>
        <span class="muted">— plain-English programming for</span>
        <span class="ctrl-label">{ctrlLabel}</span>
      </div>
      <div class="head-actions">
        <button type="button" class="action" onclick={() => (showPoints = !showPoints)} title="Toggle the Point Assignments panel">
          {showPoints ? '▲ Hide points' : '▼ Show points'}
        </button>
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

    {#if deployToast}
      <div class="deploy-toast" class:err={deployToast.msg.startsWith('⚠')}>
        {deployToast.msg}
      </div>
    {/if}

    {#if showPoints}
      <section class="points-panel" aria-label="Point assignments">
        <header class="points-head">
          <h3>Point Assignments</h3>
          <span class="muted">map each physical terminal to a logical role · prevents "wrong sensor wired to wrong rule" bugs</span>
        </header>
        <div class="points-grid">
          <div class="points-col">
            <h4>Inputs (UI / AI / BI terminals)</h4>
            {#if inputTerminals.length === 0}
              <p class="muted small">No input terminals on this controller model.</p>
            {/if}
            {#each inputTerminals as terminalId (terminalId)}
              {@const b = bindingFor(terminalId)}
              {@const wired = sensorOnTerminal(terminalId)}
              <div class="point-row" class:unwired={!wired}>
                <span class="terminal-badge kind-input">{terminalId}</span>
                <div class="point-info">
                  {#if wired}
                    <strong>{wired.sensorLabel}</strong>
                    <span class="muted small">{wired.sensorSubtitle}</span>
                  {:else}
                    <strong class="muted">(no sensor wired)</strong>
                    <span class="muted small">assign a role to pre-plan, or wire a sensor first</span>
                  {/if}
                </div>
                <select
                  class="role-select"
                  value={b?.role ?? '__unassigned__'}
                  onchange={(e) => setBindingRole(terminalId, (e.currentTarget as HTMLSelectElement).value, wired?.sensorNodeId)}
                >
                  <option value="__unassigned__">— pick role —</option>
                  {#each subjectRoles as r (r.token)}
                    <option value={r.token}>{r.display}</option>
                  {/each}
                </select>
              </div>
            {/each}
          </div>

          <div class="points-col">
            <h4>Outputs (controller terminals)</h4>
            {#if outputTerminals.length === 0}
              <p class="muted small">No output terminals on this controller model.</p>
            {/if}
            {#each outputTerminals as terminalId (terminalId)}
              {@const b = bindingFor(terminalId)}
              <div class="point-row">
                <span class="terminal-badge kind-output">{terminalId}</span>
                <div class="point-info">
                  <span class="muted small">drives an actuator</span>
                </div>
                <select
                  class="role-select"
                  value={b?.role ?? '__unassigned__'}
                  onchange={(e) => setBindingRole(terminalId, (e.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="__unassigned__">— pick role —</option>
                  {#each actuatorRoles as r (r.token)}
                    <option value={r.token}>{r.display}</option>
                  {/each}
                </select>
              </div>
            {/each}
          </div>
        </div>
      </section>
    {/if}

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
                  {#each rule.tiles as tile, idx (tile.id)}
                    <span class="tile placed kind-{tile.kind}" style:--c={CATEGORY_COLOR[tile.kind]}>
                      <button
                        type="button"
                        class="tile-move"
                        title="Move this tile left"
                        disabled={idx === 0}
                        onclick={() => moveTileLeft(rule.id, tile.id)}
                      >←</button>
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
                        class="tile-move"
                        title="Move this tile right"
                        disabled={idx === rule.tiles.length - 1}
                        onclick={() => moveTileRight(rule.id, tile.id)}
                      >→</button>
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
                {#each compileResult.warnings.get(rule.id) ?? [] as warn}
                  <div class="rule-warning">⚠ {warn}</div>
                {/each}
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
  </div>
{/if}

<style>
  .speclang-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: stretch;
    justify-content: stretch;
    padding: 1rem;
  }
  .speclang-overlay {
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
  .tile-remove,
  .tile-move {
    background: transparent;
    border: none;
    color: inherit;
    font-size: 0.7rem;
    cursor: pointer;
    padding: 0 0.2rem;
    opacity: 0.55;
    font-family: inherit;
  }
  .tile-remove:hover,
  .tile-move:hover:not(:disabled) { opacity: 1; }
  .tile-move:disabled { opacity: 0.18; cursor: not-allowed; }

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
  .rule-warning {
    color: #f39c12;
    font-size: 0.78rem;
    margin-top: 0.25rem;
  }

  .points-panel {
    border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    padding: 0.7rem 1.2rem 0.9rem;
    background: color-mix(in srgb, Canvas 94%, CanvasText 2%);
  }
  .points-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .points-head h3 { margin: 0; font-size: 0.9rem; }
  .points-head .muted { font-size: 0.72rem; }
  .points-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem 1.5rem;
  }
  .points-col h4 {
    margin: 0 0 0.4rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }
  .point-row {
    display: grid;
    grid-template-columns: 4.2rem 1fr 10rem;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem 0.4rem;
    border-radius: 5px;
  }
  .point-row:hover { background: color-mix(in srgb, CanvasText 4%, transparent); }
  .point-row.unwired { opacity: 0.55; }
  .point-row.unwired:hover { opacity: 0.85; }
  .terminal-badge {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    text-align: center;
    border: 1px solid currentColor;
  }
  .terminal-badge.kind-input { color: #3498db; }
  .terminal-badge.kind-output { color: #9b59b6; }
  .point-info { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
  .point-info strong { font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .small { font-size: 0.72rem; }
  .role-select {
    background: color-mix(in srgb, Canvas 98%, transparent);
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    color: CanvasText;
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .role-select:focus { outline: 1px solid #27ae60; outline-offset: 1px; }

  .deploy-toast {
    padding: 0.45rem 0.9rem;
    background: color-mix(in srgb, #16a085 18%, transparent);
    border-bottom: 1px solid color-mix(in srgb, #16a085 50%, transparent);
    color: #16a085;
    font-size: 0.82rem;
    font-weight: 500;
    animation: toast-fade 4s ease forwards;
  }
  .deploy-toast.err {
    background: color-mix(in srgb, #e67e22 18%, transparent);
    border-bottom-color: color-mix(in srgb, #e67e22 50%, transparent);
    color: #e67e22;
  }
  @keyframes toast-fade {
    0% { opacity: 0; transform: translateY(-4px); }
    8% { opacity: 1; transform: translateY(0); }
    85% { opacity: 1; }
    100% { opacity: 0; }
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
