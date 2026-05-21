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

<div class="cli-panel" role="dialog" aria-label="Controller terminal">
  <header class="cli-head">
    <div class="cli-title">
      <span class="dot"></span>
      <strong>{ctx?.controllerLabel ?? 'CTRL'}</strong>
      <span class="muted">— terminal</span>
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
    justify-content: space-between;
    padding: 0.4rem 0.75rem;
    background: #14181f;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    color: #e0e0e0;
    font-size: 0.82rem;
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
