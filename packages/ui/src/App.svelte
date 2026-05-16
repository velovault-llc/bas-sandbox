<script lang="ts">
  import { VERSION } from '@bas/core';
  import { dbexportPlugin } from '@bas/ingest-dbexport';
  import { brickTtlPlugin } from '@bas/ingest-brick';

  const plugins = [dbexportPlugin, brickTtlPlugin];
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

  <section>
    <h2>Registered ingest plugins</h2>
    <ul>
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

  h2 {
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    margin-bottom: 0.5rem;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  li {
    padding: 0.5rem 0;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
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
