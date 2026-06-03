# Capture real BACnet/IP traffic to a Wireshark-openable .pcap — with
# NO Npcap / WinPcap / driver install, and it works on loopback (which a
# normal sniffer can't see on Windows).
#
# How it works: instead of sniffing the network card, we tap bacpypes3's
# own datagram layer *inside this process*. Every UDP payload bacpypes3
# actually sends (Who-Is, ReadProperty) and every one it receives back
# from the reference device (I-Am, ReadProperty-ACK) is the REAL wire
# byte stream — BVLC + NPDU + APDU exactly as a real stack frames it. We
# wrap each in a synthetic-but-correct IPv4/UDP header and write a
# standard libpcap file. Wireshark then decodes it as full BACnet.
#
# This is the same byte stream you'd see sniffing the wire; only the
# IP/UDP/link framing is reconstructed (from the real src/dst the stack
# used), which is all Wireshark needs to recognise UDP/47808 and decode.
#
# Usage (works in cmd.exe AND PowerShell — no env vars needed):
#     # 1. In one terminal, start the reference device on loopback:
#     py bacserv.py --address 127.0.0.1:47808
#     # 2. In another terminal, capture an exchange:
#     py capture_pcap.py --target 127.0.0.1 --out capture.pcap
#     # 3. Open capture.pcap in Wireshark (display filter: bvlc)
#
# Defaults bind the client to 127.0.0.1:47809 and target 127.0.0.1, so a
# bare `py capture_pcap.py` Just Works against a loopback bacserv.

import asyncio
import os
import socket
import struct
import sys
import time

# Windows consoles default to cp1252; force UTF-8 so status output can't
# crash the run (same fix as deep_capture.py).
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

try:
    import bacpypes3.ipv4 as _ipv4
    from bacpypes3.app import Application
    from bacpypes3.argparse import SimpleArgumentParser
    from bacpypes3.pdu import Address, IPv4Address, LocalBroadcast, LocalStation
    from bacpypes3.primitivedata import ObjectIdentifier
except ImportError as e:
    print("ERROR: bacpypes3 not installed.", file=sys.stderr)
    print("    pip install bacpypes3", file=sys.stderr)
    print(f"(original error: {e})", file=sys.stderr)
    sys.exit(1)


# ── In-process capture tap ───────────────────────────────────────────
# Each entry: (direction, src_tuple, dst_tuple, payload_bytes, ts_float)
_RECORD: list = []
# Our own bind address, used as the destination for received frames —
# bacpypes3 doesn't stamp a destination on the receive path, so without
# this the replies would show dst 0.0.0.0 in Wireshark.
_LOCAL_ADDR: tuple = None


def _install_tap() -> None:
    """Monkeypatch bacpypes3's datagram layer to record every UDP payload
    it sends and receives. Patches the class, so it must be installed
    before the Application builds its endpoint."""

    orig_rx = _ipv4.IPv4DatagramProtocol.datagram_received

    def patched_rx(self, data, addr):
        try:
            dst = None
            d = getattr(self, "destination", None)
            if d is not None and hasattr(d, "addrTuple"):
                dst = d.addrTuple
            _RECORD.append(("rx", tuple(addr), dst or _LOCAL_ADDR, bytes(data), time.time()))
        except Exception:
            pass
        return orig_rx(self, data, addr)

    _ipv4.IPv4DatagramProtocol.datagram_received = patched_rx

    orig_ind = _ipv4.IPv4DatagramServer.indication

    async def patched_ind(self, pdu):
        try:
            dest = pdu.pduDestination
            if isinstance(dest, LocalStation):
                dt = IPv4Address(dest).addrTuple
            elif isinstance(dest, LocalBroadcast):
                dt = self.broadcast_address
            elif isinstance(dest, IPv4Address):
                dt = dest.addrTuple
            else:
                dt = None
            _RECORD.append(
                ("tx", tuple(self.local_address), dt, bytes(pdu.pduData), time.time())
            )
        except Exception:
            pass
        return await orig_ind(self, pdu)

    _ipv4.IPv4DatagramServer.indication = patched_ind


# ── pcap writer (DLT_RAW = 101, so no fake MAC addresses needed) ──────

_PCAP_MAGIC = 0xA1B2C3D4
_LINKTYPE_RAW = 101


def _ip_checksum(header: bytes) -> int:
    s = 0
    for i in range(0, len(header), 2):
        s += (header[i] << 8) | header[i + 1]
    s = (s >> 16) + (s & 0xFFFF)
    s += s >> 16
    return (~s) & 0xFFFF


def _addr_bytes(addr) -> tuple:
    """(ip_str, port) -> (4-byte ip, port int). Tolerates None."""
    if not addr:
        return b"\x00\x00\x00\x00", 0
    ip, port = addr[0], int(addr[1])
    try:
        return socket.inet_aton(ip), port
    except OSError:
        return b"\x00\x00\x00\x00", port


def _frame_ip_udp(src, dst, payload: bytes) -> bytes:
    src_ip, src_port = _addr_bytes(src)
    dst_ip, dst_port = _addr_bytes(dst)
    udp_len = 8 + len(payload)
    udp = struct.pack("!HHHH", src_port, dst_port, udp_len, 0) + payload  # csum 0 = not computed (legal on IPv4)
    total_len = 20 + udp_len
    ip_no_csum = struct.pack(
        "!BBHHHBBH4s4s",
        0x45,            # version 4 + IHL 5
        0x00,            # DSCP/ECN
        total_len,       # total length
        0x0000,          # identification
        0x0000,          # flags + fragment offset
        64,              # TTL
        17,              # protocol = UDP
        0x0000,          # checksum placeholder
        src_ip,
        dst_ip,
    )
    csum = _ip_checksum(ip_no_csum)
    ip = ip_no_csum[:10] + struct.pack("!H", csum) + ip_no_csum[12:]
    return ip + udp


