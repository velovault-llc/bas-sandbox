# Capture a REAL Change-of-Value (COV) stream to a Wireshark-openable
# .pcap — SubscribeCOV → COVNotification storm — with no Npcap/driver.
#
# This fills a gap in the public BACnet corpus, which has no COV traffic.
# It's the ground truth the sandbox's COV / COV-saturation modelling gets
# measured against.
#
# How it works: subscribe to a device's analogValue:1 via bacpypes3's COV
# client. When the device's value changes (run bacserv.py with --drive to
# make it a noisy sensor), the device pushes a COVNotification per change.
# We tap the datagram layer in-process (see pcap_tap.py) so every
# SubscribeCOV, COVNotification, and (for confirmed COV) Simple-ACK is
# recorded with real wire bytes.
#
# Usage (cmd.exe or PowerShell — no env vars needed):
#     # 1. Noisy device on loopback:
#     py bacserv.py --address 127.0.0.1:47808 --drive
#     # 2. Subscribe + capture for 8 seconds:
#     py cov_capture.py --device 127.0.0.1 --seconds 8 --out cov.pcap
#     # 3. Open cov.pcap in Wireshark (display filter: bvlc)
#
# Confirmed COV is the default (each notification is ACKed — that ACK
# round-trip is exactly the bus pressure that causes saturation). Use
# --unconfirmed for fire-and-forget notifications.

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
    parser = SimpleArgumentParser(prog="cov_capture")
    parser.add_argument("--device", type=str, default="127.0.0.1",
                        help="IP of the device to subscribe to (default 127.0.0.1).")
    parser.add_argument("--object", type=str, default="analogValue:1",
                        help="Monitored object <type>:<instance> (default analogValue:1).")
    parser.add_argument("--bind", type=str, default="127.0.0.1:47809",
                        help="Local address:port for this subscriber (default 127.0.0.1:47809).")
    parser.add_argument("--seconds", type=float, default=8.0,
                        help="How long to listen for notifications (default 8).")
    parser.add_argument("--lifetime", type=int, default=0,
                        help="Subscription lifetime in seconds, 0 = infinite (default 0). "
                        "A finite value < seconds also captures resubscribe traffic.")
    parser.add_argument("--unconfirmed", action="store_true",
                        help="Request unconfirmed notifications (default: confirmed, which ACK).")
    parser.add_argument("--out", type=str, default="cov.pcap",
                        help="Output pcap path (default cov.pcap).")
    args = parser.parse_args()
    if getattr(args, "instance", None) in (None, 999):
        args.instance = 9999
    args.address = os.environ.get("BACPYPES_DEVICE_ADDRESS", args.bind)

    install_tap(_RECORD)  # MUST be before Application builds its endpoint
    app = Application.from_args(args)

    device = Address(f"{args.device}:47808")
    obj_id = ObjectIdentifier(args.object)
    confirmed = not args.unconfirmed

    print(f"Subscribing to {args.object} on {args.device}:47808")
    print(f"  subscriber bound to {args.address}")
    print(f"  notifications: {'confirmed' if confirmed else 'unconfirmed'}, "
          f"lifetime={'infinite' if args.lifetime == 0 else f'{args.lifetime}s'}, "
          f"listening {args.seconds}s\n")

    notif_values = 0

    try:
        async with app.change_of_value(
            device, obj_id, None, confirmed, args.lifetime
        ) as scm:
            print("→ SubscribeCOV sent; waiting for notifications "
                  "(run bacserv.py with --drive to generate them)…")

            async def drain() -> None:
                nonlocal notif_values
                while True:
                    await scm.get()  # raw PropertyValue; just keep the queue clear
                    notif_values += 1

            drain_task = asyncio.create_task(drain())
            try:
                await asyncio.sleep(args.seconds)
            finally:
                drain_task.cancel()
    except Exception as e:
        print(f"\nSubscription failed: {type(e).__name__}: {e}")
        print("Is bacserv.py running on the target? (py bacserv.py --address "
              "127.0.0.1:47808 --drive)")
        if not _RECORD:
            return

    # settle so a final in-flight ACK lands
    await asyncio.sleep(0.2)

    if not _RECORD:
        print("\nNo frames captured — is bacserv.py running on the device?")
        return

    frames = sorted(_RECORD, key=lambda r: r[4])

    # tally by service for a quick saturation read
    tally: dict = {}
    for _d, _s, _dst, payload, _ts in frames:
        label = summarise(payload).split(" / ")[-1]
        tally[label] = tally.get(label, 0) + 1

    print(f"\nCaptured {len(frames)} frames "
          f"({notif_values} property-values delivered):")
    for label, count in sorted(tally.items(), key=lambda kv: -kv[1]):
        print(f"  {count:>4}  {label}")

    n = write_pcap(args.out, frames)
    print(f"\nWrote {n} frames to {os.path.abspath(args.out)}")
    print("Open in Wireshark (display filter: bvlc). No Npcap needed — it's a file.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
