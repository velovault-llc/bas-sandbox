# Architecture

`bas-sandbox` is a browser-based, four-layer simulator. This document captures the technical decisions, the build-vs-borrow rationale for each layer, and the integration contracts between them.

## Goals

- **Zero install.** Open the URL, drag a file, see something happen. No local agent, no service, no JCI Launcher equivalent.
- **No live-engine contact.** Everything runs in the browser. Archives never leave the user's machine.
- **Vendor-neutral.** BACnet at the protocol layer, Brick Schema at the data model, ASHRAE Guideline 36 as the control-logic target. Vendor-specific ingest (Metasys `.dbexport`, Niagara `.bog`, etc.) is one pluggable input, not the core abstraction.
- **Two audiences, one engine.** Same simulator runs in "controls tech" and "design engineer / commissioning" modes — different scenario libraries and report templates, shared core.

## Layered architecture

```
┌──────────────────────────────────────────────────┐
│  UI (TypeScript + Svelte)                        │
│  Canvas · Scenario editor · Results viewer       │
├──────────────────────────────────────────────────┤
│  Orchestrator (TypeScript, in a Web Worker)      │
│  Sim loop · Scenario runner · Result aggregation │
├─────────────┬─────────────┬──────────────────────┤
│  BACnet     │  Controls   │  Physics             │
│  WASM       │  WASM       │  WASM                │
│  (bacnet-   │  (Rust,     │  (Rust thermal,      │
│   stack)    │   G36 IR)   │   FMI later)         │
├─────────────┴─────────────┴──────────────────────┤
│  Data model: Brick Schema (RDF) + Haystack tags  │
├──────────────────────────────────────────────────┤
│  Ingest plugins                                  │
│  .dbexport · BACnet discovery · Brick TTL · ...  │
└──────────────────────────────────────────────────┘
```

## Layer decisions

### UI: TypeScript + Svelte

Svelte over React, three reasons:

- Smaller bundle, faster cold-start — matters when the page also has to load several MB of WASM.
- Reactive stores fit the simulator's shape: object property changes propagate to the canvas, the results viewer, the deviation report, the alarm log — a graph of derived state.
- The single-maintainer surface is smaller. Svelte is easier to keep moving alone than React's ecosystem churn.

If we hit a wall (component-library gaps, hiring difficulty later), migrating to React is a known cost.

**Canvas rendering**: SVG for the topology canvas (simpler interaction, accessibility built in), with a fallback to Canvas2D if performance bites at >500 objects. WebGL is overkill for what this is — we draw boxes and lines, not GPU-accelerated graphics.

### BACnet protocol: bacnet-stack via WASM

`bacnet-stack` (Steve Karg, C, weekly commits since 2003) is the reference open-source BACnet stack. Compiling it to WASM gives us a real protocol implementation in the browser — not a re-implementation that drifts from spec.

Tradeoffs:

- Build complexity: emscripten toolchain, BACnet's C ergonomics are 2003-vintage. Worth it for protocol fidelity.
- Alternative considered: `bacpypes3` (Python) as a sidecar service. Cleaner code, but requires deployment infrastructure that breaks the "open the URL" pitch.

### Controls: Rust → WASM, mapped to ASHRAE G36

The control-logic interpreter is the strategic moat. Rust because:

- Sim loops are hot paths — every block evaluated on every tick.
- Rust → WASM has the cleanest tooling (`wasm-bindgen`, `wasm-pack`).
- The block library is data-driven: each block type's behavior is a small chunk of code plus a JSON spec. Adding a new vendor block type is a data file, not a recompile.

**ASHRAE G36 as the canonical control vocabulary.** Vendor block libraries (JCI CCT, Tridium WB, Siemens APOGEE) are mapped *to* G36 primitives in their respective ingest plugins. The interpreter only runs G36 — vendor-specific quirks live in the ingest layer where they belong.

This is the bridge nobody else builds because nobody else has both the open-standards story and the vendor-specific archive parsers.

### Physics: lumped-capacitance now, EnergyPlus FMI later

Phase 3 ships a hand-rolled thermal model in Rust:

- Per-zone lumped-capacitance (one thermal node per zone, RC against outdoor air).
- Per-equipment first-order responses (cooling coil, heating coil, fan with simple curve, damper position → flow).
- Good enough to demonstrate "the damper closed and the zone warmed up." Bad at multi-zone interaction, latent loads, anything involving radiation or stratification.

Phase 5 swaps in EnergyPlus or Modelica Buildings via FMI:

- EnergyPlus as a WASM-compiled FMU (emerging — NREL has been moving this direction).
- Or as a containerized sidecar for a hosted-only "pro" mode where browser limits are too tight.
- Spawn-of-EnergyPlus is the modern co-sim bridge.

