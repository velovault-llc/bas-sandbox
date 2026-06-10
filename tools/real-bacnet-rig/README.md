# Real-BACnet reference rig — pinning exact behavior

Goal (James, 2026-06-10): *"I just really want to pin down exact bacnet
behavior if possible."* This rig runs REAL BACnet stacks on spare Windows
machines on the LAN, captures the conversations with Wireshark, and feeds
them into `tools/bacnet-harness` as conversation-level fixtures — so the
sim's discovery/poll/COV dances are diffed against reality instead of
invented.

Why: every behavior bug found this week (dead IP COV, suppressed Who-Is,
FD-registration false-positive) was CONVERSATION-level. The 19,523-packet
corpus pins byte encoding; it can't pin behavior. Real devices can.

**Scope caveat:** a software rig pins **BACnet/IP** behavior. Real MS/TP
timing requires RS-485 hardware (USB-485 dongles + MS/TP devices). Until
then, MS/TP stays spec+corpus validated.

## James's fleet → lab topology (planned 2026-06-10)

| Box | Role |
|---|---|
| Desktop (Win · Ryzen 7600 · 32 GB · RX 9070) | **Operator**: YABE + Wireshark + the sandbox, side-by-side sim-vs-real |
| ThinkPad T15p Gen 3 (i7-12700H · 32 GB · 2 TB) | **Device farm**: 2–3 Hyper-V VMs, BRIDGED networking, one `bacserv` each (distinct IP/MAC per device — broadcasts behave honestly). ⚠ buy the 135 W slim-tip AC first |
| Spare laptop (16 GB) | One bare-metal `bacserv` + the **sacrifice node** for the timeout/retry recipe (gets killed mid-poll) |
| Mac mini | **Scripted device** home (BACpypes3 via pip) — the ramping sensor that forces COV cadence |
| Desktop's Ubuntu drive | Reserve: **phase-B multi-subnet lab** via Linux network namespaces (two subnets + router + BBMD on one machine, real UDP stacks) |

**Phase A (flat LAN, zero purchases):** everything on the home network →
covers recipes 1–4. Expect 4–6 discoverable devices in YABE.
**Phase B (two subnets, recipe 5 BBMD/FD):** either boot the Ubuntu drive
(netns topology, desktop unavailable as Windows operator that session —
drive from the T15p) or a ~$25 travel router for a live second subnet.
Decide at phase-B time.

Lab-night checklist (phase A):
1. T15p: enable Hyper-V, 2 tiny Win/Linux VMs on an External (bridged)
   vSwitch, `bacserv 1001` / `bacserv 1002`, UDP 47808 allowed in firewall.
2. Spare laptop: `bacserv 1003`, firewall open.
3. Mac mini: `pip install bacpypes3` (scripts written live that night).
4. Desktop: YABE discovers all of them; Wireshark capture `udp port 47808`;
   run the capture recipes below in order, save each pcap to `wireshark/`
   with a README line.

## Tier 1 — zero-code (one evening): bacnet-stack demo binaries

⚠ The GitHub repo's Releases page is EMPTY (James hit this) — the project
predates GitHub and publishes its prebuilt Windows binaries on SourceForge:
**https://sourceforge.net/projects/bacnet/files/bacnet-tools/** → newest
folder (1.4.1 as of 2026-06) → `bacnet-tools-1.4.1.zip` (~10 MB). Verified
present. (Source lives at github.com/bacnet-stack/bacnet-stack if we ever
want to build custom behavior; the zip also ships `mstpcap` — the MS/TP
sniffer for the future RS-485-dongle phase.) The important tools:

| Tool | What it is |
|---|---|
| `bacserv.exe` | A complete virtual BACnet/IP **device** (AI/AO/AV/BI/BO/BV objects, COV support). `bacserv 1234` = device instance 1234. |
| `bacwi.exe` | Who-Is client — watch real discovery. |
| `bacrp.exe` / `bacwp.exe` | ReadProperty / WriteProperty clients (`bacwp` exercises **priority arrays** against a real stack). |
| `bacepics.exe` | Dumps a device's full object/property picture. |

Setup:
1. Machine A + Machine B: unzip tools, run `bacserv <instance>` on each
   (different instances). Allow UDP 47808 through Windows Firewall.
2. Machine C (or A): [YABE](https://sourceforge.net/projects/yetanotherbacnetexplorer/)
   as the supervisor-ish client — discover both, subscribe COV, read/write.
3. Wireshark on any of them: capture filter `udp port 47808`, display
   filter `bacnet || bvlc`. The BACnet dissector decodes everything.

## Tier 2 — scriptable devices: BACpypes3 (Python)

`pip install bacpypes3` — scriptable real devices for behaviors Tier 1
can't stage on demand: a sensor that ramps (forces COV cadence), a device
that ignores re-subscription (TTL expiry behavior), a BBMD + a foreign
device registering through it. Scripts live in this folder as they're
written (next session, iterated live against the LAN — BACpypes3's API
moves; write them with the rig running, not blind).

## Capture recipes — the behaviors we actually want pinned

Each recipe = one pcap checked into `wireshark/` with a one-line README
entry. Priorities, highest first:

1. **COV lifecycle**: YABE subscribes to `bacserv` AI with a lifetime →
   capture SubscribeCOV/ACK, notifications as the value changes, the
   RE-subscription before TTL, and what happens when the subscriber just
   stops (does the device keep notifying? for how long?).
2. **Who-Is / I-Am**: full I-Am field contents (device id, max-APDU,
   segmentation, vendor id — fixes the standing conformance ⚠ when we do
   the structured-PDU migration), and real client retry cadence.
3. **WriteProperty + priority array**: `bacwp` at priority 8, then 16,
   then relinquish → exact wire shapes + Present_Value behavior. Feeds the
   SITE_DIRECTOR_PLAN.md SD.2 work directly.
4. **Timeout/retry**: kill `bacserv` mid-poll → how a real client times
   out, retries, backs off (vs our APDU_TIMEOUT_S=3 / 3-retry guess).
5. **BBMD + FD**: two subnets (or simulated via second NIC/VLAN), BBMD on
   one, YABE as foreign device → Register-Foreign-Device TTL + re-reg
   cadence, Forwarded-NPDU on both segments (validates the slice-7
   capture-point model with real traffic).

## Feeding the harness

`tools/bacnet-harness` currently replays single-packet byte fixtures. The
extension (scoped, not built): a conversation fixture = ordered pcap-derived
exchange (service, direction, Δt, key fields) the harness replays against
the sim's emitters and diffs. Start with recipe 1 (COV lifecycle) — it's
the one the sim got wrong silently.

## Phase 2 (the differentiator)

A small Node relay (UDP 47808 ↔ WebSocket) so the BROWSER sandbox joins
the real LAN as a discoverable BACnet device — YABE on a real machine
discovering a virtual JACE in a browser tab. Big demo energy for the
federal pitch; scoped after the rig exists.
