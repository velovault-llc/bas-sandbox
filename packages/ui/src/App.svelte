<script lang="ts">
  import { VERSION, type IngestResult, type ValidationFinding } from '@bas/core';
  import { dbexportPlugin } from '@bas/ingest-dbexport';
  import { brickTtlPlugin } from '@bas/ingest-brick';
  import TreeNode from './lib/TreeNode.svelte';
  import FindingsPanel from './lib/FindingsPanel.svelte';
  import BuildCanvas from './lib/BuildCanvas.svelte';
  import WeatherPanel from './lib/weather/WeatherPanel.svelte';
  import CLIPanel from './lib/cli/CLIPanel.svelte';
  import VendorPalette from './lib/equipment/VendorPalette.svelte';
  import { importStore } from './lib/canvasStore.svelte';
  import { topologyToCanvas } from './lib/topologyImport';
  import { programStore, rehydrateAllPrograms } from './lib/cli/programStore.svelte';
  import { onMount } from 'svelte';

  onMount(() => rehydrateAllPrograms());

  const plugins = [dbexportPlugin, brickTtlPlugin];

  type Mode = 'view' | 'build';
  let mode = $state<Mode>('build');

  type LeftDrawerTab = 'weather' | 'catalog' | 'settings';
  let leftDrawerOpen = $state(true);
  let leftDrawerTab = $state<LeftDrawerTab>('weather');
  let bottomDockOpen = $state(true);

  function toggleLeftDrawer(): void {
    leftDrawerOpen = !leftDrawerOpen;
  }
  function pickLeftDrawerTab(tab: LeftDrawerTab): void {
    if (leftDrawerTab === tab && leftDrawerOpen) {
      leftDrawerOpen = false;
    } else {
      leftDrawerTab = tab;
      leftDrawerOpen = true;
    }
  }
  function toggleBottomDock(): void {
    bottomDockOpen = !bottomDockOpen;
  }

  let dragOver = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let result = $state<IngestResult | null>(null);
  let sourceFileName = $state<string | null>(null);
  let findings = $state<ValidationFinding[]>([]);
  let validateMs = $state<number | null>(null);
  let validating = $state(false);

  async function handleFile(file: File) {
    error = null;
    result = null;
    findings = [];
    validateMs = null;
    sourceFileName = file.name;
    loading = true;
    try {
      const plugin = plugins.find((p) =>
        p.accepts.some((ext) => file.name.toLowerCase().endsWith(ext)),
      );
      if (!plugin) {
        throw new Error(
          `No ingest plugin matched ${file.name}. Accepted: ${plugins.flatMap((p) => p.accepts).join(', ')}`,
        );
      }
      result = await plugin.ingest(file);
      loading = false;

      const validators = plugin.validators ?? [];
      if (validators.length > 0) {
        validating = true;
        await new Promise((r) => setTimeout(r, 0));
        const t0 = performance.now();
        const all: ValidationFinding[] = [];
        for (const v of validators) {
          const items = v.validate({ graph: result.graph, vendor: result.vendor });
          all.push(...items);
        }
        findings = all;
        validateMs = Math.round(performance.now() - t0);
        validating = false;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      loading = false;
      validating = false;
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragOver = false;
    const file = event.dataTransfer?.files[0];
    if (file) handleFile(file);
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    dragOver = true;
  }

  function onDragLeave() {
    dragOver = false;
  }

  function onFileInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) handleFile(file);
  }

  function reset() {
    result = null;
    error = null;
    sourceFileName = null;
    findings = [];
    validateMs = null;
  }

  function openInBuild() {
    if (!result || !result.topology) return;
    const {
      nodes: importedNodes,
      edges: importedEdges,
      summary,
    } = topologyToCanvas(result.topology, result.vendor as Parameters<typeof topologyToCanvas>[1]);
    importStore.pending = {
      nodes: importedNodes,
      edges: importedEdges,
      sourceLabel: sourceFileName ?? 'imported',
    };
    const parts: string[] = [];
    if (summary.adxCount > 0) parts.push(`${summary.adxCount} ADX`);
    parts.push(`${summary.engineCount} engines`);
    parts.push(`${summary.controllerCount} controllers`);
    if (summary.skipped.length > 0) parts.push(`skipped: ${summary.skipped.join(', ')}`);
    console.info(`Imported from ${sourceFileName}: ${parts.join(' · ')}`);
    mode = 'build';
  }
