# Next Session — Prep Notes

Last updated: 2026-06-10. Author: James + Claude.

## 🔖 Resume here — 2026-06-10 evening ("knock em all out" build sprint, ALL COMMITTED)

**Four commits landed** (`77ec882` → `2880987` → `1b58939` → `0559941`):
all prior uncommitted work + revamp slices **1, 2, 2b, 2c, 4, 6, 7** shipped,
tested (361/361 · typecheck 0 · build clean), and live-verified in preview.

- **Slice 4 (AHU terminals)** — the G36 AHU has a real terminal block now
  (AI-1 OAT / AI-4 ZN-T override synthetic inputs through the signal
  bridge; AO-1..4/BO-1 drive wired actuators from live sequence state —
  verified the Belimo damper slewing to 100% in Economizer). **A CRITICAL
  bug was introduced+caught during this slice:** restore-time edge styling
  hit a TDZ on `nodes`, the try/catch swallowed it, and every reload
  silently wiped the canvas to defaults. Fixed + guarded. If your canvas
  vanished mid-evening, that was it — apologies.
- **Slice 7 (capture-point packet log)** — James's sniffer design: hidden
  until traffic exists, auto-taps the first segment, "all segments" is an
  explicit omniscient opt-in.
- **Slice 2b (ring) + 2c (one-engine-per-trunk, supervisor EOL toggle)** —
  see WIRING_REVAMP_PLAN.md table for verification notes.

**Remaining (the two big ones + stragglers):** slice 3 (IP port model:
catalog `ethernetPorts`, 1-port daisy block, 2-port daisy lesson, L2 loop →
broadcast storm), slice 5 (equipment AHU + controller split; G36 as
loadable program; fixes G40 air-side physics), repeater catalog device,
2d EOL sim-consequence, real-network reference rig (bacnet-stack +
BACpypes3 scripts). Deploy + Netlify token rotation STILL pending.

## 🔖 Previous resume point — 2026-06-10 (walkthrough leg 2 + solo demo audit)

**Walkthrough findings (James driving, Realistic mode):** G33 trunk-panel
Delete clipped under Run (✅ fixed, wraps now), G34 actuator wired onto MS/TP
got a fake MAC + helper missed it (✅ fixed: field devices never take a MAC;
network-wire-to-actuator is now a flagged miswire — *James: one manual
wire-drag to confirm the flag*), G35 actuator picker grouped into
Dampers/Valves/VFDs/Relays with "start with a damper" hint (✅ verified).

**Solo demo-premise audit (all 13 demos):** found + fixed G37 (demo loads
leaked COV subs/trunk state/log/start-hour across topologies — caused ghost
packets AND silently killed Who-Is), G38 (validator called Annex-J
foreign-device registration an error), G39 (**all BACnet/IP COV notifications
were dead** — the firehose demo streamed zero; now 17 in the same window).
G36 logged: two occupancy schedules (per-target vs global) can contradict —
Conditions panel now shows both; unification is James's design call.
Details in GAPS_FROM_COLD_BUILD.md Step 11.

**Wiring revamp started (James's call: daisy-chain + rules, BOTH AHU
patterns, build now).** Design doc: [WIRING_REVAMP_PLAN.md](WIRING_REVAMP_PLAN.md).
- **Slice 1 ✅ code-complete** — `ConnectionMode.Loose` (wire net handles in
  EITHER gesture direction), net-pair dedupe ("one cable per device pair"),
  two-outputs/two-inputs terminal guard, and process-link direction
  normalization (zone→equipment / equipment→actuator gestures auto-swap to
  the flow-correct direction the thermal pass expects). *Needs James's manual
  drag verification — the harness can't synthesize xyflow drags.*
