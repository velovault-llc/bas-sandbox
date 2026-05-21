<script lang="ts">
  import { onMount } from 'svelte';
  import {
    runtimeLog,
    clearLog,
    togglePanel,
    togglePaused,
    setFilter,
    setPanelPosition,
    resetPanelPosition,
    rehydratePanelPosition,
    visibleEntries,
    type LogLevel,
  } from './runtimeLogStore.svelte';

  // Re-clamp on mount + on resize so a saved-from-different-screen
  // position never strands the panel off-screen.
  onMount(() => {
    rehydratePanelPosition();
    const onResize = () => rehydratePanelPosition();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  const visible = $derived(visibleEntries());
  const counts = $derived.by(() => {
    const c = { info: 0, warn: 0, error: 0, critical: 0 };
    for (const e of runtimeLog.entries) c[e.level]++;
    return c;
  });

  let scrollEl: HTMLDivElement | null = $state(null);

  // Auto-scroll to bottom on new entry — unless the user has scrolled up.
  let stickToBottom = $state(true);
  $effect(() => {
    // Touch the dependency so this effect re-runs on new entries
    const _ = visible.length;
    void _;
    if (!scrollEl || !stickToBottom) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  });

  function onScroll(): void {
    if (!scrollEl) return;
    const atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 12;
    stickToBottom = atBottom;
  }

  function formatTime(s: number): string {
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function levelGlyph(l: LogLevel): string {
    if (l === 'critical') return '⛔';
    if (l === 'error') return '✕';
    if (l === 'warn') return '⚠';
    return '•';
  }

  // Drag-to-reposition. The header acts as the grab handle. We track the
  // mouse origin + the panel's offset at grab time, then translate the
  // panel by the delta on mousemove. On mouseup we persist via the store.
  //
  // Click-vs-drag: a real drag moves the mouse > DRAG_THRESHOLD pixels. If
  // the pointer barely moved we treat it as a click and let the header's
  // onclick toggle the panel. After a real drag we suppress the next
  // click event so the toggle doesn't fire as the user releases.
  const DRAG_THRESHOLD = 4;
  let dragging = $state(false);
  let didActuallyDrag = false;
  let suppressNextClick = $state(false);
  let dragStart = { x: 0, y: 0, originX: 0, originY: 0 };

  function startDrag(e: MouseEvent): void {
    // Only start drag on the header's bare area — not on a button inside.
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    didActuallyDrag = false;
    dragStart = {
      x: e.clientX,
      y: e.clientY,
      originX: runtimeLog.offsetX,
      originY: runtimeLog.offsetY,
    };
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', endDrag);
    e.preventDefault();
  }

  function onDragMove(e: MouseEvent): void {
    if (!dragging) return;
    const dx = dragStart.x - e.clientX;
    const dy = dragStart.y - e.clientY;
    if (!didActuallyDrag && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
      didActuallyDrag = true;
    }
    if (!didActuallyDrag) return; // tiny jitter — don't move yet
    // offset is from the bottom-right anchor; dragging right/down should
    // SHRINK both offsets (panel moves toward the corner), dragging
    // left/up should grow them. So invert deltas.
    runtimeLog.offsetX = Math.max(0, dragStart.originX + dx);
    runtimeLog.offsetY = Math.max(0, dragStart.originY + dy);
  }

  function endDrag(): void {
    if (didActuallyDrag) {
      setPanelPosition(runtimeLog.offsetX, runtimeLog.offsetY);
      suppressNextClick = true;
      // Reset suppression after the click event would have fired.
      setTimeout(() => { suppressNextClick = false; }, 50);
    }
    dragging = false;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', endDrag);
  }

  function onHeaderClick(e: MouseEvent): void {
    if (suppressNextClick) return;
    if ((e.target as HTMLElement).closest('button')) return;
    togglePanel();
  }
</script>

<aside
  class="runtime-log"
  class:open={runtimeLog.panelOpen}
  class:dragging
  role="log"
  aria-label="Runtime event log"
  style:right="{1 + runtimeLog.offsetX / 16}rem"
  style:bottom="{0.75 + runtimeLog.offsetY / 16}rem"
>
  <header class="head" onmousedown={startDrag} onclick={onHeaderClick} title="Drag to reposition · click to collapse">
    <span class="glyph grip">⠿</span>
    <strong>Runtime log</strong>
    <span class="counts">
      {#if counts.critical > 0}<span class="count crit">{counts.critical}</span>{/if}
      {#if counts.error > 0}<span class="count err">{counts.error}</span>{/if}
      {#if counts.warn > 0}<span class="count warn">{counts.warn}</span>{/if}
      <span class="count info">{counts.info}</span>
    </span>
    <button
      type="button"
      class="snap-btn"
      title="Snap panel back to bottom-right corner"
      onclick={(e) => { e.stopPropagation(); resetPanelPosition(); }}
    >⌐</button>
    <span class="toggle">{runtimeLog.panelOpen ? '▼' : '▲'}</span>
  </header>

  {#if runtimeLog.panelOpen}
    <div class="toolbar">
      <div class="filters">
        {#each ['all', 'info', 'warn', 'error', 'critical'] as level}
          <button
            type="button"
            class="filter-btn"
            class:active={runtimeLog.filter === level}
            onclick={() => setFilter(level as LogLevel | 'all')}
          >
            {level}
          </button>
        {/each}
      </div>
      <div class="actions">
        <button type="button" class="action-btn" onclick={togglePaused} title={runtimeLog.paused ? 'Resume logging' : 'Pause logging'}>
          {runtimeLog.paused ? '▶' : '⏸'}
        </button>
        <button type="button" class="action-btn" onclick={clearLog} title="Clear log">
          ⌫
        </button>
      </div>
    </div>

    <div class="log-body" bind:this={scrollEl} onscroll={onScroll}>
      {#if visible.length === 0}
        <div class="empty">No events yet. Start the sim and BAS-tech events will stream here.</div>
      {/if}
      {#each visible as e (e.id)}
        <div class="entry level-{e.level}">
          <span class="time">{formatTime(e.simSec)}</span>
          <span class="lvl">{levelGlyph(e.level)}</span>
          <span class="src">{e.source}</span>
          <span class="msg">{e.message}</span>
        </div>
      {/each}
    </div>
  {/if}
</aside>

<style>
  .runtime-log {
    position: absolute;
    right: 1rem;
    bottom: 0.75rem;
    width: min(38rem, calc(100% - 2rem));
    max-height: 22rem;
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, Canvas 96%, CanvasText 3%);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    z-index: 40;
    font-size: 0.78rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .runtime-log:not(.open) {
    max-height: 2.4rem;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.7rem;
    background: color-mix(in srgb, Canvas 88%, CanvasText 6%);
    border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    cursor: grab;
    user-select: none;
  }

  .runtime-log.dragging .head {
    cursor: grabbing;
  }

  .runtime-log.dragging {
    transition: none;
  }

  .snap-btn {
    background: transparent;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    color: color-mix(in srgb, CanvasText 65%, transparent);
    padding: 0 0.4rem;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
    line-height: 1.2;
    margin-left: auto;
  }
  .snap-btn:hover {
    color: CanvasText;
    border-color: color-mix(in srgb, CanvasText 45%, transparent);
  }

  .grip {
    color: color-mix(in srgb, CanvasText 45%, transparent);
    font-size: 0.95rem;
    letter-spacing: -0.1em;
  }

  .head strong {
    flex: 0;
    white-space: nowrap;
    font-family: system-ui, sans-serif;
    font-size: 0.82rem;
  }

  .counts {
    display: flex;
    gap: 0.3rem;
    margin-left: auto;
    margin-right: 0.55rem;
  }

  .count {
    font-size: 0.66rem;
    padding: 0.05rem 0.4rem;
    border-radius: 8px;
    font-variant-numeric: tabular-nums;
    background: color-mix(in srgb, CanvasText 10%, transparent);
    color: color-mix(in srgb, CanvasText 80%, transparent);
  }

  .count.crit {
    background: color-mix(in srgb, #e74c3c 60%, transparent);
    color: white;
  }
  .count.err {
    background: color-mix(in srgb, #e67e22 60%, transparent);
    color: white;
  }
  .count.warn {
    background: color-mix(in srgb, #f39c12 50%, transparent);
    color: color-mix(in srgb, #f39c12 95%, CanvasText);
  }

  .toggle {
    font-size: 0.75rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
    background: color-mix(in srgb, Canvas 94%, CanvasText 2%);
  }

  .filters {
    display: flex;
    gap: 0.3rem;
  }

  .filter-btn {
    background: transparent;
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    color: color-mix(in srgb, CanvasText 70%, transparent);
    font: inherit;
    font-size: 0.65rem;
    padding: 0.1rem 0.45rem;
    border-radius: 10px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .filter-btn.active {
    background: color-mix(in srgb, CanvasText 14%, transparent);
    color: CanvasText;
    border-color: color-mix(in srgb, CanvasText 30%, transparent);
  }

  .actions {
    display: flex;
    gap: 0.25rem;
  }

  .action-btn {
    background: transparent;
    border: 0;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    cursor: pointer;
    padding: 0.1rem 0.4rem;
    font-size: 0.85rem;
    border-radius: 4px;
  }

  .action-btn:hover {
    background: color-mix(in srgb, CanvasText 10%, transparent);
  }

  .log-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.35rem 0.55rem;
    background: color-mix(in srgb, Canvas 98%, CanvasText 1%);
  }

  .empty {
    color: color-mix(in srgb, CanvasText 50%, transparent);
    font-style: italic;
    padding: 0.55rem 0.4rem;
    font-family: system-ui, sans-serif;
  }

  .entry {
    display: grid;
    grid-template-columns: 3.6rem 1.2rem 7rem 1fr;
    gap: 0.45rem;
    padding: 0.12rem 0.25rem;
    border-radius: 3px;
    line-height: 1.4;
  }

  .entry.level-warn {
    background: color-mix(in srgb, #f39c12 8%, transparent);
  }

  .entry.level-error {
    background: color-mix(in srgb, #e67e22 10%, transparent);
    color: color-mix(in srgb, #e67e22 90%, CanvasText);
  }

  .entry.level-critical {
    background: color-mix(in srgb, #e74c3c 14%, transparent);
    color: color-mix(in srgb, #e74c3c 100%, CanvasText);
    font-weight: 600;
  }

  .time {
    color: color-mix(in srgb, CanvasText 50%, transparent);
    font-variant-numeric: tabular-nums;
    font-size: 0.72rem;
  }

  .lvl {
    text-align: center;
  }

  .src {
    color: color-mix(in srgb, #4a9eff 90%, CanvasText);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .msg {
    color: inherit;
    overflow-wrap: break-word;
    min-width: 0;
  }
</style>
