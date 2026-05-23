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


def detect_local_ipv4() -> str:
    """Find the IP address of the active outbound interface.

    The trick is to open a UDP socket "connected" to a public address.
    UDP `connect` doesn't actually send packets — it just makes the
    OS pick a source IP for the route. We grab that and close the
    socket. Works on Windows / Linux / macOS without any deps.

    Falls back to 127.0.0.1 if nothing's routable (e.g., offline laptop).
    """
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # 8.8.8.8 = Google DNS. Could be anything public; never contacted.
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


async def main() -> None:
    # CRITICAL on Windows: bacserv.py already owns UDP 47808 on this
    # machine. Two processes can't bind the same UDP port. So we
    # bind the client to 47809 instead — the WHO-IS BROADCAST still
    # targets UDP/47808 (the spec port), and the server replies to
    # our source port (47809). Override with BACPYPES_DEVICE_ADDRESS
    # env var if you need something else.
    #
    # We also need a SPECIFIC interface IP (not 0.0.0.0) so bacpypes3
    # knows what subnet to broadcast on — without that it raises
    # `RuntimeError: no broadcast`. Auto-detect via outbound socket
    # trick + assume /24 (which covers ~all home/office BAS deployments).
    import os
    parser = SimpleArgumentParser(prog="whois_client")
    args = parser.parse_args()
    if getattr(args, "instance", None) is None:
        args.instance = 9999
    if getattr(args, "address", None) is None:
        env_addr = os.environ.get("BACPYPES_DEVICE_ADDRESS")
        if env_addr:
            args.address = env_addr
        else:
            local_ip = detect_local_ipv4()
            args.address = f"{local_ip}/24:47809"
            print(f"Using local address: {args.address}")

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
