<script lang="ts">
  import type { Sample } from './sim/thermal';

  type Props = {
    samples: readonly Sample[];
    setpoint: number;
    oat: number;
    /** Y-axis range. Auto if not provided. */
    tempMin?: number;
    tempMax?: number;
  };

  let { samples, setpoint, oat, tempMin = 65, tempMax = 96 }: Props = $props();

  const W = 280;
  const H = 110;
  const PAD_X = 6;
  const PAD_Y = 6;
  const w = W - PAD_X * 2;
  const h = H - PAD_Y * 2;

  function yFor(temp: number): number {
    return PAD_Y + (1 - (temp - tempMin) / (tempMax - tempMin)) * h;
  }

  function xFor(i: number, n: number): number {
    if (n <= 1) return PAD_X + w;
    return PAD_X + (i / (n - 1)) * w;
  }

  const tempPath = $derived.by(() => {
    if (samples.length === 0) return '';
    return samples
      .map(
        (s, i) =>
          `${i === 0 ? 'M' : 'L'}${xFor(i, samples.length).toFixed(1)},${yFor(s.T_zone).toFixed(1)}`,
      )
      .join(' ');
  });

  const setpointY = $derived(yFor(setpoint));
  const oatY = $derived(yFor(oat));
  const currentZone = $derived(samples.length > 0 ? samples[samples.length - 1].T_zone : null);
  const currentAct = $derived(samples.length > 0 ? samples[samples.length - 1].actuator : null);
</script>

<svg viewBox="0 0 {W} {H}" width={W} height={H} class="chart" aria-label="Zone temperature trend">
  <!-- Grid -->
  <g class="grid">
    <line x1={PAD_X} y1={PAD_Y + h * 0.25} x2={W - PAD_X} y2={PAD_Y + h * 0.25} />
    <line x1={PAD_X} y1={PAD_Y + h * 0.5} x2={W - PAD_X} y2={PAD_Y + h * 0.5} />
    <line x1={PAD_X} y1={PAD_Y + h * 0.75} x2={W - PAD_X} y2={PAD_Y + h * 0.75} />
  </g>

  <!-- OAT (outdoor air, horizontal red line) -->
  <line x1={PAD_X} y1={oatY} x2={W - PAD_X} y2={oatY} class="oat" />
  <text x={W - PAD_X} y={Math.max(oatY - 3, PAD_Y + 8)} text-anchor="end" class="label oat-label">
    OAT {oat.toFixed(0)}°F
  </text>

  <!-- Setpoint (dashed gray horizontal) -->
  <line x1={PAD_X} y1={setpointY} x2={W - PAD_X} y2={setpointY} class="setpoint" />
  <text
    x={W - PAD_X}
    y={Math.min(setpointY + 9, H - PAD_Y - 2)}
    text-anchor="end"
    class="label sp-label"
  >
    SP {setpoint.toFixed(0)}°F
  </text>

  <!-- Zone temperature curve -->
  <path d={tempPath} class="zone" />

  <!-- Current zone temp marker -->
  {#if samples.length > 0 && currentZone !== null}
    <circle
      cx={xFor(samples.length - 1, samples.length)}
      cy={yFor(currentZone)}
      r="2.5"
      class="zone-dot"
    />
  {/if}
</svg>

{#if currentZone !== null && currentAct !== null}
  <div class="readouts">
    <span class="readout zone-rd">Zone {currentZone.toFixed(1)}°F</span>
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
    stroke: #f39c12;
    stroke-width: 2;
    stroke-linejoin: round;
  }

  .zone-dot {
    fill: #f39c12;
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
    background: color-mix(in srgb, #f39c12 18%, Canvas);
    color: #f39c12;
  }

  .act-rd {
    background: color-mix(in srgb, #4a9eff 18%, Canvas);
    color: #4a9eff;
  }
</style>
