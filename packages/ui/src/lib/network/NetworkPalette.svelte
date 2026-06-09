<script lang="ts">
  // Network palette — consolidates the network-gear authoring tools
  // (subnet zone, IP router, BBMD appliance) into a single sidebar tab
  // so the bottom dock + top-left toolbar don't have to carry them.
  //
  // The Router + BBMD tiles are draggable onto the canvas using the
  // same `application/bas-node-kind` MIME the regular palette uses.
  // The Subnet button calls the exposed `canvasActions.addSubnetZone`
  // hook on BuildCanvas, since drawing a zone is a click action (not
  // a drag-drop of a node).

  import { canvasActions, canvasSnapshot } from '../canvasStore.svelte';
  import { networkGearByVendor, type NetworkGearModel } from '@bas/core';

  function onTileDragStart(event: DragEvent, kind: string): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('application/bas-node-kind', kind);
    event.dataTransfer.effectAllowed = 'move';
  }

  /** Drag-start for a specific real-world network appliance — carries
   *  the node kind plus the model id so BuildCanvas can stamp the
   *  vendor + model on the dropped node. */
  function onGearDragStart(event: DragEvent, gear: NetworkGearModel): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('application/bas-node-kind', gear.nodeKind);
    event.dataTransfer.setData('application/bas-network-gear-model', gear.id);
    event.dataTransfer.effectAllowed = 'move';
  }

  const gearByVendor = $derived.by(() => Array.from(networkGearByVendor().entries()));

  // Live inventory — count zones / routers / BBMDs currently on the
  // canvas so the user can see at a glance what they've built.
  const inventory = $derived.by(() => {
    let zones = 0,
      routers = 0,
      bbmds = 0,
      switches = 0,
      supervisorBbmds = 0;
    for (const n of canvasSnapshot.nodes) {
      const d = n.data as { kind?: string; isBBMD?: boolean };
      if (d.kind === 'subnet-zone') zones++;
      else if (d.kind === 'router') routers++;
      else if (d.kind === 'bbmd') bbmds++;
      else if (d.kind === 'switch') switches++;
      else if (d.isBBMD) supervisorBbmds++;
    }
    return { zones, routers, bbmds, switches, supervisorBbmds };
  });
</script>

