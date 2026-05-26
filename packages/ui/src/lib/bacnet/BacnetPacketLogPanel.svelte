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
  import { findCorpusExemplar, hexDump } from '@bas/core';
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
    // Use the panel's POSITIONED ANCESTOR height — `bottom`/`left`
    // resolve relative to that ancestor, not the window. See the matching
    // comment in RuntimeLogPanel.svelte for the full reasoning.
    const parent = panelEl?.offsetParent as HTMLElement | null;
    const parentH = parent?.clientHeight ?? window.innerHeight;
    const parentW = parent?.clientWidth ?? window.innerWidth;
    const margin = 12;
    const maxY = Math.max(0, parentH - panelH - margin);
    const maxX = Math.max(0, parentW - panelW - margin);
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

  const visible = $derived.by(() => {
    const arr = visiblePackets();
    const q = searchTerm.trim().toLowerCase();
    if (!q) return arr;
    // Substring match across the fields a tech would actually want to
    // filter on. Multi-term: each whitespace-separated token must match
    // somewhere — Wireshark's display-filter does the same in basic mode.
    const tokens = q.split(/\s+/);
    return arr.filter((p) => {
      const hay = [
        p.service,
        p.objectId ?? '',
        p.propertyName ?? '',
        p.summary,
        p.srcLabel ?? '',
        p.dstLabel ?? '',
        p.srcMac !== undefined ? `mac ${p.srcMac}` : '',
        p.dstMac !== undefined ? `mac ${p.dstMac}` : '',
      ].join(' ').toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  });
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

  // ── Wireshark-style inspector state + helpers ──────────────────────
  /** Which packet (by id) is currently expanded inline. -1 = none. */
  let expandedId = $state<number>(-1);
  /** Substring search across the summary field. Empty = no filter. */
  let searchTerm = $state<string>('');

  function toggleExpanded(id: number): void {
    expandedId = expandedId === id ? -1 : id;
  }

  /** Extract structured details out of the summary string + packet fields.
   *  We don't currently emit raw bytes (only human summaries), so the
   *  detail tree pulls everything it can from the typed BacnetPacket
   *  fields PLUS heuristic regex-pulls from the summary line. When the
   *  Node bridge lands and emit.ts starts producing bytes, this is where
   *  the hex-dump pane will render. */
  function decodeDetails(p: BacnetPacket): {
    transport: {
      bvllFn?: string;        // e.g. "0x0a Original-Unicast-NPDU"
      bvllName?: string;
      isBroadcast?: boolean;
      isForwarded?: boolean;
    };
    network: {
      expectingReply?: boolean;
    };
    apdu: {
      invokeId?: number;
      attemptInfo?: string;   // e.g. "attempt 2/3"
    };
    service: {
      name: string;
      objectId?: string;
      propertyName?: string;
      propertyId?: number;
      value?: string;
      statusFlags?: string;   // e.g. "F,F,F,F"
      deadband?: string;
    };
    raw: string;
  } {
    const s = p.summary;
    const det = {
      transport: {} as { bvllFn?: string; bvllName?: string; isBroadcast?: boolean; isForwarded?: boolean },
      network: {} as { expectingReply?: boolean },
      apdu: {} as { invokeId?: number; attemptInfo?: string },
      service: {
        name: String(p.service),
        objectId: p.objectId,
        propertyName: p.propertyName,
        propertyId: p.propertyId,
      } as {
        name: string;
        objectId?: string;
        propertyName?: string;
        propertyId?: number;
        value?: string;
        statusFlags?: string;
        deadband?: string;
      },
      raw: s,
    };
    // BVLC function code — surfaced in any summary that mentions it.
    const mBvlc = /BVLC fn (0x[0-9a-f]+)\s+([A-Za-z][-A-Za-z]*)/i.exec(s);
    if (mBvlc) {
      det.transport.bvllFn = mBvlc[1];
      det.transport.bvllName = mBvlc[2];
      det.transport.isBroadcast = mBvlc[2].toLowerCase().includes('broadcast');
      det.transport.isForwarded = mBvlc[2].toLowerCase().includes('forwarded');
    } else if (p.dstMac === undefined && p.dstLabel === undefined) {
      // No explicit destination → almost certainly broadcast.
      det.transport.isBroadcast = true;
    }
    if (/Expecting-Reply/i.test(s)) det.network.expectingReply = true;
    const mInvoke = /invokeId\s+(\d+)/i.exec(s);
    if (mInvoke) det.apdu.invokeId = parseInt(mInvoke[1], 10);
    const mAttempt = /attempt\s+(\d+\/\d+)/i.exec(s);
    if (mAttempt) det.apdu.attemptInfo = mAttempt[1];
    // statusFlags from COV summaries — pattern like "(F,F,F,F)" or "(T,F,F,F)".
    const mStatus = /statusFlags?[:\s]*\(?([TF],[TF],[TF],[TF])\)?/i.exec(s);
    if (mStatus) det.service.statusFlags = mStatus[1];
    // Deadband from SubscribeCOV.
    const mDeadband = /deadband\s+([\d.]+)\s*([^\s)]+)?/i.exec(s);
    if (mDeadband) det.service.deadband = mDeadband[2] ? `${mDeadband[1]} ${mDeadband[2]}` : mDeadband[1];
    // ReadProperty-ACK value: prefer typed field; otherwise look for "= <num>".
    if (p.value !== undefined) {
      det.service.value = typeof p.value === 'boolean'
        ? (p.value ? 'TRUE' : 'FALSE')
        : String(p.value);
    } else {
      const mVal = /=\s*(-?\d+(?:\.\d+)?)/.exec(s);
      if (mVal) det.service.value = mVal[1];
    }
    return det;
  }

  function copyToClipboard(text: string): void {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text);
  }

  function srcDst(p: BacnetPacket): string {
    // Prefer human labels when present (IP-pair traffic). Fall back to
    // MAC display for MS/TP frames. The fixed-width MAC column gets
    // padded; label columns expand to fit so JACE-MAIN and VAV-101
    // don't get truncated to "MAC".
    //
    // Defensive: also reject the literal STRING "undefined" — that's
    // what shows up when a caller template-literal-stringified an
    // undefined JS value into the label field (`${undef}` → "undefined").
    // Treating it as missing falls through to the MAC display or "?".
    const cleanLabel = (s: string | undefined): string | undefined =>
      s && s !== 'undefined' && s.trim().length > 0 ? s : undefined;
    const srcLbl = cleanLabel(p.srcLabel);
    const dstLbl = cleanLabel(p.dstLabel);
    const srcStr =
      srcLbl ??
      (p.srcMac !== undefined ? `MAC ${String(p.srcMac).padStart(3, ' ')}` : '   ?');
    const dstStr =
      dstLbl ??
      (p.dstMac !== undefined ? `MAC ${String(p.dstMac).padStart(3, ' ')}` : '  *');
    return `${srcStr} → ${dstStr}`;
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
      <input
        class="search-input"
        type="search"
        placeholder="Filter (e.g. VAV-101 invokeId 42)"
        title="Substring match across service, addresses, object, property, summary. Whitespace-separated terms = AND."
        bind:value={searchTerm}
      />
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
        {@const isOpen = expandedId === p.id}
        <button
          type="button"
          class="entry entry-row layer-{p.layer}"
          class:fault
          class:recover
          class:open={isOpen}
          onclick={() => toggleExpanded(p.id)}
          title={p.summary}
        >
          <span class="chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
          <span class="time">{formatTime(p.simSec)}</span>
          <span class="macs" title={srcDst(p)}>{srcDst(p)}</span>
          <span class="svc">{p.service}</span>
          <span class="obj">{p.objectId ?? ''}</span>
          <span class="val">{formatValue(p)}</span>
        </button>
        {#if isOpen}
          {@const det = decodeDetails(p)}
          <div class="entry-detail" role="region" aria-label="Packet details">
            <div class="tree">
              <div class="branch">
                <div class="branch-head">▼ Frame</div>
                <div class="row"><span class="k">Sim time</span><span class="v">{formatTime(p.simSec)} ({p.simSec.toFixed(3)}s)</span></div>
                {#if p.trunkLabel}
                  <div class="row"><span class="k">Trunk</span><span class="v">{p.trunkLabel}</span></div>
                {/if}
                {#if p.trunkId}
                  <div class="row"><span class="k">Trunk ID</span><span class="v"><code>{p.trunkId}</code></span></div>
                {/if}
                <div class="row"><span class="k">Layer</span><span class="v">{p.layer === 'app' ? 'application' : 'data-link'}</span></div>
              </div>

              <div class="branch">
                <div class="branch-head">▼ Transport (BVLC + NPDU)</div>
                {#if det.transport.bvllFn}
                  <div class="row"><span class="k">BVLC function</span><span class="v"><code>{det.transport.bvllFn}</code> {det.transport.bvllName ?? ''}</span></div>
                {:else}
                  <div class="row dim"><span class="k">BVLC function</span><span class="v">— (not surfaced for this service)</span></div>
                {/if}
                {#if det.transport.isBroadcast}
                  <div class="row"><span class="k">Cast</span><span class="v">broadcast</span></div>
                {:else if det.transport.isForwarded}
                  <div class="row"><span class="k">Cast</span><span class="v">BBMD-forwarded</span></div>
                {:else}
                  <div class="row"><span class="k">Cast</span><span class="v">unicast</span></div>
                {/if}
                {#if det.network.expectingReply}
                  <div class="row"><span class="k">NPDU flag</span><span class="v">Expecting-Reply</span></div>
                {/if}
              </div>

              <div class="branch">
                <div class="branch-head">▼ Addressing</div>
                <div class="row">
                  <span class="k">Source</span>
                  <span class="v">
                    {p.srcLabel ?? (p.srcMac !== undefined ? `MAC ${p.srcMac}` : '?')}
                    {#if p.srcLabel && p.srcMac !== undefined}<span class="dim">(MAC {p.srcMac})</span>{/if}
                  </span>
                </div>
                <div class="row">
                  <span class="k">Destination</span>
                  <span class="v">
                    {p.dstLabel ?? (p.dstMac !== undefined ? `MAC ${p.dstMac}` : 'broadcast')}
                    {#if p.dstLabel && p.dstMac !== undefined}<span class="dim">(MAC {p.dstMac})</span>{/if}
                  </span>
                </div>
              </div>

              <div class="branch">
                <div class="branch-head">▼ APDU</div>
                <div class="row"><span class="k">Service</span><span class="v"><strong>{det.service.name}</strong></span></div>
                {#if det.apdu.invokeId !== undefined}
                  <div class="row"><span class="k">Invoke ID</span><span class="v">{det.apdu.invokeId}</span></div>
                {/if}
                {#if det.apdu.attemptInfo}
                  <div class="row"><span class="k">Retry</span><span class="v">attempt {det.apdu.attemptInfo}</span></div>
                {/if}
                {#if det.service.objectId}
                  <div class="row"><span class="k">Object</span><span class="v"><code>{det.service.objectId}</code></span></div>
                {/if}
                {#if det.service.propertyName !== undefined || det.service.propertyId !== undefined}
                  <div class="row">
                    <span class="k">Property</span>
                    <span class="v">
                      {det.service.propertyName ?? '?'}
                      {#if det.service.propertyId !== undefined}<span class="dim">({det.service.propertyId})</span>{/if}
                    </span>
                  </div>
                {/if}
                {#if det.service.value !== undefined}
                  <div class="row"><span class="k">Value</span><span class="v">{det.service.value}</span></div>
                {/if}
                {#if det.service.deadband}
                  <div class="row"><span class="k">Deadband</span><span class="v">{det.service.deadband}</span></div>
                {/if}
                {#if det.service.statusFlags}
                  <div class="row">
                    <span class="k">Status flags</span>
                    <span class="v">
                      <code>{det.service.statusFlags}</code>
                      <span class="dim">(in-alarm, fault, overridden, out-of-service)</span>
                    </span>
                  </div>
                {/if}
              </div>

              <div class="branch raw">
                <div class="branch-head">▼ Summary (raw)</div>
                <div class="raw-text">{det.raw}</div>
                <div class="row">
                  <button
                    type="button"
                    class="copy-btn"
                    onclick={(e) => { e.stopPropagation(); copyToClipboard(det.raw); }}
                    title="Copy summary to clipboard"
                  >📋 Copy</button>
                </div>
              </div>

              {#if findCorpusExemplar(String(p.service))}
                {@const exemplar = findCorpusExemplar(String(p.service))!}
                <div class="branch corpus-ref">
                  <div class="branch-head">▼ Real-corpus reference</div>
                  <div class="row">
                    <span class="k">Source</span>
                    <span class="v">
                      <code>kargs:{exemplar.capture}</code> frame {exemplar.frame}
                    </span>
                  </div>
                  <div class="row">
                    <span class="k">Real-device context</span>
                    <span class="v">{exemplar.context}</span>
                  </div>
                  <div class="row">
                    <span class="k">Byte length</span>
                    <span class="v">{exemplar.byteLength} bytes</span>
                  </div>
                  <pre class="hexdump">{hexDump(exemplar.hex)}</pre>
                  <div class="row">
                    <button
                      type="button"
                      class="copy-btn"
                      onclick={(e) => { e.stopPropagation(); copyToClipboard(exemplar.hex); }}
                      title="Copy raw hex to clipboard"
                    >📋 Copy hex</button>
                    <span class="v dim">
                      Real bytes captured on a {exemplar.capture.includes('plugfest') ? 'multi-vendor plugfest' : 'real BACnet'} network. Our sandbox doesn't emit these bytes yet — coming with the Node bridge milestone.
                    </span>
                  </div>
                </div>
              {:else}
                <div class="branch hex-todo">
                  <div class="branch-head dim">▾ Real-corpus reference</div>
                  <div class="row dim">
                    <span class="k">Service</span>
                    <span class="v">No corpus exemplar for <code>{p.service}</code> yet.</span>
                  </div>
                  <div class="row dim">
                    <span class="v">
                      Closes when the bacpypes3 reference-device milestone lands — that's the
                      tool we'll use to generate real wire bytes for services not in the
                      public capture corpus (Who-Is, I-Am, SubscribeCOV, COV-Notification, etc.).
                    </span>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</aside>

<style>
  .bacnet-log {
    position: absolute;
    left: 1rem;
    bottom: 0.75rem;
    /* Widened from 36rem so labels like "JACE-MAIN → VAV-104" don't
       collide with the service column. When the inspector is open the
       max-height also grows to fit the expanded detail tree. */
    width: min(48rem, calc(100% - 2rem));
    max-height: 28rem;
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
    /* Columns: chevron · time · src/dst · service · object · value.
       The src/dst column was 5.2rem; widened to 12rem to fit human
       labels ("JACE-MAIN → VAV-104" is ~13 chars + arrow). Long labels
       still ellipsize defensively via overflow rules below. */
    grid-template-columns: 0.9rem 5rem 12rem 9rem 4rem 1fr;
    gap: 0.4rem;
    padding: 0.1rem 0.25rem;
    border-radius: 3px;
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
    /* Row-as-button base styles — reset native <button> chrome so the
       row reads as a list item with a chevron, not a clickable button. */
    background: transparent;
    border: 0;
    color: inherit;
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: left;
    width: 100%;
    cursor: pointer;
  }
  .entry-row:hover {
    background: color-mix(in srgb, CanvasText 5%, transparent);
  }
  .entry-row.open {
    background: color-mix(in srgb, #4a9eff 14%, transparent);
  }
  .chev {
    color: color-mix(in srgb, CanvasText 50%, transparent);
    font-size: 0.65rem;
    line-height: 1.4;
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
    /* Force containment — long labels truncate with ellipsis rather
       than bleeding into the service column. The title tooltip keeps
       the full label accessible on hover. */
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .svc {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
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

  /* ── Search input in toolbar ───────────────────────────────────── */
  .search-input {
    flex: 1 1 7rem;
    min-width: 6rem;
    max-width: 14rem;
    padding: 0.18rem 0.45rem;
    background: Canvas;
    color: CanvasText;
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    border-radius: 4px;
    font: inherit;
    font-size: 0.7rem;
    outline: none;
  }
  .search-input:focus {
    border-color: color-mix(in srgb, #4a9eff 70%, transparent);
  }
  .search-input::placeholder {
    color: color-mix(in srgb, CanvasText 45%, transparent);
  }

  /* ── Inspector tree (Wireshark-style detail pane) ──────────────── */
  .entry-detail {
    background: color-mix(in srgb, Canvas 92%, CanvasText 8%);
    border-left: 2px solid color-mix(in srgb, #4a9eff 60%, transparent);
    margin: 0.15rem 0 0.35rem 1.1rem;
    padding: 0.5rem 0.7rem;
    border-radius: 3px;
    font-size: 0.72rem;
    line-height: 1.5;
  }
  .tree {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .branch {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .branch-head {
    color: color-mix(in srgb, #4a9eff 90%, CanvasText);
    font-weight: 600;
    margin-bottom: 0.15rem;
  }
  .branch.raw .branch-head {
    color: color-mix(in srgb, #16a085 85%, CanvasText);
  }
  .branch.hex-todo .branch-head {
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }
  .branch .row {
    display: grid;
    grid-template-columns: 7.5rem 1fr;
    gap: 0.5rem;
    padding-left: 0.8rem;
  }
  .branch .k {
    color: color-mix(in srgb, CanvasText 60%, transparent);
    text-transform: lowercase;
    font-variant: small-caps;
    font-size: 0.7rem;
  }
  .branch .v {
    color: color-mix(in srgb, CanvasText 90%, transparent);
    word-break: break-word;
  }
  .branch .v code {
    background: color-mix(in srgb, CanvasText 8%, transparent);
    padding: 0.02rem 0.3rem;
    border-radius: 3px;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
  }
  .branch .v .dim,
  .branch .row.dim {
    color: color-mix(in srgb, CanvasText 45%, transparent);
    font-style: italic;
  }
  .raw-text {
    background: color-mix(in srgb, CanvasText 6%, transparent);
    padding: 0.35rem 0.5rem;
    border-radius: 3px;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0 0 0.3rem 0.8rem;
  }
  .copy-btn {
    background: transparent;
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    color: color-mix(in srgb, CanvasText 75%, transparent);
    padding: 0.12rem 0.5rem;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 0.7rem;
  }
  .copy-btn:hover {
    background: color-mix(in srgb, CanvasText 8%, transparent);
    color: CanvasText;
  }
  /* Real-corpus reference branch — visually distinct from the
     sandbox-synthesized branches above it so the user understands
     these bytes came from a different (authoritative) source. */
  .branch.corpus-ref .branch-head {
    color: color-mix(in srgb, #16a085 90%, CanvasText);
  }
  .hexdump {
    background: color-mix(in srgb, #16a085 7%, transparent);
    border: 1px solid color-mix(in srgb, #16a085 25%, transparent);
    color: color-mix(in srgb, CanvasText 88%, transparent);
    padding: 0.45rem 0.6rem;
    border-radius: 3px;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
    line-height: 1.4;
    margin: 0.3rem 0 0.3rem 0.8rem;
    overflow-x: auto;
    white-space: pre;
    max-height: 18rem;
    overflow-y: auto;
  }
</style>
