<script lang="ts" module>
  import type { Sample } from './sim/thermal';

  export type ChartSeries = {
    samples: readonly Sample[];
    label: string;
    color: string;
    setpoint: number;
    oat: number;
  };
</script>

<script lang="ts">
  type Props = {
    primary: ChartSeries;
    ghosts?: readonly ChartSeries[];
    tempMin?: number;
    tempMax?: number;
  };

  let { primary, ghosts = [], tempMin = 65, tempMax = 96 }: Props = $props();

  const W = 280;
  const H = 110;
  const PAD_X = 6;
  const PAD_Y = 6;
  const w = W - PAD_X * 2;
  const h = H - PAD_Y * 2;

  function yFor(temp: number): number {
    return PAD_Y + (1 - (temp - tempMin) / (tempMax - tempMin)) * h;
  }

  function actY(a: number): number {
    return PAD_Y + (1 - Math.max(0, Math.min(1, a))) * h;
  }

  function xFor(i: number, n: number): number {
    if (n <= 1) return PAD_X + w;
    return PAD_X + (i / (n - 1)) * w;
  }

  function tempPathOf(samples: readonly Sample[]): string {
    if (samples.length === 0) return '';
    return samples
      .map(
        (s, i) =>
          `${i === 0 ? 'M' : 'L'}${xFor(i, samples.length).toFixed(1)},${yFor(s.T_zone).toFixed(1)}`,
      )
      .join(' ');
  }

  const primaryTempPath = $derived(tempPathOf(primary.samples));
  const ghostPaths = $derived(
    ghosts.map((g) => ({ label: g.label, color: g.color, d: tempPathOf(g.samples) })),
  );

  const actPath = $derived.by(() => {
    if (primary.samples.length === 0) return '';
    return primary.samples
      .map(
        (s, i) =>
          `${i === 0 ? 'M' : 'L'}${xFor(i, primary.samples.length).toFixed(1)},${actY(s.actuator).toFixed(1)}`,
      )
      .join(' ');
  });

  const setpointY = $derived(yFor(primary.setpoint));
  const oatY = $derived(yFor(primary.oat));
  const currentZone = $derived(
    primary.samples.length > 0 ? primary.samples[primary.samples.length - 1].T_zone : null,
  );
  const currentAct = $derived(
    primary.samples.length > 0 ? primary.samples[primary.samples.length - 1].actuator : null,
  );
</script>

