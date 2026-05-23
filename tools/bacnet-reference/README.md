# BACnet reference container

A real, open-source BACnet device you can run on your own machine and point YABE / Wireshark / the sandbox at, so the sandbox's behavior can be measured against actual wire bytes from a known-good stack.

## What it is

This directory wraps [bacnet-stack](https://github.com/bacnet-stack/bacnet-stack) — the canonical open-source BACnet implementation — into a Docker container that:

- Boots a minimal BACnet device on UDP 47808 (the standard BACnet/IP port)
- Responds to Who-Is broadcasts with proper I-Am replies
- Serves a small set of test objects (analog input, binary value, etc.)
- Optionally records a packet capture (pcap) of everything it transmits + receives

It's the **ground truth** the sandbox can be diffed against. If our sim's packet log diverges from what bacnet-stack actually emits on the wire — that's a real conformance gap, not an opinion.

## Quick start

```bash
cd tools/bacnet-reference

# Build the reference container (one time, ~3 min)
docker build -t bas-bacnet-ref .

# Run it on UDP 47808
docker run --rm --network host bas-bacnet-ref
```

In another shell:

```bash
# Send a Who-Is broadcast — bacserv should reply with I-Am
# (use YABE, ttcp/bacnet4j, or the sandbox itself)
```

## With packet capture

```bash
docker compose up   # starts bacserv + tcpdump sidecar
# ...exercise the device...
docker compose down
# capture.pcap is now in this directory — open in Wireshark
```

In Wireshark, set the filter to `bvlc` (BACnet Virtual Link Control) to see only BACnet traffic.

## Compare against the sandbox

1. Run the reference container with packet capture (above)
2. Run the sandbox in parallel and exercise the same topology (drop a supervisor, run Who-Is)
3. Export the sandbox's packet log from the BACnet packet log panel (or save scenario file — the topology embeds the trace)
4. Diff:
   - Wireshark capture shows real wire bytes from bacnet-stack
   - Sandbox export shows our sim's record of "what would have been sent"
   - Discrepancies → conformance gaps in our sim

The in-app **Conformance** panel (top-right of the canvas, click to expand) already runs spec-derived checks against the live packet log — it'll catch many of the discrepancies automatically. Use the wire-byte comparison for the cases it doesn't catch.

## Why this matters

- **Federal evaluators** want to see "your sandbox produces output that matches a real BACnet stack" — this is the receipt.
- **BAS techs** trust tools that match what they see in YABE / Wireshark in the field. Lining up reduces the "this is just a toy" objection.
- **Future-proofing**: when ASHRAE 135 revises (rare but happens), updating the pinned `BACNET_STACK_REF` in the Dockerfile re-grounds the sandbox against the new authority.

## Files

| Path | Purpose |
|---|---|
| `Dockerfile` | Builds bacnet-stack from source, pinned to a known-good tag (currently `bacnet-stack-1.3.7`). |
| `docker-compose.yml` | Brings up `bacserv` + a tcpdump sidecar that records to `capture.pcap`. |
| `README.md` | This file. |

## Known limitations

- `bacserv` is the *demo* server in bacnet-stack. It supports the core BACnet/IP services (Who-Is, I-Am, ReadProperty, WriteProperty, SubscribeCOV) but not the full optional set. For deeper conformance work, use the `bacrouter` or `bacgateway` demos which include more services.
- The container uses `network_mode: host` because BACnet broadcasts (UDP) don't traverse Docker's default bridge networking cleanly. This means the container shares the host's network namespace — fine for development, not for production.
- Windows + Docker Desktop: `--network host` is approximated, not real. For full fidelity, run the container in a Linux VM (WSL2 works) and capture from there.
