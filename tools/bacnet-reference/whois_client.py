# Who-Is discovery client — sends a global broadcast and prints
# every I-Am that comes back. Equivalent to YABE's "discover devices"
# button, or `bacwi -1 -1` from bacnet-stack's win32 build.
#
# Pair this with bacserv.py to verify a real BACnet device responds
# with a properly-formed I-Am. The four fields ASHRAE 135 §16.10.2
# requires are visible in the output: deviceIdentifier, maxAPDU,
# segmentation, vendorId.
#
# Run:    python whois_client.py
#
# Output looks like:
#   Sending Who-Is global broadcast...
#   I-Am from device-1234 @ 192.168.1.42:
#     deviceIdentifier=device,1234
#     maxAPDULengthAccepted=1024
#     segmentationSupported=segmentedBoth
#     vendorIdentifier=15

import asyncio
import sys

try:
    from bacpypes3.app import Application
    from bacpypes3.argparse import SimpleArgumentParser
except ImportError as e:
    print("ERROR: bacpypes3 not installed.", file=sys.stderr)
    print("    pip install bacpypes3", file=sys.stderr)
    print(f"(original error: {e})", file=sys.stderr)
    sys.exit(1)


async def main() -> None:
    # CRITICAL on Windows: bacserv.py already owns UDP 47808 on this
    # machine. Two processes can't bind the same UDP port. So we tell
    # bacpypes3 to bind to 47809 instead — the WHO-IS BROADCAST still
    # goes to UDP/47808 (the spec port), and the server replies to
    # our source port (47809). On Linux SO_REUSEPORT lets both share
    # 47808, but Windows doesn't honor that for UDP. Override with
    # the BACPYPES_DEVICE_ADDRESS env var if you need something else.
    import os
    parser = SimpleArgumentParser(prog="whois_client")
    args = parser.parse_args()
    if getattr(args, "instance", None) is None:
        args.instance = 9999
    # Force the client onto an alternate local port unless the user
    # explicitly passed --address. SimpleArgumentParser stores the
    # supplied address on args.address; default is None → we set it.
    if getattr(args, "address", None) is None:
        args.address = os.environ.get("BACPYPES_DEVICE_ADDRESS", "0.0.0.0:47809")

    app = Application.from_args(args)

    print("Sending Who-Is global broadcast...")
    # who_is(low_limit, high_limit, address) — None,None = unbounded
    # (i.e., every device on the network responds).
    i_ams = await app.who_is(None, None)

    if not i_ams:
        print("No replies. Things to check:")
        print("  - Is bacserv.py running in another terminal?")
        print("  - Is Windows Firewall blocking UDP 47808?")
        print("    (admin: netsh advfirewall firewall add rule"
              ' name="BACnet 47808" dir=in protocol=UDP localport=47808 action=allow)')
        return

    print(f"\nGot {len(i_ams)} I-Am repl{'y' if len(i_ams) == 1 else 'ies'}:\n")
    for i_am in i_ams:
        # i_am is a bacpypes3 IAmRequest with the four required fields.
        dev_id = getattr(i_am, "iAmDeviceIdentifier", None)
        max_apdu = getattr(i_am, "maxAPDULengthAccepted", None)
        seg = getattr(i_am, "segmentationSupported", None)
        vendor = getattr(i_am, "vendorID", None)
        # pduSource shows where the reply came from (network-layer addr).
        src = getattr(i_am, "pduSource", None)
        print(f"I-Am from {dev_id} @ {src}:")
        print(f"    deviceIdentifier      = {dev_id}")
        print(f"    maxAPDULengthAccepted = {max_apdu}")
        print(f"    segmentationSupported = {seg}")
        print(f"    vendorIdentifier      = {vendor}")
        print()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
