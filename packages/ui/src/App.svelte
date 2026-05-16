<script lang="ts">
  import { VERSION, type IngestResult } from '@bas/core';
  import { dbexportPlugin } from '@bas/ingest-dbexport';
  import { brickTtlPlugin } from '@bas/ingest-brick';

  const plugins = [dbexportPlugin, brickTtlPlugin];

  let dragOver = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let result = $state<IngestResult | null>(null);
  let sourceFileName = $state<string | null>(null);

  async function handleFile(file: File) {
    error = null;
    result = null;
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
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
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
</script>

<main>
  <header>
    <h1>bas-sandbox</h1>
    <span class="badge">Phase 0 · v{VERSION}</span>
  </header>

  <p class="lede">
    Vendor-neutral simulator for building automation systems. Drag-and-drop topology, real BACnet
    behavior, thermal response — try the edit before you ship it to the live engine.
  </p>

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
    {:else if !result && !error}
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

  {#if error}
    <div class="error" role="alert">
      <strong>Couldn't parse {sourceFileName}:</strong>
      {error}
    </div>
  {/if}

  {#if result}
    <section class="result">
      <h2>{sourceFileName}</h2>
      <ul class="stats">
        <li><strong>{result.metadata?.deviceCount ?? '?'}</strong> devices</li>
        <li><strong>{result.metadata?.objectCount ?? '?'}</strong> objects</li>
        <li><strong>{result.metadata?.engines?.length ?? '?'}</strong> engines</li>
        <li><strong>{result.graph.size()}</strong> brick triples</li>
      </ul>

      {#if result.metadata?.engines && result.metadata.engines.length > 0}
        <h3>Engines</h3>
        <ul class="engines">
          {#each result.metadata.engines as engine (engine.name)}
            <li>
              <span class="kind">◉</span>
              <span class="engine-name">{engine.name}</span>
              <span class="count">{engine.objectCount.toLocaleString()} objects</span>
            </li>
          {/each}
        </ul>
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
        </li>
      {/each}
    </ul>
  </section>

  <footer>
    <a href="https://github.com/velovault-llc/bas-sandbox">github.com/velovault-llc/bas-sandbox</a>
  </footer>
</main>

<style>
  main {
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    max-width: 720px;
    margin: 3rem auto;
    padding: 0 1.25rem;
    line-height: 1.5;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  h1 {
    margin: 0;
    font-size: 1.75rem;
  }

  .badge {
    font-size: 0.8rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    background: color-mix(in srgb, CanvasText 10%, transparent);
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }

  .lede {
    color: color-mix(in srgb, CanvasText 80%, transparent);
    margin-bottom: 2rem;
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

  .result {
    margin-bottom: 2.5rem;
  }

  .result h2 {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 1rem;
    margin: 0 0 0.75rem 0;
    word-break: break-all;
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
  }

  h3 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    margin: 1.25rem 0 0.5rem 0;
  }

  .engines {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .engines li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
  }

  .engine-name {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.9rem;
  }

  .count {
    font-size: 0.85rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
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

  .accepts {
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
