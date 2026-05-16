# Roadmap

`bas-sandbox` is structured as five composable phases plus an open-ended Phase 6+ for hosted/commercial features. Phases are sized by what one focused contributor can ship in months, not weeks.

This is a living document. Dates are intentionally absent — the project ships when it ships.

## Phase 0: Foundation (in progress)

Repo scaffold, build pipeline, ingest plugin interface, Brick Schema integration, empty topology canvas.

**Deliverable**: the site loads, you can drag a `.dbexport` onto it and see the topology tree (no simulation yet).

**Borrows**: [dbexport-viewer](https://github.com/jmsboswell67-alt/dbexport-viewer) parser, Brick Schema TypeScript bindings.

## Phase 1: Static validator

A "Validate" mode that runs structural lint rules across an imported archive. No physics, no protocol simulation, no UI builder — audit dressed up as a pre-flight check. Ships an immediate value prop for both personas.

**Rules in v1**:

- Required-object check (engine root, NIC, security objects exist).
- Ref integrity — every internal ref resolves to a defined object.
- Graphics binding lint — every `<reference>` inside a `Base64Zip` graphic payload points to something defined.
- Programming wire lint — every TSEGraph edge has a defined source and target port.
- Setpoint sanity — heating SP < cooling SP, both in human ranges, deadband > 0.
- Schedule sanity — at least one occupied period, default event well-formed.
- Alarm config — notification class refs resolve, hysteresis present where required.
- Class-specific — AI has units, AO has Relinquish Default, schedules have a weekly schedule.

**Output**: pass / warning / error per rule, with offending refs and one-click "show in Browse mode" navigation.

**Persona surfaces**:
- Tech: "this edit would fail SCT import in these 4 places."
- Engineer/CxA: "this submitted SOO has 3 G36 deviations and 1 missing alarm class."

## Phase 2: Impact preview + sandbox edit

Extension of dbexport-viewer's reverse-lookup into a "what if" UI.

- Right-click any object → "Simulate delete" → show blast radius (downstream graphics, programs, schedules, user trees).
- Right-click any prefix → "Simulate rename" → preview the repoint plan with confidence pills.
- Diff-with-validation: drop original in slot A, edited version in slot B, run static lint on the *delta*.
- In-browser edit mode: change Description, setpoints, schedule patterns, alarm thresholds. Validation runs live. Export the modified archive.

**Output**: by the time you click "save," you know the export will import cleanly.

## Phase 3: BACnet network + toy thermal

The "Packet Tracer for BAS" piece, scoped to ship something usable rather than something complete.

- Drag-and-drop topology canvas — MS/TP trunks, BACnet/IP routers, BBMDs.
- Auto-populate from imported archive — every device becomes a virtual BACnet device exposing its objects.
- Simulate addressing (instance numbers, MAC addresses on MS/TP, IP addresses on BACnet/IP).
- Simulate broadcast behavior — Who-Is / I-Am, change-of-value notifications, alarm notifications.
- Inject faults: drop a trunk, kill a controller, slow response time, force a token loss.
- Wireshark-style packet log — see exactly what's on the wire under each scenario.
- Connect external tools (YABE, real BACnet clients) to the virtual network for cross-validation.
- **Lumped-capacitance thermal model** running in parallel — actuator positions feed simple zone temperatures, which feed back into virtual sensor objects.

**Output**: tech wires their site, points YABE or a real BACnet client at the virtual network, validates commissioning. Engineer drops a candidate sequence, watches the thermal response to a load profile.

This is the first phase that's visually compelling — the screenshot you put on the README.

## Phase 4: Full control-logic runtime

The technical moonshot. Interpret the parsed control graph and produce simulated outputs.

- Every CCT (and equivalent) block type mapped to its behavior — math, compare, PID, state machine, schedule, alarm, ramp, deadband.
- Wire-walking with timing semantics — PID integration, schedule transitions, debounce.
- Vendor blocks lower to G36 primitives at import time; runtime only knows G36.
- Per-block vendor quirks captured as data files, not code.

**Output**: drop archive, set OAT/RAT/setpoints, watch supply temp track over a simulated day. Step through logic block-by-block.

**Persona surfaces deepen**:
- Tech: "this edit would have caused a freeze-stat trip during last winter's coldest hour."
- Engineer/CxA: "this sequence deviates from G36 §5.16 at these steps; here are the canonical responses."

## Phase 5: Physics-backed runtime

Swap the toy thermal model for EnergyPlus or Modelica Buildings via FMI co-simulation.

- Archive contents (or user input) infer the physical model: AHU type, zone areas, duct sizes, equipment capacities.
- Map archive objects to E+ or Modelica components.
- Run a full coupled simulation: physical inputs → controls → equipment response → loop.
- Replay historical trend data: "yesterday's actual OAT cycle, applied to your edited logic — here's what would have happened."
- Fault injection at the physical layer: stuck damper, failed sensor, fouled coil.

**Output**: validation that an edit doesn't break the building, not just the SCT import.

## Phase 6+: Hosted and commercial

This is where commercial licensing pays the bills. Likely candidates:

- Save / load scenarios; share as `.bas-scenario` bundles.
- Team scenario libraries with role-based access.
- Federal-training scenario packs — tech-track + engineer-track curricula tied to G36 and base-installation HVAC standards. SBIR-aligned.
- Demand-response integration via openLEADR.
- Optional cloud-rendered EnergyPlus co-sim for users whose browsers can't run it locally.
- Brick / Haystack tagging on all simulator outputs for analytics export.
- Cross-vendor ingest beyond Metasys — Niagara `.bog`, Siemens BACnet export, Honeywell EBI.

## Scope discipline (what this isn't)

- **Not a replacement for SCT / Workbench / Desigo CC.** These remain the engineering tools of record. The simulator is the staging environment they lack.
- **Not a building-energy model.** OpenStudio answers that question.
- **Not a thermodynamic research platform.** EnergyPlus and Modelica do that directly.
- **Not a Niagara-first or Siemens-first tool.** Cross-vendor ingest is plugin-based; Metasys is the first plugin because the parser is already shipped.

## Open questions

These need resolution before committing to certain phases.

1. **`.caf` runtime semantics** — how does the NAE actually execute a compiled `.caf`? The format is readable, but runtime quirks (sample rates, propagation order, shared-variable races) are JCI-internal. Probable resolution: G36 mapping + empirical observation against test archives.
2. **Block library completeness** — the ~30 CCT block IDs without canonical names (526, 528, 555, 556, etc.) need either insider data or empirical inference from real archives.
3. **MS/TP timing fidelity** — "ballpark right" for v1 (catch broadcast storms) and "tight" for v2 (predict bus saturation). What's the right threshold?
4. **License-friendly G36 mapping** — ASHRAE documents are public, but pseudocode may have licensing constraints. Needs review before publishing the mapping.
5. **WASM EnergyPlus maturity** — is the NREL community far enough along that we can ride it in Phase 5, or do we ship hosted-only co-sim?
6. **Commercial line** — static validator and BACnet sim are commodity utilities; G36 deviation reports and federal-training packs are billable. Likely commercial boundary, subject to revision.

## Reference reading

External docs and projects worth bookmarking:

- [BOPTEST](https://github.com/ibpsa/project1-boptest) — closest analog (researcher-facing); study FMI co-sim patterns.
- [EnergyPlus](https://github.com/NREL/EnergyPlus) — the physics backend.
- [Modelica Buildings Library](https://github.com/lbl-srg/modelica-buildings) — G36 sequences live here.
- [bacnet-stack](https://github.com/bacnet-stack/bacnet-stack) — the BACnet protocol stack.
- [BACpypes3](https://github.com/JoelBender/BACpypes3) and [BAC0](https://github.com/ChristianTremblay/BAC0) — Python prototyping.
- [Brick Schema](https://github.com/BrickSchema/Brick) — internal data model.
- [Project Haystack Xeto](https://www.project-haystack.org/) — tagging vocabulary.
- [Spawn-of-EnergyPlus](https://www.energy.gov/cmei/buildings/articles/spawn-energyplus-spawn) — modern co-sim bridge.
- [ASHRAE Guideline 36-2024](https://www.ashrae.org/technical-resources/ashrae-standards-and-guidelines) — canonical control sequences.
- [openLEADR](https://openleadr.org/) — demand response, future feature.
- [YABE](https://sourceforge.net/projects/yetanotherbacnetexplorer/) — validation target.

## Honest bottom line

The pieces exist. The integration doesn't.

The strategic asset — the `.dbexport` parser, the TSEGraph parser, the audit-rule library — is already shipped in the sibling dbexport-viewer project. The remaining work is real but mostly composition, not invention.

A focused six-month effort by one contributor could get to Phase 3 (validation + impact preview + BACnet network sim with toy thermal). A focused year could get to Phase 4 (full control runtime). Phase 5 (physics co-simulation) is open-ended but optional — many useful workflows don't need it.

Nobody else owns this category. The path is open.
