# bas-sandbox

**A vendor-neutral simulator for building automation systems. Drag-and-drop topology, real BACnet behavior, thermal response — try the edit before you ship it to the live engine.**

> Status: **live at [sandbox.velovaultllc.com](https://sandbox.velovaultllc.com)** — no install, runs entirely in your browser. An interactive BACnet/IP + MS/TP network simulator with signal-level I/O fidelity, byte-accurate packet capture, a lumped-capacitance thermal model, and an optional on-device LLM assistant. Wire a site up from scratch, or import a Metasys `.dbexport` to auto-build the topology.
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

## What works today

- **Drag-and-drop topology** from a real vendor catalog — engines/supervisors (JACE, NAE, SNE, AS-P, PXC…), field & plant controllers (FEC, VMA, Spyder, Distech…), sensors, safeties, actuators, equipment, zones, IP routers, BBMDs, Ethernet switches, virtual controllers, and a G36 §5.18 AHU.
- **BACnet that behaves like BACnet** — MS/TP token passing + BACnet/IP, automatic MAC / device-instance / IP addressing, Who-Is/I-Am discovery, ReadProperty, SubscribeCOV + COV notifications, BBMD/BDT broadcast forwarding, baud-derived latency, timeout→retry→Comm-Lost — all surfaced in a **Wireshark-style packet log with a byte-level inspector**.
- **Byte-accurate wire codec** — validated **byte-for-byte against a 19,523-packet real-capture corpus (100%)**.
- **Ground-truthed against real stacks** — a physical [BACnet lab](tools/real-bacnet-rig/README.md) (bacnet-stack reference devices + Wireshark on a dedicated LAN) feeds [conversation-level captures](wireshark/README.md) back into development: COV subscription lifecycles, renewal cadence, discovery dances, and priority-array semantics are matched to observed wire behavior, not just the spec.
- **Network validation** — duplicate MAC/IP, subnet/mask/gateway mismatches, BBMD/BDT misconfig, and L2/VLAN broadcast-domain checks (the "same subnet, different VLAN, no comms" gotcha).
- **Signal-level I/O fidelity** — Pt100/Pt1000/Ni1000 RTDs, thermistors, 4-20mA/0-10V/2-10V transmitters, dry contacts; set each controller terminal's input type and catch the *silent* mismatches that bite techs in the field.
- **Two teaching modes** — *Easy* blocks mistakes and shows omniscient hints; *Realistic* lets you wire it wrong with no warning, like the field — then diagnose it yourself, ask the local AI, or hit "Check my work."
- **Thermal + sequence sim** — run a controller's logic against a lumped-capacitance zone driven by live weather, and watch the loop respond.
- **Static validator** — structural lint over an imported Metasys archive (suppressed alarms, duplicate descriptions, unresolved refs).

## What's underneath

A **TypeScript** monorepo (pnpm workspaces). Everything runs client-side — no backend, no live-engine connection.

| Layer         | What it does                                                                                                  | Technology                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **UI**        | Topology canvas, inspectors, packet log, results                                                              | Svelte 5 + `@xyflow/svelte` (SVG canvas)   |
| **Network**   | BACnet object model + byte-level wire codec, MS/TP + BACnet/IP + L2/VLAN modeling, addressing, BBMD routing, fault injection | TypeScript (`@bas/core`)      |
| **Controls**  | Structured-Text interpreter + function-block / SpecLang front-ends; ASHRAE G36 §5.18 single-zone AHU sequence | TypeScript                                 |
| **Physics**   | Lumped-capacitance zone thermal model, weather-driven OAT (Open-Meteo)                                        | TypeScript                                 |
| **Assistant** | Optional on-device diagnosis chat                                                                             | local Ollama (no cloud)                    |

Data model is [Brick Schema](https://brickschema.org/) with [Project Haystack](https://project-haystack.org/) display tags. Ingest is pluggable: Metasys `.dbexport` via the sibling [dbexport-viewer](https://github.com/jmsboswell67-alt/dbexport-viewer) parser, plus Brick TTL.

> The hot paths (high-resolution MS/TP timing, multi-zone physics) are candidates for a future Rust→WASM port — but the current implementation is pure TypeScript and comfortably real-time for interactive use. [ARCHITECTURE.md](ARCHITECTURE.md) captures the original build-vs-borrow rationale.

## Roadmap

Full phased plan in [ROADMAP.md](ROADMAP.md). At a glance:

| Phase | Scope                                                   | Status              |
| ----- | ------------------------------------------------------- | ------------------- |
| 1     | Static validator, multi-vendor ingest, topology canvas  | ✅ Shipped          |
| 2     | Impact preview, sandbox edit mode, diff-with-validation | Planned             |
| 3     | BACnet network simulator + toy thermal model            | ✅ Mostly shipped   |
| 4     | Full control-logic runtime, G36 mapping                 | 🚧 In progress      |
| 5     | Physics-backed runtime via EnergyPlus FMI co-simulation | Planned             |

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the technical decisions — tech stack, data model, sim-loop design, integration points, and the build-vs-borrow rationale for each layer.

## License

Functional Source License, Version 1.1, ALv2 Future License ([FSL-1.1-ALv2](LICENSE)).

Source is public and free to read, fork, and use for any non-competing purpose — internal use, education, research, and professional services are all permitted. After two years, each release auto-converts to Apache 2.0. Commercial licenses, hosted instances, and federal-training packs are available from [VELOVAULT LLC](https://velovaultllc.com).

## Acknowledgments

- **[dbexport-viewer](https://github.com/jmsboswell67-alt/dbexport-viewer)** — ships the Metasys `.dbexport` parser this simulator uses as one ingest path.
- **[BOPTEST](https://github.com/ibpsa/project1-boptest)** at IBPSA — the closest existing open-source analog, aimed at controls researchers rather than field techs.
- **[bacnet-stack](https://github.com/bacnet-stack/bacnet-stack)** and **[BACpypes3](https://github.com/JoelBender/BACpypes3)** — reference implementations our from-scratch BACnet codec is validated against. **[Brick Schema](https://github.com/BrickSchema/Brick)** and the ASHRAE Guideline 36 maintainers — the open standards that make a vendor-neutral simulator possible.
