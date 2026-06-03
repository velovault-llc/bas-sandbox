# Capture a real BACnet/IP Who-Is + ReadProperty exchange to a
# Wireshark-openable .pcap — with NO Npcap / driver, working on loopback
# (which a NIC sniffer can't see on Windows). See pcap_tap.py for how the
# in-process capture works.
#
# Usage (works in cmd.exe AND PowerShell — no env vars needed):
#     # 1. In one terminal, start the reference device on loopback:
#     py bacserv.py --address 127.0.0.1:47808
#     # 2. In another terminal, capture an exchange:
#     py capture_pcap.py --target 127.0.0.1 --out capture.pcap
#     # 3. Open capture.pcap in Wireshark (display filter: bvlc)

import asyncio
import os
import sys

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

_RECORD: list = []


async def main() -> None:
    parser = SimpleArgumentParser(prog="capture_pcap")
    parser.add_argument("--target", type=str, default="127.0.0.1",
                        help="IP of the device to exercise (default 127.0.0.1).")
    parser.add_argument("--bind", type=str, default="127.0.0.1:47809",
                        help="Local address:port for this client (default 127.0.0.1:47809).")
    parser.add_argument("--out", type=str, default="capture.pcap",
                        help="Output pcap path (default capture.pcap).")
    args = parser.parse_args()
    if getattr(args, "instance", None) in (None, 999):
        args.instance = 9999
    args.address = os.environ.get("BACPYPES_DEVICE_ADDRESS", args.bind)

    install_tap(_RECORD)  # MUST be before Application builds its endpoint
    app = Application.from_args(args)

    target = Address(f"{args.target}:47808")
    print(f"Capturing BACnet/IP exchange with {args.target}:47808")
    print(f"  client bound to {args.address}\n")

    print("→ Who-Is (directed)")
    i_ams = await app.who_is(None, None, target)
    print(f"  ← {len(i_ams)} I-Am repl{'y' if len(i_ams) == 1 else 'ies'}")

    for obj in ("analogValue:1", "binaryValue:1"):
        try:
            val = await app.read_property(target, ObjectIdentifier(obj), "presentValue")
            print(f"→ ReadProperty {obj} presentValue   ← {val!r}")
        except Exception as e:
            print(f"→ ReadProperty {obj} failed: {type(e).__name__}: {e}")

    await asyncio.sleep(0.3)

    if not _RECORD:
        print("\nNo frames captured — is bacserv.py running on the target?")
        return

    frames = sorted(_RECORD, key=lambda r: r[4])
    print(f"\nCaptured {len(frames)} frames:")
    for direction, src, dst, payload, _ts in frames:
        arrow = "TX" if direction == "tx" else "RX"
        s = f"{src[0]}:{src[1]}" if src else "?"
        d = f"{dst[0]}:{dst[1]}" if dst else "?"
        print(f"  {arrow}  {s:>22} → {d:<22} {len(payload):>3}B  {summarise(payload)}")

    n = write_pcap(args.out, frames)
    print(f"\nWrote {n} frames to {os.path.abspath(args.out)}")
    print("Open in Wireshark (display filter: bvlc). No Npcap needed — it's a file.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
