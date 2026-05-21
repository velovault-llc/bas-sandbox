<script lang="ts">
  import { SCENARIO_LIBRARY } from '@bas/core';
  import { scenarioStore, startScenario, stopScenario } from './scenarioStore.svelte';
</script>

<section class="scenarios-tab">
  <header class="head">
    <h3>Scenarios</h3>
    <p class="hint">
      Step-by-step walkthroughs of real-world BAS commissioning jobs. Pick one and the
      right-side panel guides you through equipment selection, wiring, and programming
      with real-time validation.
    </p>
  </header>

  <ul class="scenario-list">
    {#each SCENARIO_LIBRARY as sc (sc.id)}
      {@const isActive = scenarioStore.active?.id === sc.id}
      <li class="scenario" class:active={isActive}>
        <div class="title-row">
          <strong>{sc.title}</strong>
          <span class="diff">{sc.difficulty}</span>
        </div>
        <p class="tagline">{sc.tagline}</p>
        <div class="meta">
          <span class="time">~{sc.estimatedMinutes} min</span>
          {#if sc.reference}
            <span class="ref">{sc.reference}</span>
          {/if}
        </div>
        {#if isActive}
          <button type="button" class="btn stop" onclick={stopScenario}>✕ End scenario</button>
        {:else}
          <button type="button" class="btn start" onclick={() => startScenario(sc)}>▶ Start scenario</button>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .scenarios-tab {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.25rem 0;
  }

  .head h3 {
    margin: 0 0 0.2rem 0;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .head .hint {
    margin: 0 0 0.4rem 0;
    font-size: 0.75rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    line-height: 1.4;
  }

  .scenario-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .scenario {
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    border-radius: 8px;
    padding: 0.6rem 0.75rem;
    background: color-mix(in srgb, Canvas 95%, CanvasText 3%);
  }

  .scenario.active {
    border-color: color-mix(in srgb, #2ecc71 50%, transparent);
    background: color-mix(in srgb, #2ecc71 8%, transparent);
  }

  .title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .title-row strong {
    font-size: 0.85rem;
  }

  .diff {
    font-size: 0.62rem;
    padding: 0.05rem 0.4rem;
    border-radius: 8px;
    background: color-mix(in srgb, #4a9eff 18%, transparent);
    color: color-mix(in srgb, #4a9eff 90%, CanvasText);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  .tagline {
    margin: 0 0 0.45rem 0;
    font-size: 0.76rem;
    line-height: 1.4;
    color: color-mix(in srgb, CanvasText 75%, transparent);
  }

  .meta {
    display: flex;
    gap: 0.55rem;
    font-size: 0.68rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    margin-bottom: 0.55rem;
  }

  .ref {
    font-style: italic;
  }

  .btn {
    width: 100%;
    padding: 0.4rem 0.65rem;
    border: 0;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .btn.start {
    background: #4a9eff;
    color: white;
  }

  .btn.start:hover {
    background: color-mix(in srgb, #4a9eff 88%, Canvas);
  }

  .btn.stop {
    background: transparent;
    border: 1px solid color-mix(in srgb, #e74c3c 40%, transparent);
    color: color-mix(in srgb, #e74c3c 90%, CanvasText);
  }

  .btn.stop:hover {
    background: color-mix(in srgb, #e74c3c 14%, transparent);
  }
</style>
