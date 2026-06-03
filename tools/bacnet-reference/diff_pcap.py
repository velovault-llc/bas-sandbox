# Diff two BACnet/IP pcaps at the decoded-field level.
#
# The whole point of the reference lab is to keep the sandbox honest. This
# closes the loop: export the sandbox's packet log as a .pcap (the "⬇ pcap"
# button in the BACnet packet panel), capture a real device with
# capture_pcap.py / cov_capture.py, then diff them here.
#
# It decodes every APDU in both files with bacpypes3, tallies services per
# file, and for each service present in BOTH shows a field-by-field
# comparison of a representative packet — surfacing where the sandbox's
# encoding diverges from a real stack (missing fields, different values).
#
# Usage:
#     py diff_pcap.py sandbox.pcap capture.pcap
#     py diff_pcap.py sandbox.pcap cov.pcap

import sys

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

try:
    from bacpypes3.pdu import PDU
    from bacpypes3.apdu import APDU, APCISequence
except ImportError as e:
    print("ERROR: bacpypes3 not installed.  pip install bacpypes3", file=sys.stderr)
    print(f"(original error: {e})", file=sys.stderr)
    sys.exit(1)

from pcap_tap import read_pcap, apdu_offset

# Fields worth comparing per service — extracted by attribute name if the
# decoded object has them. Order matters only for display.
FIELDS = [
    "iAmDeviceIdentifier", "maxAPDULengthAccepted", "segmentationSupported", "vendorID",
    "deviceInstanceRangeLowLimit", "deviceInstanceRangeHighLimit",
    "objectIdentifier", "propertyIdentifier", "propertyArrayIndex",
    "subscriberProcessIdentifier", "initiatingDeviceIdentifier",
    "monitoredObjectIdentifier", "issueConfirmedNotifications", "lifetime",
    "timeRemaining",
]
# propertyValue / listOfValues are decoded as opaque Any objects whose
# repr includes a memory address — comparing them adds noise without
# signal, so the structural comparison sticks to identifiable fields.


def decode(payload: bytes):
    """(service_name, {field: value}) for one BVLC frame, or (None, {})."""
    try:
        apdu_bytes = payload[apdu_offset(payload):]
        apdu = APDU.decode(PDU(apdu_bytes))
        seq = APCISequence.decode(apdu)
        name = type(seq).__name__
        fields = {}
        for f in FIELDS:
            v = getattr(seq, f, None)
            if v is not None:
                fields[f] = str(v)
        return name, fields
    except Exception as e:
        return f"<undecodable: {type(e).__name__}>", {}


def load(path: str):
    frames = read_pcap(path)
    decoded = [decode(p) for _ts, p in frames]
    by_service = {}
    for name, fields in decoded:
        by_service.setdefault(name, []).append(fields)
    return len(frames), by_service


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: py diff_pcap.py <a.pcap> <b.pcap>")
        sys.exit(2)
    path_a, path_b = sys.argv[1], sys.argv[2]
    na, a = load(path_a)
    nb, b = load(path_b)

    print(f"A = {path_a}   ({na} BACnet/IP frames)")
    print(f"B = {path_b}   ({nb} BACnet/IP frames)")
    print()

    # ── service tally ────────────────────────────────────────────────
    services = sorted(set(a) | set(b))
    print("Service tally          A     B")
    print("─" * 40)
    for s in services:
        print(f"  {s:<28} {len(a.get(s, [])):>3}  {len(b.get(s, [])):>4}")
    print()

    # ── field-level comparison for shared services ───────────────────
    shared = [s for s in services if s in a and s in b and not s.startswith("<")]
    if not shared:
        print("No services in common to compare field-by-field.")
        print("(Capture matching traffic on both sides — e.g. both a Who-Is/I-Am "
              "discovery, or both a COV stream.)")
        return

    for s in shared:
        fa = a[s][0]  # representative packet from each file
        fb = b[s][0]
        print(f"▼ {s} — field comparison (first packet of each)")
        keys = [k for k in FIELDS if k in fa or k in fb]
        for k in keys:
            va = fa.get(k)
            vb = fb.get(k)
            if va is None:
                mark, va = "B-only ", "—"
            elif vb is None:
                mark, vb = "A-only ", "—"
            elif va == vb:
                mark = "match  "
            else:
                mark = "DIFFER "
            print(f"    [{mark}] {k:<28} A={va!s:<22} B={vb!s}")
        print()

    print("Note: differing instance numbers / values are expected when the two "
          "captures are different scenarios. Look for STRUCTURAL gaps — a field "
          "the real device (B) includes that the sandbox (A) omits, or vice versa.")


if __name__ == "__main__":
    main()
