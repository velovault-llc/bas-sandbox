# Next Session — Prep Notes

Last updated: 2026-05-22 evening. Author: James + Claude.

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
