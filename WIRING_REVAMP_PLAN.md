# Wiring Revamp Plan — connection model v2

Date: 2026-06-10. Authors: James (design direction) + Claude.
Decisions locked: **MS/TP = daisy-chain + rules** · **AHU = both patterns
(packaged-with-terminals AND equipment+controller split)** · **build starts now**.

## Why (the session that triggered this)

James, wiring Suite 200 in Realistic mode:

> "the only way I can connect the supervisor to the AHU is by connecting the
> AHU out to the supervisors in. we need room to make simple bus topologies
> for controllers, and potential star patterns using bacnet over IP and we
> need to be able to catch issues with both if set up incorrectly. for end
> devices like AHU … just having an out and an in when we are planning on
> connecting actuators to it isn't going to cut it, that AHU would need its
> own controller too."

## Root cause

One edge type carries **three different physical meanings**, and inherits a
fake directionality from the `net-out → net-in` handle pair:

| Wire class | Real shape | Direction means | Today |
|---|---|---|---|
| **Network segment** (MS/TP, BACnet/IP, N2, LON) | bus / star / daisy | nothing — a trunk has no in/out | forced through directed net-out→net-in; gesture-blocked |
| **Signal wire** (sensor/actuator ↔ terminal) | point-to-point | which end is the terminal | works, but only controllers render terminals |
| **Process link** (air/water: equipment→zone, AHU→zone) | duct / pipe | flow direction — **matters** | same arrow style as everything; direction silently significant |

The sim already treats network edges as undirected (trunk grouping builds an
undirected adjacency in `assignMstpAddressing`); only the UI gesture is
directional. Process links are the opposite: they look interchangeable but
`computeCoilHeatForZone` requires equipment as SOURCE and zone as TARGET.

## Target model

### 1. Three explicit wire classes

- `network` — undirected. Either gesture direction produces the same edge.
  Trunk membership, addressing, and validators all already treat it this way.
- `signal` — terminal-anchored (UI/AI/BI/UO/AO/BO ↔ device). Existing
  behavior, extended to AHU terminals (see §3).
- `process` — directed (flow). Distinct visual (thicker, duct/pipe styling,
  arrowhead that MEANS something). Equipment→zone, AHU→zone, zone↔zone
  shared-wall.

### 2. Network topology rules (the teaching core)

**MS/TP (RS-485 bus) — daisy-chain + rules:**

- Device-to-device edges stay (field-authentic: RS-485 lands lug-to-lug,
  chain order is physical).
- **T-tap / star detection**: >2 MS/TP edges on a non-repeater device = a
  real-world reflection fault. Easy: blocked with explanation. Realistic:
  allowed, tagged `edge.data.miswire`, surfaced by Check-my-work + AI.
  (Classic field failure — "it worked at 9600 but not 38400".)
- **EOL termination**: per-device boolean (inspector toggle, mirrors the DIP
  switch). Validator: exactly the two physical chain ends terminated.
  Missing/extra → warning finding; (stretch) inject packet errors at high
  baud when wrong.
- **Repeater** device (network gear catalog): legitimately branches a trunk /
  extends past 32 unit loads. Excluded from the T-tap rule.
- **MAC assignment**: field devices (sensor/safety/actuator — done 2026-06-09)
  AND zones/equipment (this revamp) never take a MAC.

**BACnet/IP (Ethernet) — star + port-aware daisy:**

- Home-run to the **Ethernet Switch** node (exists; L2/VLAN validator exists).
- **Port counts in the catalog**: JACE-8000 / ECY etc. carry
  `ethernetPorts: 2` (built-in switch) vs 1. Daisy-chaining through a 2-port
  device = legal, with the "everything downstream dies with this box" lesson
  surfaced. Daisy through a 1-port device = topology-impossible (block).
- **Loop detection**: a cycle in the L2 graph without RSTP = broadcast storm.
  Realistic: allow it, then SHOW the storm (packet log floods, comms die) —
  the single best networking lesson the sandbox could teach. Easy: block.
- Star-vs-bus misuse both directions is now catchable, per James's ask.

### 3. The AHU (both patterns)

**A. Packaged unit with terminals** (small lift, first):
- The G36 `vahu` node grows real terminal handles mapped to its sequence I/O:
  inputs OAT / MAT / DAT / ZN-T (AI), outputs SF-VFD (AO), OA-damper (AO),
  HW/CHW valves (AO), fan start (BO).
- Wiring a sensor/actuator to an AHU terminal rides the existing controller
  bridge pass (snapshots, truth table, mismatch rules — all reusable).
- Unwired terminals fall back to today's synthetic inputs (weather OAT, sim
  occupancy, wired-Zone temp), so existing demos keep working; wiring a
  terminal OVERRIDES the synthetic source. Teachable: wire a miscurved OAT
  sensor and watch the economizer lock out wrongly.

**B. Field-built split** (the richer story, second):
- `equipment`-kind AHU (fan + coils + damper assembly, dumb) with process
  links to the zone + signal terminals expecting actuator/sensor wiring.
