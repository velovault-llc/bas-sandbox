# Site Director — supervisor GUI arc (idea: James, 2026-06-10)

> "a basic site director to connect engines to, with its own dedicated GUI.
> The idea being that you can program things through there, adjust COV's and
> other things you would need to do in an IRL situation."

Status: **queued** (after the wiring-revamp tail: slices 3 + 5). This doc
scopes it so the idea doesn't evaporate.

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

| Phase | Scope |
|---|---|
| SD.1 | Designate-site-director role + the tab + live point tree (browse only). Every refresh visibly polls (ReadProperty/RPM packets). |
| SD.2 | Command dialog: WriteProperty with **priority array** modeling on every commandable object (AO/AV/BO/BV), release/relinquish, "in control" indicator. |
| SD.3 | COV increment editing per object → re-subscribe on the wire; per-object subscription list view. |
| SD.4 | Trends (the sample history already exists per target), schedules (the occupancy schedule objects), alarm console (alarms already fire — give them ack/state). |
| SD.5 | Program download: deploy a SpecLang/ST program from the site director to a controller; transfer visible as traffic. |

## Open questions for James

1. Dedicated ADS/server node in the catalog, or "any engine can be
   promoted to site director" (Metasys allows both)?
2. Easy/Realistic split: does Realistic hide the omniscient canvas values
   while the site director is open (you know only what the supervisor
   polls)? That could be the strongest realism lever in the whole tool.
3. How JCI-flavored should the GUI read? (Vendor-neutral layout that
   *rhymes* with Metasys/Niagara probably safest.)
