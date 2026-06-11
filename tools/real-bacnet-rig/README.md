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

## START HERE — the two-machine minimum lab (~20 min)

What `bacserv` makes a laptop into: a real BACnet **device**, not a
controller — perfect protocol behavior (discovery, points, COV, writes
with priorities) with no HVAC brain behind the points. For pinning wire
behavior, that's everything.

1. **Laptop:** unzip bacnet-tools → Command Prompt in that folder →
   `bacserv 1001` → leave running. *Gotcha:* Windows Firewall can silently
   drop packets without prompting for console apps — if discovery fails,
   add an inbound allow rule for UDP 47808.
2. **Desktop:** Wireshark on the LAN interface, capture filter
   `udp port 47808`, leave rolling.
3. **Desktop:** YABE → add BACnet/IP channel → Who-Is goes out → device
   1001 appears. You now have a real BACnet network.
4. **YABE:** read points → right-click an AI → Subscribe → write a value
   (the priority prompt = the priority array, live).
5. **Wireshark:** save the capture to `wireshark/lab1-first-contact.pcapng`.
   Ground truth #1.

This covers recipes 1–4 below (for timeout/retry: kill bacserv mid-poll).
Everything after this section is just MORE DEVICES — same method.

### Firewall & network checklist (nothing gets DISABLED)

- Every machine (YABE host and bacserv hosts alike) needs inbound UDP
  47808 allowed: click Allow (Private) on the Windows prompt, or run as
  admin:
  `New-NetFirewallRule -DisplayName "BACnet/IP" -Direction Inbound -Protocol UDP -LocalPort 47808 -Action Allow -Profile Private`
  (Why: Who-Is goes out as broadcast but I-Am / COV notifications come
  back UNICAST — the stateful firewall won't match those as replies.)
- Network profile = **Private** on every Windows machine (a LAN classified
  Public blocks inbound regardless of app rules).
- Same LAN for everything: no guest SSID (separate subnet = invisible,
  broadcasts don't route), and beware router/mesh **AP/client isolation**
  which blocks wireless peers from each other — the classic "firewall's
  open but nothing appears" culprit. Ethernet sidesteps it.
- Wireshark needs nothing — passive capture.
- **G51 refined (late-night finding):** even with clean bindings — both
  apps holding 47808, no squatters — the .NET (YABE/RoomSim) stack runs its
  ESTABLISHED sessions on each app's secondary ephemeral socket
  (observed: 64353↔51844 carrying all notifications/renewals while both
  47808 sockets idle). Broadcasts ride 47808; conversations don't. So:
  **capture by HOST, not port** (`host <device-ip>` capture filter, no
  port), watch live with `udp && ip.addr == <ip>`, and use Decode As → BVLC
  (or tshark `-d udp.port==NNAS,bvlc`) at analysis time. The `bacnet`
  display filter alone will always lie to you with this stack.
- **Instance roulette (2026-06-10's recurring trap):** YABE's Room Simulator
  rolls a RANDOM device instance every launch. Subscriptions bind to an
  instance → every sim restart orphans every subscription row, which then
  sits in YABE showing confident stale values (we fell for this 3×). bacserv
  doesn't have this problem (instance is a fixed CLI arg). Real sites mandate
  STATIC device instances for exactly this reason — teachable moment AND lab
  rule: prefer bacserv for repeatable captures; re-subscribe after any sim
  restart; always sanity-check the Time column.

## Dedicated lab router (James's plan — next session)

A small router/AP serving ONLY the lab machines. Benefits: isolation from
the home mesh (no AP-isolation surprises, no family traffic), DHCP control
→ **static reservations** for every lab box (kills IP roulette), and it's
the hardware for phase-B (second subnet / BBMD recipe). Setup checklist —
every item below is a trap we already hit once on the home network:
1. Connect desktop + laptop(s); give each a **DHCP reservation** (or static
   IP) and write them in this file.
2. On EVERY machine, first thing: `Get-NetConnectionProfile` →
   `Set-NetConnectionProfile -NetworkCategory Private` (new network = new
   profile = defaults to Public = silent firewall wall).
3. Firewall rules are profile-scoped but ours are Private-wide — they carry
   over once the profile is Private. Verify UDP 47808 + ICMP + SSH (22).
4. Update the SSH target IP in the lab notes; first connect re-prompts for
   the host key (new IP).
5. Re-run the two-machine smoke test (START HERE section) before any
   recipe.

Status 2026-06-10: lab router deployed (192.168.100.0/24, produced lab5) but
**power-cycles mysteriously** — suspect the wall-wart first (swap for any
matching-voltage, equal-or-higher-amperage adapter), then heat. Plan B is a
VLAN on the main router — **guest-network trap:** consumer routers' "guest
SSID" ships with client isolation ON, which blocks exactly the
device-to-device traffic the lab needs. Verify a real VLAN or an "allow
clients to see each other" toggle before relying on it. Note: remaining
recipes (TTL ghost, priority array) run fine on the main LAN — isolation is
only load-bearing for phase-B.
- **CHECK THE PROFILE FIRST (learned the hard way, 2026-06-10):** run
  `Get-NetConnectionProfile` on EVERY machine before anything else. Both
  lab boxes turned out to be **Public** — meaning every `-Profile Private`
  firewall rule above had silently applied to NOTHING, and the lab "worked"
  only via fragile per-app prompts until it didn't. Fix (admin):
  `Set-NetConnectionProfile -Name '<profile>' -NetworkCategory Private`.
- **Ping is NOT a liveness test** between Windows boxes — ICMP echo is
  dropped by default even on Private. Either add
  `New-NetFirewallRule -DisplayName 'ICMPv4-In (lab)' -Protocol ICMPv4 -IcmpType 8 -Direction Inbound -Action Allow -Profile Private`
  on every machine, or test liveness with actual BACnet traffic (a tshark
  sniff beats ping). Several "the device is asleep" diagnoses were really
  "nobody answers ping ever."

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

## Tier 2 — scriptable devices: BACpypes3 (Python) — ✅ LIVE (2026-06-10)

`pip install bacpypes3` (verified 0.0.106, Python 3.12/3.13). Two scripts
in this folder, both conformant (anchored on UDP 47808, fixed instances —
none of the .NET stack's ephemeral-port quirks):

- **`vctrl.py`** — virtual controller with scripted ("B.S.'d") sensors:
  ZN-T (AI:0) drifts on a sine + wiggle, OAT (AI:1) on a slow sine, both
  covIncrement 0.5. Deployed to the laptop at `C:\baslab\vctrl.py`, run:
  `python vctrl.py --name BAS-VCTRL-1 --instance 9001 --address <ip>/24`
- **`vclient.py`** — the YABE bypass: one-shot discover → read → hold a
  COV subscription and print notifications.
  `python vclient.py --name BAS-CLIENT --instance 9100 --address <ip>/24 --device-address <device-ip> --seconds 90`

Verified end-to-end: who-Is/i-Am, ReadProperty, SubscribeCOV → clean
~0.5° COV steps as the scripted sine descends. **Remote ops pattern:** the
device runs under a long-lived SSH session from the desktop (process lives
as long as the session; output streams back for live debugging) — Windows
scheduled tasks proved unreliable for GUI/console spawning post-reboot.

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
