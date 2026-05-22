<script lang="ts">
  // Global network-health pill — a floating status chip in the top-right
  // of the canvas that summarizes MS/TP trunk validation across the
  // entire canvas. Always present, subdued when healthy, alarming when
  // there are findings. Click jumps to the first problematic trunk's
  // inspector, so the user can drill in from a single glance.

  import {
    trunkInspectorStore,
    openTrunkInspector,
  } from './trunkInspectorStore.svelte';

  type Summary = {
    errors: number;
    warnings: number;
    info: number;
    firstProblemTrunk: string | null;
    totalTrunks: number;
  };

  const summary = $derived.by<Summary>(() => {
    void trunkInspectorStore.tick;
    let errors = 0;
    let warnings = 0;
    let info = 0;
    let firstProblemTrunk: string | null = null;
    const totalTrunks = trunkInspectorStore.byTrunkId.size;
    for (const [trunkId, findings] of trunkInspectorStore.findingsByTrunkId) {
      for (const f of findings) {
        if (f.severity === 'error') {
          errors++;
          if (!firstProblemTrunk) firstProblemTrunk = trunkId;
        } else if (f.severity === 'warning') {
          warnings++;
          if (!firstProblemTrunk) firstProblemTrunk = trunkId;
        } else {
          info++;
        }
      }
    }
    return { errors, warnings, info, firstProblemTrunk, totalTrunks };
  });

  function onClick(): void {
    // Click jumps to the first problematic trunk inspector. If everything
    // is clean, jump to the first trunk anyway — gives the user an entry
    // point even on a healthy network.
    void trunkInspectorStore.tick;
    const target =
      summary.firstProblemTrunk ??
      trunkInspectorStore.byTrunkId.keys().next().value ??
      null;
    if (target) openTrunkInspector(target);
  }

  const state = $derived(
    summary.errors > 0 ? 'err' : summary.warnings > 0 ? 'warn' : 'ok',
  );
</script>

{#if summary.totalTrunks > 0}
  <button
    type="button"
    class="net-health state-{state}"
    onclick={onClick}
    title={summary.errors > 0
      ? `Network: ${summary.errors} error${summary.errors === 1 ? '' : 's'}, ${summary.warnings} warning${summary.warnings === 1 ? '' : 's'} across ${summary.totalTrunks} trunk${summary.totalTrunks === 1 ? '' : 's'}. Click to inspect.`
      : summary.warnings > 0
      ? `Network: ${summary.warnings} warning${summary.warnings === 1 ? '' : 's'} across ${summary.totalTrunks} trunk${summary.totalTrunks === 1 ? '' : 's'}. Click to inspect.`
      : `Network: ${summary.totalTrunks} trunk${summary.totalTrunks === 1 ? '' : 's'} healthy. Click for trunk inspector.`}
  >
    <span class="glyph">
      {#if state === 'err'}⛔
      {:else if state === 'warn'}⚠
      {:else}✓{/if}
    </span>
    <span class="label">
      Network:
      {#if state === 'err'}
        {summary.errors} err{#if summary.warnings > 0}, {summary.warnings} warn{/if}
      {:else if state === 'warn'}
        {summary.warnings} warning{summary.warnings === 1 ? '' : 's'}
      {:else}
        healthy ({summary.totalTrunks} trunk{summary.totalTrunks === 1 ? '' : 's'})
      {/if}
    </span>
  </button>
{/if}

<style>
  .net-health {
    position: absolute;
    top: 0.65rem;
    right: 1rem;
    z-index: 8;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border-radius: 14px;
    padding: 0.3rem 0.75rem;
    font: inherit;
    font-size: 0.74rem;
    font-weight: 600;
    line-height: 1.2;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    background: color-mix(in srgb, Canvas 92%, CanvasText 4%);
    color: CanvasText;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
    letter-spacing: 0.02em;
    transition: background 100ms ease, border-color 100ms ease, transform 100ms ease;
  }

  .net-health:hover {
    transform: translateY(-1px);
  }

  .net-health.state-ok {
    border-color: color-mix(in srgb, #2ecc71 45%, transparent);
    color: color-mix(in srgb, #2ecc71 90%, CanvasText);
    background: color-mix(in srgb, #2ecc71 12%, Canvas);
  }

  .net-health.state-warn {
    border-color: color-mix(in srgb, #f39c12 70%, transparent);
    color: color-mix(in srgb, #f39c12 95%, CanvasText);
    background: color-mix(in srgb, #f39c12 18%, Canvas);
  }

  .net-health.state-err {
    border-color: color-mix(in srgb, #e74c3c 75%, transparent);
    color: white;
    background: color-mix(in srgb, #e74c3c 75%, Canvas);
    animation: pulse-err 2.2s ease-in-out infinite;
  }

  @keyframes pulse-err {
    0%, 100% {
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
    }
    50% {
      box-shadow: 0 0 0 4px color-mix(in srgb, #e74c3c 30%, transparent), 0 1px 3px rgba(0, 0, 0, 0.18);
    }
  }

  .glyph {
    font-size: 0.9rem;
    line-height: 1;
  }
</style>
