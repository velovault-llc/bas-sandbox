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
#     python whois_client.py
#
# Wireshark filter while this runs:    bvlc
#
# Object set is deliberately tiny — a temp AV and an occupancy BV.
# Enough for Who-Is / I-Am / ReadProperty / SubscribeCOV to exercise
# every spec rule the sandbox's conformance panel checks.

import asyncio
import random
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
    # but its DEFAULTS are not what the docstring at the top of this
    # file claimed — bacpypes3 picks instance 999 / vendor 999 / name
    # "Excelsior" when nothing is supplied. Force the values we want
    # by writing them onto args BEFORE Application.from_args reads them.
    parser = SimpleArgumentParser(
        prog="bacserv",
        description="Reference BACnet device for bas-sandbox conformance work.",
    )
    # --drive turns the zone-temp AV into a noisy sensor whose value
    # wanders on a timer. With a COV subscriber attached, that produces a
    # real COVNotification stream — the ground truth for the sandbox's
    # COV-saturation work. Pair with cov_capture.py.
    parser.add_argument(
        "--drive", action="store_true",
        help="Fluctuate analogValue:1 on a timer (simulates a noisy sensor → COV storm).",
    )
    parser.add_argument(
        "--drive-rate", type=float, default=4.0,
        help="Updates per second when --drive is set (default 4).",
    )
    parser.add_argument(
        "--drive-step", type=float, default=1.0,
        help="Max °F change per update, random walk (default 1.0).",
    )
    parser.add_argument(
        "--cov-increment", type=float, default=0.5,
        help="COV_Increment on analogValue:1 — notify when value moves this much (default 0.5).",
    )
    parser.add_argument(
        "--vendor", type=int, default=None,
        help="Override the vendor ID reported in I-Am (e.g. 5=Johnson Controls, "
        "36=Reliable Controls). bacpypes3 only registers vendor 999, so we set it "
        "directly on the device object — enough to give captures real vendor variety.",
    )
    args = parser.parse_args()
    if getattr(args, "instance", None) in (None, 999):
        args.instance = 1234
    if getattr(args, "name", None) in (None, "Excelsior"):
        args.name = "bas-sandbox-ref"

    app = Application.from_args(args)

    # Report a specific vendor on the wire if asked. from_args can only
    # build with a vendor bacpypes3 has registered (999), but the I-Am
    # field is read straight off the device object, so overriding it here
    # gives multi-vendor captures real variety.
    if getattr(args, "vendor", None) is not None and app.device_object is not None:
        app.device_object.vendorIdentifier = args.vendor

    # Test objects — give ReadProperty + COV something to chew on.
    zn_t = AnalogValueObject(
        objectIdentifier=("analogValue", 1),
        objectName="ZN-T",
        presentValue=72.4,
        units="degreesFahrenheit",
        description="Reference zone temp",
        covIncrement=args.cov_increment,
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
    print(f"    python whois_client.py")
    if args.drive:
        print(
            f"DRIVE on: ZN-T wandering ±{args.drive_step}°F at {args.drive_rate}/s, "
            f"COV_Increment={args.cov_increment}. Subscribe with cov_capture.py."
        )
    print(f"Ctrl+C to quit.")

    async def drive_value() -> None:
        # Random-walk the zone temp within a sane band so a COV subscriber
        # sees a continuous notification stream. Writing presentValue is
        # what trips bacpypes3's COV detection for every subscriber.
        period = 1.0 / max(0.1, args.drive_rate)
        lo, hi = 60.0, 85.0
        while True:
            pv = float(zn_t.presentValue)
            pv += random.uniform(-args.drive_step, args.drive_step)
            zn_t.presentValue = max(lo, min(hi, pv))
            await asyncio.sleep(period)

    # Run forever — sleep on a never-resolving future. Ctrl+C interrupts.
    try:
        if args.drive:
            await drive_value()
        else:
            await asyncio.Future()
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nShutting down.")
