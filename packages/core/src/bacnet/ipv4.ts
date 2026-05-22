// BACnet/IP network validation — the IPv4 sister to MS/TP's link-layer
// checks. Catches the day-1 commissioning mistakes the field tech
// either learns from doing themselves or inherits as a "why won't this
// JACE see the NAE?" ticket.
//
// Findings here are intentionally narrow: this is config validation,
// not a full network sim. We model:
//
//   - duplicate-ip: two devices share an IPv4 → ARP collision
//   - subnet-mismatch: two devices wired by bacnet-ip have IPs in
//     different subnets per their masks → can't reach each other
//     without a BBMD/route
//   - inconsistent-mask: a single trunk uses different masks
//     (255.255.255.0 here, 255.255.0.0 there) — works by accident
//     until someone adds a third device that breaks the assumption
//   - gateway-not-in-subnet: the configured gateway isn't on the
//     same subnet as the device → packets to other subnets disappear
//   - private-public-mix: a device on a routable public IP wired to
//     the same trunk as 10.x / 192.168.x devices. Almost always a
//     misconfig (the dev typed their VPN's WAN IP on a JACE).
//
// All checks are pure. No name resolution, no ICMP, no live network IO.

export interface BacnetIpDevice {
  /** Canvas node id, opaque to this module. */
  readonly nodeId: string;
  readonly label: string;
  /** Dotted-quad, e.g. "192.168.1.10". Optional — devices without an
   *  IP are skipped (rather than treated as a fault). */
  readonly ipAddress?: string;
  /** Dotted-quad mask, e.g. "255.255.255.0". */
  readonly subnetMask?: string;
  /** Optional default gateway. */
  readonly gateway?: string;
}

/** An edge connecting two devices over BACnet/IP. */
export interface BacnetIpEdge {
  readonly edgeId: string;
  readonly aNodeId: string;
  readonly bNodeId: string;
}

export type Ipv4FindingId =
  | 'ipv4.duplicate-ip'
  | 'ipv4.subnet-mismatch'
  | 'ipv4.inconsistent-mask'
  | 'ipv4.gateway-not-in-subnet'
  | 'ipv4.invalid-ip'
  | 'ipv4.invalid-mask'
  | 'ipv4.private-public-mix';

export interface Ipv4Finding {
  readonly id: Ipv4FindingId;
  readonly severity: 'error' | 'warning' | 'info';
  readonly title: string;
  readonly description: string;
  /** Node ids implicated. */
  readonly nodeIds?: readonly string[];
  /** Edge ids implicated (when relevant). */
  readonly edgeIds?: readonly string[];
}

// ── IPv4 helpers ─────────────────────────────────────────────────────

