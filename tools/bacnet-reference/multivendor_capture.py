# Capture a multi-vendor BACnet/IP discovery + poll to a Wireshark-
# openable .pcap — with no Npcap/driver.
#
# Spins up several reference devices on loopback, each reporting a
# different vendor ID / instance / name (a stand-in for JCI vs Tridium vs
# Reliable, etc.), then runs a discovery + ReadProperty sweep and captures
# every frame. The point is wire-level vendor VARIETY — different vendor
# IDs in the I-Ams, different instance numbering — which is the ground
# truth for per-vendor wire profiles in the sandbox.
#
# Real multi-device-on-one-host BACnet normally shares port 47808 via a
# BBMD; bacpypes3 can't bind several apps to one UDP port cleanly, so we
# put each device on its own port and send DIRECTED Who-Is to each. The
# captured I-Ams + reads are byte-identical to what each device would emit
# on a shared bus.
#
# Usage (cmd.exe or PowerShell — fully self-contained, one command):
#     py multivendor_capture.py --out multivendor.pcap
#     # then open multivendor.pcap in Wireshark (display filter: bvlc)

import asyncio
import os
import subprocess
import sys
import time

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

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

from pcap_tap import install_tap, summarise, write_pcap

# A small fleet — (vendor_id, vendor_label, device_instance, name, port).
# Vendor IDs are real BACnet assignments so Wireshark labels them.
FLEET = [
    (5, "Johnson Controls", 1001, "JCI-FEC", 47808),
    (37, "Tridium", 1002, "JACE", 47810),
    (36, "Reliable Controls", 1003, "MACH-Pro", 47812),
    (10, "Schneider/TAC", 1004, "AS-P", 47814),
]

_RECORD: list = []
_HERE = os.path.dirname(os.path.abspath(__file__))


def _spawn_fleet() -> list:
    procs = []
    for vid, label, inst, name, port in FLEET:
        cmd = [
            "py", os.path.join(_HERE, "bacserv.py"),
            "--address", f"127.0.0.1:{port}",
            "--instance", str(inst),
            "--name", name,
            "--vendor", str(vid),
        ]
        p = subprocess.Popen(
            cmd, cwd=_HERE,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        procs.append((p, label, port))
        print(f"  started {name} (vendor {vid} = {label}) on 127.0.0.1:{port}")
    return procs


async def main() -> None:
    parser = SimpleArgumentParser(prog="multivendor_capture")
    parser.add_argument("--bind", type=str, default="127.0.0.1:47809",
                        help="Local address:port for this client (default 127.0.0.1:47809).")
    parser.add_argument("--out", type=str, default="multivendor.pcap",
                        help="Output pcap path (default multivendor.pcap).")
    args = parser.parse_args()
    if getattr(args, "instance", None) in (None, 999):
        args.instance = 9999
    args.address = os.environ.get("BACPYPES_DEVICE_ADDRESS", args.bind)

    print("Spinning up the device fleet…")
    procs = _spawn_fleet()
    print("Waiting for devices to bind…")
    time.sleep(2.5)

    install_tap(_RECORD)  # MUST be before Application builds its endpoint
    app = Application.from_args(args)
    print(f"\nClient bound to {args.address}; sweeping the fleet…\n")

    try:
        for _vid, label, _inst, _name, port in FLEET:
            target = Address(f"127.0.0.1:{port}")
            i_ams = await app.who_is(None, None, target)
            seen = ", ".join(
                f"{getattr(a, 'iAmDeviceIdentifier', '?')} vendor={getattr(a, 'vendorID', '?')}"
                for a in i_ams
            ) or "(no reply)"
            print(f"→ Who-Is 127.0.0.1:{port:<5} ({label:<18}) ← {seen}")
            try:
                val = await app.read_property(
                    target, ObjectIdentifier("analogValue:1"), "presentValue"
                )
                print(f"  ReadProperty analogValue:1 ← {val!r}")
            except Exception as e:
                print(f"  ReadProperty failed: {type(e).__name__}: {e}")
        await asyncio.sleep(0.3)
    finally:
        for p, _label, _port in procs:
            p.terminate()

    if not _RECORD:
        print("\nNo frames captured.")
        return

    frames = sorted(_RECORD, key=lambda r: r[4])
    tally: dict = {}
    for _d, _s, _dst, payload, _ts in frames:
        label = summarise(payload).split(" / ")[-1]
        tally[label] = tally.get(label, 0) + 1

    print(f"\nCaptured {len(frames)} frames across {len(FLEET)} vendors:")
    for label, count in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"  {count:>4}  {label}")

    n = write_pcap(args.out, frames)
    print(f"\nWrote {n} frames to {os.path.abspath(args.out)}")
    print("Open in Wireshark (display filter: bvlc). Compare the I-Am vendor IDs.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
