# Shared in-process BACnet/IP capture: tap bacpypes3's datagram layer and
# write a standard libpcap file. No Npcap / driver, works on loopback
# (which a NIC sniffer can't see on Windows). Imported by capture_pcap.py
# and cov_capture.py.
#
# We record the REAL UDP payloads bacpypes3 sends/receives (BVLC + NPDU +
# APDU, exactly as a real stack frames them) and reconstruct the IPv4/UDP
# headers from the real src/dst the stack used — all Wireshark needs to
# recognise UDP/47808 and decode full BACnet.

import socket
import struct

import bacpypes3.ipv4 as _ipv4
from bacpypes3.pdu import IPv4Address, LocalBroadcast, LocalStation

# ── In-process tap ───────────────────────────────────────────────────
# record entries: (direction, src_tuple, dst_tuple, payload_bytes, ts)

_installed = False


def install_tap(record: list) -> None:
    """Patch bacpypes3's datagram layer so every UDP payload sent/received
    in THIS process is appended to `record`. Idempotent. Must be called
    before the Application builds its endpoint. Captures every Application
    in the process, so a single subscriber tap sees both sides of a
    conversation (its requests + the device's replies)."""
    global _installed
    if _installed:
        return
    _installed = True

    import time

    orig_rx = _ipv4.IPv4DatagramProtocol.datagram_received

    def patched_rx(self, data, addr):
        try:
            dst = None
            d = getattr(self, "destination", None)
            if d is not None and hasattr(d, "addrTuple"):
                dst = d.addrTuple
            if dst is None:
                # bacpypes3 doesn't stamp a destination on the receive
                # path; fall back to the receiving server's bind address
                # so replies don't show dst 0.0.0.0 in Wireshark.
                srv = getattr(self, "server", None)
                dst = getattr(srv, "local_address", None)
            record.append(("rx", tuple(addr), dst, bytes(data), time.time()))
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
            record.append(
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
    udp = struct.pack("!HHHH", src_port, dst_port, udp_len, 0) + payload
    total_len = 20 + udp_len
    ip_no_csum = struct.pack(
        "!BBHHHBBH4s4s",
        0x45, 0x00, total_len, 0x0000, 0x0000, 64, 17, 0x0000, src_ip, dst_ip,
    )
    csum = _ip_checksum(ip_no_csum)
    return ip_no_csum[:10] + struct.pack("!H", csum) + ip_no_csum[12:] + udp


def write_pcap(path: str, frames: list) -> int:
    with open(path, "wb") as f:
        f.write(struct.pack("<IHHiIII", _PCAP_MAGIC, 2, 4, 0, 0, 65535, _LINKTYPE_RAW))
        n = 0
        for _direction, src, dst, payload, ts in frames:
            pkt = _frame_ip_udp(src, dst, payload)
            ts_sec = int(ts)
            ts_usec = int((ts - ts_sec) * 1_000_000)
            f.write(struct.pack("<IIII", ts_sec, ts_usec, len(pkt), len(pkt)))
            f.write(pkt)
            n += 1
    return n


# ── light APDU summary (console only) ────────────────────────────────

_UNCONF = {0: "I-Am", 1: "I-Have", 2: "Unconfirmed-COV", 7: "Who-Has", 8: "Who-Is"}
_CONF = {1: "ConfirmedCOV", 5: "SubscribeCOV", 12: "ReadProperty", 14: "WriteProperty"}
_PDU_TYPE = {0: "Confirmed-REQ", 1: "Unconfirmed-REQ", 2: "Simple-ACK", 3: "Complex-ACK"}


def summarise(payload: bytes) -> str:
    if len(payload) < 6 or payload[0] != 0x81:
        return "non-BACnet/IP"
    npdu_control = payload[5]
    apdu_off = 6
    try:
        if npdu_control & 0x20:  # destination present
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
        if ptype == 1:
            svc = payload[apdu_off + 1]
            return f"{name} / {_UNCONF.get(svc, f'svc-{svc}')}"
        if ptype == 0:
            svc = payload[apdu_off + 3]
            return f"{name} / {_CONF.get(svc, f'svc-{svc}')}"
        return name
    except Exception:
        return "?"
