#!/usr/bin/env python3
"""
reference_device.py — Stage 3 STUB. A live, known-good BACnet device.

Static captures (Stages 1-2) tell you what a device said in response to whatever
it happened to be asked. They cannot answer a NEW question. A training simulator
must be interactive — a trainee pokes a device and watches it react. To test that,
and to mint fresh known-good baselines for new scenarios, you need a live reference
device. bacpypes is the natural engine (it also understands BACnet objects
semantically, useful for the field-level diff TODO in diff_harness.py).

This is a STUB. Flesh it out in Claude Code:
  - define an object model (Device, AnalogInput, AnalogValue, BinaryValue, ...)
    that mirrors the objects appearing in the captured corpus
  - run it bound to a local interface on UDP 47808
  - point a client (or the simulator-under-test) at it and capture the exchange
    with tshark to generate new baselines via parse_captures.py

See bacpypes docs: https://bacpypes.readthedocs.io/  (sample apps under
bacpypes/samples, e.g. WhoIsIAmApplication, ReadProperty server.)
"""

def main():
    try:
        import bacpypes  # noqa: F401
    except ImportError:
        raise SystemExit("bacpypes not installed. pip install bacpypes")

    print(__doc__)
    print("STUB: implement a bacpypes device here.")
    print("Suggested next step for Claude Code:")
    print("  1. Read which objects/properties appear across baselines/*.json")
    print("  2. Instantiate matching bacpypes objects on a local device")
    print("  3. Serve on 127.0.0.1:47808 and validate the simulator can be diffed")
    print("     against THIS device interactively (not just static captures).")


if __name__ == "__main__":
    main()
