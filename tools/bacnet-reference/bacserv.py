# Reference BACnet device for the sandbox.
#
# Runs a real BACnet/IP device on UDP 47808 using bacpypes3 — the
# asyncio-based rewrite of bacpypes. The original bacpypes uses
# Python's asyncore module, which was REMOVED in Python 3.12+; if
# you're on a modern Python you need bacpypes3.
#
# Install once:
#     pip uninstall -y bacpypes
#     pip install bacpypes3
#
# Run:
#     python bacserv.py
#
# Verify from another shell:
#     python -m bacpypes3.apps.discover whois
#
# Wireshark filter while this runs:    bvlc
#
# Object set is deliberately tiny — a temp AV and an occupancy BV.
# Enough for Who-Is / I-Am / ReadProperty / SubscribeCOV to exercise
# every spec rule the sandbox's conformance panel checks.

import asyncio
import sys

try:
    from bacpypes3.app import Application
    from bacpypes3.argparse import SimpleArgumentParser
    from bacpypes3.local.analog import AnalogValueObject
    from bacpypes3.local.binary import BinaryValueObject
except ImportError as e:
    print("ERROR: bacpypes3 not installed.", file=sys.stderr)
    print("Install with:    pip install bacpypes3", file=sys.stderr)
    print(
        "If you have the old bacpypes (not bacpypes3), uninstall it first:",
        file=sys.stderr,
    )
    print("    pip uninstall -y bacpypes", file=sys.stderr)
    print(f"(original error: {e})", file=sys.stderr)
    sys.exit(1)


async def main() -> None:
    # SimpleArgumentParser handles --address, --instance, --name, etc.
    # Defaults: instance 1234, name "Excelsior", listens on all interfaces.
    parser = SimpleArgumentParser(
        prog="bacserv",
        description="Reference BACnet device for bas-sandbox conformance work.",
    )
    args = parser.parse_args()

    app = Application.from_args(args)

    # Test objects — give ReadProperty + COV something to chew on.
    zn_t = AnalogValueObject(
        objectIdentifier=("analogValue", 1),
        objectName="ZN-T",
        presentValue=72.4,
        units="degreesFahrenheit",
        description="Reference zone temp",
    )
    occ = BinaryValueObject(
        objectIdentifier=("binaryValue", 1),
        objectName="OCC",
        presentValue="active",
        description="Reference occupancy state",
    )
    app.add_object(zn_t)
    app.add_object(occ)

    print(f"BACnet reference device on UDP 47808")
    print(f"Discover from another shell:")
    print(f"    python -m bacpypes3.apps.discover whois")
    print(f"Ctrl+C to quit.")

    # Run forever — sleep on a never-resolving future. Ctrl+C interrupts.
    try:
        await asyncio.Future()
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nShutting down.")
