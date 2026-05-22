<script lang="ts">
  // BACnet packet log panel — companion surface to the runtime log.
  //
  // The runtime log shows BAS-tech events (cooling engaged, freezestat
  // tripped, NC/NO mismatch). This panel shows the WIRE: token-passes
  // bouncing around MS/TP trunks, ReadProperty requests from the
  // supervisor, ACKs coming back with live values. It's what a tech
  // sees in YABE's packet view or on a Niagara JACE's bacnet diagnostic
  // tab — but synthesized from the sandbox sim instead of a real bus.
  //
  // Lives bottom-left so it doesn't fight the runtime log for space.

  import { onMount } from 'svelte';
  import {
    bacnetPacketLog,
    clearPackets,
    togglePanel,
    togglePaused,
    setLayerFilter,
    setTrunkFilter,
    setPanelPosition,
    resetPanelPosition,
    rehydratePanelPosition,
    visiblePackets,
    trunkIdsInBuffer,
    type LayerFilter,
    type BacnetPacket,
  } from './bacnetPacketLog.svelte';

  /** Bound to the panel <aside> for DOM-aware clamping (same pattern as
   *  the runtime log panel — see comment there for why a static
   *  headroom guess can't keep the header reachable when expanded). */
  let panelEl: HTMLElement | null = $state(null);

  function clampPos(x: number, y: number): { x: number; y: number } {
    if (typeof window === 'undefined') return { x: Math.max(0, x), y: Math.max(0, y) };
    const panelH = panelEl?.offsetHeight ?? 80;
    const panelW = panelEl?.offsetWidth ?? 320;
    const margin = 12;
    const maxY = Math.max(0, window.innerHeight - panelH - margin);
    const maxX = Math.max(0, window.innerWidth - panelW - margin);
    return {
      x: Math.min(maxX, Math.max(0, x)),
      y: Math.min(maxY, Math.max(0, y)),
    };
  }

  onMount(() => {
    rehydratePanelPosition();
    queueMicrotask(() => {
      const { x, y } = clampPos(bacnetPacketLog.offsetX, bacnetPacketLog.offsetY);
      if (x !== bacnetPacketLog.offsetX || y !== bacnetPacketLog.offsetY) {
        setPanelPosition(x, y);
      }
    });
    const onResize = () => {
      rehydratePanelPosition();
      const { x, y } = clampPos(bacnetPacketLog.offsetX, bacnetPacketLog.offsetY);
      setPanelPosition(x, y);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  const visible = $derived(visiblePackets());
  const trunkOptions = $derived(trunkIdsInBuffer());
  const totals = $derived.by(() => {
    const c = { link: 0, app: 0 };
    for (const p of bacnetPacketLog.packets) c[p.layer]++;
    return c;
  });

  let scrollEl: HTMLDivElement | null = $state(null);
  let stickToBottom = $state(true);

  $effect(() => {
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
    const sec = s % 60;
    const intSec = Math.floor(sec);
    // Show milliseconds when there's sub-second info — lets the user
    // see request → ACK latency in the packet log (e.g. 00:12.066 for
    // a ReadProperty-ACK that landed 66ms after the request).
    const ms = Math.floor((sec - intSec) * 1000);
    const base = `${String(min).padStart(2, '0')}:${String(intSec).padStart(2, '0')}`;
    return ms > 0 ? `${base}.${String(ms).padStart(3, '0')}` : base;
  }

  function formatValue(p: BacnetPacket): string {
    if (p.value === undefined) return '';
    if (typeof p.value === 'boolean') return p.value ? 'TRUE' : 'FALSE';
    if (Math.abs(p.value) < 0.01) return '0';
    if (Math.abs(p.value) < 10) return p.value.toFixed(2);
    if (Math.abs(p.value) < 100) return p.value.toFixed(1);
    return p.value.toFixed(0);
  }

  function srcDst(p: BacnetPacket): string {
    const src = String(p.srcMac).padStart(3, ' ');
    const dst = p.dstMac !== undefined ? String(p.dstMac).padStart(3, ' ') : '  *';
    return `${src} → ${dst}`;
  }

  // Drag-to-reposition — anchored bottom-LEFT instead of bottom-right so
  // it doesn't collide with the runtime log on small viewports.
  const DRAG_THRESHOLD = 4;
  let dragging = $state(false);
  let didActuallyDrag = false;
  let suppressNextClick = $state(false);
  let dragStart = { x: 0, y: 0, originX: 0, originY: 0 };

  function startDrag(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('button, select')) return;
    dragging = true;
    didActuallyDrag = false;
    dragStart = {
      x: e.clientX,
      y: e.clientY,
      originX: bacnetPacketLog.offsetX,
      originY: bacnetPacketLog.offsetY,
    };
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', endDrag);
    e.preventDefault();
  }

  function onDragMove(e: MouseEvent): void {
    if (!dragging) return;
    // Anchored bottom-LEFT — dragging RIGHT should grow offsetX, dragging
    // UP should grow offsetY. (Bottom-left anchor logic differs from the
    // runtime log which is anchored bottom-right.)
    const dx = e.clientX - dragStart.x;
    const dy = dragStart.y - e.clientY;
    if (!didActuallyDrag && Math.hypot(dx, dy) >= DRAG_THRESHOLD) didActuallyDrag = true;
    if (!didActuallyDrag) return;
    // Live-clamp against the panel's actual rendered size so the
    // drag-handle header can never get pushed off-screen mid-drag.
    const { x, y } = clampPos(dragStart.originX + dx, dragStart.originY + dy);
    bacnetPacketLog.offsetX = x;
    bacnetPacketLog.offsetY = y;
  }

  function endDrag(): void {
    if (didActuallyDrag) {
      setPanelPosition(bacnetPacketLog.offsetX, bacnetPacketLog.offsetY);
      suppressNextClick = true;
      setTimeout(() => { suppressNextClick = false; }, 50);
    }
    dragging = false;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', endDrag);
  }

  function onHeaderClick(e: MouseEvent): void {
    if (suppressNextClick) return;
    if ((e.target as HTMLElement).closest('button, select')) return;
    togglePanel();
  }
</script>

<aside
  bind:this={panelEl}
  class="bacnet-log"
  class:open={bacnetPacketLog.panelOpen}
  class:dragging
  role="log"
  aria-label="BACnet packet log"
  style:left="{1 + bacnetPacketLog.offsetX / 16}rem"
  style:bottom="{0.75 + bacnetPacketLog.offsetY / 16}rem"
>
  <header
    class="head"
    onmousedown={startDrag}
    onclick={onHeaderClick}
    title="Drag to reposition · click to collapse"
  >
    <span class="glyph grip">⠿</span>
    <strong>BACnet packets</strong>
    <span class="counts">
      <span class="count link" title="MS/TP link-layer (token-pass)">L {totals.link}</span>
      <span class="count app" title="BACnet application-layer (ReadProperty etc.)">A {totals.app}</span>
    </span>
    <button
      type="button"
      class="snap-btn"
      title="Snap panel back to bottom-left corner"
      onclick={(e) => { e.stopPropagation(); resetPanelPosition(); }}
    >⌐</button>
    <span class="toggle">{bacnetPacketLog.panelOpen ? '▼' : '▲'}</span>
  </header>

  {#if bacnetPacketLog.panelOpen}
    <div class="toolbar">
      <div class="filters">
        {#each ['all', 'link', 'app'] as f}
          <button
            type="button"
            class="filter-btn"
            class:active={bacnetPacketLog.layerFilter === f}
            onclick={() => setLayerFilter(f as LayerFilter)}
            title={f === 'link' ? 'Show only MS/TP link-layer frames' : f === 'app' ? 'Show only BACnet application-layer service requests' : 'Show every packet'}
          >
            {f}
          </button>
        {/each}
      </div>
      {#if trunkOptions.length > 1}
        <select
          class="trunk-select"
          value={bacnetPacketLog.trunkFilter}
          onchange={(e) => setTrunkFilter((e.currentTarget as HTMLSelectElement).value)}
          title="Filter packets by trunk"
        >
          <option value="">All trunks</option>
          {#each trunkOptions as opt (opt.id)}
            <option value={opt.id}>{opt.label}</option>
          {/each}
        </select>
      {/if}
      <div class="actions">
        <button type="button" class="action-btn" onclick={togglePaused} title={bacnetPacketLog.paused ? 'Resume capture' : 'Pause capture'}>
          {bacnetPacketLog.paused ? '▶' : '⏸'}
        </button>
        <button type="button" class="action-btn" onclick={clearPackets} title="Clear buffer">
          ⌫
        </button>
      </div>
    </div>

    <div class="log-body" bind:this={scrollEl} onscroll={onScroll}>
      {#if visible.length === 0}
        <div class="empty">
          {#if bacnetPacketLog.packets.length === 0}
            No packets yet. Wire two devices on an MS/TP trunk and run the sim.
          {:else}
            Filter hides every captured packet — try widening the filter.
          {/if}
        </div>
      {/if}
      {#each visible as p (p.id)}
        {@const fault = p.service === 'Timeout' || p.service === 'CommunicationLost'}
        {@const recover = p.service === 'CommunicationRestored'}
        <div class="entry layer-{p.layer}" class:fault class:recover>
          <span class="time">{formatTime(p.simSec)}</span>
          <span class="macs">{srcDst(p)}</span>
          <span class="svc" title={p.summary}>{p.service}</span>
          <span class="obj">{p.objectId ?? ''}</span>
          <span class="val">{formatValue(p)}</span>
        </div>
      {/each}
    </div>
  {/if}
</aside>

<style>
  .bacnet-log {
    position: absolute;
    left: 1rem;
    bottom: 0.75rem;
    width: min(36rem, calc(100% - 2rem));
    max-height: 20rem;
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, Canvas 96%, CanvasText 3%);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    z-index: 39;
    font-size: 0.74rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .bacnet-log:not(.open) {
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

  .bacnet-log.dragging .head {
    cursor: grabbing;
  }

  .grip {
    color: color-mix(in srgb, CanvasText 45%, transparent);
    font-size: 0.95rem;
    letter-spacing: -0.1em;
  }

  .head strong {
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

  .count.link {
    background: color-mix(in srgb, #06b6d4 25%, transparent);
    color: color-mix(in srgb, #06b6d4 95%, CanvasText);
  }
  .count.app {
    background: color-mix(in srgb, #9b59b6 25%, transparent);
    color: color-mix(in srgb, #9b59b6 95%, CanvasText);
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
  }
  .snap-btn:hover {
    color: CanvasText;
    border-color: color-mix(in srgb, CanvasText 45%, transparent);
  }

  .toggle {
    font-size: 0.75rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
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

  .trunk-select {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 0.7rem;
    padding: 0.15rem 0.35rem;
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 4px;
    background: Canvas;
    color: CanvasText;
    max-width: 14rem;
  }

  .actions {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
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
    /* time column widened to 5rem to accommodate MM:SS.mmm formatting
       when sub-second packet latency is present. */
    grid-template-columns: 5rem 5.2rem 9rem 4rem 1fr;
    gap: 0.4rem;
    padding: 0.1rem 0.25rem;
    border-radius: 3px;
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
  }

  .entry.layer-link {
    color: color-mix(in srgb, CanvasText 75%, transparent);
  }

  .entry.layer-app {
    background: color-mix(in srgb, #9b59b6 8%, transparent);
    color: color-mix(in srgb, #9b59b6 92%, CanvasText);
  }

  /* Timeout + CommunicationLost rows turn red — same visual language
     as the runtime log's error level, so a tech scanning either surface
     knows immediately that a confirmed service failed. */
  .entry.fault {
    background: color-mix(in srgb, #e74c3c 14%, transparent);
    color: color-mix(in srgb, #e74c3c 100%, CanvasText);
    font-weight: 600;
  }

  /* CommunicationRestored rows turn green to signal recovery. */
  .entry.recover {
    background: color-mix(in srgb, #2ecc71 14%, transparent);
    color: color-mix(in srgb, #2ecc71 100%, CanvasText);
    font-weight: 600;
  }

  .time {
    color: color-mix(in srgb, CanvasText 50%, transparent);
    font-size: 0.7rem;
  }

  .macs {
    font-weight: 600;
    color: color-mix(in srgb, #4a9eff 90%, CanvasText);
    white-space: nowrap;
    font-size: 0.7rem;
  }

  .svc {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .obj {
    color: color-mix(in srgb, #16a085 90%, CanvasText);
    font-weight: 600;
  }

  .val {
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
