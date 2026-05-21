<script lang="ts">
  import { scenarioStore, stopScenario, toggleScenarioCollapsed } from './scenarioStore.svelte';
  import { canvasSnapshot, showInDevices } from '../canvasStore.svelte';
  import { validateScenario } from './validator';

  function tabForKind(kind: string): 'controllers' | 'sensors' | 'safeties' | 'expansions' {
    if (kind === 'controller') return 'controllers';
    if (kind === 'sensor') return 'sensors';
    if (kind === 'safety') return 'safeties';
    return 'expansions';
  }

  const result = $derived.by(() => {
    if (!scenarioStore.active) return null;
    return validateScenario(scenarioStore.active, canvasSnapshot.nodes, canvasSnapshot.edges);
  });

  const eqPassed = $derived(result ? result.equipmentSteps.filter((s) => s.passed).length : 0);
  const eqTotal = $derived(result ? result.equipmentSteps.length : 0);
  const wirePassed = $derived(result ? result.wireSteps.filter((s) => s.passed).length : 0);
  const wireTotal = $derived(result ? result.wireSteps.length : 0);
  const allPassed = $derived(result ? eqPassed === eqTotal && wirePassed === wireTotal : false);
</script>

{#if scenarioStore.active}
  {@const sc = scenarioStore.active}
  <aside class="scenario-panel" class:collapsed={scenarioStore.collapsed} aria-label="Scenario walkthrough">
    <header class="head">
      <div class="title-row">
        <span class="dot" class:on={allPassed}></span>
        <strong>{sc.title}</strong>
        <span class="diff">{sc.difficulty}</span>
        <span class="time muted">~{sc.estimatedMinutes} min</span>
      </div>
      <div class="head-actions">
        <button type="button" class="icon-btn" onclick={toggleScenarioCollapsed} title={scenarioStore.collapsed ? 'Expand' : 'Collapse'}>
          {scenarioStore.collapsed ? '◀' : '▶'}
        </button>
        <button type="button" class="icon-btn" onclick={stopScenario} title="End scenario">✕</button>
      </div>
    </header>

    {#if !scenarioStore.collapsed}
      <div class="body">
        <section class="card">
          <h4>Context</h4>
          {#each sc.context.split('\n\n') as para}
            <p>{para}</p>
          {/each}
          {#if sc.reference}
            <p class="ref">Reference: <strong>{sc.reference}</strong></p>
          {/if}
        </section>

        <section class="card">
          <div class="card-head">
            <h4>Equipment to place</h4>
            <span class="progress" class:done={eqPassed === eqTotal}>{eqPassed} / {eqTotal}</span>
          </div>
          <ul class="steps">
            {#each result?.equipmentSteps ?? [] as step (step.id)}
              {@const req = sc.equipment.find((e) => `eq-${e.tag}` === step.id)}
              <li class="step" class:passed={step.passed}>
                <span class="step-dot" class:passed={step.passed}>{step.passed ? '✓' : '○'}</span>
                <div class="step-body">
                  <div class="step-title">{step.description}</div>
                  <div class="step-detail" class:err={!step.passed}>{step.detail}</div>
                  {#if req}
                    <div class="step-rationale">{req.rationale}</div>
                    {#if !step.passed && req.preferredModelId}
                      <button
                        type="button"
                        class="show-me"
                        onclick={() => showInDevices(tabForKind(req.kind), req.preferredModelId!)}
                      >
                        Show recommended → {req.preferredModelId}
                      </button>
                    {/if}
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        </section>

        <section class="card">
          <div class="card-head">
            <h4>Wires to land</h4>
            <span class="progress" class:done={wirePassed === wireTotal}>{wirePassed} / {wireTotal}</span>
          </div>
          <ul class="steps">
            {#each result?.wireSteps ?? [] as step (step.id)}
              <li class="step" class:passed={step.passed}>
                <span class="step-dot" class:passed={step.passed}>{step.passed ? '✓' : '○'}</span>
                <div class="step-body">
                  <div class="step-title">{step.description}</div>
                  <div class="step-detail" class:err={!step.passed}>{step.detail}</div>
                </div>
              </li>
            {/each}
          </ul>
        </section>

        <section class="card">
          <h4>Program sequence ({sc.program.language === 'fbd' ? 'block diagram' : 'Structured Text'})</h4>
          {#each sc.program.sequence as line}
            {#if line === ''}
              <div class="seq-spacer"></div>
            {:else if /^\d+\./.test(line)}
              <h5 class="seq-step">{line}</h5>
            {:else}
              <p class="seq-line">{line}</p>
            {/if}
          {/each}
          {#if sc.program.requiredBlocks}
            <p class="block-list">Required FBD blocks: <code>{sc.program.requiredBlocks.join(' · ')}</code></p>
          {/if}
        </section>

        <section class="card">
          <h4>Runtime checks</h4>
          <p class="muted">After you Run the sim, these checks will validate the controller's response under driven conditions.</p>
          <ul class="checks">
            {#each sc.runtimeChecks as rc}
              <li><strong>{rc.id}</strong> — {rc.description}</li>
            {/each}
          </ul>
        </section>

        {#if allPassed}
          <div class="done-banner">
            ✓ All build steps passed. Click <strong>Run</strong> to validate the programming sequence at runtime.
          </div>
        {/if}
      </div>
    {/if}
  </aside>
{/if}

<style>
  .scenario-panel {
    position: absolute;
    right: 1rem;
    top: 4.5rem;
    bottom: 1rem;
    width: 26rem;
    max-width: calc(100vw - 2rem);
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, Canvas 95%, CanvasText 4%);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    z-index: 45;
    overflow: hidden;
    transition: width 180ms ease;
  }

  .scenario-panel.collapsed {
    width: 11rem;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    background: color-mix(in srgb, Canvas 88%, CanvasText 6%);
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    overflow: hidden;
  }

  .title-row strong {
    font-size: 0.88rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: color-mix(in srgb, CanvasText 30%, transparent);
    flex-shrink: 0;
  }

  .dot.on {
    background: #2ecc71;
    box-shadow: 0 0 8px #2ecc7180;
  }

  .diff {
    font-size: 0.65rem;
    padding: 0.05rem 0.4rem;
    border-radius: 8px;
    background: color-mix(in srgb, #4a9eff 18%, transparent);
    color: color-mix(in srgb, #4a9eff 90%, CanvasText);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .time {
    font-size: 0.7rem;
    flex-shrink: 0;
  }

  .muted {
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }

  .head-actions {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .icon-btn {
    background: transparent;
    border: 0;
    color: CanvasText;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
  }

  .icon-btn:hover {
    background: color-mix(in srgb, CanvasText 8%, transparent);
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 0.65rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .card {
    border: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, Canvas 96%, CanvasText 2%);
    padding: 0.6rem 0.75rem;
  }

  .card h4 {
    margin: 0 0 0.4rem 0;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }

  .card h5.seq-step {
    margin: 0.45rem 0 0.25rem 0;
    font-size: 0.82rem;
    color: color-mix(in srgb, CanvasText 90%, transparent);
  }

  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .progress {
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-variant-numeric: tabular-nums;
    padding: 0.05rem 0.45rem;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    border-radius: 8px;
  }

  .progress.done {
    background: color-mix(in srgb, #2ecc71 22%, transparent);
    color: color-mix(in srgb, #2ecc71 92%, CanvasText);
  }

  .card p {
    margin: 0 0 0.45rem 0;
    font-size: 0.82rem;
    line-height: 1.45;
  }

  .card p:last-child {
    margin-bottom: 0;
  }

  .ref {
    font-size: 0.75rem !important;
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .step {
    display: flex;
    gap: 0.45rem;
    padding: 0.4rem 0.5rem;
    border-radius: 5px;
    background: color-mix(in srgb, CanvasText 4%, transparent);
    border-left: 3px solid color-mix(in srgb, CanvasText 25%, transparent);
  }

  .step.passed {
    border-left-color: #2ecc71;
    background: color-mix(in srgb, #2ecc71 8%, transparent);
  }

  .step-dot {
    flex-shrink: 0;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    background: color-mix(in srgb, CanvasText 12%, transparent);
    color: color-mix(in srgb, CanvasText 65%, transparent);
    font-size: 0.72rem;
    line-height: 1.1rem;
    text-align: center;
    font-weight: 600;
  }

  .step-dot.passed {
    background: #2ecc71;
    color: white;
  }

  .step-body {
    flex: 1;
    min-width: 0;
  }

  .step-title {
    font-size: 0.78rem;
    font-weight: 500;
  }

  .step-detail {
    font-size: 0.72rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    margin-top: 0.15rem;
  }

  .step-detail.err {
    color: color-mix(in srgb, #e74c3c 90%, CanvasText);
  }

  .step-rationale {
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    margin-top: 0.2rem;
    font-style: italic;
  }

  .show-me {
    margin-top: 0.35rem;
    background: transparent;
    border: 1px solid color-mix(in srgb, #4a9eff 50%, transparent);
    color: color-mix(in srgb, #4a9eff 95%, CanvasText);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.18rem 0.55rem;
    border-radius: 4px;
    cursor: pointer;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .show-me:hover {
    background: color-mix(in srgb, #4a9eff 14%, transparent);
  }

  .seq-line {
    font-size: 0.78rem;
    line-height: 1.45;
    margin: 0 0 0.2rem 0.55rem;
    color: color-mix(in srgb, CanvasText 80%, transparent);
  }

  .seq-spacer {
    height: 0.35rem;
  }

  .block-list {
    margin-top: 0.55rem;
    font-size: 0.72rem !important;
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }

  .block-list code {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
  }

  .checks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.78rem;
  }

  .checks li {
    line-height: 1.4;
  }

  .checks li strong {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.72rem;
    color: color-mix(in srgb, #4a9eff 95%, CanvasText);
  }

  .done-banner {
    padding: 0.55rem 0.75rem;
    background: color-mix(in srgb, #2ecc71 18%, transparent);
    border: 1px solid color-mix(in srgb, #2ecc71 50%, transparent);
    color: color-mix(in srgb, #2ecc71 95%, CanvasText);
    border-radius: 6px;
    font-size: 0.85rem;
    text-align: center;
  }
</style>
