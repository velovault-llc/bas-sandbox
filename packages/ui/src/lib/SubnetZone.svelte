<script lang="ts">
  // SubnetZone — a visual VLAN/subnet container on the canvas (Net.1).
  //
  // Renders as a labeled, resizable colored rectangle behind regular BAS
  // nodes. Membership is geometric: any device that sits inside the rect
  // is "on" this subnet. Net.1 ships the visual + creation flow; the IP
  // validator (Net.5 / already shipped pipeline) cross-checks each
  // contained device's IP against the zone's CIDR and flags mismatches.
  //
  // Implementation notes:
  //   - This is a SvelteFlow custom node type 'subnet'. It lives in the
  //     same nodes[] array as BAS nodes; persistence is free.
  //   - data.kind === 'subnet-zone' is the discriminator. Every consumer
  //     in BuildCanvas keys off the existing 7-kind union and naturally
  //     skips zones; the IP validator picks them out explicitly.
  //   - NodeResizer gives drag-to-resize for free. We pin minWidth /
  //     minHeight so the user can't accidentally shrink a zone to nothing.

  import type { NodeProps } from '@xyflow/svelte';
  import { NodeResizer } from '@xyflow/svelte';

  type SubnetZoneData = {
    kind: 'subnet-zone';
    label: string;
    cidr: string;
    color: string;
  };

  let { data, selected, width, height }: NodeProps & {
    data: SubnetZoneData;
    width?: number;
    height?: number;
  } = $props();

  // Derive a soft fill from the chrome color so the zone reads as
  // a tinted background rather than a flat block.
  function fillFor(color: string, alpha: number): string {
    // color is "#RRGGBB" — append the alpha as a hex byte.
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
      .toString(16)
      .padStart(2, '0');
    return `${color}${a}`;
  }
</script>

<NodeResizer
  isVisible={!!selected}
  minWidth={160}
  minHeight={120}
  color={data.color}
  lineStyle="stroke-width: 1.5px;"
/>

<div
  class="subnet-zone"
  class:selected
  style:--zone-color={data.color}
  style:--zone-fill={fillFor(data.color, 0.08)}
  style:--zone-fill-selected={fillFor(data.color, 0.15)}
  style:width={width ? `${width}px` : undefined}
  style:height={height ? `${height}px` : undefined}
  title="Subnet zone — drag to move, drag corners to resize, click to select & edit CIDR."
>
  <div class="zone-label">
    <span class="zone-label-text">{data.label || 'Subnet'}</span>
    <span class="zone-cidr">{data.cidr || '— no CIDR —'}</span>
  </div>
</div>

<style>
  .subnet-zone {
    /* The viewport sizes us via width/height on the node wrapper; fall
       back to inherit so a fresh zone has SOMETHING before xyflow stamps
       a layout pass on it. */
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border: 1.5px dashed var(--zone-color);
    border-radius: 8px;
    background: var(--zone-fill);
    transition: background-color 120ms ease, border-color 120ms ease;
    /* Let drag / click events fall through to nodes ON TOP of the zone
       except where we explicitly mark zone chrome interactive. The whole
       point of a zone is to be a background; you select it by clicking
       its label, not by clicking its body. */
    pointer-events: none;
    position: relative;
  }
  .subnet-zone.selected {
    background: var(--zone-fill-selected);
    border-style: solid;
    border-width: 2px;
  }
  .zone-label {
    /* Pull the label up above the zone rect so it sits on top of the
       dashed border rather than competing with whatever node lands in
       the corner. */
    position: absolute;
    top: -1.6em;
    left: 8px;
    pointer-events: auto;
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(20, 22, 28, 0.92);
    color: var(--zone-color);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    user-select: none;
    cursor: pointer;
    border: 1px solid var(--zone-color);
  }
  .zone-label-text {
    color: var(--zone-color);
  }
  .zone-cidr {
    color: rgba(255, 255, 255, 0.7);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    font-weight: 500;
  }
</style>