- **Slice 2 ✅ shipped + verified live** — the MS/TP bus is a real daisy-chain
  now: (a) **T-tap/star detection** — 3+ wires on a non-repeater device is an
  error in the standing topology validator (Check-my-work + Network pill,
  verified: "VAV-102 T-taps the RS-485 bus (3 wires)") AND a wire-time
  `fault` in validateWireCompat (Easy blocks the 3rd wire, Realistic lets it
  through tagged); (b) **EOL termination** — per-device "EOL on/off" toggle in
  the controller inspector, validated against the physical chain ends
  (verified live: mid-chain + missing both flag correctly; un-modeled trunks
  get one info-level hint, not a nag); (c) zones + equipment excluded from
  MAC assignment; (d) "3 coupled VAVs" demo re-wired hub-spoke → true chain
  with correct EOL flags (loads clean, MACs 0–3). Core: `mstpComponents()`
  extracted + `validateMstpTopology()` (6 new tests, 358/358).
  *Still TODO from slice 2:* repeater catalog device; **slice 2b (new):**
  RS-485 RING detection — discovered while testing that closing the chain
  into a loop isn't flagged (no degree-3 node, but a ring has no ends).
- **Slice 2c ✅ (James's walkthrough finds, verified live):** (a) **one engine
  per trunk** — two supervisors on one MS/TP segment is now
  `mstp.multiple-engines` (error; names both engines + explains the silent
  MAC-demotion) plus a wire-time fault that blocks/flags the wire that would
  merge them; (b) **supervisors got the EOL toggle** in the Network panel —
  James's chain ends were engines, which had no switch, so "EOL didn't seem
  to matter." Verified: flipping SNE10500's EOL on immediately flagged
  "Missing EOL termination at MACH-ProSys." EOL sim-consequence (frame
  errors at speed) logged as slice 2d.
- **New direction from James (in the plan doc):** slice 7 — capture-POINT
  packet log (pick where you tap; per-segment visibility; meshing emerges
  from BBMD/router forwarding, not a global firehose) + the
  **real-network reference rig** (bacnet-stack demo exes + BACpypes3 on his
  spare Windows boxes + Wireshark → conversation-level fixtures for the
  harness; phase 2 = Node UDP relay so the sandbox joins the real LAN).

**Validation:** 352/352 core tests · typecheck 0 errors · build clean.
**Still pending:** COMMIT (three sessions of work in the tree now — do this
first next session) + deploy + Netlify token rotation. Manual checks for
James: (1) wire supervisor↔AHU in BOTH gesture directions; (2) try a second
wire between the same pair → refused; (3) drag zone→equipment → edge lands
equipment→zone; (4) G34: MS/TP wire to an actuator → Easy refuses /
Realistic flags in Check-my-work. Walkthrough then resumes: close the
thermal loop (AHU→zone duct + equipment chain), VAV-2/3 multi-drop.

## 🔖 Resume here — 2026-06-09 session 2 (backlog burn-down, uncommitted)

**Built this session (all in working tree, NOT yet committed):**
- **G25-full** — Realistic mode lets a wrong-kind output wire (analog actuator →
  BO etc.) land untagged-warned, stashed on `edge.data.miswire`; Easy keeps the
  auto-shift. *Needs one manual wire-drag confirmation in the browser.*
- **G26** — actuator position feedback end-to-end: actuator → AI emits 2–10 V
  position (Terminals truth-table row + `env.inputs.fb_<label>`), "stuck" fault
  injection on the actuator inspector, Check-my-work reports "commanded but
  didn't move". Verified live.
- **G27** — 🌤 Conditions panel on the run toolbar: OAT (From weather ↔ Manual
  slider, persisted, overrides every consumer) + live time/occupancy. Verified
  live (95 °F manual flipped the G36 demo to Cooling w/ econ lockout).
- **G28** — AHU inspector: self-description + live sequence state (mode, SAT sp,
  damper/valves/fan, OAT/RAT/MAT/DAT) + G36 config chips. Verified live.
- **Bug fixes found while testing:** G30 `T_zone_init` ignored (economizer demo
  premise never ran — now fixed + verified), G31 occupancy-schedule copy drift
  (actual schedule is 06:00–19:00), `vahuPrevInputs` made reactive.
- **New gap logged:** G32 — generic controllers render no terminal handles →
  auto-shifted edges (AO-1 etc.) are invisible on canvas though the sim uses them.

**Validation:** 351/351 core tests · UI typecheck 0 errors · prod build clean.
**Still pending:** commit + deploy (actuator-parity `75379d7` is ALSO still
undeployed — both go out together; rotate the Netlify token first). Remaining
backlog: decision guidance (G1/G3/G10/G13), G11 polish, G32, AHU config editing.

## 🔖 Previous resume point — 2026-06-09 (cold-build dogfooding)

**How we're working:** James role-plays a *newbie BAS tech* building a site from
an empty canvas; Claude guides step-by-step and logs every place the tool
assumes knowledge / confuses / can't do the realistic thing. Every finding is in
[GAPS_FROM_COLD_BUILD.md](GAPS_FROM_COLD_BUILD.md) (G1–G29). The site under
construction is **"Suite 200"** — one rooftop AHU w/ economizer + 3 VAVs w/
hydronic reheat. Two guidance modes drive the teaching: **Easy** (blocks
mistakes + shows omniscient hints) and **Realistic** (field-like — no warnings;
diagnose it yourself, ask the local AI, or hit "Check my work").

**Shipped to prod this arc** (live at https://sandbox.velovaultllc.com):
- Easy/Realistic guidance modes; allow-and-flag miswiring; Check-my-work; self-loop guard.
- Nickel RTD (Ni1000) end-to-end; sensor "element fixed by the device" + grouped generic picker.
- Terminals "truth table" (Installed vs Programmed, Easy-only) + populates before Run.
- L2 switch + VLAN core validator + Ethernet Switch node.
- IP-field affordance + live red/green validation; weather OAT now reaches AHU/zones; Assistant panel clamp; always-visible in/out handle tags; "Terminal"→"Programming"; README brought current.
- **Committed but NOT yet deployed:** actuator parity — inspector + model picker + Delete + fixed-by-device specs (commit `75379d7`).

**Canvas state we left off at** (the in-progress Suite 200):
- `JACE-RTU` (Tridium JACE 8000) — carries a *deliberate teachable defect*: gateway on the wrong subnet (10.1.10.x with gw 10.0.1.1) → the "Network: 1 err" pill.
- `VAV-1` (Distech ECY-VAV) on MS/TP to the JACE, with a BAPI Pt1000 zone sensor wired in.
- `AHU-1` (G36 §5.18) on MS/TP to the JACE; responds to the Weather-drive OAT + sim-clock occupancy.

**Pick the newbie walkthrough up here** (each step is likely to surface gaps):
1. **Close the thermal loop** — drop a Zone, wire AHU/VAV into it, watch room temp track OAT/occupancy.
2. **Wire VAV-1's outputs** — actuators are real now: damper + reheat-valve → see AO behavior, then close the loop.
3. **Add VAV-2 / VAV-3** on the MS/TP trunk — multi-drop addressing + trunk inspector.
4. **Program a controller** (SpecLang / `>_ Programming`) — the logic surface, still untested (James flagged wanting help here).
5. **Run + watch** the BACnet packet log + conformance.

**Build backlog (prioritized, from the gap log):**
- **G25-full** — Realistic-mode AO/BO "force the wrong output kind + flag it" (mirror of the sensor terminal mismatch).
- **G26** — model actuator position feedback (actuator → AI + "commanded but didn't move" fault).
- **G27** — unified **Conditions box** (OAT + occupancy/time in one place; today scattered across the Weather tab + sim clock).
- **G28** — AHU node inspector / self-description (it drops as an opaque box).
- **Decision guidance** (G1/G3/G10/G13) — "recommended" defaults + explainers in the model pickers (the recurring "beginner can't choose" theme).
- **G11** — non-uniform separator-line polish.

**How to resume:** dev server at `localhost:5173` (`pnpm --filter @bas/ui dev`, or the preview "ui" config — root `.claude/launch.json` has it). To deploy: `pnpm --filter @bas/ui build` then `netlify deploy --prod --dir=packages/ui/dist --filter @bas/ui --site=602708bc-b819-4afd-9cad-f275d19f9106` (⚠️ rotate the previously-pasted Netlify token first).

---

## Historical — 2026-05-22 session

## What shipped today (one-window summary)

Network-layer protocol fidelity + local LLM assistant + custom domain.
All 101 tasks tracked are complete or explicitly deferred. Live at:

```
https://sandbox.velovaultllc.com
```

| Session | What | Status |
|---|---|---|
| N.1c | BACnet discovery (Who-Is / I-Am) + WriteProperty + Trunk Inspector | ✓ |
| N.1d | MS/TP validator (duplicate MAC, range, supervisor count, overload) | ✓ |
| N.1e | Global Network Health pill | ✓ |
| N.1f | BACnet/IP subnet validator (duplicate IP, subnet mismatch, mask, gateway) | ✓ |
| N.2a | COV subscriptions replace round-robin polling | ✓ |
| N.2b | Realistic request/response latency (baud-derived RTT) | ✓ |
| N.2c | Timeout + retry + Communication-Lost on broken trunks | ✓ |
| N.3b | Local Ollama LLM assistant panel + system prompt | ✓ |
| infra | `sandbox.velovaultllc.com` custom domain + COEP removal | ✓ |
| infra | Native Ollama install + Vulkan GPU acceleration on RX 9070 | ✓ |

Numbers: 164 core unit tests passing, 0 typecheck errors, ~102 tokens/sec LLM inference on the RX 9070 (was ~25 on CPU).

## Pending / known-soft

- **LLM voice quality**: small (7-14B) instruction-tuned models can't be prompt-engineered into the tight "senior tech voice" we want for the BAS Auditor product. Content quality is good; format keeps reverting to bullet-list textbook prose. Real fix is JSON structured output (next session N.3c).
- **OpenPLC runtime (N.3a)**: deferred. Docker shim that runs real IEC 61131-3 programs as a replacement for the JS-interpreted ST. Plumbing scoped; not started.
- **dbexport scanner (task #92)**: still pending. All the building blocks now exist (validators, LLM, parser). Two-session lift to ship as a focused tool.

## Three next-session candidates (pick by mood)

### A — N.3c · Structured LLM output (small, high-leverage)

Switch the assistant from free-form prose to JSON output. Model produces:

```json
{
  "likely_cause": "AI:1 has no Point Assignment binding...",
  "evidence": ["AI:1 = 0.00 in ReadProperty-ACK", "Bindings: (none)"],
  "first_check": "Open Point Assignment, bind a sensor role to UI-1.",
  "severity": "info | warn | error"
}
```

UI renders that as a fixed card. Eliminates the prompt-engineering arms race against verbosity. ~1 session of work; cleanest output we'll get without going to 70B+ models.

### B — N.3a · OpenPLC runtime Docker shim (medium, federal-pitch)

Real IEC 61131-3 runtime in a container; sandbox programs actually execute on real-deal OpenPLC. Stronger story for federal evaluators. ~2-3 sessions to ship cleanly.

### C — Network-layer virtualization (large, novel ground)

User-raised idea (deserves its own section below). VLANs, virtual routers, BBMDs, network segmentation. Real differentiator vs every other BAS training tool. ~3-5 sessions but absorbed in chunks.

## New idea raised tonight — Network virtualization layer

**The pitch (from James):** real BAS techs/HVAC technicians don't understand the network side. Adding VLANs + virtual routers + BACnet/IP routing to the sandbox would teach the IT/OT bridge that techs typically learn only by getting burned in the field.

**Why this is actually a brilliant differentiator:**

- No other BAS training tool teaches network architecture this way (Niagara training assumes you know it; Metasys docs gloss over it).
- BACnet/IP is the growing backbone — every new commercial install, every data center HVAC system. Techs who only know MS/TP get cornered when promoted to higher-end jobs.
- The IT/OT convergence is the #1 stress point in modern BMS work. Techs need a sandbox where they can break a VLAN and see what happens *before* doing it on a customer site.
- BBMD config is famously brittle and famously misconfigured. A visual "BBMD here, broadcast forwarded there" model would be a real teaching tool.

### Network virtualization — scoped sessions

| Phase | What |
|---|---|
| Net.1 | Subnet "zones" on the canvas (visual containers with their own CIDR) |
| Net.2 | IP-layer validator extends to BBMD + cross-subnet routing checks |
| Net.3 | Virtual router node (drag onto canvas, configures static routes) |
| Net.4 | BBMD node — bridges BACnet broadcasts between subnets |
| Net.5 | Packet-log shows packets being routed / blocked / NAT'd / dropped at firewalls |
| Net.6 | Demo scenarios: "BBMD missing → controllers can't discover each other", "VLAN segregation isolates BMS from corporate", "Firewall blocks 47808/UDP → silent comms failure" |

## Open product questions for James to chew on

These are the questions worth thinking about between sessions — not technical, not for me to answer, just things that shape the BAS Auditor product path:

1. Who at a federal site actually BUYS BAS-tech tools? Facility manager? In-house controls engineer? GSA contractor? End-user pays vs. installing-contractor pays?
2. What are existing FDD tools priced at? Clockworks, BrainBox, KGS Buildings — per site / per controller / per square foot?
3. What's the #1 thing a BAS commissioning agent wishes they had on the truck, that doesn't exist today?
4. Of the 4-5 most common BAS commissioning failures, which ones would the validator + LLM combo prevent vs only diagnose?
5. SDVOSB sole-source ceiling is $5M. What's the largest single deliverable you could sell at that ceiling without becoming a multi-person company?

## Honest meta — quality of the questions James has been asking

These have been good. Specifically:
- Intuited the right product (local-LLM + audit) without prompting.
- Spotted the false-positive validator (no-supervisor warning on a router-bridged trunk).
- Flagged real personal pain points (subnet/IP misconfiguration he's done himself).
- Pushed for protocol realism (latency, retry, comm-lost) rather than letting the sandbox stay toy-grade.
- Identified the IT/OT gap in BAS-tech training (tonight's network-virtualization idea).

What's missing — and worth investing in between sessions:
- Customer-discovery questions (who buys, why, what they'd pay).
- Competitive landscape (what specifically do Clockworks / BrainBox / Switch Automation NOT solve).
- Distribution channel questions (federal vs commercial; direct vs through controls contractor).
- The "what would you sell first" question — pick one customer profile and stay laser-focused.

## Industry-context primer (for future sessions)

### BACnet/IP vs MS/TP — the real industry split

Both, hybrid is the norm:
- **Backbone**: BACnet/IP — JACEs, NAEs, supervisors, BACnet routers. 10/100/1000 Mbps Ethernet.
- **Field level**: MS/TP — VAVs, FCUs, exhaust fans, lighting controllers. RS-485 at 38400 baud, daisy-chained off an FEC/JACE.
- **Why the split persists**: pulling Cat6 to every VAV is expensive; RS-485 is $0.20/foot of two-conductor + shielded.

New construction (data centers, hospitals, big office) overwhelmingly: BACnet/IP backbone + MS/TP downstream. Pure BACnet/IP all the way to the VAV exists but is premium-priced.

### Wireless — adoption is slow but real

- **BACnet/SC** (Secure Connect) — newer secure-by-default spec, gaining traction
- **BLE / Zigbee mesh** — common for retrofit sensor adds (Lutron, Enlighted)
- **LoRaWAN** — wide-area low-bandwidth (parking, water meters)
- **Wi-Fi BACnet** — exists but uncommon in new construction
- Wireless is mostly RETROFIT territory (avoiding cable pulls in existing buildings)

### Data center specifics

Data centers are their own world:
- BACnet/IP for HVAC + UPS monitoring
- Modbus TCP for power monitoring
- SNMP for everything network
- Proprietary DCIM systems (Schneider EcoStruxure, Vertiv, etc.) on top
- They CARE about network segregation — VLANs separating BMS from server traffic
- Cybersecurity reviews are intense
- Building automation reports up to IT Operations, not Facilities

This is where the network-virtualization idea has the most teeth — data center technicians genuinely need to understand VLAN routing and they currently have nowhere to practice.
