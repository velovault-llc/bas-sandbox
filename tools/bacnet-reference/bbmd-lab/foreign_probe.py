# Foreign-device Who-Is probe — registers as a foreign device with a
# BBMD, then sends a global broadcast Who-Is via the BBMD. The BBMD
# forwards the broadcast to its BDT peers, which respond with I-Am.
#
# This is the canonical way to trigger BBMD broadcast forwarding for
# testing. Direct broadcast on the local subnet ALSO triggers
# forwarding, but on Windows the local broadcast often doesn't
# loop back to other processes on the same host — so the foreign-
# device path is what works reliably in a one-machine lab.
#
# Usage (with bbmd_node.py BBMD-A + BBMD-B already running):
#
#     python foreign_probe.py
#
# Expected output: TWO I-Am replies (one from each BBMD).
#   - device,1801 @ 127.0.0.1:47808 = BBMD-A's local response
#   - device,1802 @ 127.0.0.1:47809 = BBMD-B's response via
#     Forwarded-NPDU (BVLC fn 0x04)
#
# With Wireshark running on the loopback adapter ("Adapter for loopback
# traffic capture" on Windows), filter `bvlc` to see:
#   - Frame N:    Original-Unicast-NPDU  (FD registration)
#   - Frame N+1:  Original-Broadcast-NPDU (Who-Is from us → BBMD-A)
#   - Frame N+2:  Forwarded-NPDU         (BBMD-A → BBMD-B)
#   - Frame N+3:  I-Am from BBMD-A
#   - Frame N+4:  I-Am from BBMD-B (forwarded via BBMD-A)

import asyncio
import sys

try:
    from bacpypes3.app import Application
    from bacpypes3.argparse import SimpleArgumentParser
except ImportError as e:
    print(f"ERROR: bacpypes3 not installed ({e})", file=sys.stderr)
    sys.exit(1)


async def main() -> None:
    parser = SimpleArgumentParser(prog="foreign_probe")
    args = parser.parse_args()
    # Defaults that target BBMD-A as our registration target.
    if getattr(args, "instance", None) in (None, 999):
        args.instance = 9999
    if getattr(args, "name", None) in (None, "Excelsior"):
        args.name = "fd-probe"
    if getattr(args, "address", None) is None:
        args.address = "127.0.0.1:47810"  # Unused port; doesn't clash with BBMDs.
    # Register as foreign device with BBMD-A by default.
    if getattr(args, "foreign", None) is None:
        args.foreign = "127.0.0.1:47808"
    if getattr(args, "ttl", None) in (None, 0):
        args.ttl = 30

    app = Application.from_args(args)

    print(f"Foreign device registered with BBMD at {args.foreign}")
    print(f"Sending global-broadcast Who-Is via BBMD...")
    print()
    i_ams = await app.who_is(None, None)

    if not i_ams:
        print("No replies. BBMDs might not be running. Start them with:")
        print("  python bbmd_node.py --address 127.0.0.1:47808 --bbmd 127.0.0.1:47809 --instance 1801 --name BBMD-A")
        print("  python bbmd_node.py --address 127.0.0.1:47809 --bbmd 127.0.0.1:47808 --instance 1802 --name BBMD-B")
        return

    print(f"Got {len(i_ams)} I-Am repl{'y' if len(i_ams) == 1 else 'ies'}:")
    print()
    for i_am in i_ams:
        dev_id = getattr(i_am, "iAmDeviceIdentifier", None)
        max_apdu = getattr(i_am, "maxAPDULengthAccepted", None)
        seg = getattr(i_am, "segmentationSupported", None)
        vendor = getattr(i_am, "vendorID", None)
        src = getattr(i_am, "pduSource", None)
        print(f"  I-Am from {dev_id} @ {src}:")
        print(f"      deviceIdentifier      = {dev_id}")
        print(f"      maxAPDULengthAccepted = {max_apdu}")
        print(f"      segmentationSupported = {seg}")
        print(f"      vendorIdentifier      = {vendor}")
        print()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
