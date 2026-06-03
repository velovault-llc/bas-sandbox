// Export the sandbox's BACnet packet log as a Wireshark-openable .pcap.
//
// Each logged packet already carries the real BACnet/IP wire bytes (the
// full BVLC frame, starting 0x81) when the encoder supports its service.
// We wrap those in synthetic-but-correct IPv4/UDP headers — all Wireshark
// needs to recognise UDP/47808 and decode full BACnet — and write a
// standard libpcap file (DLT_RAW, so no fake MAC layer).
//
// This is the mirror image of tools/bacnet-reference/pcap_tap.py on the
// Python side: both produce DLT_RAW pcaps wrapping real BVLC payloads, so
// a sandbox export and a live-device capture can be diffed directly.

/** The subset of a logged packet this exporter needs. `BacnetPacket`
 *  satisfies it structurally; kept local so the module has no dependency
 *  on the Svelte store and stays unit-testable. */
export interface PcapPacketInput {
  readonly simSec: number;
  /** Full BACnet/IP frame as lowercase hex (BVLC+NPDU+APDU). Packets
   *  without this (e.g. MS/TP link frames) are skipped — they have no
   *  BACnet/IP framing to wrap. */
  readonly bytes?: string;
  readonly srcMac?: number;
  readonly dstMac?: number;
  readonly srcLabel?: string;
  readonly dstLabel?: string;
}

const PCAP_MAGIC = 0xa1b2c3d4;
const LINKTYPE_RAW = 101;
const BACNET_PORT = 47808;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

/** Stable synthetic IPv4 for a node, keyed by its label/MAC. The actual
 *  addresses are irrelevant to the BACnet decode; they only need to be
 *  consistent so a given node keeps one address across the capture. */
function makeIpAssigner(): (key: string | undefined, broadcast?: boolean) => string {
  const map = new Map<string, string>();
  let next = 11; // 10.13.0.11, .12, …
  return (key, broadcast) => {
    if (broadcast) return '255.255.255.255';
    const k = key ?? 'unknown';
    let ip = map.get(k);
    if (!ip) {
      ip = `10.13.0.${next}`;
      next = next >= 254 ? 254 : next + 1;
      map.set(k, ip);
    }
    return ip;
  };
}

function ipToBytes(ip: string): number[] {
  return ip.split('.').map((n) => parseInt(n, 10) & 0xff);
}

function ipChecksum(header: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < header.length; i += 2) {
    sum += (header[i] << 8) | header[i + 1];
  }
  sum = (sum >>> 16) + (sum & 0xffff);
  sum += sum >>> 16;
  return ~sum & 0xffff;
}

function frameIpUdp(srcIp: string, dstIp: string, srcPort: number, dstPort: number, payload: Uint8Array): Uint8Array {
  const udpLen = 8 + payload.length;
  const totalLen = 20 + udpLen;
  const buf = new Uint8Array(totalLen);
  const dv = new DataView(buf.buffer);
  // IPv4 header
  buf[0] = 0x45; // version 4, IHL 5
  buf[1] = 0x00;
  dv.setUint16(2, totalLen);
  dv.setUint16(4, 0x0000); // identification
  dv.setUint16(6, 0x0000); // flags + fragment
  buf[8] = 64; // TTL
  buf[9] = 17; // UDP
  dv.setUint16(10, 0x0000); // checksum placeholder
  ipToBytes(srcIp).forEach((b, i) => (buf[12 + i] = b));
  ipToBytes(dstIp).forEach((b, i) => (buf[16 + i] = b));
  dv.setUint16(10, ipChecksum(buf.subarray(0, 20)));
  // UDP header
  dv.setUint16(20, srcPort);
  dv.setUint16(22, dstPort);
  dv.setUint16(24, udpLen);
  dv.setUint16(26, 0x0000); // checksum 0 = not computed (legal on IPv4)
  buf.set(payload, 28);
  return buf;
}

/** Build a libpcap byte stream from logged packets. Packets without
 *  `bytes` are skipped. Pure — no DOM, unit-testable. */
export function packetsToPcap(packets: readonly PcapPacketInput[]): Uint8Array {
  const ipFor = makeIpAssigner();
  const records: Uint8Array[] = [];

  for (const p of packets) {
    if (!p.bytes) continue;
    const payload = hexToBytes(p.bytes);
    if (payload.length === 0) continue;

    const srcKey = p.srcLabel ?? (p.srcMac !== undefined ? `mac:${p.srcMac}` : 'src');
    const isBroadcast = p.dstLabel === undefined && p.dstMac === undefined;
    const dstKey = p.dstLabel ?? (p.dstMac !== undefined ? `mac:${p.dstMac}` : undefined);
    const srcIp = ipFor(srcKey);
    const dstIp = ipFor(dstKey, isBroadcast);

    const ipPkt = frameIpUdp(srcIp, dstIp, BACNET_PORT, BACNET_PORT, payload);

    const tsSec = Math.max(0, Math.floor(p.simSec));
    let tsUsec = Math.round((p.simSec - tsSec) * 1_000_000);
    if (tsUsec >= 1_000_000) tsUsec -= 1_000_000;

    const rec = new Uint8Array(16 + ipPkt.length);
    const rdv = new DataView(rec.buffer);
    rdv.setUint32(0, tsSec, true);
    rdv.setUint32(4, tsUsec, true);
    rdv.setUint32(8, ipPkt.length, true);
    rdv.setUint32(12, ipPkt.length, true);
    rec.set(ipPkt, 16);
    records.push(rec);
  }

  const body = records.reduce((n, r) => n + r.length, 0);
  const out = new Uint8Array(24 + body);
  const gdv = new DataView(out.buffer);
  gdv.setUint32(0, PCAP_MAGIC, true);
  gdv.setUint16(4, 2, true); // version major
  gdv.setUint16(6, 4, true); // version minor
  gdv.setInt32(8, 0, true); // thiszone
  gdv.setUint32(12, 0, true); // sigfigs
  gdv.setUint32(16, 65535, true); // snaplen
  gdv.setUint32(20, LINKTYPE_RAW, true); // network
  let off = 24;
  for (const r of records) {
    out.set(r, off);
    off += r.length;
  }
  return out;
}

/** Count how many packets will actually be written (have BACnet/IP bytes). */
export function countExportable(packets: readonly PcapPacketInput[]): number {
  return packets.reduce((n, p) => n + (p.bytes && p.bytes.length > 0 ? 1 : 0), 0);
}

/** Trigger a browser download of the packet log as a .pcap. Returns the
 *  number of frames written. Browser-only (uses Blob + <a download>). */
export function downloadPcap(
  packets: readonly PcapPacketInput[],
  filename = 'sandbox.pcap',
): number {
  const data = packetsToPcap(packets);
  // packetsToPcap returns a fresh, exact-size Uint8Array, so its backing
  // buffer is the data verbatim. Cast resolves the SharedArrayBuffer union
  // TS infers for Uint8Array.buffer when SharedArrayBuffer is in lib.
  const blob = new Blob([data.buffer as ArrayBuffer], { type: 'application/vnd.tcpdump.pcap' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return countExportable(packets);
}