The toy model and the real model expose the same interface to the orchestrator. Swapping is a config flag.

### Data model: Brick Schema + Haystack tags

Brick Schema (RDF + SHACL) is the internal representation. Every imported topology converts to a Brick graph; every queryable question ("what does this VAV serve?", "what's downstream of AHU-3?") is a SPARQL query against the in-memory store.

Project Haystack tags are display-layer metadata — what the techs already know to read.

IFC is intentionally not used. Building geometry isn't what techs need; point lists and control graphs are.

### Ingest: pluggable

Each ingest plugin converts a vendor format to Brick. Plugins:

- **Metasys `.dbexport`** — wraps the [dbexport-viewer](https://github.com/jmsboswell67-alt/dbexport-viewer) parser. Maps JCI classes to Brick entity types using the existing class dictionary.
- **BACnet discovery scan** — runs a Who-Is/I-Am cycle against the virtual network and synthesizes Brick from the responses. Lets you build a topology from a live snapshot (or another simulator's exported state).
- **Brick TTL import** — direct, for users who already have a Brick model.
- **Niagara `.bog`** — Phase 4+. Harder format, lower priority.

The orchestrator never sees vendor-specific data. By the time topology reaches the sim engine, it is pure Brick.

## Sim loop

The orchestrator runs in a Web Worker so the canvas stays responsive. Each tick:

1. BACnet WASM advances the protocol clock — token passing on MS/TP trunks, broadcast messages, COV notifications.
2. Controls WASM evaluates every block, propagating values along the control graph.
3. Physics WASM advances the thermal model by `dt`, taking actuator positions as inputs and producing sensor values.
4. The orchestrator marshals updated BACnet object values, surfaces them to the UI, logs to the scenario record.

Default tick: 1 simulated second per 16 wall-clock ms (real-time at 60 fps), with "fast forward" up to 1 simulated minute per tick for 24-hour scenarios. Scenarios capture every BACnet message and every block evaluation for post-run analysis.

## Two-persona surface

The same simulator runs in two modes, distinguished by **scenario library + report template**, not by engine.

- **Controls Tech mode** — scenario library is "common pre-flight checks for live edits." Reports surface failure modes in tech-operational language ("this would have caused a freeze-stat trip on the AHU-3 chilled-water coil at 14:30").
- **Design Engineer / CxA mode** — scenario library is reference loads (G36 §5.X annual cycles, ASHRAE 90.1 zone profiles). Reports surface deviations against G36 reference logic with citations.

Both modes share the BACnet, Controls, Physics, and Data layers verbatim. Persona is a UI shell + scenario pack, not a fork.

## Deployment

- Static hosting on Netlify under VELOVAULT's existing setup, deployed via `netlify deploy --prod`.
- Domain: TBD — likely `sandbox.velovaultllc.com` or a dedicated short name.
- WASM binaries served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` so `SharedArrayBuffer` is available (needed for high-resolution sim timing across the three WASM modules).
- No backend in v1. Scenario sharing is via file download / upload (`.bas-scenario` bundle: topology + scenario script + result log).

A hosted "pro" tier (Phase 6+) would add: account-bound scenario sharing, team scenario libraries, cloud-rendered EnergyPlus co-sim for users whose browsers can't run it, federal-training scenario packs. Backend in Rust (axum) or Go, fronted by the same Svelte app.

## Build-vs-borrow summary

| Component | Decision | Rationale |
|---|---|---|
| `.dbexport` parser | Borrow (dbexport-viewer) | Already shipped, calibrated to ~88% recall vs. SCT ground truth. |
| BACnet protocol | Borrow (`bacnet-stack`, WASM) | Spec-accurate, weekly commits since 2003, MIT-compatible. |
| Control interpreter | Build (Rust) | Strategic moat. No suitable open-source equivalent that targets G36. |
| Block library mappings | Build (data files) | Per-vendor; updates ship as data, not code. |
| Thermal model (early) | Build (Rust, ~200 LOC) | Real EnergyPlus is overkill for first demos and slow to compile. |
| Physics (later) | Borrow (EnergyPlus via FMI / Spawn) | Gold standard. Co-sim via FMI keeps us out of physics-engine maintenance. |
| Data model | Borrow (Brick Schema + Haystack) | Vendor-neutral, has growing tooling ecosystem. |
| UI framework | Borrow (Svelte) | Solo-maintainer friendly. |
| Canvas | Build (SVG) | Custom interaction model; no off-the-shelf BAS canvas exists. |
| Scenario format | Build (`.bas-scenario` bundle) | Need topology + script + result log in one file. |
