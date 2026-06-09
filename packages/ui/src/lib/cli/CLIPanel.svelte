<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import {
    closeCli,
    getProgram,
    programStore,
    setProgramSource,
    clearProgram,
  } from './programStore.svelte';
  import { controllerBridge } from './controllerBridge.svelte';
  import {
    dispatch,
    makeShellState,
    promptFor,
    type ControllerContext,
  } from './commandShell';

  let termHost: HTMLDivElement | null = $state(null);
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let lineBuffer = '';
  const shell = makeShellState();
  let resizeObserver: ResizeObserver | null = null;

  // Drag-to-reposition. Same pattern as the runtime / packet log panels:
  // bind:this on the panel, header drag handle, parent-clamp on each
  // move so the header never escapes the canvas-area. Position is
  // tracked in CSS px (offsetRight / offsetTop deltas from the default
  // top-right corner).
  let panelEl: HTMLDivElement | null = $state(null);
  let offsetX = $state(0); // px subtracted from `right: 1rem`
  let offsetY = $state(0); // px added to `top: 1rem`
  let dragging = $state(false);
  let didActuallyDrag = false;
  let dragStart = { mx: 0, my: 0, ox: 0, oy: 0 };
  const DRAG_THRESHOLD = 4;

  function clampPos(x: number, y: number): { x: number; y: number } {
    if (typeof window === 'undefined') return { x: Math.max(0, x), y: Math.max(0, y) };
    const parent = panelEl?.offsetParent as HTMLElement | null;
    const parentW = parent?.clientWidth ?? window.innerWidth;
    const parentH = parent?.clientHeight ?? window.innerHeight;
    const panelW = panelEl?.offsetWidth ?? 640;
    const panelH = panelEl?.offsetHeight ?? 420;
    const margin = 12;
    // offsetX is subtracted from right edge → max is parentW - panelW - margin
    const maxX = Math.max(0, parentW - panelW - margin);
    // offsetY is added to top → max is parentH - panelH - margin
    const maxY = Math.max(0, parentH - panelH - margin);
    return {
      x: Math.min(maxX, Math.max(0, x)),
      y: Math.min(maxY, Math.max(0, y)),
    };
  }

  function startDrag(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    didActuallyDrag = false;
    dragStart = { mx: e.clientX, my: e.clientY, ox: offsetX, oy: offsetY };
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', endDrag);
    e.preventDefault();
  }
  function onDragMove(e: MouseEvent): void {
    if (!dragging) return;
    // Panel is anchored top-right. Dragging LEFT should grow offsetX
    // (panel moves further from the right edge). Dragging DOWN should
    // grow offsetY.
    const dx = dragStart.mx - e.clientX;
    const dy = e.clientY - dragStart.my;
    if (!didActuallyDrag && Math.hypot(dx, dy) >= DRAG_THRESHOLD) didActuallyDrag = true;
    if (!didActuallyDrag) return;
    const { x, y } = clampPos(dragStart.ox + dx, dragStart.oy + dy);
    offsetX = x;
    offsetY = y;
  }
  function endDrag(): void {
    dragging = false;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', endDrag);
  }

  // Build the controller-context whenever the active id or bridge changes.
  const ctx = $derived.by((): ControllerContext | null => {
    const id = programStore.activeControllerId;
    const label = programStore.activeControllerLabel ?? id ?? 'CTRL';
    if (!id) return null;
    return {
      controllerId: id,
      controllerLabel: shortLabel(label),
      snapshot: () => {
        const s = controllerBridge.impl?.getSnapshot(id);
        return (
          s ?? { sensed: 0, setpoint: 0, oat: 0, actuator: 0, mode: 'cool', Kp: 0, Ki: 0 }
        );
      },
      setConfig: (key, value) => {
        if (!controllerBridge.impl) return 'simulator not running — start a scenario first';
        return controllerBridge.impl.setConfig(id, key, value);
      },
      getProgram: () => getProgram(id),
      setProgram: (source) => setProgramSource(id, source),
      clearProgram: () => clearProgram(id),
    };
  });

  function shortLabel(label: string): string {
    return label.replace(/[^\w-]/g, '').slice(0, 16) || 'CTRL';
  }

  onMount(() => {
    if (!termHost) return;
    term = new Terminal({
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
      theme: {
        background: '#0e1116',
        foreground: '#d4d4d4',
        cursor: '#4a9eff',
      },
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termHost);
    requestAnimationFrame(() => fit?.fit());
    resizeObserver = new ResizeObserver(() => fit?.fit());
    resizeObserver.observe(termHost);

    welcome();
    writePrompt();

    term.onData((data) => {
      if (!term) return;
      for (const ch of data) {
        const code = ch.charCodeAt(0);
        if (code === 13) {
          // Enter
          term.write('\r\n');
          handleLine(lineBuffer);
          lineBuffer = '';
        } else if (code === 127 || code === 8) {
          // Backspace
          if (lineBuffer.length > 0) {
            lineBuffer = lineBuffer.slice(0, -1);
            term.write('\b \b');
          }
        } else if (code === 3) {
          // Ctrl-C: discard current line
          term.write('^C\r\n');
          lineBuffer = '';
          writePrompt();
        } else if (code === 26) {
          // Ctrl-Z: exit current mode (Cisco IOS-style)
          term.write('^Z\r\n');
          handleLine('end');
        } else if (code >= 32 && code < 127) {
          lineBuffer += ch;
          term.write(ch);
        }
      }
    });
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    term?.dispose();
    term = null;
  });

  function welcome(): void {
    if (!term || !ctx) return;
    term.writeln('\x1b[1;36mbas-sandbox CLI\x1b[0m');
    term.writeln(`Connected to controller ${ctx.controllerLabel}.`);
    term.writeln('Type "help" or "?" for commands. "enable" to elevate.');
    term.writeln('');
  }

  function writePrompt(): void {
    if (!term || !ctx) return;
    term.write(promptFor(shell, ctx.controllerLabel));
  }

  function handleLine(raw: string): void {
    if (!term || !ctx) return;
    const res = dispatch(raw, shell, ctx);
    for (const line of res.lines) term.writeln(line);
    if (res.close) {
      closeCli();
      return;
    }
    writePrompt();
  }

  // Close button + ESC handler
  function onClose(): void {
    closeCli();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && (e.target as HTMLElement)?.closest('.cli-panel')) {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  bind:this={panelEl}
  class="cli-panel"
  class:dragging
  role="dialog"
  aria-label="Controller terminal"
  style:right="calc(1rem + {offsetX}px)"
  style:top="calc(1rem + {offsetY}px)"
>
  <header
    class="cli-head"
    onmousedown={startDrag}
    title="Drag the header to reposition this terminal."
  >
    <span class="grip">⠿</span>
    <div class="cli-title">
      <span class="dot"></span>
      <strong>{ctx?.controllerLabel ?? 'CTRL'}</strong>
      <span class="muted">— programming</span>
    </div>
    <button type="button" class="cli-close" onclick={onClose} title="Close (Esc)">
      ✕
    </button>
  </header>
  <div class="cli-term" bind:this={termHost}></div>
</div>

<style>
  .cli-panel {
    position: absolute;
    right: 1rem;
    top: 1rem;
    width: min(640px, calc(100% - 2rem));
    height: min(420px, calc(100% - 2rem));
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    border-radius: 8px;
    background: #0e1116;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 50;
    overflow: hidden;
  }

  .cli-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    background: #14181f;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    color: #e0e0e0;
    font-size: 0.82rem;
    cursor: grab;
    user-select: none;
  }
  .cli-panel.dragging .cli-head {
    cursor: grabbing;
  }
  .grip {
    color: #5a6473;
    font-size: 1.1rem;
    line-height: 1;
  }
  .cli-title {
    flex: 1;
  }

  .cli-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: #4a9eff;
    box-shadow: 0 0 6px #4a9eff80;
  }

  .muted {
    color: #888;
    font-weight: normal;
  }

  .cli-close {
    background: transparent;
    border: 0;
    color: #ccc;
    font-size: 1rem;
    cursor: pointer;
    line-height: 1;
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
  }

  .cli-close:hover {
    background: #2a3140;
    color: #fff;
  }

  .cli-term {
    flex: 1;
    padding: 0.5rem 0.5rem 0.25rem;
    overflow: hidden;
  }

  /* xterm.css adds its own backdrop — make sure it fills */
  .cli-term :global(.terminal) {
    height: 100% !important;
  }
</style>
