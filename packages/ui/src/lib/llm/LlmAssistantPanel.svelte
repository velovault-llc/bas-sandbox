<script lang="ts">
  // Local LLM assistant — connects to an Ollama instance running on the
  // user's machine. Default endpoint http://localhost:11434. Two quick
  // actions wired into the live sandbox state (Explain Program / Diagnose
  // Controller) plus a free-form chat box. No data leaves the user's
  // network — that's the entire commercial value prop for federal sites.

  import { onMount, tick } from 'svelte';
  import {
    llmStore,
    togglePanel,
    refreshConnection,
    sendMessage,
    cancelActive,
    clearTurns,
    setEndpoint,
    setModel,
    setPanelPosition,
    resetPanelPosition,
    rehydratePanelPosition,
    appendLocalAssistantNotice,
  } from './llmStore.svelte';
  import { buildDiagnosePrompt, buildExplainPrompt } from './systemPrompt';
  import { programStore } from '../cli/programStore.svelte';
  import { controllerBridge } from '../cli/controllerBridge.svelte';
  import { canvasSnapshot } from '../canvasStore.svelte';
  import { runtimeLog } from '../runtime/runtimeLogStore.svelte';
  import { bacnetPacketLog } from '../bacnet/bacnetPacketLog.svelte';

  let pollHandle: ReturnType<typeof setInterval> | null = null;

  /** Bound to the panel <aside> so the drag clamp can measure the
   *  panel's actual rendered size — matches the runtime + packet log
   *  pattern. Without it, the panel could be dragged off the top of
   *  the canvas and the user couldn't grab the header to drag it back. */
  let panelEl: HTMLElement | null = $state(null);

  function clampPos(x: number, y: number): { x: number; y: number } {
    if (typeof window === 'undefined') return { x: Math.max(0, x), y: Math.max(0, y) };
    const panelH = panelEl?.offsetHeight ?? 80;
    const panelW = panelEl?.offsetWidth ?? 320;
    const parent = panelEl?.offsetParent as HTMLElement | null;
    const parentH = parent?.clientHeight ?? window.innerHeight;
    const parentW = parent?.clientWidth ?? window.innerWidth;
    const margin = 12;
    // Reserve headroom for the in-canvas top toolbar.
    const TOP_HEADROOM = 56;
    const maxY = Math.max(0, parentH - panelH - margin - TOP_HEADROOM);
    const maxX = Math.max(0, parentW - panelW - margin);
    return {
      x: Math.min(maxX, Math.max(0, x)),
      y: Math.min(maxY, Math.max(0, y)),
    };
  }

  onMount(() => {
    rehydratePanelPosition();
    // Re-clamp once the DOM has measured the panel — the store-level
    // clamp uses a static height estimate, but the real panel might
    // be taller. Same pattern as RuntimeLogPanel.
    queueMicrotask(() => {
      const { x, y } = clampPos(llmStore.offsetX, llmStore.offsetY);
      if (x !== llmStore.offsetX || y !== llmStore.offsetY) {
        setPanelPosition(x, y);
      }
    });
    const onResize = () => {
      rehydratePanelPosition();
      const { x, y } = clampPos(llmStore.offsetX, llmStore.offsetY);
      setPanelPosition(x, y);
    };
    window.addEventListener('resize', onResize);
    refreshConnection();
    // Poll the endpoint every 8s when panel is open. Cheap (local HTTP)
    // and lets the status pill flip green automatically the moment the
    // user starts their Ollama container.
    pollHandle = setInterval(() => {
      if (llmStore.panelOpen) refreshConnection();
    }, 8000);
    return () => {
      if (pollHandle) clearInterval(pollHandle);
      window.removeEventListener('resize', onResize);
    };
  });

  // Auto-scroll the chat to the bottom on new content unless the user
  // has scrolled up to read earlier replies.
  let scrollEl: HTMLDivElement | null = $state(null);
  let stickToBottom = $state(true);
  $effect(() => {
    // Touch the deps so this effect re-runs on each turn / token.
    const _ = llmStore.turns.length;
    void _;
    const last = llmStore.turns[llmStore.turns.length - 1];
    void last?.content?.length;
    if (!scrollEl || !stickToBottom) return;
    tick().then(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  });

  function onScroll(): void {
    if (!scrollEl) return;
    const atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 24;
    stickToBottom = atBottom;
  }

  let draft = $state('');

  function onSend(): void {
    const text = draft.trim();
    if (!text) return;
    sendMessage(text);
    draft = '';
  }

  function onKey(e: KeyboardEvent): void {
    // Enter sends; Shift+Enter inserts a newline (multi-line drafts).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  // ── Quick actions: Explain Program + Diagnose Controller ─────────────

  function explainSelectedProgram(): void {
    // Same detection priority as diagnoseSelectedController — programming
    // surface first, then canvas click, then refuse.
    const selectedOnCanvas = canvasSnapshot.nodes.find(
      (n) =>
        n.selected &&
        (n.data as { kind?: string } | undefined)?.kind === 'controller',
    )?.id ?? null;
    const ctrlId =
      programStore.activeSpecLangControllerId ??
      programStore.activeFbdControllerId ??
      programStore.activeControllerId ??
      selectedOnCanvas;
    if (!ctrlId) {
      // Local panel notice — NOT a chat message. We don't want the model
      // to dutifully answer "no program currently open" as if it were a
      // real user prompt.
      appendLocalAssistantNotice('No program currently open. Open a controller via CLI / FBD / SpecLang first, then try again.');
      return;
    }
    const prog = programStore.byId[ctrlId];
    if (!prog || !prog.source) {
      appendLocalAssistantNotice(`Controller "${ctrlId}" has no compiled program yet. Author one in the CLI / FBD / SpecLang surface first.`);
      return;
    }
    // `source` always holds the ST representation regardless of the
    // editor used (FBD-compiled, SpecLang-compiled, or hand-typed).
    // For SpecLang/FBD programs we also include the higher-level
    // representation so the LLM can speak in the user's editor's
    // vocabulary rather than dropping straight into IEC-speak.
    const lang: 'speclang' | 'st' | 'fbd' = prog.specProgram
      ? 'speclang'
      : prog.fbdGraph
      ? 'fbd'
      : 'st';
    const extra =
      prog.specProgram
        ? `\n\n## SpecLang AST (higher-level intent)\n\`\`\`json\n${JSON.stringify(prog.specProgram, null, 2)}\n\`\`\``
        : prog.fbdGraph
        ? `\n\n## FBD graph (higher-level intent)\n\`\`\`json\n${JSON.stringify(prog.fbdGraph, null, 2)}\n\`\`\``
        : '';
    sendMessage(buildExplainPrompt(prog.source, lang) + extra);
  }

  function diagnoseSelectedController(): void {
    // Detection priority:
    //   1. A programming surface is open (CLI / BACnet inspector / SpecLang
    //      / FBD) — that's the explicit focus signal
    //   2. The user clicked a controller node on the canvas (sets
    //      n.selected via SvelteFlow) — a more casual focus signal
    //   3. Otherwise refuse — we don't know what they want diagnosed
    const selectedOnCanvas = canvasSnapshot.nodes.find(
      (n) =>
        n.selected &&
        (n.data as { kind?: string } | undefined)?.kind === 'controller',
    )?.id ?? null;
    const ctrlId =
      programStore.activeControllerId ??
      programStore.activeBacnetControllerId ??
      programStore.activeSpecLangControllerId ??
      programStore.activeFbdControllerId ??
      selectedOnCanvas;
    if (!ctrlId) {
      appendLocalAssistantNotice('Select a controller first (click one on the canvas, or open its CLI/BACnet inspector) so I know which device to diagnose.');
      return;
    }
    const node = canvasSnapshot.nodes.find((n) => n.id === ctrlId);
    const label = (node?.data as { label?: string } | undefined)?.label ?? ctrlId;
    const vendorModelId = (node?.data as { vendorModelId?: string } | undefined)?.vendorModelId;
    const prog = programStore.byId[ctrlId];
    const bindings = prog?.bindings?.bindings ?? [];
    const bindingsText = bindings.length
      ? bindings.map((b) => `  ${b.terminalId} → ${b.role}`).join('\n')
      : undefined;

    // Topology summary — always available, even before the sim runs.
    // Walks the edges to enumerate what's wired to this controller and on
    // which kind of bus. Without this, a "diagnose me" click on a fresh
    // canvas gives the model nothing to look at.
    const labelOf = (id: string): string =>
      (canvasSnapshot.nodes.find((n) => n.id === id)?.data as { label?: string } | undefined)?.label ?? id;
    const kindOf = (id: string): string =>
      (canvasSnapshot.nodes.find((n) => n.id === id)?.data as { kind?: string } | undefined)?.kind ?? '?';
    const wires = canvasSnapshot.edges.filter((e) => e.source === ctrlId || e.target === ctrlId);
    const topologyLines: string[] = [];
    for (const w of wires) {
      const other = w.source === ctrlId ? w.target : w.source;
      const direction = w.source === ctrlId ? 'downstream →' : '← upstream';
      const wireKind = (w.data as { wireKind?: string } | undefined)?.wireKind ?? '?';
      topologyLines.push(`  ${direction} ${labelOf(other)} [${kindOf(other)}] via ${wireKind}`);
    }
    const topologySummary = topologyLines.length > 0
      ? topologyLines.join('\n')
      : '  (nothing wired to this controller yet)';

    // Last 20 runtime log entries (most recent at the bottom — typical
    // for "what just happened" diagnosis).
    const recentRuntimeLog = runtimeLog.entries
      .slice(-20)
      .map((e) => `  ${formatSec(e.simSec)} [${e.level}] ${e.source}: ${e.message}`)
      .join('\n') || undefined;

    // Last 30 packets, but only ones touching this controller (by node
    // id or its MAC). Cheap filter — just match the label since the
    // packet log already includes the controller label in summaries.
    const recentPacketLog = bacnetPacketLog.packets
      .slice(-50)
      .filter((p) => p.summary.includes(label))
      .slice(-30)
      .map((p) => `  ${formatSec(p.simSec)} ${p.service.padEnd(28)} ${p.summary}`)
      .join('\n') || undefined;

    // Sim is "running" (or has been) when there's ANY live env data for
    // this or any other controller, OR when the runtime log has entries.
    // Either signal indicates the user has actually pressed ▶ Run.
    const envInputsForCtrl = controllerBridge.envInputsByCtrl.get(ctrlId);
    const envOutputsForCtrl = controllerBridge.envOutputsByCtrl.get(ctrlId);
    const simIsRunning =
      (envInputsForCtrl && Object.keys(envInputsForCtrl).length > 0) ||
      (envOutputsForCtrl && Object.keys(envOutputsForCtrl).length > 0) ||
      runtimeLog.entries.length > 0;

    sendMessage(
      buildDiagnosePrompt({
        controllerLabel: label,
        vendorModelId,
        bindingsText,
        topologySummary,
        envInputs: envInputsForCtrl,
        envOutputs: envOutputsForCtrl,
        recentRuntimeLog,
        recentPacketLog,
        simIsRunning,
      }),
    );
  }

  function formatSec(s: number): string {
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // ── Drag to reposition (same pattern as runtime / packet log panels) ──

  const DRAG_THRESHOLD = 4;
  let dragging = $state(false);
  let didActuallyDrag = false;
  let suppressNextClick = $state(false);
  let dragStart = { x: 0, y: 0, originX: 0, originY: 0 };

  function startDrag(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('button, input, select, textarea')) return;
    dragging = true;
    didActuallyDrag = false;
    dragStart = {
      x: e.clientX,
      y: e.clientY,
      originX: llmStore.offsetX,
      originY: llmStore.offsetY,
    };
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', endDrag);
    e.preventDefault();
  }

  function onDragMove(e: MouseEvent): void {
    if (!dragging) return;
    // Anchored bottom-RIGHT — match runtime log convention.
    const dx = dragStart.x - e.clientX;
    const dy = dragStart.y - e.clientY;
    if (!didActuallyDrag && Math.hypot(dx, dy) >= DRAG_THRESHOLD) didActuallyDrag = true;
    if (!didActuallyDrag) return;
    // Live-clamp via the parent-aware clamp so the header never drags
    // off the top of the canvas or behind the in-canvas toolbar.
    const { x, y } = clampPos(dragStart.originX + dx, dragStart.originY + dy);
    llmStore.offsetX = x;
    llmStore.offsetY = y;
  }

  function endDrag(): void {
    if (didActuallyDrag) {
      setPanelPosition(llmStore.offsetX, llmStore.offsetY);
      suppressNextClick = true;
      setTimeout(() => { suppressNextClick = false; }, 50);
    }
    dragging = false;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', endDrag);
  }

  function onHeaderClick(e: MouseEvent): void {
    if (suppressNextClick) return;
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    togglePanel();
  }
</script>

<aside
  bind:this={panelEl}
  class="llm-panel"
  class:open={llmStore.panelOpen}
  class:dragging
  role="complementary"
  aria-label="Local LLM assistant"
  style:right="{1 + llmStore.offsetX / 16}rem"
  style:bottom="{1 + llmStore.offsetY / 16}rem"
>
  <header class="head" onmousedown={startDrag} onclick={onHeaderClick} title="Drag to reposition · click to collapse">
    <span class="glyph">🤖</span>
    <strong>Assistant</strong>
    {#if llmStore.connection.kind === 'up'}
      <span class="pill ok" title="Ollama reachable at {llmStore.endpoint}">● {llmStore.model}</span>
    {:else if llmStore.connection.kind === 'down'}
      <span class="pill down" title="Ollama not reachable">○ offline</span>
    {:else}
      <span class="pill unknown">… checking</span>
    {/if}
    <button
      type="button"
      class="snap-btn"
      title="Snap panel back to bottom-right corner"
      onclick={(e) => { e.stopPropagation(); resetPanelPosition(); }}
    >⌐</button>
    <span class="toggle">{llmStore.panelOpen ? '▼' : '▲'}</span>
  </header>

  {#if llmStore.panelOpen}
    {#if llmStore.connection.kind !== 'up'}
      <div class="setup">
        <p>Not connected to a local LLM yet. To start Ollama:</p>
        <pre class="cmd">docker run -d --name ollama -p 11434:11434 ollama/ollama
docker exec ollama ollama pull {llmStore.model}</pre>
        <div class="setup-row">
          <label>
            Endpoint
            <input
              type="text"
              value={llmStore.endpoint}
              onchange={(e) => setEndpoint((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <label>
            Model
            <input
              type="text"
              value={llmStore.model}
              onchange={(e) => setModel((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <button type="button" class="retry" onclick={refreshConnection}>↺ Retry</button>
        </div>
        <p class="note">All requests run on your machine. No telemetry, no cloud call-home.</p>
      </div>
    {:else}
      <div class="toolbar">
        <button type="button" class="action-btn" onclick={explainSelectedProgram} title="Send the currently open program to the assistant for a plain-English walkthrough">
          ❖ Explain program
        </button>
        <button type="button" class="action-btn" onclick={diagnoseSelectedController} title="Bundle the selected controller's recent runtime log, packets, and bindings and ask the assistant for the likely cause">
          🔎 Diagnose
        </button>
        <select
          class="model-pick"
          value={llmStore.model}
          onchange={(e) => setModel((e.currentTarget as HTMLSelectElement).value)}
          title="Switch model — only models pulled into your Ollama instance show up here"
        >
          {#each llmStore.connection.models as m (m)}
            <option value={m}>{m}</option>
          {/each}
        </select>
        <button type="button" class="clear-btn" onclick={clearTurns} title="Clear the chat history">⌫</button>
      </div>

      <div class="chat" bind:this={scrollEl} onscroll={onScroll}>
        {#if llmStore.turns.length === 0}
          <div class="empty">
            <p>Local BAS assistant. Try:</p>
            <ul>
              <li><em>"Explain program"</em> after opening a SpecLang / FBD / ST surface</li>
              <li><em>"Diagnose"</em> after clicking a controller that's behaving oddly</li>
              <li><em>"Write a hot-water reset sequence with OAT lockout above 65°F"</em></li>
              <li><em>"What does Subscribe-COV do and why is it better than polling?"</em></li>
            </ul>
            <p class="hint">All inference runs on this machine. Nothing leaves your network.</p>
          </div>
        {/if}
        {#each llmStore.turns as t (t.id)}
          <div class="turn role-{t.role}" class:err={t.error}>
            <span class="who">{t.role === 'user' ? 'you' : 'asst'}</span>
            <div class="body">
              {t.content}{#if t.streaming}<span class="caret">▍</span>{/if}
            </div>
          </div>
        {/each}
      </div>

      <div class="compose">
        <textarea
          rows="3"
          placeholder="Ask anything BAS — sequences, BACnet, troubleshooting…"
          bind:value={draft}
          onkeydown={onKey}
        ></textarea>
        <div class="compose-actions">
          {#if llmStore.activeRequest}
            <button type="button" class="cancel" onclick={cancelActive} title="Stop the current response mid-stream">
              ✕ Stop
            </button>
          {:else}
            <button type="button" class="send" onclick={onSend} disabled={!draft.trim()}>
              Send ↵
            </button>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</aside>

<style>
  .llm-panel {
    position: absolute;
    right: 1rem;
    bottom: 1rem;
    width: min(32rem, calc(100% - 2rem));
    max-height: 30rem;
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, Canvas 96%, CanvasText 3%);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    /* Sits ABOVE the SpecLang / FBD / BACnet inspector overlays
       (z-index 200) so the Assistant stays accessible when the user
       has opened a program editor for a controller. Without this the
       assistant disappears behind SpecLang and there's no way to read
       its "explain program" output while the editor is open. */
    z-index: 220;
    font-size: 0.82rem;
    font-family: system-ui, sans-serif;
  }

  .llm-panel:not(.open) {
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

  .llm-panel.dragging .head {
    cursor: grabbing;
  }

  .head strong {
    flex: 0;
    white-space: nowrap;
    font-size: 0.82rem;
  }

  .glyph {
    font-size: 0.95rem;
  }

  .pill {
    font-size: 0.66rem;
    padding: 0.1rem 0.5rem;
    border-radius: 10px;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  }
  .pill.ok {
    background: color-mix(in srgb, #2ecc71 18%, transparent);
    color: color-mix(in srgb, #2ecc71 92%, CanvasText);
  }
  .pill.down {
    background: color-mix(in srgb, #e74c3c 18%, transparent);
    color: color-mix(in srgb, #e74c3c 92%, CanvasText);
  }
  .pill.unknown {
    background: color-mix(in srgb, CanvasText 10%, transparent);
    color: color-mix(in srgb, CanvasText 65%, transparent);
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

  .toggle {
    font-size: 0.75rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
  }

  .setup {
    padding: 0.7rem 0.9rem;
    overflow-y: auto;
  }
  .setup p {
    margin: 0 0 0.5rem 0;
    font-size: 0.8rem;
    color: color-mix(in srgb, CanvasText 80%, transparent);
  }
  .cmd {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
    font-size: 0.72rem;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    padding: 0.55rem 0.7rem;
    border-radius: 5px;
    margin: 0.3rem 0 0.7rem;
    overflow-x: auto;
    white-space: pre;
  }
  .setup-row {
    display: flex;
    gap: 0.5rem;
    align-items: end;
    margin-bottom: 0.5rem;
  }
  .setup-row label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }
  .setup-row input {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.3rem 0.45rem;
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    border-radius: 4px;
    background: Canvas;
    color: CanvasText;
  }
  .retry {
    background: color-mix(in srgb, #4a9eff 20%, transparent);
    color: color-mix(in srgb, #4a9eff 95%, CanvasText);
    border: 1px solid color-mix(in srgb, #4a9eff 55%, transparent);
    padding: 0.3rem 0.7rem;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    white-space: nowrap;
  }
  .note {
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-style: italic;
  }

  .toolbar {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
    background: color-mix(in srgb, Canvas 94%, CanvasText 2%);
    flex-wrap: wrap;
  }
  .action-btn {
    background: color-mix(in srgb, #4a9eff 14%, transparent);
    color: color-mix(in srgb, #4a9eff 95%, CanvasText);
    border: 1px solid color-mix(in srgb, #4a9eff 45%, transparent);
    font: inherit;
    font-size: 0.72rem;
    padding: 0.2rem 0.55rem;
    border-radius: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .action-btn:hover {
    background: color-mix(in srgb, #4a9eff 28%, transparent);
  }
  .model-pick {
    margin-left: auto;
    font: inherit;
    font-size: 0.7rem;
    padding: 0.15rem 0.35rem;
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 4px;
    background: Canvas;
    color: CanvasText;
    max-width: 12rem;
  }
  .clear-btn {
    background: transparent;
    border: 0;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    cursor: pointer;
    padding: 0.1rem 0.4rem;
    font-size: 0.85rem;
    border-radius: 4px;
  }
  .clear-btn:hover {
    background: color-mix(in srgb, CanvasText 10%, transparent);
  }

  .chat {
    flex: 1;
    overflow-y: auto;
    padding: 0.55rem 0.7rem;
    background: color-mix(in srgb, Canvas 98%, CanvasText 1%);
    min-height: 8rem;
  }
  .empty {
    color: color-mix(in srgb, CanvasText 70%, transparent);
    font-size: 0.78rem;
  }
  .empty p {
    margin: 0.3rem 0;
  }
  .empty ul {
    margin: 0.25rem 0 0.75rem;
    padding-left: 1.2rem;
  }
  .empty li {
    margin: 0.15rem 0;
    line-height: 1.45;
  }
  .empty .hint {
    font-style: italic;
    color: color-mix(in srgb, CanvasText 50%, transparent);
  }

  .turn {
    display: grid;
    grid-template-columns: 3rem 1fr;
    gap: 0.55rem;
    margin: 0.45rem 0;
    line-height: 1.5;
  }
  .turn .who {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    padding-top: 0.15rem;
  }
  .turn.role-user .who {
    color: color-mix(in srgb, #4a9eff 95%, CanvasText);
  }
  .turn .body {
    white-space: pre-wrap;
    overflow-wrap: break-word;
    min-width: 0;
    font-size: 0.8rem;
  }
  .turn.err .body {
    color: color-mix(in srgb, #e74c3c 90%, CanvasText);
  }
  .caret {
    color: color-mix(in srgb, CanvasText 60%, transparent);
    animation: blink 0.8s ease-in-out infinite;
  }
  @keyframes blink {
    0%, 100% { opacity: 0.2; }
    50% { opacity: 1; }
  }

  .compose {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.55rem 0.7rem 0.65rem;
    border-top: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
    background: color-mix(in srgb, Canvas 94%, CanvasText 2%);
  }
  textarea {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.45rem 0.55rem;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    border-radius: 5px;
    background: Canvas;
    color: CanvasText;
    resize: vertical;
    min-height: 3rem;
    max-height: 12rem;
  }
  .compose-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  .send, .cancel {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.3rem 0.85rem;
    border-radius: 5px;
    cursor: pointer;
  }
  .send {
    background: color-mix(in srgb, #4a9eff 80%, Canvas);
    color: white;
    border: 1px solid color-mix(in srgb, #4a9eff 100%, Canvas);
  }
  .send:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .cancel {
    background: color-mix(in srgb, #e74c3c 80%, Canvas);
    color: white;
    border: 1px solid #c0392b;
  }
</style>
