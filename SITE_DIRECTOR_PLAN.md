# Site Director — supervisor GUI arc (idea: James, 2026-06-10)

> "a basic site director to connect engines to, with its own dedicated GUI.
> The idea being that you can program things through there, adjust COV's and
> other things you would need to do in an IRL situation."

Status: **ready to build** — design calls answered 2026-06-11 (below).
Does NOT need to wait for slices 3 + 5: SD.1/SD.2 are orthogonal to the IP
port model and the equipment split; interleave by session mood.

## Why this is the right next big arc

The sandbox today is the OMNISCIENT view — you see everything from above.
A real tech works through the **supervisor UI** (Metasys Site Director /
Niagara Workbench): point tree, commands, trends, schedules, alarms. That
workflow IS the job; the sandbox can't teach it yet.

**Design law for the whole arc: everything the GUI does emits real
packets.** Command a setpoint → WriteProperty (with priority) on the trunk,
visible in the capture window. Edit a COV increment → SubscribeCOV
re-issues. The GUI is a packet generator observed by the sniffer we already
built — UI actions become wire lessons automatically.

## What it drags in (and why that's good)

- **Priority arrays** — 16 slots, command/relinquish, "why won't my point
  release." The biggest unmodeled BACnet concept; every tech learns it the
  hard way. The site director's command dialog is the natural teacher.
- **WriteProperty / WritePropertyMultiple** on the wire (today the sim
  emits WriteProperty only in one path).
- **COV increment editing** per object (today fixed 0.5 °F deadband).
- **Program download flow** — program in the tool, download to the
  controller, watch the transfer. The existing `>_ Programming` surface
  (ST / SpecLang / FBD) becomes content the site director deploys, which
  is exactly the CCT / Workbench shape.

## Modeling

- Metasys-accurate: **Site Director is a ROLE on a node** — designate an
  engine (or a dedicated ADS/server node, new catalog entry) as site
  director. Engines connect to it over BACnet/IP.
- The GUI itself = a new top-level tab ("Site Director" next to Build /
  dbexport). Inside: a point tree built from the same discovery + object
  synthesis the sim already runs (devices it can reach → their BacnetObjects).
- Unreachable device in the tree = stale/grey — reachability teaching
  carries straight over.

## Phasing

**Architectural keystone (build first, in SD.1): the supervisor knowledge
store.** A first-class model of "what the supervisor actually knows" —
per-device object lists, last-known values, HOW it knows each one (polled
vs COV), and staleness. Today that knowledge is implicit in BuildCanvas
locals. Extracting it (a) feeds the point tree, (b) keeps the Site
Director a NEW surface reading a store instead of growing the 10k-line
BuildCanvas, and (c) is exactly what field view needs — after the
2026-06-11 COV lease work, an expired subscription leaves a visibly stale
value sitting in the tree with its age. The TTL ghost becomes an
experience instead of a log line. (G42 — point names in summaries — also
lands naturally here as supervisor-resolved display.)

**Rig tie-in:** capture the PRIORITY ARRAY recipe on the lab rig BEFORE
building SD.2, same ground-truth-first playbook that paid off for COV
(G47–G51).

| Phase | Scope |
|---|---|
| SD.1 | Site-director designation (BOTH paths: promote-an-engine toggle + dedicated ADS/server catalog node) + the tab + supervisor knowledge store + live point tree (browse only). Every refresh visibly polls (ReadProperty/RPM packets). |
| SD.2 | Command dialog: WriteProperty with **priority array** modeling on every commandable object (AO/AV/BO/BV), release/relinquish, "in control" indicator. |
| SD.3 | COV increment editing per object → re-subscribe on the wire; per-object subscription list view. |
| SD.4 | Trends (the sample history already exists per target), schedules (the occupancy schedule objects), alarm console (alarms already fire — give them ack/state). |
| SD.5 | Program download: deploy a SpecLang/ST program from the site director to a controller; transfer visible as traffic. |

## Design calls — answered by James, 2026-06-11

1. **Node model: BOTH in SD.1.** Promote-an-engine role toggle AND a
   dedicated ADS/server catalog node from the start (Metasys allows both;
   small site = engine is site director, big site = ADS). The ADS node is
   a supervisor variant in the catalog — engines connect to it over
   BACnet/IP.
2. **Field view: YES, as a toggle inside Realistic.** When on, canvas node
   values grey out and the point tree shows only what the supervisor
   knows — last-known values with staleness + source (polled vs COV).
   Not forced, so demos and Easy mode stay friendly. This is the
   strongest realism lever in the tool; the supervisor knowledge store
   (above) is its data spine.
3. **GUI flavor: vendor-neutral that rhymes.** Nav tree left, detail
   right, command dialog with 16 priority slots — anyone who's used
   Metasys/Niagara recognizes the shape, but terminology stays generic
   (BACnet-standard terms are vendor-neutral anyway). No trade-dress
   risk; fits the federal vendor-neutral training angle.