/** Parse "192.168.1.10" → 0xC0A8010A. Returns null on malformed input. */
export function parseIpv4(s: string | undefined): number | null {
  if (!s) return null;
  const parts = s.trim().split('.');
  if (parts.length !== 4) return null;
  let v = 0;
  for (const p of parts) {
    if (!/^[0-9]+$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    v = (v << 8) | n;
  }
  // >>> 0 forces unsigned for `v` in case the top bit got set.
  return v >>> 0;
}

/** True iff `mask` is a contiguous run of 1s followed by 0s (i.e. a
 *  valid /N CIDR mask). 255.255.255.0 yes, 255.0.255.0 no.
 *
 *  Derivation: a contiguous mask m has the shape `1...10...0`. Its
 *  bitwise-NOT then has the shape `0...01...1` — a value of the form
 *  `2^k - 1`. Adding 1 to that yields exactly `2^k`, and ANDing a power
 *  of 2 with its predecessor (which IS `~m`) gives zero. So:
 *
 *      contiguous(m) ⇔ (~m + 1) & ~m === 0
 *
 *  All ops are in 32-bit unsigned space.
 */
export function isContiguousMask(mask: number): boolean {
  const inv = (~mask) >>> 0;
  if (inv === 0) return true;   // mask = 0xFFFFFFFF (/32) — degenerate
  return (((inv + 1) >>> 0) & inv) === 0;
}

/** Network address = ip & mask. */
export function networkAddress(ip: number, mask: number): number {
  return (ip & mask) >>> 0;
}

/** RFC1918 private space — 10/8, 172.16/12, 192.168/16. */
export function isPrivateIpv4(ip: number): boolean {
  const a = (ip >>> 24) & 0xff;
  const b = (ip >>> 16) & 0xff;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** Pretty-print a 32-bit unsigned int as dotted-quad. */
export function formatIpv4(ip: number): string {
  return [(ip >>> 24) & 0xff, (ip >>> 16) & 0xff, (ip >>> 8) & 0xff, ip & 0xff].join('.');
}

// ── Validator ────────────────────────────────────────────────────────

export function validateBacnetIpNetwork(
  devices: readonly BacnetIpDevice[],
  edges: readonly BacnetIpEdge[],
): Ipv4Finding[] {
  const findings: Ipv4Finding[] = [];

  // Parse each device once; flag parse failures up front.
  type Parsed = {
    dev: BacnetIpDevice;
    ip: number | null;
    mask: number | null;
    gateway: number | null;
  };
  const parsed = new Map<string, Parsed>();
  for (const d of devices) {
    const ip = parseIpv4(d.ipAddress);
    const mask = parseIpv4(d.subnetMask);
    const gateway = parseIpv4(d.gateway);
    if (d.ipAddress && ip === null) {
      findings.push({
        id: 'ipv4.invalid-ip',
        severity: 'error',
        title: `Invalid IP "${d.ipAddress}" on ${d.label}`,
        description: 'Each octet must be 0–255 with exactly three dots. Fix the entry or clear it.',
        nodeIds: [d.nodeId],
      });
    }
    if (d.subnetMask && mask === null) {
      findings.push({
        id: 'ipv4.invalid-mask',
        severity: 'error',
        title: `Invalid mask "${d.subnetMask}" on ${d.label}`,
        description: 'Subnet mask must be a valid dotted-quad like 255.255.255.0.',
        nodeIds: [d.nodeId],
      });
    } else if (mask !== null && !isContiguousMask(mask)) {
      findings.push({
        id: 'ipv4.invalid-mask',
        severity: 'error',
        title: `Non-contiguous mask "${d.subnetMask}" on ${d.label}`,
        description: 'A valid subnet mask is a run of 1-bits followed by 0-bits (e.g. 255.255.255.0 = /24). Discontiguous masks were deprecated by RFC 4632.',
        nodeIds: [d.nodeId],
      });
    }
    parsed.set(d.nodeId, { dev: d, ip, mask, gateway });
  }

  // 1. Duplicate IP.
  const byIp = new Map<number, BacnetIpDevice[]>();
  for (const { dev, ip } of parsed.values()) {
    if (ip === null) continue;
    const arr = byIp.get(ip) ?? [];
    arr.push(dev);
    byIp.set(ip, arr);
  }
  for (const [ip, devs] of byIp) {
    if (devs.length > 1) {
      findings.push({
        id: 'ipv4.duplicate-ip',
        severity: 'error',
        title: `Duplicate IP ${formatIpv4(ip)}`,
        description: `${devs.length} devices share ${formatIpv4(ip)}: ${devs.map((d) => d.label).join(', ')}. ARP collisions = one device wins and the others go intermittent. Re-address one of them.`,
        nodeIds: devs.map((d) => d.nodeId),
      });
    }
  }

  // 2. Gateway not in device's subnet.
  for (const p of parsed.values()) {
    if (p.ip === null || p.mask === null || p.gateway === null) continue;
    if (!isContiguousMask(p.mask)) continue;
    const devNet = networkAddress(p.ip, p.mask);
    const gwNet = networkAddress(p.gateway, p.mask);
    if (devNet !== gwNet) {
      findings.push({
        id: 'ipv4.gateway-not-in-subnet',
        severity: 'error',
        title: `Gateway ${formatIpv4(p.gateway)} not on ${p.dev.label}'s subnet`,
        description: `${p.dev.label} is on ${formatIpv4(devNet)}/${maskToCidr(p.mask)} but its gateway ${formatIpv4(p.gateway)} sits on ${formatIpv4(gwNet)}/${maskToCidr(p.mask)}. Off-subnet traffic disappears. Fix the gateway IP, the mask, or both.`,
        nodeIds: [p.dev.nodeId],
      });
    }
  }

  // 3. Per-edge: subnet match + mask consistency between the two endpoints.
  for (const e of edges) {
    const a = parsed.get(e.aNodeId);
    const b = parsed.get(e.bNodeId);
    if (!a || !b) continue;
    if (a.ip === null || b.ip === null || a.mask === null || b.mask === null) continue;
    if (!isContiguousMask(a.mask) || !isContiguousMask(b.mask)) continue;
    // Mask consistency first — flag before subnet check since a mask
    // mismatch IS one of the ways subnet-mismatch happens.
    if (a.mask !== b.mask) {
      findings.push({
        id: 'ipv4.inconsistent-mask',
        severity: 'warning',
        title: `Mask mismatch on bacnet-ip trunk`,
        description: `${a.dev.label} uses ${a.dev.subnetMask} (/${maskToCidr(a.mask)}), ${b.dev.label} uses ${b.dev.subnetMask} (/${maskToCidr(b.mask)}). Works by accident today; will silently break the first time a third device assumes one of the two masks.`,
        nodeIds: [a.dev.nodeId, b.dev.nodeId],
        edgeIds: [e.edgeId],
      });
    }
    // Subnet match — use each device's own mask. If the two networks
    // disagree under EITHER mask, the link is broken.
    const aNet = networkAddress(a.ip, a.mask);
    const bNet = networkAddress(b.ip, a.mask);
    if (aNet !== bNet) {
      findings.push({
        id: 'ipv4.subnet-mismatch',
        severity: 'error',
        title: `Subnet mismatch on bacnet-ip trunk`,
        description: `${a.dev.label} (${a.dev.ipAddress}/${maskToCidr(a.mask)}) and ${b.dev.label} (${b.dev.ipAddress}) end up on different networks (${formatIpv4(aNet)} vs ${formatIpv4(bNet)}) under ${a.dev.label}'s mask. These devices can't talk without a BBMD or a route — re-IP one of them or add a BBMD if you actually need cross-subnet BACnet.`,
        nodeIds: [a.dev.nodeId, b.dev.nodeId],
        edgeIds: [e.edgeId],
      });
    }

    // Private/public mix — at least one in RFC1918, the other not.
    const aPriv = isPrivateIpv4(a.ip);
    const bPriv = isPrivateIpv4(b.ip);
    if (aPriv !== bPriv) {
      findings.push({
        id: 'ipv4.private-public-mix',
        severity: 'warning',
        title: 'Mixed private + public IP on the same trunk',
        description: `${a.dev.label} (${a.dev.ipAddress}) and ${b.dev.label} (${b.dev.ipAddress}): one is on RFC1918 private space, the other is routable. Usually a misconfig — someone typed their VPN's public IP on a controller. Re-check the planned addressing.`,
        nodeIds: [a.dev.nodeId, b.dev.nodeId],
        edgeIds: [e.edgeId],
      });
    }
  }

  return findings;
}

function maskToCidr(mask: number): number {
  let count = 0;
  let m = mask >>> 0;
  while (m) {
    count += m & 1;
    m >>>= 1;
  }
  return count;
}