<svg viewBox="0 0 {W} {H}" width={W} height={H} class="chart" aria-label="Zone temperature trend">
  <!-- Grid -->
  <g class="grid">
    <line x1={PAD_X} y1={PAD_Y + h * 0.25} x2={W - PAD_X} y2={PAD_Y + h * 0.25} />
    <line x1={PAD_X} y1={PAD_Y + h * 0.5} x2={W - PAD_X} y2={PAD_Y + h * 0.5} />
    <line x1={PAD_X} y1={PAD_Y + h * 0.75} x2={W - PAD_X} y2={PAD_Y + h * 0.75} />
  </g>

  <!-- OAT (primary, horizontal) -->
  <line x1={PAD_X} y1={oatY} x2={W - PAD_X} y2={oatY} class="oat" />
  <text x={W - PAD_X} y={Math.max(oatY - 3, PAD_Y + 8)} text-anchor="end" class="label oat-label">
    OAT {primary.oat.toFixed(0)}°F
  </text>

  <!-- Setpoint (primary, dashed) -->
  <line x1={PAD_X} y1={setpointY} x2={W - PAD_X} y2={setpointY} class="setpoint" />
  <text
    x={W - PAD_X}
    y={Math.min(setpointY + 9, H - PAD_Y - 2)}
    text-anchor="end"
    class="label sp-label"
  >
    SP {primary.setpoint.toFixed(0)}°F
  </text>

  <!-- Ghost zone curves (muted, no markers) -->
  {#each ghostPaths as g (g.label)}
    <path d={g.d} class="ghost-zone" stroke={g.color} />
  {/each}

  <!-- Primary zone curve (full color) -->
  <path d={primaryTempPath} class="zone" stroke={primary.color} />

  <!-- Primary actuator curve (right axis 0-100%) -->
  <path d={actPath} class="actuator" />

  <!-- Endpoint markers on primary -->
  {#if primary.samples.length > 0 && currentZone !== null}
    <circle
      cx={xFor(primary.samples.length - 1, primary.samples.length)}
      cy={yFor(currentZone)}
      r="2.5"
      class="zone-dot"
      fill={primary.color}
    />
  {/if}
  {#if primary.samples.length > 0 && currentAct !== null}
    <circle
      cx={xFor(primary.samples.length - 1, primary.samples.length)}
      cy={actY(currentAct)}
      r="2.5"
      class="actuator-dot"
    />
  {/if}

  <!-- Right-axis hint for the actuator scale -->
  <text x={W - PAD_X} y={PAD_Y + 8} text-anchor="end" class="label act-label">Out 100%</text>
  <text x={W - PAD_X} y={PAD_Y + h - 2} text-anchor="end" class="label act-label">0%</text>
</svg>

{#if ghosts.length > 0}
  <div class="legend">
    <span class="legend-item" style:--c={primary.color}>
      <span class="legend-swatch"></span>
      <span class="legend-label">{primary.label}</span>
    </span>
    {#each ghosts as g (g.label)}
      <span class="legend-item" style:--c={g.color}>
        <span class="legend-swatch ghost"></span>
        <span class="legend-label">{g.label}</span>
      </span>
    {/each}
  </div>
{/if}

{#if currentZone !== null && currentAct !== null}
  <div class="readouts">
    <span class="readout zone-rd" style:--c={primary.color}>
      Zone {currentZone.toFixed(1)}°F
    </span>
    <span class="readout act-rd">Out {(currentAct * 100).toFixed(0)}%</span>
  </div>
{/if}

<style>
  .chart {
    background: color-mix(in srgb, Canvas 92%, transparent);
    border-radius: 4px;
    display: block;
  }

  .grid line {
    stroke: color-mix(in srgb, CanvasText 8%, transparent);
    stroke-width: 0.5;
  }

  .oat {
    stroke: #e74c3c;
    stroke-width: 1;
    opacity: 0.55;
  }

  .setpoint {
    stroke: color-mix(in srgb, CanvasText 55%, transparent);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }

  .zone {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
  }

  .ghost-zone {
    fill: none;
    stroke-width: 1.25;
    stroke-linejoin: round;
    opacity: 0.55;
  }

  .actuator {
    fill: none;
    stroke: #4a9eff;
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-dasharray: 4 2;
    opacity: 0.9;
  }

  .actuator-dot {
    fill: #4a9eff;
  }

  .label {
    font-size: 8.5px;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .oat-label {
    fill: #e74c3c;
  }

  .sp-label {
    fill: color-mix(in srgb, CanvasText 60%, transparent);
  }

  .act-label {
    fill: color-mix(in srgb, #4a9eff 80%, transparent);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.3rem 0.15rem 0;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .legend-swatch {
    display: inline-block;
    width: 0.85rem;
    height: 0.15rem;
    background: var(--c, currentColor);
    border-radius: 1px;
  }

  .legend-swatch.ghost {
    opacity: 0.55;
  }

  .legend-label {
    color: color-mix(in srgb, CanvasText 75%, transparent);
  }

  .readouts {
    display: flex;
    gap: 0.4rem;
    padding: 0.25rem 0.1rem 0;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  .readout {
    padding: 0.05rem 0.4rem;
    border-radius: 8px;
  }

  .zone-rd {
    background: color-mix(in srgb, var(--c, #f39c12) 18%, Canvas);
    color: var(--c, #f39c12);
  }

  .act-rd {
    background: color-mix(in srgb, #4a9eff 18%, Canvas);
    color: #4a9eff;
  }
</style>
