# Reference BACnet device for the sandbox.
#
# Runs a real BACnet/IP device on UDP 47808 using bacpypes — the
# Python BACnet implementation. Used as ground-truth to validate the
# sandbox's packet emission against actual on-the-wire BACnet bytes.
#
# Install once:    pip install bacpypes
# Run:             python bacserv.py
# Verify:          python -m bacpypes.apps.whois  (in another shell)
#
# Wireshark filter while this runs:   bvlc
# That isolates BACnet traffic on whatever adapter you're capturing.
#
# Object set is deliberately tiny — a temp AV and an occupancy BV.
# Enough for Who-Is / I-Am / ReadProperty / SubscribeCOV to exercise
# every spec rule the sandbox's conformance panel checks.

from bacpypes.app import BIPSimpleApplication
from bacpypes.core import run
from bacpypes.local.device import LocalDeviceObject
from bacpypes.object import AnalogValueObject, BinaryValueObject


def main() -> None:
    device = LocalDeviceObject(
        objectName="bas-sandbox-ref",
        objectIdentifier=1234,
        # Reasonable defaults — matches what a small JACE / NCE
        # advertises. These are the fields the sandbox's conformance
        # panel cites as required per ASHRAE 135 §16.10.2.
        maxApduLengthAccepted=1024,
        segmentationSupported="segmentedBoth",
        vendorIdentifier=15,  # 15 = Cimetrics (an arbitrary real vendor)
    )
    # 0.0.0.0 binds all interfaces. If you have multiple NICs and want
    # to pin to one, replace with the IP of the desired adapter.
    app = BIPSimpleApplication(device, "0.0.0.0")

    # Test objects so ReadProperty / COV exchanges have something to
    # chew on. Property values are static (no simulation); the goal
    # is wire-format validation, not realistic behavior.
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

    print("BACnet reference device 'bas-sandbox-ref' (instance 1234)")
    print("Listening on UDP 47808 — all interfaces.")
    print("Discover from another shell:   python -m bacpypes.apps.whois")
    print("Stop with Ctrl+C.")
    run()


if __name__ == "__main__":
    main()
