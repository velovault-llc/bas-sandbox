<script lang="ts">
  // Library — the in-site reference catalog. Federal evaluators (and
  // honest BAS techs) want to know "where did the sandbox get this?"
  // Every claim the conformance checker makes cites an ASHRAE clause;
  // every catalog entry has a provenance trail. This panel surfaces
  // all of that source material with search + filter.
  //
  // Driven by the `LIBRARY` array in `@bas/core/references/library`.
  // To add an entry, add it there — it'll appear here automatically.

  import {
    LIBRARY_CATEGORIES,
    CATEGORY_LABEL,
    searchLibrary,
    type LibraryCategory,
    type LibraryEntry,
  } from '@bas/core';
  import { libraryNavStore } from './libraryNavStore.svelte';

  let query = $state('');
  let selectedCategory = $state<LibraryCategory | null>(null);
  let expandedId = $state<string | null>(null);

  // Listen for "navigate to library with query" pulses from outside
  // (e.g., a conformance citation click). Each pulse seeds the search
  // input, clears any category filter so the result is visible, and
  // auto-expands the top-scoring entry.
  let lastPulse = 0;
  $effect(() => {
    if (libraryNavStore.pulse !== lastPulse) {
      lastPulse = libraryNavStore.pulse;
      query = libraryNavStore.query;
      selectedCategory = null;
      // Auto-expand the top result so the user lands on something.
      const top = searchLibrary(libraryNavStore.query)[0];
      if (top) expandedId = top.id;
    }
  });

  /** Results filtered by category + scored by search relevance.
   *  Empty query returns the full (filtered) catalog. */
  const results = $derived.by(() =>
    searchLibrary(query, selectedCategory ?? undefined),
  );

  /** Per-category counts shown next to filter chips. Empty query so
   *  the counts reflect "what's in the library" rather than "what
   *  matches the search". Easier mental model. */
  const counts = $derived.by(() => {
    const c: Record<string, number> = { all: 0 };
    for (const cat of LIBRARY_CATEGORIES) c[cat] = 0;
    const all = searchLibrary('');
    c.all = all.length;
    for (const e of all) c[e.category] = (c[e.category] ?? 0) + 1;
    return c;
  });

  function toggleCategory(cat: LibraryCategory): void {
    selectedCategory = selectedCategory === cat ? null : cat;
  }

  function toggleExpanded(id: string): void {
    expandedId = expandedId === id ? null : id;
  }

  function clearQuery(): void {
    query = '';
  }

  /** External sources open in a new tab; in-tree sources are shown
   *  as a non-clickable path the user can copy. */
  function isExternal(src: LibraryEntry['sources'][number]): boolean {
    return !!src.url;
  }
</script>

