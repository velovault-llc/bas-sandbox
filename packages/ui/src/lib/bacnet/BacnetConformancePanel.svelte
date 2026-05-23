<script lang="ts">
  // BACnet conformance panel — runs the spec-derived checks from
  // @bas/core/bacnet/conformance against the live packet log and
  // surfaces findings with their ASHRAE 135 citations.
  //
  // The teaching value: a tech can see "your sandbox emits Who-Is
  // every 30s ✓ matches §16.10.1 — but your I-Am is missing
  // statusFlags ⚠ §16.10.2." That makes the sandbox legible to
  // anyone who's grown up on the spec instead of "trust me bro."

  import { onMount } from 'svelte';
  import {
    checkBacnetConformance,
    summarizeConformance,
    type ConformancePacket,
    type ConformanceFinding,
  } from '@bas/core';
  import { bacnetPacketLog } from './bacnetPacketLog.svelte';
  import { navigateToLibrary } from '../library/libraryNavStore.svelte';

  let panelOpen = $state(false);
  let panelEl: HTMLElement | null = $state(null);
  let offsetX = $state(0);
  let offsetY = $state(0);

  // Re-run the check whenever the packet log changes. Throttled by
  // Svelte's reactivity — runs at most once per microtask flush.
  const findings = $derived.by<ConformanceFinding[]>(() => {
    // Map packet log entries to the simpler ConformancePacket shape
    // (the conformance module is core-side and doesn't know about
    // the UI's packet record).
    const packets: ConformancePacket[] = bacnetPacketLog.packets.map((p) => ({
      simSec: p.simSec,
      service: p.service,
      srcMac: p.srcMac,
      dstMac: p.dstMac,
      trunkId: p.trunkId,
      summary: p.summary,
      objectId: p.objectId,
      value: p.value,
    }));
    if (packets.length === 0) return [];
    return checkBacnetConformance(packets);
  });

  const summary = $derived(summarizeConformance(findings));
  // NB: avoid shadowing Svelte 5's `$state` rune by naming this
  // `complianceState` instead of the more natural `state`.
  const complianceState = $derived(
    summary.errors > 0 ? 'err' : summary.warnings > 0 ? 'warn' : 'ok',
  );

  function clampPos(x: number, y: number): { x: number; y: number } {
    if (typeof window === 'undefined') return { x: Math.max(0, x), y: Math.max(0, y) };
    const parent = panelEl?.offsetParent as HTMLElement | null;
    const parentW = parent?.clientWidth ?? window.innerWidth;
    const parentH = parent?.clientHeight ?? window.innerHeight;
    const panelH = panelEl?.offsetHeight ?? 80;
    const panelW = panelEl?.offsetWidth ?? 320;
    const margin = 12;
    return {
      x: Math.min(Math.max(0, parentW - panelW - margin), Math.max(0, x)),
      y: Math.min(Math.max(0, parentH - panelH - margin), Math.max(0, y)),
    };
  }

  // Drag-to-reposition. Same parent-clamp pattern as the other panels.
  let dragging = $state(false);
  let didDrag = false;
  let dragStart = { mx: 0, my: 0, ox: 0, oy: 0 };
  function startDrag(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    didDrag = false;
    dragStart = { mx: e.clientX, my: e.clientY, ox: offsetX, oy: offsetY };
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', endDrag);
    e.preventDefault();
  }
  function onDragMove(e: MouseEvent): void {
    if (!dragging) return;
    const dx = dragStart.mx - e.clientX;
    const dy = e.clientY - dragStart.my;
    if (!didDrag && Math.hypot(dx, dy) >= 4) didDrag = true;
    if (!didDrag) return;
    const { x, y } = clampPos(dragStart.ox + dx, dragStart.oy + dy);
    offsetX = x;
    offsetY = y;
  }
  function endDrag(): void {
    dragging = false;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', endDrag);
  }
  function onHeaderClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('button')) return;
    if (didDrag) return;
    panelOpen = !panelOpen;
  }

  onMount(() => {
    // Re-clamp on resize so a saved position can't strand the panel.
    const onResize = () => {
      const { x, y } = clampPos(offsetX, offsetY);
      offsetX = x;
      offsetY = y;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });
</script>

<aside
  bind:this={panelEl}
  class="conformance"
  class:open={panelOpen}
  class:dragging
  class:state-err={complianceState === 'err'}
  class:state-warn={complianceState === 'warn'}
  class:state-ok={complianceState === 'ok'}
  role="region"
  aria-label="BACnet conformance"
  style:right="calc(1rem + {offsetX}px)"
  style:top="calc(7rem + {offsetY}px)"
>
  <header class="head" onmousedown={startDrag} onclick={onHeaderClick} title="BACnet conformance (ASHRAE 135). Drag to reposition · click to toggle.">
    <span class="grip">⠿</span>
    <span class="glyph">
      {#if complianceState === 'err'}⛔{:else if complianceState === 'warn'}⚠{:else}✓{/if}
    </span>
    <strong>Conformance</strong>
    <span class="counts">
      {#if summary.errors > 0}<span class="count err">{summary.errors}</span>{/if}
      {#if summary.warnings > 0}<span class="count warn">{summary.warnings}</span>{/if}
      {#if summary.infos > 0}<span class="count info">{summary.infos}</span>{/if}
      {#if summary.total === 0}<span class="count clean">— pass</span>{/if}
    </span>
    <span class="toggle">{panelOpen ? '▼' : '▲'}</span>
  </header>

  {#if panelOpen}
    <div class="body">
      {#if findings.length === 0}
        {#if bacnetPacketLog.packets.length === 0}
          <p class="empty">
            No packets yet. The conformance checker reads from the BACnet packet log; it
            needs the sandbox to actually emit BACnet traffic. To produce some:
          </p>
          <ul class="empty-hints">
            <li>
              <strong>MS/TP trunk</strong> — wire a supervisor to one or more controllers
              with the MS/TP wire kind. Token-pass + ReadProperty/COV packets fire while
              the sim runs.
            </li>
            <li>
              <strong>Supervisor with an IP</strong> — set IP + Mask on a supervisor's
              Network panel. Net.5 broadcast trace synthesizes a Who-Is from each
              IP-enabled supervisor every 30 sim-seconds.
            </li>
            <li>
              Or load the <strong>Quick start: 1 VAV</strong> demo from the DEMOS list
              (bottom-right) — it has both already set up.
            </li>
          </ul>
        {:else}
          <p class="empty">
            ✓ No findings. The packet log passes every rule this checker knows about
            (ASHRAE 135 §16.10, §13.10, §15.5, §12.11).
          </p>
        {/if}
      {:else}
        {#each findings as f, i (i)}
          <div class="finding lvl-{f.severity}">
            <div class="row1">
              <span class="sev">
                {#if f.severity === 'error'}✕{:else if f.severity === 'warning'}⚠{:else}●{/if}
              </span>
              <strong class="title">{f.title}</strong>
            </div>
            <p class="desc">{f.description}</p>
            {#if f.citation}
              <button
                type="button"
                class="cite-btn"
                onclick={() => navigateToLibrary(f.citation ?? '')}
                title="Open this citation in the Library tab"
              >📘 {f.citation}</button>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</aside>

<style>
  .conformance {
    position: absolute;
    width: 22rem;
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    background: color-mix(in srgb, Canvas 92%, CanvasText 4%);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    z-index: 18;
    font-size: 0.78rem;
    overflow: hidden;
  }
  .conformance:not(.open) {
    width: auto;
    max-width: 18rem;
  }
  .conformance.state-err {
    border-color: color-mix(in srgb, #e74c3c 60%, transparent);
  }
  .conformance.state-warn {
    border-color: color-mix(in srgb, #f59e0b 60%, transparent);
  }
  .conformance.state-ok {
    border-color: color-mix(in srgb, #2ecc71 50%, transparent);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.6rem;
    background: color-mix(in srgb, Canvas 88%, CanvasText 6%);
    border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    cursor: grab;
    user-select: none;
  }
  .conformance.dragging .head {
    cursor: grabbing;
  }
  .grip {
    color: color-mix(in srgb, CanvasText 35%, transparent);
    font-size: 1rem;
    line-height: 1;
  }
  .glyph {
    font-size: 0.95rem;
    line-height: 1;
  }
  .state-err .glyph {
    color: #e74c3c;
  }
  .state-warn .glyph {
    color: #f59e0b;
  }
  .state-ok .glyph {
    color: #2ecc71;
  }
  .counts {
    display: inline-flex;
    gap: 0.25rem;
    margin-left: auto;
    align-items: center;
  }
  .count {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.7rem;
    font-weight: 700;
    padding: 0.05rem 0.4rem;
    border-radius: 8px;
    background: color-mix(in srgb, CanvasText 10%, transparent);
  }
  .count.err {
    color: #e74c3c;
    background: color-mix(in srgb, #e74c3c 18%, transparent);
  }
  .count.warn {
    color: #f59e0b;
    background: color-mix(in srgb, #f59e0b 18%, transparent);
  }
  .count.info {
    color: #4a9eff;
    background: color-mix(in srgb, #4a9eff 18%, transparent);
  }
  .count.clean {
    color: #2ecc71;
    background: color-mix(in srgb, #2ecc71 18%, transparent);
  }
  .toggle {
    color: color-mix(in srgb, CanvasText 50%, transparent);
    font-size: 0.7rem;
    margin-left: 0.2rem;
  }

  .body {
    overflow-y: auto;
    padding: 0.5rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .empty {
    margin: 0;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-style: italic;
    line-height: 1.4;
  }
  .empty-hints {
    margin: 0.3rem 0 0;
    padding-left: 1.1rem;
    font-size: 0.72rem;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    line-height: 1.4;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .empty-hints li {
    margin: 0;
  }
  .finding {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.4rem 0.5rem;
    border-radius: 4px;
    border-left: 2px solid color-mix(in srgb, CanvasText 25%, transparent);
    background: color-mix(in srgb, CanvasText 4%, transparent);
  }
  .finding.lvl-error {
    border-left-color: #e74c3c;
    background: color-mix(in srgb, #e74c3c 8%, transparent);
  }
  .finding.lvl-warning {
    border-left-color: #f59e0b;
    background: color-mix(in srgb, #f59e0b 6%, transparent);
  }
  .finding.lvl-info {
    border-left-color: #4a9eff;
    background: color-mix(in srgb, #4a9eff 6%, transparent);
  }
  .row1 {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
  }
  .sev {
    font-size: 0.78rem;
  }
  .lvl-error .sev {
    color: #e74c3c;
  }
  .lvl-warning .sev {
    color: #f59e0b;
  }
  .lvl-info .sev {
    color: #4a9eff;
  }
  .title {
    font-size: 0.78rem;
  }
  .desc {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.4;
    color: color-mix(in srgb, CanvasText 75%, transparent);
  }
  .cite-btn {
    align-self: flex-start;
    margin: 0;
    padding: 0.1rem 0.35rem;
    background: color-mix(in srgb, #06b6d4 10%, transparent);
    border: 1px solid color-mix(in srgb, #06b6d4 35%, transparent);
    border-radius: 3px;
    font: inherit;
    font-size: 0.68rem;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    cursor: pointer;
    text-align: left;
    transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
  }
  .cite-btn:hover {
    border-color: color-mix(in srgb, #06b6d4 70%, transparent);
    background: color-mix(in srgb, #06b6d4 20%, transparent);
    color: CanvasText;
  }
</style>
