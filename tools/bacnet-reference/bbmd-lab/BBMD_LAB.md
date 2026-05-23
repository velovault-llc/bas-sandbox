# BBMD lab — ground-truth Forwarded-NPDU capture

A two-BBMD loopback setup using bacpypes3 to generate REAL
Forwarded-NPDU (BVLC fn 0x04) packets we can capture in Wireshark
and diff against the sandbox's emissions.

## Why this exists

The sandbox claims to model BBMD bridging correctly. The credibility
of that claim depends on whether our pretty-printed packet log
matches what an actual BACnet stack puts on the wire. This lab is
the calibration source.

## Lab setup (proven working 2026-05-23)

Two `bbmd_node.py` instances on loopback, BDTs pointing at each
other:

```
Shell 1:  python bbmd_node.py --address 127.0.0.1:47808 --bbmd 127.0.0.1:47809 --instance 1801 --name BBMD-A
Shell 2:  python bbmd_node.py --address 127.0.0.1:47809 --bbmd 127.0.0.1:47808 --instance 1802 --name BBMD-B
```

Verify with `netstat -an | grep 4780`:

```
UDP    127.0.0.1:47808        *:*    (BBMD-A)
UDP    127.0.0.1:47809        *:*    (BBMD-B)
```

## Triggering BBMD forwarding

**Directed Who-Is** (Shell 3) — verifies BBMD-A responds locally,
no forwarding:

```
python ../whois_client.py --target 127.0.0.1
```

Expected: 1 I-Am reply from `device,1801` (BBMD-A only).

**Foreign-device Who-Is** (Shell 3) — registers as FD with BBMD-A,
sends a global-broadcast Who-Is via the BBMD, which forwards to
BBMD-B's BDT entry:

```
python foreign_probe.py
```

Expected: 2 I-Am replies — `device,1801` (BBMD-A direct) AND
`device,1802` (BBMD-B via Forwarded-NPDU).

The foreign-device path is the canonical trigger because Windows
loopback does not propagate UDP broadcasts between processes —
direct broadcast from a sibling process is silently dropped. Foreign
registration uses unicast packets the OS happily routes.

## Wireshark capture

Install **Npcap** with "Loopback adapter capture" enabled. Then:

1. Open Wireshark
2. Interface: **Adapter for loopback traffic capture** (Windows)
   / **Loopback: lo0** (macOS) / **any** (Linux)
3. Capture filter: `udp port 47808 or udp port 47809`
4. Display filter: `bvlc`
5. Start capture
6. Run `python foreign_probe.py` in Shell 3
7. Stop capture, save as `wireshark/bbmd-lab-<date>.pcapng`

Or use tshark (faster, headless):

```
"C:/Program Files/Wireshark/tshark.exe" -i 4 -f "udp port 47808 or udp port 47809" -w bbmd-lab.pcapng -a duration:10
```

(adapter index varies — find with `tshark -D`)

Read with:

```
"C:/Program Files/Wireshark/tshark.exe" -r bbmd-lab.pcapng -V -Y bvlc
```

## Findings — bacpypes3 wire format (verified 2026-05-23)

bacpypes3's I-Am responses match the sandbox's emissions exactly:

| Field                  | bacpypes3 output      | sandbox emits         | match |
| ---------------------- | --------------------- | --------------------- | ----- |
| deviceIdentifier       | `device,1801`         | `device,${N}`         | ✓     |
| maxAPDULengthAccepted  | `1024`                | `1024`                | ✓     |
| segmentationSupported  | `segmented-both`      | `segmented-both`      | ✓     |
| vendorIdentifier       | `999` (default) / `5` for JCI / `15` for ASHRAE | matches when vendorModelId set | ✓ |

Wire-frame BVLC functions to capture + verify:

- `0x0a` Original-Unicast-NPDU  — foreign-device registration
- `0x0b` Original-Broadcast-NPDU — Who-Is on local subnet
- `0x04` Forwarded-NPDU         — BBMD-to-BBMD bridging (the prize)
- `0x05` Register-Foreign-Device — FD registration request
- `0x09` Read-FDT               — FD-table inspection (Shell 4 use)

## Sandbox alignment work

Things to add to the conformance / experiment catalog after capturing
the actual wire bytes:

- [ ] Verify our BVLC fn 0x04 emit shape has the right "originating
      device address" field per ASHRAE 135 §J.4.4
- [ ] Verify foreign-device subscription lifetime semantics (TTL
      countdown, re-registration interval) match what bacpypes3 does
- [ ] Capture Read-BDT exchange and add it as a "BDT inspector" sandbox
      feature
- [ ] Test what happens when a BDT peer is unreachable (we currently
      warn `ipv4.bbmd-peer-unknown` — confirm bacpypes3's behavior matches)

## Cleanup

Kill the BBMD shells with Ctrl+C when done. They consume ~50MB each.
