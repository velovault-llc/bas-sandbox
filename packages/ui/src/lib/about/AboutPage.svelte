<script lang="ts">
  import { VENDOR_CATALOG, type ControllerModel } from '@bas/core';

  // Group catalog by vendor and compute a sandbox-support status.
  type SupportLevel = 'full' | 'partial' | 'planned';

  function supportLevel(m: ControllerModel): SupportLevel {
    if (m.stPortable) return 'full';
    return 'partial';
  }

  function supportLabel(level: SupportLevel): string {
    if (level === 'full') return 'Full programming + topology + protocols';
    if (level === 'partial') return 'Topology + protocols + dbexport import — native programming not simulated';
    return 'Planned';
  }

  const grouped = $derived.by(() => {
    const map = new Map<string, ControllerModel[]>();
    for (const m of VENDOR_CATALOG) {
      if (!map.has(m.vendor)) map.set(m.vendor, []);
      map.get(m.vendor)!.push(m);
    }
    return Array.from(map.entries()).map(([vendor, models]) => ({ vendor, models }));
  });

  type RoadmapRow = {
    feature: string;
    status: 'shipped' | 'in-progress' | 'planned' | 'considering';
    notes: string;
  };

  const roadmap: RoadmapRow[] = [
    { feature: 'Vendor-neutral topology canvas + drag-and-drop equipment', status: 'shipped', notes: 'Engine / Controller / Sensor / Safety with named wire trunks (MS/TP, BACnet/IP, N2, LON, hardwired).' },
    { feature: 'Real JCI Metasys .dbexport / .caf import', status: 'shipped', notes: 'Powered by @velovault/dbexport-parser (Apache-2.0 sibling project, 4,800+ entry dictionary).' },
    { feature: 'Lumped-capacitance thermal sim + PI control', status: 'shipped', notes: 'Single-zone and two-zone coupling; sensor fault injection; comm-fail propagation.' },
    { feature: 'Live weather drive (Open-Meteo)', status: 'shipped', notes: 'Live forecast / historical archive / curated presets (Phoenix August, Chicago January, …).' },
    { feature: 'IEC 61131-3 Structured Text + xterm.js CLI', status: 'shipped', notes: 'Pascal-flavored text programs on Beckhoff/Wago controllers, Cisco-IOS-style command shell.' },
    { feature: 'IEC 61131-3 Function Block Diagram editor', status: 'shipped', notes: '19-block library, SvelteFlow-backed canvas, compiles down to the same ST runtime.' },
    { feature: 'Stateful FBD blocks (TON, SR latch, SCHEDULE)', status: 'in-progress', notes: 'Needed for G36 sequence faithfulness.' },
    { feature: 'Data view dashboard (counts + validation summary)', status: 'planned', notes: 'Trunks by type, controllers by vendor, sensors by signal, validation findings rollup.' },
    { feature: 'AWS IoT Core MQTT publish', status: 'planned', notes: 'Optionally publish simulator telemetry to a customer-supplied AWS IoT endpoint so real AWS infrastructure can consume it.' },
    { feature: 'AWS IoT SiteWise asset-model export', status: 'planned', notes: 'Export topology canvas as a SiteWise asset-model JSON for one-click import into AWS.' },
    { feature: 'AWS IoT TwinMaker scene export', status: 'considering', notes: 'Bind topology + telemetry to a TwinMaker 3D digital twin.' },
    { feature: 'Read-only JCI TSEGraph block-graph viewer', status: 'considering', notes: 'View imported .caf control logic alongside an editable FBD on a Beckhoff next to it.' },
    { feature: 'Niagara wiresheet visualization (read-only)', status: 'considering', notes: 'Pending Tridium developer-program engagement.' },
  ];

  function statusColor(s: RoadmapRow['status']): string {
    if (s === 'shipped') return 'green';
    if (s === 'in-progress') return 'amber';
    if (s === 'planned') return 'blue';
    return 'grey';
  }
</script>

