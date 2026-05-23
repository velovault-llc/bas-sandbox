# ReadProperty client — issues a confirmed ReadProperty request to
# bacserv.py and prints the ACK with decoded field structure.
#
# This is the other half of the wire-byte comparison: I-Am gives us
# the device-discovery format; ReadProperty gives us the property-
# access format (which is what the sandbox's COV + polling code
# emulates). Two completely different APDU service-choices, both
# vital to validate against.
#
# Usage:
#     python read_property.py --target 192.168.1.150
#     python read_property.py --target 192.168.1.150 \
#         --object binaryValue:1 --property presentValue
#
# Default reads analogValue:1.presentValue from bacserv.py's ZN-T object.

import asyncio
import sys
import os

try:
    from bacpypes3.app import Application
    from bacpypes3.argparse import SimpleArgumentParser
    from bacpypes3.pdu import Address
    from bacpypes3.primitivedata import ObjectIdentifier
except ImportError as e:
    print("ERROR: bacpypes3 not installed.", file=sys.stderr)
    print("    pip install bacpypes3", file=sys.stderr)
    print(f"(original error: {e})", file=sys.stderr)
    sys.exit(1)


def detect_local_ipv4() -> str:
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


async def main() -> None:
    parser = SimpleArgumentParser(prog="read_property")
    parser.add_argument(
        "--target",
        type=str,
        required=True,
        help="IP of the BACnet device to query (e.g. 192.168.1.150).",
    )
    parser.add_argument(
        "--object",
        type=str,
        default="analogValue:1",
        help="Object identifier as <type>:<instance>. Default: analogValue:1",
    )
    parser.add_argument(
        "--property",
        type=str,
        default="presentValue",
        help="Property name to read. Default: presentValue",
    )
    args = parser.parse_args()
    if getattr(args, "instance", None) in (None, 999):
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

    target = Address(f"{args.target}:47808")
    # bacpypes3 accepts the colon-form ("analogValue:1") directly.
    obj_id = ObjectIdentifier(args.object)

    print(f"Sending ReadProperty to {target}:")
    print(f"    object   = {obj_id}")
    print(f"    property = {args.property}")
    print()

    try:
        value = await app.read_property(target, obj_id, args.property)
        print(f"ACK: {args.property} = {value!r}")
        print(f"     (type = {type(value).__name__})")
    except Exception as e:
        print(f"ReadProperty failed: {type(e).__name__}: {e}")
        print()
        print("Common causes:")
        print(f"  - bacserv.py isn't running, or running on a different host")
        print(f"  - The object {args.object} doesn't exist on the target device")
        print(f"    (bacserv.py exposes analogValue:1 (ZN-T) and binaryValue:1 (OCC))")
        print(f"  - Windows Firewall is dropping UDP/47808")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