<div class="network-palette">
  <h3>Network</h3>
  <p class="blurb">
    Subnet zones, IP routers, and BBMDs for modeling cross-subnet BACnet — the
    IT/OT bridge layer most BAS techs only learn by getting burned in the
    field.
  </p>

  <section class="tools">
    <h4>Tools</h4>
    <button
      type="button"
      class="net-tile clickable"
      onclick={() => canvasActions.addSubnetZone?.()}
      title="Drop a labeled subnet container on the canvas. Resize to enclose the devices that live on the VLAN."
    >
      <span class="net-tile-glyph">▢</span>
      <div class="net-tile-body">
        <span class="net-tile-title">+ Subnet zone</span>
        <span class="net-tile-sub">Visual CIDR container — flags IP-vs-VLAN mismatches</span>
      </div>
    </button>
  </section>

  <section class="devices">
    <h4>Network devices</h4>
    <div
      class="net-tile draggable"
      draggable="true"
      ondragstart={(e) => onTileDragStart(e, 'switch')}
      title="Drag onto the canvas. Layer-2 Ethernet switch. Devices plug into access ports (one VLAN each); switch-to-switch uplinks are trunk ports. The port's VLAN decides which broadcast domain the device lands in."
      role="button"
      tabindex="0"
    >
      <span class="net-tile-glyph switch-color">▦</span>
      <div class="net-tile-body">
        <span class="net-tile-title">Ethernet Switch</span>
        <span class="net-tile-sub">L2 device · access/trunk ports · VLANs</span>
      </div>
    </div>
    <div
      class="net-tile draggable"
      draggable="true"
      ondragstart={(e) => onTileDragStart(e, 'router')}
      title="Drag onto the canvas. Multi-interface L3 router. Bridges unicast BACnet between subnets without requiring BBMDs (broadcasts still need them)."
      role="button"
      tabindex="0"
    >
      <span class="net-tile-glyph router-color">◆</span>
      <div class="net-tile-body">
        <span class="net-tile-title">IP Router</span>
        <span class="net-tile-sub">L3 device · 2+ interfaces · routes unicast</span>
      </div>
    </div>
    <div
      class="net-tile draggable"
      draggable="true"
      ondragstart={(e) => onTileDragStart(e, 'bbmd')}
      title="Drag onto the canvas. Dedicated BBMD appliance — bridges BACnet broadcasts (Who-Is / I-Am) to peer BBMDs on remote subnets. Drop one per subnet."
      role="button"
      tabindex="0"
    >
      <span class="net-tile-glyph bbmd-color">◫</span>
      <div class="net-tile-body">
        <span class="net-tile-title">BBMD appliance</span>
        <span class="net-tile-sub">Forwards BACnet broadcasts across subnets</span>
      </div>
    </div>
  </section>

  <section class="catalog">
    <h4>Real-world models</h4>
    <p class="catalog-blurb">
      Drag a specific BBMD or router product onto the canvas — the dropped node
      carries the vendor + model in its subtitle. Useful when you want to
      mirror an actual install ("this site has 3 BAS Routers and a Cimetrics Eapi").
    </p>
    {#each gearByVendor as [vendor, models] (vendor)}
      <div class="vendor-group">
        <span class="vendor-name">{vendor}</span>
        {#each models as gear (gear.id)}
          <div
            class="gear-tile"
            draggable="true"
            ondragstart={(e) => onGearDragStart(e, gear)}
            role="button"
            tabindex="0"
            title={gear.notes}
          >
            <span class="gear-glyph" class:bbmd={gear.nodeKind === 'bbmd'}
              class:router={gear.nodeKind === 'router'}>
              {gear.nodeKind === 'bbmd' ? '◫' : '◆'}
            </span>
            <div class="gear-body">
              <div class="gear-line1">
                <span class="gear-model">{gear.model}</span>
                {#if gear.priceBand}
                  <span class="gear-price">{gear.priceBand}</span>
                {/if}
              </div>
              <span class="gear-line2">
                {gear.family} · {gear.protocols.join(' / ')}
              </span>
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </section>

  <section class="inventory">
    <h4>On the canvas</h4>
    <ul>
      <li><strong>{inventory.zones}</strong> subnet zone{inventory.zones === 1 ? '' : 's'}</li>
      <li><strong>{inventory.switches}</strong> switch{inventory.switches === 1 ? '' : 'es'}</li>
      <li><strong>{inventory.routers}</strong> IP router{inventory.routers === 1 ? '' : 's'}</li>
      <li>
        <strong>{inventory.bbmds}</strong> BBMD appliance{inventory.bbmds === 1 ? '' : 's'}
      </li>
      <li>
        <strong>{inventory.supervisorBbmds}</strong> supervisor{inventory.supervisorBbmds === 1 ? '' : 's'} running BBMD service
      </li>
    </ul>
  </section>

  <section class="primer">
    <h4>BBMD vs Router — which to use</h4>
    <dl>
      <dt>IP Router</dt>
      <dd>
        L3 unicast bridging. Routes <code>ReadProperty</code>, <code>WriteProperty</code>,
        etc. across subnets. <em>Does NOT forward broadcasts.</em>
      </dd>
      <dt>BBMD service (checkbox on a supervisor)</dt>
      <dd>
        When a JACE / NCE / NAE runs BBMD service alongside its normal duties.
        Use the <strong>BBMD</strong> checkbox in the device's Network panel.
      </dd>
      <dt>BBMD appliance (dedicated node)</dt>
      <dd>
        A purpose-built BBMD (Contemporary Controls BAS Router, etc.). Drag the
        tile above. The BBMD role is intrinsic — can't be turned off.
      </dd>
    </dl>
  </section>
</div>

<style>
  .network-palette {
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    height: 100%;
    overflow-y: auto;
  }
  h3 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  h4 {
    margin: 0 0 0.4rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in srgb, CanvasText 60%, transparent);
  }
  .blurb {
    margin: 0;
    font-size: 0.75rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    line-height: 1.35;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .net-tile {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, Canvas 92%, transparent);
    cursor: grab;
    text-align: left;
    font: inherit;
    transition: border-color 120ms ease, background 120ms ease;
  }
  .net-tile.clickable {
    cursor: pointer;
  }
  .net-tile:hover {
    border-color: color-mix(in srgb, CanvasText 35%, transparent);
    background: color-mix(in srgb, CanvasText 6%, transparent);
  }
  .net-tile.draggable:active {
    cursor: grabbing;
  }
  .net-tile-glyph {
    font-size: 1.4rem;
    line-height: 1;
    width: 1.6rem;
    text-align: center;
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }
  .net-tile-glyph.router-color {
    color: #f59e0b;
  }
  .net-tile-glyph.bbmd-color {
    color: #06b6d4;
  }
  .net-tile-glyph.switch-color {
    color: #2dd4bf;
  }
  .net-tile-body {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .net-tile-title {
    font-weight: 600;
    font-size: 0.8rem;
  }
  .net-tile-sub {
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
  }
  .inventory ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.75rem;
  }
  .inventory li {
    color: color-mix(in srgb, CanvasText 75%, transparent);
  }
  .inventory strong {
    color: CanvasText;
    font-variant-numeric: tabular-nums;
    min-width: 1.5rem;
    display: inline-block;
  }
  .primer dl {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .primer dt {
    font-weight: 600;
    font-size: 0.75rem;
  }
  .primer dd {
    margin: 0;
    font-size: 0.72rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    line-height: 1.4;
  }
  .primer code {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.7rem;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }

  /* Real-world gear catalog list — denser tiles grouped by vendor. */
  .catalog {
    gap: 0.55rem;
  }
  .catalog-blurb {
    margin: 0;
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    line-height: 1.4;
  }
  .vendor-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .vendor-name {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    margin-top: 0.2rem;
  }
  .gear-tile {
    display: grid;
    grid-template-columns: 1.4rem 1fr;
    gap: 0.5rem;
    padding: 0.4rem 0.55rem;
    border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
    border-radius: 5px;
    background: color-mix(in srgb, Canvas 92%, transparent);
    cursor: grab;
    transition: border-color 120ms ease, background 120ms ease;
  }
  .gear-tile:hover {
    border-color: color-mix(in srgb, CanvasText 30%, transparent);
    background: color-mix(in srgb, CanvasText 5%, transparent);
  }
  .gear-tile:active {
    cursor: grabbing;
  }
  .gear-glyph {
    font-size: 1.1rem;
    line-height: 1;
    text-align: center;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    align-self: center;
  }
  .gear-glyph.bbmd {
    color: #06b6d4;
  }
  .gear-glyph.router {
    color: #f59e0b;
  }
  .gear-body {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .gear-line1 {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .gear-model {
    font-size: 0.75rem;
    font-weight: 600;
  }
  .gear-price {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 50%, transparent);
  }
  .gear-line2 {
    font-size: 0.68rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