def write_pcap(path: str, frames: list) -> int:
    with open(path, "wb") as f:
        # global header (little-endian, microsecond resolution)
        f.write(
            struct.pack(
                "<IHHiIII",
                _PCAP_MAGIC, 2, 4, 0, 0, 65535, _LINKTYPE_RAW,
            )
        )
        n = 0
        for direction, src, dst, payload, ts in frames:
            pkt = _frame_ip_udp(src, dst, payload)
            ts_sec = int(ts)
            ts_usec = int((ts - ts_sec) * 1_000_000)
            f.write(struct.pack("<IIII", ts_sec, ts_usec, len(pkt), len(pkt)))
            f.write(pkt)
            n += 1
    return n


# ── light APDU summary (best-effort, for the console only) ────────────

_UNCONF = {0: "I-Am", 1: "I-Have", 2: "Unconfirmed-COV", 8: "Who-Is", 7: "Who-Has"}
_CONF = {12: "ReadProperty", 14: "WriteProperty", 5: "SubscribeCOV", 26: "ConfirmedCOV"}
_PDU_TYPE = {0: "Confirmed-REQ", 1: "Unconfirmed-REQ", 2: "Simple-ACK", 3: "Complex-ACK"}


def _summarise(payload: bytes) -> str:
    # BVLC: 0x81, function, 2-byte length. APDU starts after BVLC+NPDU.
    if len(payload) < 6 or payload[0] != 0x81:
        return "non-BACnet/IP"
    # NPDU version at offset 4, control at offset 5. With control 0x00 and
    # no routing fields, the APDU starts at offset 6.
    npdu_control = payload[5]
    apdu_off = 6
    if npdu_control & 0x20:  # destination present — skip DNET(2)+DLEN(1)+DADR
        apdu_off += 3 + payload[apdu_off + 2]
    if npdu_control & 0x08:  # source present
        apdu_off += 3 + payload[apdu_off + 2]
    if npdu_control & 0x20:
        apdu_off += 1  # hop count
    if apdu_off >= len(payload):
        return "NPDU-only"
    apdu0 = payload[apdu_off]
    ptype = apdu0 >> 4
    name = _PDU_TYPE.get(ptype, f"apdu-type-{ptype}")
    if ptype == 1:  # unconfirmed-req: service choice at next byte
        svc = payload[apdu_off + 1] if apdu_off + 1 < len(payload) else -1
        return f"{name} / {_UNCONF.get(svc, f'svc-{svc}')}"
    if ptype == 0:  # confirmed-req: service choice at offset+3 (after PDU flags + maxseg + invokeID)
        svc = payload[apdu_off + 3] if apdu_off + 3 < len(payload) else -1
        return f"{name} / {_CONF.get(svc, f'svc-{svc}')}"
    return name


# ── CLI ──────────────────────────────────────────────────────────────

async def main() -> None:
    parser = SimpleArgumentParser(prog="capture_pcap")
    parser.add_argument(
        "--target", type=str, default="127.0.0.1",
        help="IP of the device to exercise (default 127.0.0.1, the loopback bacserv).",
    )
    parser.add_argument(
        "--bind", type=str, default="127.0.0.1:47809",
        help="Local address:port for this client (default 127.0.0.1:47809). "
        "Must differ from the device's 47808.",
    )
    parser.add_argument(
        "--out", type=str, default="capture.pcap",
        help="Output pcap path (default capture.pcap).",
    )
    args = parser.parse_args()
    if getattr(args, "instance", None) in (None, 999):
        args.instance = 9999
    # Force our bind address (SimpleArgumentParser would otherwise pick a
    # broadcast-needing default). Honour BACPYPES_DEVICE_ADDRESS if set.
    args.address = os.environ.get("BACPYPES_DEVICE_ADDRESS", args.bind)

    # Record our bind tuple so received frames get a real destination.
    global _LOCAL_ADDR
    _bind_host, _, _bind_port = args.address.partition(":")
    _LOCAL_ADDR = (_bind_host, int(_bind_port) if _bind_port else 47809)

    _install_tap()  # MUST be before Application builds its endpoint
    app = Application.from_args(args)

    target = Address(f"{args.target}:47808")

    print(f"Capturing BACnet/IP exchange with {args.target}:47808")
    print(f"  client bound to {args.address}")
    print()

    # 1. Who-Is -> I-Am
    print("→ Who-Is (directed)")
    i_ams = await app.who_is(None, None, target)
    print(f"  ← {len(i_ams)} I-Am repl{'y' if len(i_ams) == 1 else 'ies'}")

    # 2. ReadProperty on the two objects bacserv exposes
    for obj in ("analogValue:1", "binaryValue:1"):
        try:
            val = await app.read_property(target, ObjectIdentifier(obj), "presentValue")
            print(f"→ ReadProperty {obj} presentValue   ← {val!r}")
        except Exception as e:
            print(f"→ ReadProperty {obj} failed: {type(e).__name__}: {e}")

    # settle so late-arriving ACKs are recorded
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
        print(f"  {arrow}  {s:>22} → {d:<22} {len(payload):>3}B  {_summarise(payload)}")

    n = write_pcap(args.out, frames)
    out_abs = os.path.abspath(args.out)
    print(f"\nWrote {n} frames to {out_abs}")
    print("Open in Wireshark (display filter: bvlc). No Npcap needed — it's a file.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