<div class="library-panel">
  <header class="hdr">
    <h3>Library</h3>
    <p class="blurb">
      Every reference the sandbox + AI assistant draw from. Spec clauses,
      reference implementations, vendor docs, registries. If we make a claim
      anywhere, the source is here.
    </p>
  </header>

  <div class="search-row">
    <input
      type="search"
      placeholder="Search title, tag, clause… (e.g. 'I-Am' or '§16.10.2')"
      bind:value={query}
      class="search-input"
      autocomplete="off"
      spellcheck="false"
    />
    {#if query}
      <button type="button" class="clear-btn" onclick={clearQuery} title="Clear search">×</button>
    {/if}
  </div>

  <div class="chip-row" role="tablist" aria-label="Category filters">
    <button
      type="button"
      class="chip"
      class:active={selectedCategory === null}
      onclick={() => (selectedCategory = null)}
      role="tab"
      aria-selected={selectedCategory === null}
    >
      All <span class="chip-count">{counts.all}</span>
    </button>
    {#each LIBRARY_CATEGORIES as cat (cat)}
      <button
        type="button"
        class="chip"
        class:active={selectedCategory === cat}
        onclick={() => toggleCategory(cat)}
        role="tab"
        aria-selected={selectedCategory === cat}
      >
        {CATEGORY_LABEL[cat]} <span class="chip-count">{counts[cat] ?? 0}</span>
      </button>
    {/each}
  </div>

  <div class="results" role="list">
    {#if results.length === 0}
      <p class="empty">No entries match. Try clearing the search or a different filter.</p>
    {/if}
    {#each results as entry (entry.id)}
      {@const open = expandedId === entry.id}
      <article
        class="entry"
        class:expanded={open}
        role="listitem"
        data-category={entry.category}
      >
        <button
          type="button"
          class="entry-head"
          onclick={() => toggleExpanded(entry.id)}
          aria-expanded={open}
        >
          <div class="entry-head-text">
            <span class="entry-title">{entry.title}</span>
            <span class="entry-cat">{CATEGORY_LABEL[entry.category]}</span>
          </div>
          <span class="caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>

        {#if open}
          <div class="entry-body">
            <p class="summary">{entry.summary}</p>
            <p class="relevance"><strong>Why it matters:</strong> {entry.relevance}</p>

            {#if entry.citations && entry.citations.length > 0}
              <div class="meta-row">
                <span class="meta-label">Citations</span>
                <div class="citations">
                  {#each entry.citations as cite (cite)}
                    <code class="citation">{cite}</code>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="meta-row">
              <span class="meta-label">Sources</span>
              <ul class="sources">
                {#each entry.sources as src (src.label)}
                  <li>
                    {#if isExternal(src)}
                      <a href={src.url} target="_blank" rel="noopener noreferrer">{src.label}</a>
                    {:else if src.path}
                      <span class="src-path">
                        <span class="src-label">{src.label}</span>
                        <code class="path">{src.path}</code>
                      </span>
                    {:else}
                      <span class="src-label">{src.label}</span>
                    {/if}
                    {#if src.note}
                      <span class="src-note">— {src.note}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>

            <div class="meta-row">
              <span class="meta-label">Tags</span>
              <div class="tags">
                {#each entry.tags as tag (tag)}
                  <span class="tag">{tag}</span>
                {/each}
              </div>
            </div>

            <div class="entry-id">id: <code>{entry.id}</code></div>
          </div>
        {/if}
      </article>
    {/each}
  </div>
</div>

<style>
  .library-panel {
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    height: 100%;
    overflow-y: auto;
  }
  .hdr {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  h3 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .blurb {
    margin: 0;
    font-size: 0.72rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    line-height: 1.4;
  }

  /* Search */
  .search-row {
    position: relative;
    display: flex;
    align-items: center;
  }
  .search-input {
    width: 100%;
    padding: 0.45rem 1.8rem 0.45rem 0.6rem;
    font: inherit;
    font-size: 0.8rem;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    border-radius: 5px;
    background: color-mix(in srgb, Canvas 96%, transparent);
    color: CanvasText;
  }
  .search-input:focus {
    outline: none;
    border-color: color-mix(in srgb, CanvasText 45%, transparent);
  }
  .clear-btn {
    position: absolute;
    right: 0.4rem;
    width: 1.4rem;
    height: 1.4rem;
    border: none;
    background: transparent;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
    border-radius: 3px;
  }
  .clear-btn:hover {
    background: color-mix(in srgb, CanvasText 10%, transparent);
    color: CanvasText;
  }

  /* Chips */
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.55rem;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, Canvas 95%, transparent);
    cursor: pointer;
    font: inherit;
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 80%, transparent);
    transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
  }
  .chip:hover {
    border-color: color-mix(in srgb, CanvasText 40%, transparent);
    background: color-mix(in srgb, CanvasText 6%, transparent);
  }
  .chip.active {
    background: color-mix(in srgb, #06b6d4 18%, transparent);
    border-color: color-mix(in srgb, #06b6d4 60%, transparent);
    color: CanvasText;
  }
  .chip-count {
    font-variant-numeric: tabular-nums;
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }

  /* Results */
  .results {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .empty {
    margin: 1rem 0;
    text-align: center;
    font-size: 0.75rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }

  .entry {
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, Canvas 94%, transparent);
    overflow: hidden;
    transition: border-color 120ms ease;
  }
  .entry:hover {
    border-color: color-mix(in srgb, CanvasText 30%, transparent);
  }
  .entry.expanded {
    border-color: color-mix(in srgb, #06b6d4 50%, transparent);
  }

  .entry-head {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.55rem 0.7rem;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .entry-head:hover {
    background: color-mix(in srgb, CanvasText 4%, transparent);
  }
  .entry-head-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .entry-title {
    font-weight: 600;
    font-size: 0.78rem;
    line-height: 1.25;
    color: CanvasText;
  }
  .entry-cat {
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .caret {
    font-size: 0.85rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    flex-shrink: 0;
  }

  .entry-body {
    padding: 0 0.7rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    padding-top: 0.55rem;
  }
  .summary {
    margin: 0;
    font-size: 0.74rem;
    color: color-mix(in srgb, CanvasText 80%, transparent);
    line-height: 1.45;
  }
  .relevance {
    margin: 0;
    font-size: 0.72rem;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    line-height: 1.45;
  }
  .relevance strong {
    color: CanvasText;
  }

  .meta-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .meta-label {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-weight: 600;
  }

  .citations {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .citation {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.68rem;
    padding: 0.1rem 0.35rem;
    background: color-mix(in srgb, #06b6d4 12%, transparent);
    color: color-mix(in srgb, CanvasText 85%, transparent);
    border-radius: 3px;
    border: 1px solid color-mix(in srgb, #06b6d4 30%, transparent);
  }

  .sources {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .sources li {
    font-size: 0.72rem;
    line-height: 1.4;
  }
  .sources a {
    color: #06b6d4;
    text-decoration: none;
  }
  .sources a:hover {
    text-decoration: underline;
  }
  .src-path {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .src-label {
    font-weight: 500;
    color: color-mix(in srgb, CanvasText 85%, transparent);
  }
  .path {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.66rem;
    padding: 0.1rem 0.3rem;
    background: color-mix(in srgb, CanvasText 6%, transparent);
    border-radius: 3px;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    word-break: break-all;
  }
  .src-note {
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-style: italic;
    font-size: 0.68rem;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
  }
  .tag {
    font-size: 0.62rem;
    padding: 0.08rem 0.35rem;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    color: color-mix(in srgb, CanvasText 70%, transparent);
    border-radius: 3px;
  }

  .entry-id {
    font-size: 0.62rem;
    color: color-mix(in srgb, CanvasText 45%, transparent);
  }
  .entry-id code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.62rem;
  }

  /* Category accent stripe on the left edge of each entry */
  .entry[data-category='standard'] {
    border-left: 3px solid #06b6d4;
  }
  .entry[data-category='reference-impl'] {
    border-left: 3px solid #10b981;
  }
  .entry[data-category='vendor'] {
    border-left: 3px solid #f59e0b;
  }
  .entry[data-category='training'] {
    border-left: 3px solid #a855f7;
  }
  .entry[data-category='tool'] {
    border-left: 3px solid #ec4899;
  }
  .entry[data-category='registry'] {
    border-left: 3px solid #6366f1;
  }
  .entry[data-category='in-tree'] {
    border-left: 3px solid #6b7280;
  }
</style>
