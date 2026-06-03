# Deep capture — sends a Who-Is and prints every field of the
# resulting I-Am, plus the raw bytes bacpypes3 would put on the wire.
#
# Wireshark gives us the layer-cake view (Ethernet → IP → UDP → BVLC →
# NPDU → APDU), but for ground-truthing the sandbox against the spec
# we mostly care about the APDU layer — that's where every field the
# conformance checker references lives. This script prints the APDU
# in three forms:
#
#   1. Decoded fields (what bacpypes3 understands about the message)
#   2. Encoded PDU data (the bytes bacpypes3 would put on the wire)
#   3. Hex dump (annotated where possible)
#
# Pair with bacserv.py running on the same machine + `--target` to
# bypass the Windows local-broadcast loopback problem.
#
# Usage:
#     python deep_capture.py --target 192.168.1.150
#
# Output includes a hex dump like:
#     APDU: 10 00 c4 02 00 04 d2 22 04 00 91 03 21 0f
#     where:
#       10            = unconfirmed-request PDU type + control flags
#       00            = service-choice (I-Am)
#       c4 02 00 04 d2 = device-identifier context-tag (device, 1234)
#       22 04 00      = max-APDU-length-accepted (1024)
#       91 03         = segmentation-supported (segmented-both)
#       21 0f         = vendor-id (15)

import asyncio
import sys
import os

# Windows consoles default to cp1252, which can't encode the box-drawing
# characters this script prints — without this the whole run crashes with
# UnicodeEncodeError right after it gets a valid reply. Force UTF-8 on the
# output streams when the runtime supports it (Python 3.7+).
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

try:
    from bacpypes3.app import Application
    from bacpypes3.argparse import SimpleArgumentParser
    from bacpypes3.pdu import Address, PDUData
    from bacpypes3.apdu import IAmRequest, APDU
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


def hex_dump(data: bytes, indent: str = "    ") -> str:
    """Pretty-print bytes with 16 cols per line + ASCII gutter."""
    out: list[str] = []
    for i in range(0, len(data), 16):
        chunk = data[i:i + 16]
        hex_part = " ".join(f"{b:02x}" for b in chunk)
        ascii_part = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        out.append(f"{indent}{i:04x}  {hex_part:<47}  |{ascii_part}|")
    return "\n".join(out)


def dump_i_am(i_am: IAmRequest) -> None:
    """Print every meaningful attribute of an I-Am request, then the
    serialized byte form bacpypes3 would put on the wire."""
    print("─" * 70)
    print(f"I-Am from {i_am.pduSource}:")
    print()
    print("  Decoded fields (what bacpypes3 understands):")
    fields = [
        ("pduSource", "pduSource"),
        ("pduDestination", "pduDestination"),
        ("iAmDeviceIdentifier", "iAmDeviceIdentifier"),
        ("maxAPDULengthAccepted", "maxAPDULengthAccepted"),
        ("segmentationSupported", "segmentationSupported"),
        ("vendorID", "vendorID"),
    ]
    for label, attr in fields:
        v = getattr(i_am, attr, None)
        print(f"    {label:<24} = {v}")

    # Serialize back to bytes so we can show the wire encoding.
    # bacpypes3 0.0.106 changed the API: encode() takes NO arguments and
    # returns the next protocol layer down. Two hops — APCISequence
    # (IAmRequest) -> APDU -> PDU — yields the full wire bytes including
    # the 2-byte unconfirmed-request header (10 00 ...). The older
    # `i_am.encode(pdu_data)` signature raised "takes 1 positional
    # argument but 2 were given".
    try:
        pdu = i_am.encode().encode()
        raw = bytes(pdu.pduData) if pdu.pduData else b""
        print()
        print(f"  Encoded APDU bytes ({len(raw)} bytes):")
        print(hex_dump(raw))
        print()
        print("  Wire format notes:")
        if raw:
            pdu_type = raw[0] >> 4
            print(f"    [0]  0x{raw[0]:02x}  PDU-type nibble = {pdu_type} "
                  "(1 = unconfirmed-request)")
            if len(raw) > 1:
                svc = raw[1]
                print(f"    [1]  0x{svc:02x}  service-choice = {svc} (0 = I-Am)")
            if len(raw) > 2:
                print(f"    [2+] tagged data — context/application tags follow.")
                print("         See ASHRAE 135 §20.2 for the encoding rules.")
    except Exception as e:
        print(f"  (Could not serialize APDU for hex dump: {e})")

    print("─" * 70)


async def main() -> None:
    parser = SimpleArgumentParser(prog="deep_capture")
    parser.add_argument(
        "--target",
        type=str,
        default=None,
        help="IP to send Who-Is directly to (skips broadcast).",
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

    if args.target:
        target = Address(f"{args.target}:47808")
        print(f"Sending DIRECTED Who-Is to {target}...")
        i_ams = await app.who_is(None, None, target)
    else:
        print("Sending Who-Is global broadcast...")
        i_ams = await app.who_is(None, None)

    if not i_ams:
        print("\nNo replies. Is bacserv.py running? Try --target <local IP>.")
        return

    print(f"\nGot {len(i_ams)} I-Am repl{'y' if len(i_ams) == 1 else 'ies'}:\n")
    for i_am in i_ams:
        dump_i_am(i_am)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
