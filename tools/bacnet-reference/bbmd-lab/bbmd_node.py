# bacpypes3 BBMD node — runnable as a BBMD on a chosen UDP port.
#
# Why this exists: the sandbox claims to model BBMD bridging
# correctly. To validate that claim we need REAL wire bytes from a
# real BACnet stack doing real BBMD forwarding. This script + a
# Wireshark capture gives us a ground-truth Forwarded-NPDU stream
# we can diff against our sandbox emissions.
#
# Usage (run TWO instances in parallel, each in its own shell):
#
#     python bbmd_node.py --address 127.0.0.1:47808 \
#                         --bbmd 127.0.0.1:47809 \
#                         --instance 1801 --name BBMD-A
#
#     python bbmd_node.py --address 127.0.0.1:47809 \
#                         --bbmd 127.0.0.1:47808 \
#                         --instance 1802 --name BBMD-B
#
# Then in a third shell, probe one of them with a Who-Is:
#
#     python ../whois_client.py --target 127.0.0.1:47808
#
# The BBMD that receives the Who-Is should respond AND emit a
# Forwarded-NPDU (BVLC fn 0x04) to its BDT peer. The peer should
# accept the forwarded packet and broadcast it on its own segment.
# Wireshark filter:    bvlc
#
# Capture the resulting pcap into wireshark/bbmd-lab-<date>.pcapng
# and read with:
#     "C:/Program Files/Wireshark/tshark.exe" -r FILE -V -Y bvlc

import asyncio
import sys

try:
    from bacpypes3.app import Application
    from bacpypes3.argparse import SimpleArgumentParser
    from bacpypes3.local.analog import AnalogValueObject
except ImportError as e:
    print(f"ERROR: bacpypes3 not installed ({e})", file=sys.stderr)
    print("Install with:    pip install bacpypes3", file=sys.stderr)
    sys.exit(1)


async def main() -> None:
    parser = SimpleArgumentParser(
        prog="bbmd_node",
        description="bacpypes3 BBMD for the bas-sandbox BBMD lab",
    )
    args = parser.parse_args()

    # SimpleArgumentParser defaults pick instance=999/name=Excelsior.
    # Override only when the user accepted the default.
    if getattr(args, "instance", None) in (None, 999):
        args.instance = 1800
    if getattr(args, "name", None) in (None, "Excelsior"):
        args.name = "bbmd-lab-node"

    app = Application.from_args(args)

    # Give the BBMD one tiny object so it's a real device, not just
    # a forwarder. This means ReadProperty against it works and we
    # can confirm round-trip through the BBMD.
    av = AnalogValueObject(
        objectIdentifier=("analogValue", 1),
        objectName=f"AV-{args.name}",
        presentValue=42.0,
        units="noUnits",
        description=f"BBMD lab presence-indicator on {args.name}",
    )
    app.add_object(av)

    print(f"[{args.name}] BBMD up on {args.address}")
    print(f"[{args.name}] device instance: {args.instance}")
    print(f"[{args.name}] BDT peers: {args.bbmd}")
    print(f"[{args.name}] Ctrl+C to quit.")

    try:
        await asyncio.Future()
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nShutting down.")