- Any controller (FEC / JACE-hosted program / vahu-as-controller) wires to it.
- The G36 sequence becomes loadable PROGRAM content for a controller instead
  of being fused to the node — aligns with the SpecLang/program surface.

### 4. Gesture fix (slice 1, immediate)

- SvelteFlow loose connection mode (or equivalent): a network wire can start
  and end on ANY net handle; `onConnect` normalizes (canonical node-id order),
  dedupes A→B vs B→A, keeps one edge per device pair per trunk.
- in/out arrowheads disappear from network wires; process links keep them.

## Slices

| # | What | Size | Status |
|---|---|---|---|
| 1 | Undirected network wiring (gesture fix + dedupe + two-outputs guard + process-direction normalization) | S | ✅ code-complete (gesture needs James's manual drag check) |
| 2 | MS/TP bus rules: T-tap/star fault (wire-time + standing validator, verified live), EOL toggle + validator (verified live), zone/equipment MAC exclusion, "3 coupled VAVs" re-chained | M | ✅ shipped — repeater catalog device still TODO |
| 2b | RS-485 **ring** detection (found while testing: closing a chain into a loop isn't flagged yet — no degree-3 node, but a ring has no termination ends and is wrong wiring) | S | planned |
| 2c | **One engine per trunk** (James's find): 2+ supervisors on one MS/TP segment = `mstp.multiple-engines` error in the topology validator + wire-time fault (merged-component supervisor count). Verified live. Supervisor inspectors got the EOL toggle too (chain ends are usually engines — James's find). | S | ✅ shipped |
| 2d | EOL gets a SIM consequence — missing/extra termination injects frame errors that worsen with baud (today it's validator-only) | M | planned |
| 3 | IP port model: catalog `ethernetPorts`, 1-port daisy block, 2-port daisy lesson, L2 loop → broadcast storm | M-L | planned |
| 4 | AHU pattern A: terminals on the packaged G36 node | M | ✅ shipped + verified (AI-1..4 / AO-1..4 / BO-1 render + wire; AO/BO terminals drive actuators from live sequence state — verified OAD slewing to 100% in Economizer; AI-1/AI-4 sensors override synthetic OAT/zone temp via the bridge pass; role map in the AHU inspector). Exposed G40: vahu→zone air-side cooling is weak — slice-5 physics. **Note: shipping this introduced+fixed a CRITICAL restore bug** — styling edges during init read the `nodes` state pre-declaration (TDZ), the restore try/catch swallowed it, and every reload returned the EMPTY default canvas. TDZ guard + post-init restyle now; if you reloaded between those commits and lost canvas state, that was why. |
| 5 | AHU pattern B: equipment AHU + controller split; G36 as program | L | planned |
| 6 | Process-link visual class (duct/pipe styling, meaningful arrows) | S | planned |
| 7 | **Capture-point packet log** (James's design): the BACnet window models a real sniffer — pick WHERE you tap (a trunk, a switch port) and see only that segment's traffic; hidden/empty until a network actually runs. Cross-segment traffic appears only where it's genuinely on the wire (a BBMD-forwarded Who-Is shows on both segments), so the "meshed picture" emerges from routing instead of a global firehose. Teaches "where you clip the sniffer determines what you see." | M | planned |

## Real-network reference rig (James's idea, strongly endorsed)

The recurring bug class (dead IP COV, suppressed Who-Is, validator-vs-sim
contradictions) is CONVERSATION-level, which the byte-level 19,523-packet
corpus can't catch. Plan:

1. **bacnet-stack demo binaries** (prebuilt Windows): `bacserv.exe` = a real
   virtual BACnet/IP device. Run on 2+ spare machines + YABE as client +
   Wireshark (full BACnet dissector). → real Who-Is/I-Am/COV/RP sequences
   with real timing.
2. **BACpypes3 scripts** for scriptable devices (COV servers, a BBMD,
   deliberately-misbehaving devices). Claude writes them; James runs on LAN.
3. **Conversation fixtures**: feed those captures into `tools/bacnet-harness`
   so the sim's subscription/discovery dances are DIFFED against real stacks,
   not invented.
4. **Phase 2**: a small Node UDP↔WebSocket relay so the browser sandbox can
   join the real network as a discoverable BACnet device (the browser can't
   open UDP 47808 itself). Differentiator-grade feature.

## Compatibility notes

- Saved scenarios/demos store plain edges — slice 1 changes no schema.
- Slice 2's T-tap rule flags existing hub-spoke demo wiring; those demos get
  re-wired as real chains in the same slice (they were unrealistic anyway).
- The MS/TP token sim, byte codec, addressing, and L2/VLAN work all survive
  unchanged — this revamp is about the GRAPH rules, not the protocol engines.

## Related docs

- [NET_L2_VLAN_PLAN.md](NET_L2_VLAN_PLAN.md) — L2/VLAN modeling (shipped); the
  IP-side rules in slice 3 build on its broadcast-domain machinery.
- [GAPS_FROM_COLD_BUILD.md](GAPS_FROM_COLD_BUILD.md) — G34 (actuator on MS/TP)
  and the zone-OFFLINE / zone-MAC findings that exposed this design debt.
