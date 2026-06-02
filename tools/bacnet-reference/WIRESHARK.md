# Wireshark + BACnet — ground-truth capture guide

This is the wire-byte view that pairs with the bacpypes3 reference device. Once you can capture and read BACnet frames, every claim our sandbox makes ("we emit I-Am with these fields") can be verified against the actual on-the-wire encoding.

## Why bother

bacpypes3's `whois_client.py` tells us what bacpypes3 *thinks* it's sending. Wireshark shows what *actually* went on the wire. Almost always the same; occasionally not. For federal credentialing the wire bytes are the source of truth — "the spec says this hex sequence; that's what our sim emits."

You don't NEED Wireshark for everyday work — `deep_capture.py` shows the APDU decoded + hex. But Wireshark gives you the full layer cake (Ethernet → IP → UDP → BVLC → NPDU → APDU), which is what shows up in a real install's diagnostic.

## Install

1. Download: https://www.wireshark.org/download.html — pick Windows x64 installer (the most recent stable, e.g. 4.4.x).
2. Run the installer. **When prompted about Npcap**, accept the default install — Npcap is what lets Wireshark capture from your network adapter.
3. After install, log out of Windows and back in (Npcap driver needs a session restart). Reboot if you skip the relog and something looks off.

## First capture

1. Open Wireshark.
2. Pick the capture interface — the active one is the one showing live traffic in the little waveform. Usually `Ethernet` or `Wi-Fi`. If you see `Loopback` listed, that's only for traffic to/from 127.0.0.1 — BACnet broadcasts don't go through loopback, so pick the real adapter.
3. Hit the blue shark-fin icon to start capturing.
4. Type `bvlc` in the green display-filter bar (top of window) and hit Enter. This filters to BACnet Virtual Link Control — the protocol that wraps every BACnet/IP frame.

You should see nothing initially. Now generate some traffic:

```
cd C:\dev\bas-sandbox\tools\bacnet-reference
python bacserv.py        # in one terminal
python whois_client.py --target 192.168.1.150   # in another
```

Wireshark should immediately show two frames: the Who-Is going out from the client, and the I-Am coming back from the server.

## What to look for in an I-Am frame

Click the I-Am row. The detail pane (middle of the screen) decomposes the layers:

```
▶ Frame N: 60 bytes on wire
▶ Ethernet II
▶ Internet Protocol Version 4
▶ User Datagram Protocol, Src Port: 47808, Dst Port: 47809
▶ BACnet Virtual Link Control
  ▶ Type: BACnet/IP (Annex J) (0x81)
  ▶ Function: Original-Unicast-NPDU (10)
  ▶ Length: 26
▶ Building Automation and Control Network NPDU
  ▶ Version: 0x01 (ASHRAE 135-1995)
  ▶ Control: 0x00
▼ Building Automation and Control Network APDU
  ▶ APDU Type: Unconfirmed-REQ (1)
  ▶ Service Choice: i-Am (0)
  ▶ Object Identifier: device, 1234
  ▶ Maximum ADPU Length Accepted: (1024)
  ▶ Segmentation Supported: segmented-both (0)
  ▶ Vendor ID: Cimetrics, Inc. (15)
```

That's the four required §16.10.2 fields, byte-decoded by Wireshark from the actual frame.

The bottom pane shows the raw hex. Click any decoded field above and Wireshark highlights its bytes below. That's the encoding our sandbox's I-Am summary is trying to be equivalent to.

## What this teaches us for the sandbox

Things you'll see in a real trace that the sandbox doesn't fully model yet:

1. **BVLC function codes** — `Original-Unicast-NPDU`, `Original-Broadcast-NPDU`, `Forwarded-NPDU`, `Distribute-Broadcast-To-Network`. BBMDs use these to forward broadcasts across subnets. Our sandbox treats broadcasts abstractly; surfacing BVLC functions in the packet log would teach the BBMD mechanics.

2. **NPDU control byte** — flags like "expecting reply", priority, "destination is specified", "hop count". Our sandbox doesn't model NPDU at all; everything is APDU-level.

3. **APDU tagged encoding** — every property uses context tags + application tags (e.g., `c4` = context-tag-4 = device-identifier; `22` = unsigned-int 2-bytes). Looking at the hex stream teaches you to read BACnet PDUs by hand, which is invaluable when YABE/Wireshark aren't available.

4. **Invoke IDs + retry timing** — confirmed services (ReadProperty, etc.) include an invoke-ID that the receiver echoes back on the ACK. The sandbox doesn't currently track invoke-IDs — they'd be useful for "you sent ReadProperty invoke 42, but the ACK was invoke 41 — wrong handshake."

## Save a capture for later

File → Save As → name it `bacnet-trace-YYYYMMDD.pcapng`. Drop it back into Wireshark anytime to re-examine. You can also export specific packets as JSON (File → Export Packet Dissections → As JSON) for programmatic comparison against the sandbox.

## Filters that pay off

| Filter | Shows |
|---|---|
| `bvlc` | All BACnet/IP traffic |
| `bacapp` | Application-layer (APDU) BACnet only — hides MS/TP-only frames |
| `bacapp.confirmed_service_choice == 12` | ReadProperty requests (service-choice 12) |
| `bacapp.confirmed_service_choice == 14` | WriteProperty requests (14) |
| `bacapp.unconfirmed_service_choice == 0` | I-Am |
| `bacapp.unconfirmed_service_choice == 8` | Who-Is |
| `bacapp.unconfirmed_service_choice == 1` | I-Have |
| `bvlc.bdt` | BBMD broadcast distribution table traffic |

## Next steps after a capture

Once you have a `.pcapng` with a Who-Is/I-Am exchange + a ReadProperty round-trip + a COV notification, paste me a screenshot of the APDU decode for each. I'll diff field-by-field against what the sandbox emits and we'll close any remaining gaps.

To capture a ReadProperty exchange, run from another terminal while Wireshark is recording:

```
python read_property.py --target 192.168.1.150 --object analogValue:1 --property presentValue
```

(That script doesn't exist yet — if you want it, say the word and I'll add it. Or use YABE which makes ReadProperty a single button click.)