</script>

<div class="layout" class:wide={mode === 'build' || !!result} class:full-bleed={mode === 'build'}>
  <header class="app-header">
    <div class="brand">
      <h1>bas-sandbox</h1>
      <span class="badge">Phase 1 · v{VERSION}</span>
    </div>

    <div class="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'build'}
        class:active={mode === 'build'}
        onclick={() => (mode = 'build')}
      >
        Build
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'view'}
        class:active={mode === 'view'}
        onclick={() => (mode = 'view')}
      >
        dbexport tool
      </button>
    </div>
  </header>

  {#if mode === 'view'}
    <main class="view">
      <p class="lede">
        Vendor-neutral simulator for building automation systems. Drag-and-drop topology, real
        BACnet behavior, thermal response — try the edit before you ship it to the live engine.
      </p>

      {#if !result}
        <div
          class="dropzone"
          class:dragover={dragOver}
          role="region"
          aria-label="Drop an archive to ingest"
          ondrop={onDrop}
          ondragover={onDragOver}
          ondragleave={onDragLeave}
        >
          {#if loading}
            <p>Parsing <strong>{sourceFileName}</strong>…</p>
          {:else if !error}
            <p>
              Drop a <code>.dbexport</code> or <code>.ttl</code> file here, or
              <label class="file-link">
                <input type="file" accept=".dbexport,.zip,.ttl" onchange={onFileInput} />
                choose one
              </label>.
            </p>
            <p class="hint">Files are parsed locally in your browser. Nothing is uploaded.</p>
          {/if}
        </div>
      {/if}

      {#if error}
        <div class="error" role="alert">
          <strong>Couldn't parse {sourceFileName}:</strong>
          {error}
          <button type="button" class="reset" onclick={reset}>Try another file</button>
        </div>
      {/if}

      {#if result}
        <section class="result">
          <div class="result-header">
            <h2>{sourceFileName}</h2>
            <button type="button" class="reset" onclick={reset}>Load another</button>
          </div>
          <ul class="stats">
            <li><strong>{result.metadata?.deviceCount ?? '?'}</strong> devices</li>
            <li>
              <strong>{result.metadata?.objectCount?.toLocaleString() ?? '?'}</strong> objects
            </li>
            <li><strong>{result.metadata?.engines?.length ?? '?'}</strong> engines</li>
            <li><strong>{result.graph.size().toLocaleString()}</strong> brick triples</li>
          </ul>

          {#if result.topology && result.topology.length > 0}
            <h3>
              Topology
              <button type="button" class="open-in-build" onclick={openInBuild}>
                Open in Build →
              </button>
            </h3>
            <div class="topology" role="tree">
              {#each result.topology as node (node.id)}
                <TreeNode {node} />
              {/each}
            </div>
          {/if}

          <h3>
            Validation
            {#if validating}<span class="validating">running…</span>{/if}
          </h3>
          {#if validating && findings.length === 0}
            <div class="empty">Running validators…</div>
          {:else}
            <FindingsPanel {findings} durationMs={validateMs} />
          {/if}

          {#if result.warnings.length > 0}
            <h3>Warnings</h3>
            <ul class="warnings">
              {#each result.warnings as warning, i (i)}
                <li>{warning}</li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      <section class="meta">
        <h2>Registered ingest plugins</h2>
        <ul class="plugins">
          {#each plugins as plugin (plugin.id)}
            <li>
              <strong>{plugin.displayName}</strong>
              <span class="accepts">accepts: {plugin.accepts.join(', ')}</span>
              {#if plugin.validators && plugin.validators.length > 0}
                <span class="validator-count">{plugin.validators.length} validators</span>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    </main>
  {:else}
    <main class="build">
      <div class="build-shell">
        <nav class="drawer-rail" aria-label="Left drawer">
          <button
            type="button"
            class="rail-tab"
            class:active={leftDrawerOpen && leftDrawerTab === 'weather'}
            onclick={() => pickLeftDrawerTab('weather')}
            title="Weather drive"
          >
            <span class="rail-icon">☀</span>
            <span class="rail-label">Weather</span>
          </button>
          <button
            type="button"
            class="rail-tab"
            class:active={leftDrawerOpen && leftDrawerTab === 'catalog'}
            onclick={() => pickLeftDrawerTab('catalog')}
            title="Vendor controller catalog"
          >
            <span class="rail-icon">▣</span>
            <span class="rail-label">Catalog</span>
          </button>
          <button
            type="button"
            class="rail-tab"
            class:active={leftDrawerOpen && leftDrawerTab === 'settings'}
            onclick={() => pickLeftDrawerTab('settings')}
            title="Settings"
          >
            <span class="rail-icon">⚙</span>
            <span class="rail-label">Settings</span>
          </button>
          <button
            type="button"
            class="rail-collapse"
            onclick={toggleLeftDrawer}
            title={leftDrawerOpen ? 'Collapse drawer' : 'Expand drawer'}
            aria-expanded={leftDrawerOpen}
          >
            {leftDrawerOpen ? '◀' : '▶'}
          </button>
        </nav>

        <aside class="left-drawer" class:open={leftDrawerOpen} aria-hidden={!leftDrawerOpen}>
          {#if leftDrawerTab === 'weather'}
            <WeatherPanel />
          {:else if leftDrawerTab === 'catalog'}
            <VendorPalette />
          {:else if leftDrawerTab === 'settings'}
            <div class="settings-placeholder">
              <h3>Settings</h3>
              <p class="muted">
                Sim cadence, theme, and units controls will land here. For now the simulator runs
                at 60 sim-seconds per tick (= 1 sim-minute per real second) and inherits OS theme.
              </p>
            </div>
          {/if}
        </aside>

        <div class="canvas-area" class:drawer-open={leftDrawerOpen} class:dock-open={bottomDockOpen}>
          <BuildCanvas />
          {#if programStore.activeControllerId}
            <CLIPanel />
          {/if}
          <button
            type="button"
            class="dock-toggle"
            onclick={toggleBottomDock}
            title={bottomDockOpen ? 'Hide equipment dock' : 'Show equipment dock'}
            aria-expanded={bottomDockOpen}
          >
            {bottomDockOpen ? '▼ Hide dock' : '▲ Equipment / Wires'}
          </button>
        </div>
      </div>
    </main>
  {/if}

  <footer>
    <a href="https://github.com/velovault-llc/bas-sandbox">github.com/velovault-llc/bas-sandbox</a>
  </footer>
</div>

<style>
  .layout {
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    max-width: 720px;
    margin: 2rem auto;
    padding: 0 1.25rem;
    line-height: 1.5;
    transition: max-width 200ms ease;
  }

  .layout.wide {
    max-width: 1200px;
  }

  .layout.full-bleed {
    max-width: none;
    padding: 0 1rem;
    margin: 1rem auto;
  }

  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  h1 {
    margin: 0;
    font-size: 1.6rem;
  }

  .badge {
    font-size: 0.78rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    background: color-mix(in srgb, CanvasText 10%, transparent);
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
    padding: 0.15rem;
    background: color-mix(in srgb, CanvasText 4%, transparent);
  }

  .tabs button {
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    padding: 0.3rem 0.85rem;
    border-radius: 4px;
    cursor: pointer;
  }

  .tabs button.active {
    background: Canvas;
    color: CanvasText;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .lede {
    color: color-mix(in srgb, CanvasText 80%, transparent);
    margin: 0 0 1.5rem 0;
  }

  /* ── Build mode shell: full-bleed canvas with left drawer rail ── */

  .build-shell {
    position: relative;
    display: flex;
    align-items: stretch;
    /* Header sits above; subtract its approximate height plus margins so the
       canvas fills the rest of the viewport. */
    height: calc(100vh - 6.5rem);
    min-height: 32rem;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, Canvas 96%, CanvasText 2%);
  }

  .drawer-rail {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    width: 3rem;
    padding: 0.4rem 0;
    border-right: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    background: color-mix(in srgb, CanvasText 4%, transparent);
    flex-shrink: 0;
    z-index: 2;
  }

  .rail-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0.5rem 0.1rem;
    background: transparent;
    border: 0;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    cursor: pointer;
    font-size: 0.6rem;
    border-left: 2px solid transparent;
    transition: background 100ms ease, color 100ms ease;
  }

  .rail-tab:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
    color: inherit;
  }

  .rail-tab.active {
    background: color-mix(in srgb, CanvasText 10%, transparent);
    color: inherit;
    border-left-color: #4a9eff;
  }

  .rail-icon {
    font-size: 1.1rem;
    line-height: 1;
  }

  .rail-label {
    font-size: 0.6rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .rail-collapse {
    margin-top: auto;
    background: transparent;
    border: 0;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    cursor: pointer;
    padding: 0.5rem 0;
    font-size: 0.85rem;
  }

  .rail-collapse:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
    color: inherit;
  }

  .left-drawer {
    width: 0;
    overflow: hidden;
    transition: width 180ms ease;
    border-right: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    background: color-mix(in srgb, Canvas 94%, CanvasText 3%);
    flex-shrink: 0;
  }

  .left-drawer.open {
    width: 22rem;
    overflow-y: auto;
    padding: 0.75rem;
  }

  .settings-placeholder {
    padding: 0.5rem;
  }

  .settings-placeholder h3 {
    margin: 0 0 0.5rem 0;
    font-size: 0.95rem;
  }

  .settings-placeholder .muted {
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-size: 0.82rem;
    line-height: 1.45;
  }

  .canvas-area {
    flex: 1;
    min-width: 0;
    position: relative;
    overflow: hidden;
  }

  /* BuildCanvas's root `.build` div has a fixed 72vh — override it to fill
     the shell instead. */
  .canvas-area :global(.build) {
    height: 100% !important;
    border: 0;
    border-radius: 0;
  }

  /* Bottom-dock layout: flip BuildCanvas's `16rem | 1fr` grid to `1fr` rows
     with the palette pinned to the bottom. The palette children were
     authored for a vertical sidebar — we override the inner layout to a
     horizontal ribbon. */
  .canvas-area.dock-open :global(.build) {
    grid-template-columns: 1fr !important;
    grid-template-rows: 1fr 17rem !important;
  }

  .canvas-area.dock-open :global(.palette) {
    order: 2;
    flex-direction: row !important;
    align-items: flex-start;
    gap: 1rem;
    border-right: 0 !important;
    border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    padding: 0.65rem 1rem !important;
    overflow-x: auto;
    overflow-y: hidden;
  }

  /* Hide the "Equipment" header text entirely in dock mode — items are
     self-evident and the header eats horizontal space we'd rather give
     to the foot. */
  .canvas-area.dock-open :global(.palette > .palette-head) {
    display: none;
  }

  .canvas-area.dock-open :global(.palette > .items) {
    display: flex !important;
    flex-direction: row !important;
    gap: 0.35rem !important;
    flex-shrink: 0;
    margin: 0;
    padding: 0;
  }

  /* Compact items: smaller min-width + no example sub-text so the row
     fits without horizontal scroll on most viewports. */
  .canvas-area.dock-open :global(.palette > .items > li) {
    min-width: 6rem;
    padding: 0.35rem 0.4rem !important;
  }

  .canvas-area.dock-open :global(.palette > .items > li .ex) {
    display: none;
  }

  .canvas-area.dock-open :global(.palette > .wires-section) {
    flex-shrink: 0;
    border-left: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    padding-left: 0.75rem;
    margin-left: 0.25rem;
    width: 11rem;
  }

  .canvas-area.dock-open :global(.palette > .wires-section h3) {
    font-size: 0.7rem;
    margin: 0 0 0.3rem;
  }

  .canvas-area.dock-open :global(.palette > .wires-section .hint) {
    display: none;
  }

  .canvas-area.dock-open :global(.palette > .wires-section .wire-palette) {
    flex-direction: column !important;
    gap: 0.2rem;
  }

  /* Compact wire rows — strip the descriptive label sub-text in dock mode */
  .canvas-area.dock-open :global(.palette > .wires-section .wire-row) {
    padding: 0.2rem 0.4rem !important;
    font-size: 0.72rem;
  }

  .canvas-area.dock-open :global(.palette > .wires-section .wire-row-sub) {
    display: none;
  }

  .canvas-area.dock-open :global(.palette > .palette-foot) {
    flex-shrink: 0;
    margin-left: auto;
    border-left: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    padding-left: 1rem;
    min-width: 24rem;
    width: 28rem;
    max-height: calc(17rem - 1.3rem);
    overflow-y: auto;
  }

  /* Collapsed dock: hide the palette entirely and let the canvas fill */
  .canvas-area:not(.dock-open) :global(.build) {
    grid-template-columns: 1fr !important;
    grid-template-rows: 1fr !important;
  }

  .canvas-area:not(.dock-open) :global(.palette) {
    display: none !important;
  }

  /* Floating toggle button — sits at the bottom edge of the canvas area,
     toggles the dock. */
  .dock-toggle {
    position: absolute;
    bottom: 0.5rem;
    right: 1rem;
    z-index: 5;
    background: color-mix(in srgb, Canvas 90%, CanvasText 8%);
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    color: inherit;
    padding: 0.3rem 0.7rem;
    border-radius: 14px;
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  .dock-toggle:hover {
    background: color-mix(in srgb, CanvasText 12%, Canvas);
  }

  /* When dock is open, lift the toggle above the dock so it stays visible */
  .canvas-area.dock-open .dock-toggle {
    bottom: 17.5rem;
  }

  @media (max-width: 720px) {
    .build-shell {
      height: calc(100vh - 5rem);
    }
    .left-drawer.open {
      width: 18rem;
    }
  }

  .dropzone {
    border: 2px dashed color-mix(in srgb, CanvasText 25%, transparent);
    border-radius: 8px;
    padding: 2rem 1rem;
    text-align: center;
    transition:
      border-color 100ms ease,
      background 100ms ease;
    margin-bottom: 1.5rem;
  }

  .dropzone.dragover {
    border-color: color-mix(in srgb, CanvasText 60%, transparent);
    background: color-mix(in srgb, CanvasText 5%, transparent);
  }

  .dropzone p {
    margin: 0.25rem 0;
  }

  .hint {
    font-size: 0.85rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }

  .file-link {
    text-decoration: underline;
    cursor: pointer;
  }

  .file-link input[type='file'] {
    display: none;
  }

  .error {
    border-left: 3px solid #e74c3c;
    padding: 0.75rem 1rem;
    background: color-mix(in srgb, #e74c3c 8%, transparent);
    border-radius: 0 4px 4px 0;
    margin-bottom: 1.5rem;
    font-size: 0.9rem;
  }

  .error .reset {
    display: block;
    margin-top: 0.5rem;
  }

  .empty {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    background: color-mix(in srgb, CanvasText 6%, transparent);
    font-size: 0.9rem;
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }

  .result {
    margin-bottom: 2.5rem;
  }

  .result-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .result h2 {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 1rem;
    margin: 0;
    word-break: break-all;
  }

  .reset {
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.8rem;
    padding: 0.2rem 0.7rem;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }

  .reset:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem;
    list-style: none;
    padding: 0;
    margin: 0 0 1.5rem 0;
    font-size: 0.9rem;
  }

  .stats li strong {
    display: block;
    font-size: 1.4rem;
    font-weight: 600;
    margin-bottom: 0.1rem;
    font-variant-numeric: tabular-nums;
  }

  h3 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    margin: 1.5rem 0 0.5rem 0;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .open-in-build {
    margin-left: auto;
    border: 1px solid color-mix(in srgb, #2ecc71 50%, transparent);
    background: color-mix(in srgb, #2ecc71 8%, transparent);
    color: #2ecc71;
    font: inherit;
    font-size: 0.72rem;
    text-transform: none;
    letter-spacing: 0;
    padding: 0.15rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
  }

  .open-in-build:hover {
    background: color-mix(in srgb, #2ecc71 18%, transparent);
  }

  .validating {
    font-size: 0.75rem;
    text-transform: none;
    letter-spacing: 0;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    font-style: italic;
  }

  .topology {
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    border-radius: 6px;
    padding: 0.5rem;
    max-height: 60vh;
    overflow: auto;
  }

  .warnings {
    color: #d68910;
    font-size: 0.9rem;
  }

  .meta {
    margin-top: 3rem;
  }

  .meta h2 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    margin-bottom: 0.5rem;
  }

  .plugins {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .plugins li {
    padding: 0.4rem 0;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    font-size: 0.9rem;
  }

  .accepts,
  .validator-count {
    margin-left: 0.75rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.85rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
  }

  footer {
    margin-top: 3rem;
    font-size: 0.85rem;
  }

  footer a {
    color: inherit;
    text-decoration: none;
    border-bottom: 1px dotted currentColor;
  }
</style>
