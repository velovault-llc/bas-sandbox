<script lang="ts">
  import { VERSION, type IngestResult, type ValidationFinding } from '@bas/core';
  import { dbexportPlugin } from '@bas/ingest-dbexport';
  import { brickTtlPlugin } from '@bas/ingest-brick';
  import TreeNode from './lib/TreeNode.svelte';
  import FindingsPanel from './lib/FindingsPanel.svelte';
  import BuildCanvas from './lib/BuildCanvas.svelte';

  const plugins = [dbexportPlugin, brickTtlPlugin];

  type Mode = 'view' | 'build';
  let mode = $state<Mode>('view');

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
</script>

<div class="layout" class:wide={mode === 'build' || !!result}>
  <header class="app-header">
    <div class="brand">
      <h1>bas-sandbox</h1>
      <span class="badge">Phase 1 · v{VERSION}</span>
    </div>

    <div class="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'view'}
        class:active={mode === 'view'}
        onclick={() => (mode = 'view')}
      >
        View
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'build'}
        class:active={mode === 'build'}
        onclick={() => (mode = 'build')}
      >
        Build
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
            <h3>Topology</h3>
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
      <p class="lede">
        Build mode (preview). Drag equipment from the left palette onto the canvas, then drag
        between the handles to wire up a network topology. v0.1 — no simulation behavior yet; v0.2
        will animate state across the wires.
      </p>
      <BuildCanvas />
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