<article class="about">
  <header class="hero">
    <h1>bas-sandbox</h1>
    <p class="tagline">
      A vendor-neutral simulator for building automation systems — topology, real BACnet behavior,
      thermal physics, and IEC 61131-3 programming. Live in your browser, no install.
    </p>
    <p class="why">
      Building automation has a workforce-pipeline problem: there's no way for a new technician to
      get hands-on Metasys, Niagara, or Beckhoff without a $250K lab. bas-sandbox is the
      equivalent of what Cisco Packet Tracer did for network techs in the 2000s — a place to learn
      the topology, the protocols, and the control logic against simulated real-vendor equipment.
    </p>
  </header>

  <section class="card">
    <h2>Supported equipment</h2>
    <p class="muted">
      The catalog grows as vendor partnerships develop. Today we ship faithful topology + protocol
      simulation for every model below; full IEC 61131-3 programming (text + block diagram) works
      on the green-checked controllers where the language is portable to real hardware.
    </p>

    {#each grouped as group (group.vendor)}
      <div class="vendor-row">
        <h3>{group.vendor}</h3>
        <ul>
          {#each group.models as m (m.id)}
            {@const level = supportLevel(m)}
            <li class="model status-{level}">
              <div class="model-head">
                <strong>{m.model}</strong>
                <span class="role">{m.role}</span>
                <span class="status-pill status-{level}">
                  {level === 'full' ? '✓ Programmable' : level === 'partial' ? '◑ Topology only' : '○ Planned'}
                </span>
              </div>
              <div class="model-meta">
                <span class="lang">{m.programmingLanguage}</span>
                <span class="dot">·</span>
                <span class="protos">{m.protocols.join(', ')}</span>
                <span class="dot">·</span>
                <span class="pts">{m.maxPoints} pts</span>
              </div>
              <p class="model-notes">{m.notes}</p>
              <p class="model-support">{supportLabel(level)}</p>
            </li>
          {/each}
        </ul>
      </div>
    {/each}

    <p class="muted small">
      Not seeing your stack? The architecture is plugin-friendly — get in touch about adding your
      controller line.
    </p>
  </section>

  <section class="card">
    <h2>AWS integration roadmap</h2>
    <p class="muted">
      bas-sandbox is intentionally vendor-neutral, but AWS-native integrations are first-class on the
      roadmap because they unlock real-data-center training scenarios. None of the AWS items below
      require AWS to bless the project — they're additive, customer-credentials-only paths.
    </p>

    <table class="roadmap">
      <thead>
        <tr>
          <th>Feature</th>
          <th>Status</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {#each roadmap as row (row.feature)}
          <tr>
            <td>{row.feature}</td>
            <td>
              <span class="status-pill status-{statusColor(row.status)}">
                {row.status}
              </span>
            </td>
            <td class="muted">{row.notes}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="card">
    <h2>About the project</h2>
    <p>
      bas-sandbox is built by <strong>VELOVAULT LLC</strong>, an SBA-Certified Service-Disabled
      Veteran-Owned Small Business (SDVOSB / VOSB, valid through 2029-05-14; UEI VPM7K9BZLNU2,
      CAGE 1AYK1). The project is open-source under the
      <a href="https://fsl.software/" target="_blank" rel="noopener noreferrer">FSL-1.1 Apache 2.0</a>
      license; full source at
      <a href="https://github.com/velovault-llc/bas-sandbox" target="_blank" rel="noopener noreferrer">github.com/velovault-llc/bas-sandbox</a>.
    </p>
    <p>
      Three sibling projects share the codebase: <a href="https://github.com/velovault-llc/dbexport-parser" target="_blank" rel="noopener noreferrer">@velovault/dbexport-parser</a>
      (TypeScript Metasys parser, Apache 2.0) — the data foundation for the dbexport import flow;
      <a href="https://github.com/jmsboswell67-alt/dbexport-viewer" target="_blank" rel="noopener noreferrer">dbexport-viewer</a>
      (the sandbox's read-only sibling for forensic archive analysis); and the field-data weather
      service via <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer">Open-Meteo</a>.
    </p>
    <p>
      <strong>Target audiences:</strong> trade-school instructors and BAS apprenticeship programs;
      design engineers prototyping G36 sequences; data-center commissioning teams onboarding new
      controls techs; integrators preparing for cross-vendor jobs.
    </p>
  </section>

  <section class="card cta">
    <h2>Try it / get in touch</h2>
    <div class="cta-row">
      <a class="cta-btn primary" href="/" data-action="goto-build">▶ Open the sandbox</a>
      <a class="cta-btn" href="https://github.com/velovault-llc/bas-sandbox" target="_blank" rel="noopener noreferrer">
        GitHub
      </a>
      <a class="cta-btn" href="mailto:jmsboswell67@gmail.com?subject=bas-sandbox">
        Email the maintainer
      </a>
    </div>
  </section>
</article>

<style>
  .about {
    max-width: 1080px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
    line-height: 1.55;
  }

  .hero {
    margin-bottom: 2rem;
    padding: 1.25rem 0;
  }

  .hero h1 {
    margin: 0 0 0.5rem 0;
    font-size: 2.1rem;
    letter-spacing: -0.01em;
  }

  .tagline {
    font-size: 1.05rem;
    color: color-mix(in srgb, CanvasText 85%, transparent);
    margin: 0 0 0.85rem 0;
  }

  .why {
    color: color-mix(in srgb, CanvasText 72%, transparent);
    font-size: 0.95rem;
    margin: 0;
  }

  .card {
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    background: color-mix(in srgb, Canvas 95%, CanvasText 3%);
    border-radius: 10px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.25rem;
  }

  .card h2 {
    margin: 0 0 0.65rem 0;
    font-size: 1.15rem;
  }

  .muted {
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-size: 0.9rem;
  }

  .small {
    font-size: 0.82rem;
  }

  .vendor-row {
    margin-top: 1rem;
    padding-top: 0.9rem;
    border-top: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
  }

  .vendor-row:first-of-type {
    border-top: 0;
    padding-top: 0;
    margin-top: 0.55rem;
  }

  .vendor-row h3 {
    margin: 0 0 0.6rem 0;
    font-size: 0.95rem;
    color: color-mix(in srgb, CanvasText 75%, transparent);
  }

  .vendor-row ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 0.65rem;
  }

  .model {
    padding: 0.6rem 0.85rem;
    border-radius: 6px;
    background: color-mix(in srgb, Canvas 92%, CanvasText 5%);
    border-left: 3px solid color-mix(in srgb, CanvasText 25%, transparent);
  }

  .model.status-full {
    border-left-color: #2ecc71;
  }

  .model.status-partial {
    border-left-color: #f39c12;
  }

  .model-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .model-head strong {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.92rem;
  }

  .role {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }

  .status-pill {
    font-size: 0.68rem;
    padding: 0.05rem 0.45rem;
    border-radius: 8px;
    margin-left: auto;
    background: color-mix(in srgb, CanvasText 12%, transparent);
    color: color-mix(in srgb, CanvasText 80%, transparent);
  }

  .status-pill.status-full,
  .status-pill.status-green {
    background: color-mix(in srgb, #2ecc71 16%, transparent);
    color: color-mix(in srgb, #2ecc71 90%, CanvasText);
  }

  .status-pill.status-partial,
  .status-pill.status-amber {
    background: color-mix(in srgb, #f39c12 16%, transparent);
    color: color-mix(in srgb, #f39c12 92%, CanvasText);
  }

  .status-pill.status-blue {
    background: color-mix(in srgb, #4a9eff 16%, transparent);
    color: color-mix(in srgb, #4a9eff 90%, CanvasText);
  }

  .status-pill.status-grey {
    background: color-mix(in srgb, CanvasText 10%, transparent);
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }

  .model-meta {
    font-size: 0.75rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    margin-top: 0.25rem;
  }

  .dot {
    margin: 0 0.35rem;
    opacity: 0.5;
  }

  .model-notes {
    margin: 0.4rem 0 0.3rem 0;
    font-size: 0.82rem;
  }

  .model-support {
    margin: 0;
    font-size: 0.75rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-style: italic;
  }

  .roadmap {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    margin-top: 0.55rem;
  }

  .roadmap th,
  .roadmap td {
    text-align: left;
    padding: 0.5rem 0.65rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
    vertical-align: top;
  }

  .roadmap th {
    font-weight: 600;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    font-size: 0.78rem;
  }

  .roadmap td:nth-child(2) {
    white-space: nowrap;
    width: 7rem;
  }

  .cta {
    text-align: center;
  }

  .cta-row {
    display: flex;
    justify-content: center;
    gap: 0.65rem;
    margin-top: 0.6rem;
    flex-wrap: wrap;
  }

  .cta-btn {
    padding: 0.5rem 1.1rem;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    color: inherit;
    text-decoration: none;
    font-size: 0.88rem;
    font-weight: 500;
  }

  .cta-btn:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
  }

  .cta-btn.primary {
    background: #4a9eff;
    color: white;
    border-color: transparent;
  }

  .cta-btn.primary:hover {
    background: color-mix(in srgb, #4a9eff 88%, Canvas);
  }
</style>
