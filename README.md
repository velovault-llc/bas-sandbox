# bas-sandbox

**A vendor-neutral simulator for building automation systems. Drag-and-drop topology, real BACnet behavior, thermal response — try the edit before you ship it to the live engine.**

> Status: Phase 0 complete — **try it live at [bas-sandbox.netlify.app](https://bas-sandbox.netlify.app)**. Drag a `.dbexport` onto the page; the parser runs entirely in your browser and renders the topology tree. Phase 1 (static validator) in active development.
>
> Maintained by [VELOVAULT LLC](https://velovaultllc.com) — an SBA-certified SDVOSB & VOSB.

---

## What it is

A browser-based sandbox where you build (or import) a BAS topology, wire up controllers and equipment with BACnet objects, run a sequence of operations against a thermal model, and see what would happen if you pushed the same edits to a real engine. Think Cisco's Packet Tracer, but for HVAC controls.

The simulator runs entirely in your browser. No install, no live-engine connection, no cloud upload of your archive.

## Who it's for

**Controls technicians** asking _"if I push this edit to the live engine, will it brick the site?"_

Wire your virtual topology, import your archive (Metasys `.dbexport` today; generic BACnet discovery scan and Brick Schema import on the roadmap), apply the proposed change, watch the simulator predict the failure mode before you do.

**Design engineers and commissioning agents** asking _"does this sequence-of-operations actually meet G36 for this zone type?"_

Build a reference topology, drop in a candidate sequence, run a 24-hour simulated cycle against outdoor-air and load profiles, get a deviation report against the ASHRAE Guideline 36 reference logic.

Same engine. Different scenario library. Different report.

## What's underneath

Four composable layers:

| Layer        | What it does                                                                        | Technology                      |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------------- |
| **UI**       | Topology canvas, scenario editor, results viewer                                    | TypeScript + Svelte             |
| **Network**  | BACnet/IP and MS/TP protocol simulation, broadcast and fault injection              | `bacnet-stack` compiled to WASM |
| **Controls** | Sequence interpreter mapping vendor blocks to ASHRAE Guideline 36 primitives        | Rust → WASM                     |
| **Physics**  | Lumped-capacitance thermal model (Phase 3), full EnergyPlus co-simulation (Phase 5) | Rust → WASM, FMI later          |

Internal data model is [Brick Schema](https://brickschema.org/); display tags from [Project Haystack](https://project-haystack.org/). Ingest is pluggable: Metasys `.dbexport` via the sibling [dbexport-viewer](https://github.com/jmsboswell67-alt/dbexport-viewer) parser, plus generic BACnet discovery and Brick TTL import.

## Roadmap

Full phased plan in [ROADMAP.md](ROADMAP.md). At a glance:

| Phase | Scope                                                   | Status      |
| ----- | ------------------------------------------------------- | ----------- |
| 1     | Static validator, multi-vendor ingest, topology canvas  | In progress |
| 2     | Impact preview, sandbox edit mode, diff-with-validation | Planned     |
| 3     | BACnet network simulator + toy thermal model            | Planned     |
| 4     | Full control-logic runtime, G36 mapping                 | Planned     |
| 5     | Physics-backed runtime via EnergyPlus FMI co-simulation | Planned     |

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the technical decisions — tech stack, data model, sim-loop design, integration points, and the build-vs-borrow rationale for each layer.

## License

Functional Source License, Version 1.1, ALv2 Future License ([FSL-1.1-ALv2](LICENSE)).

Source is public and free to read, fork, and use for any non-competing purpose — internal use, education, research, and professional services are all permitted. After two years, each release auto-converts to Apache 2.0. Commercial licenses, hosted instances, and federal-training packs are available from [VELOVAULT LLC](https://velovaultllc.com).

## Acknowledgments

- **[dbexport-viewer](https://github.com/jmsboswell67-alt/dbexport-viewer)** — ships the Metasys `.dbexport` parser this simulator uses as one ingest path.
- **[BOPTEST](https://github.com/ibpsa/project1-boptest)** at IBPSA — the closest existing open-source analog, aimed at controls researchers rather than field techs.
- **[bacnet-stack](https://github.com/bacnet-stack/bacnet-stack)**, **[Brick Schema](https://github.com/BrickSchema/Brick)**, and the ASHRAE Guideline 36 maintainers — the open-source and open-standards work that makes a vendor-neutral simulator possible.
