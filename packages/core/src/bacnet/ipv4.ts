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
  /** True when this device is configured to act as a BACnet Broadcast
   *  Management Device — it bridges BACnet broadcasts (Who-Is, I-Am,
   *  UDP/47808) between its own subnet and the peer BBMDs listed in
   *  `bdtPeers`. Without a BBMD on each subnet, cross-subnet BACnet
   *  discovery fails silently — devices on the other side don't show
   *  up in the supervisor's "live" list. */
  readonly isBBMD?: boolean;
  /** Broadcast Distribution Table — IPs of peer BBMDs this BBMD is
   *  configured to forward broadcasts to. Each entry is a dotted-quad.
   *  Only meaningful when `isBBMD === true`. */
  readonly bdtPeers?: readonly string[];
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
  | 'ipv4.private-public-mix'
  | 'ipv4.zone-cidr-mismatch'
  | 'ipv4.zone-invalid-cidr'
  | 'ipv4.outside-any-zone'
  | 'ipv4.cross-subnet-no-bridge'
  | 'ipv4.bbmd-empty-bdt'
  | 'ipv4.bbmd-asymmetric-bdt'
  | 'ipv4.bbmd-peer-unknown';

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
    // disagree under EITHER mask, the link is broken UNLESS a BBMD on
    // each side knows about the other (Net.2 bridge-aware validation).
    const aNet = networkAddress(a.ip, a.mask);
    const bNet = networkAddress(b.ip, a.mask);
    if (aNet !== bNet) {
      const bridgeStatus = bbmdBridgeStatus(a.dev, b.dev);
      if (bridgeStatus.kind === 'bridged') {
        // OK — informational only. Tell the reader WHY the cross-subnet
        // trunk is valid, since "this works because both sides are
        // BBMDs with each other in their BDT" is exactly the kind of
        // fact a tech needs to know.
        findings.push({
          id: 'ipv4.cross-subnet-no-bridge',
          severity: 'info',
          title: `Cross-subnet BACnet/IP — bridged by BBMDs`,
          description: `${a.dev.label} (${formatIpv4(aNet)}/${maskToCidr(a.mask)}) ↔ ${b.dev.label} (${formatIpv4(bNet)}/${maskToCidr(b.mask)}). Both ends are BBMDs and each lists the other in its BDT, so broadcasts forward correctly. Healthy cross-subnet BACnet.`,
          nodeIds: [a.dev.nodeId, b.dev.nodeId],
          edgeIds: [e.edgeId],
        });
      } else if (bridgeStatus.kind === 'asymmetric') {
        // One side has the other in its BDT but not vice versa — this
        // is the famously brittle "broadcasts only flow one direction"
        // misconfig. Devices on the side without the BDT entry never
        // see broadcasts from the other side, so they don't I-Am
        // properly.
        findings.push({
          id: 'ipv4.bbmd-asymmetric-bdt',
          severity: 'error',
          title: `BBMD BDT asymmetric — broadcasts flow only one direction`,
          description: `${bridgeStatus.haveSide.label} has ${bridgeStatus.missingSide.label} in its BDT, but ${bridgeStatus.missingSide.label} doesn't have ${bridgeStatus.haveSide.label}. Broadcasts will forward one way and disappear the other. Add the missing peer (${bridgeStatus.haveSide.ipAddress}) to ${bridgeStatus.missingSide.label}'s BDT.`,
          nodeIds: [a.dev.nodeId, b.dev.nodeId],
          edgeIds: [e.edgeId],
        });
      } else if (bridgeStatus.kind === 'one-side-bbmd') {
        // Only one side is a BBMD — the other isn't bridging at all.
        findings.push({
          id: 'ipv4.cross-subnet-no-bridge',
          severity: 'error',
          title: `Cross-subnet BACnet/IP needs BBMDs on BOTH ends`,
          description: `${a.dev.label} (${a.dev.ipAddress}/${maskToCidr(a.mask)}) and ${b.dev.label} (${b.dev.ipAddress}) are on different subnets. ${bridgeStatus.bbmdSide.label} is a BBMD but ${bridgeStatus.nonBbmdSide.label} isn't — broadcasts have nowhere to land on the far side. Either make ${bridgeStatus.nonBbmdSide.label} a BBMD too, or re-IP onto the same subnet.`,
          nodeIds: [a.dev.nodeId, b.dev.nodeId],
          edgeIds: [e.edgeId],
        });
      } else {
        // No BBMD on either side — the classic subnet-mismatch.
        findings.push({
          id: 'ipv4.subnet-mismatch',
          severity: 'error',
          title: `Subnet mismatch on bacnet-ip trunk`,
          description: `${a.dev.label} (${a.dev.ipAddress}/${maskToCidr(a.mask)}) and ${b.dev.label} (${b.dev.ipAddress}) end up on different networks (${formatIpv4(aNet)} vs ${formatIpv4(bNet)}) under ${a.dev.label}'s mask. These devices can't talk without a BBMD or a route — re-IP one of them or mark a node on each side as a BBMD with the other in its BDT.`,
          nodeIds: [a.dev.nodeId, b.dev.nodeId],
          edgeIds: [e.edgeId],
        });
      }
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

  // 4. Per-BBMD: BDT sanity. A BBMD with no peers in its BDT silently
  // fails to forward; a BBMD whose BDT lists IPs not seen on the canvas
  // is pointing at ghosts — a useful "did the integrator forget to
  // update the BDT after a controller swap?" finding.
  const ipToDevice = new Map<number, BacnetIpDevice>();
  for (const d of devices) {
    const ip = parseIpv4(d.ipAddress);
    if (ip !== null) ipToDevice.set(ip, d);
  }
  for (const d of devices) {
    if (!d.isBBMD) continue;
    const peers = d.bdtPeers ?? [];
    if (peers.length === 0) {
      findings.push({
        id: 'ipv4.bbmd-empty-bdt',
        severity: 'warning',
        title: `${d.label} is a BBMD with an empty BDT`,
        description: `${d.label} is configured as a BBMD but its Broadcast Distribution Table is empty — no peer BBMDs to forward broadcasts to. The BBMD will accept local broadcasts but never propagate them. Add the IP of every BBMD on remote subnets that this BBMD should reach.`,
        nodeIds: [d.nodeId],
      });
    }
    for (const peer of peers) {
      const peerIp = parseIpv4(peer);
      if (peerIp === null) {
        findings.push({
          id: 'ipv4.bbmd-peer-unknown',
          severity: 'error',
          title: `${d.label} BDT entry "${peer}" isn't a valid IP`,
          description: `Each BDT peer must be a dotted-quad IPv4 address. Fix or remove this entry.`,
          nodeIds: [d.nodeId],
        });
        continue;
      }
      if (!ipToDevice.has(peerIp)) {
        findings.push({
          id: 'ipv4.bbmd-peer-unknown',
          severity: 'warning',
          title: `${d.label} BDT peer ${peer} not present on the canvas`,
          description: `${d.label}'s BDT names ${peer} as a peer BBMD, but no device on the canvas has that IP. The peer may exist in the real install — or this is a stale BDT entry from before someone re-IP'd a controller. Confirm with the as-built drawings.`,
          nodeIds: [d.nodeId],
        });
      }
    }
  }

  return findings;
}

/** Result of evaluating whether a cross-subnet bacnet-ip edge is
 *  bridged by BBMDs at each end. */
type BridgeStatus =
  /** Both endpoints are BBMDs AND each lists the other in its BDT. */
  | { kind: 'bridged' }
  /** Both endpoints are BBMDs but only one direction's BDT entry is
   *  present. Broadcasts flow one way only. */
  | { kind: 'asymmetric'; haveSide: BacnetIpDevice; missingSide: BacnetIpDevice }
  /** Exactly one endpoint is a BBMD; the other isn't bridging at all. */
  | { kind: 'one-side-bbmd'; bbmdSide: BacnetIpDevice; nonBbmdSide: BacnetIpDevice }
  /** Neither endpoint is a BBMD — the classic unbridged cross-subnet. */
  | { kind: 'none' };

function bbmdHasPeer(bbmd: BacnetIpDevice, peerIp: string | undefined): boolean {
  if (!peerIp) return false;
  const target = parseIpv4(peerIp);
  if (target === null) return false;
  for (const p of bbmd.bdtPeers ?? []) {
    if (parseIpv4(p) === target) return true;
  }
  return false;
}

function bbmdBridgeStatus(a: BacnetIpDevice, b: BacnetIpDevice): BridgeStatus {
  const aBb = !!a.isBBMD;
  const bBb = !!b.isBBMD;
  if (!aBb && !bBb) return { kind: 'none' };
  if (aBb && !bBb) return { kind: 'one-side-bbmd', bbmdSide: a, nonBbmdSide: b };
  if (!aBb && bBb) return { kind: 'one-side-bbmd', bbmdSide: b, nonBbmdSide: a };
  // Both BBMDs — check the BDT cross-reference.
  const aSeesB = bbmdHasPeer(a, b.ipAddress);
  const bSeesA = bbmdHasPeer(b, a.ipAddress);
  if (aSeesB && bSeesA) return { kind: 'bridged' };
  if (aSeesB && !bSeesA) return { kind: 'asymmetric', haveSide: a, missingSide: b };
  if (!aSeesB && bSeesA) return { kind: 'asymmetric', haveSide: b, missingSide: a };
  // Both BBMDs but neither has the other → treat as asymmetric with
  // an arbitrary missing-side pointer; the message names both.
  return { kind: 'asymmetric', haveSide: a, missingSide: b };
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

// ── CIDR helpers + subnet-zone validator (Net.1) ─────────────────────
//
// A "subnet zone" is a visual container on the canvas (a drawn rectangle
// with its own CIDR + label). Net.1 introduces the visual model; this
// module owns the parsing + geometric-membership-vs-IP-membership check
// so the same fact a tech learns in the field — "the IP says one network,
// the patch panel says another" — surfaces as a validator finding.

export interface ParsedCidr {
  /** Network address (32-bit unsigned) — already masked. */
  readonly network: number;
  /** Prefix length 0..32. */
  readonly prefix: number;
}

/** Parse "10.0.1.0/24" or "192.168.1.5/16" — returns the network address
 *  (masked) and prefix length. Returns null on malformed input. Accepts
 *  host bits in the IP portion (we mask them off rather than rejecting). */
export function parseCidr(s: string | undefined): ParsedCidr | null {
  if (!s) return null;
  const trimmed = s.trim();
  const slash = trimmed.indexOf('/');
  if (slash < 0) return null;
  const ipPart = trimmed.slice(0, slash);
  const prefixPart = trimmed.slice(slash + 1);
  const ip = parseIpv4(ipPart);
  if (ip === null) return null;
  if (!/^[0-9]+$/.test(prefixPart)) return null;
  const prefix = Number(prefixPart);
  if (prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: (ip & mask) >>> 0, prefix };
}

/** True iff `ip` lies within `cidr`. */
export function ipInCidr(ip: number, cidr: ParsedCidr): boolean {
  const mask = cidr.prefix === 0 ? 0 : (0xffffffff << (32 - cidr.prefix)) >>> 0;
  return ((ip & mask) >>> 0) === cidr.network;
}

/** Pretty-print a CIDR back to "a.b.c.d/N". */
export function formatCidr(cidr: ParsedCidr): string {
  return `${formatIpv4(cidr.network)}/${cidr.prefix}`;
}

/** A drawn subnet zone on the canvas. Membership is geometric (whether a
 *  node's center sits inside the rectangle); the CIDR is the policy the
 *  zone claims to enforce, and we flag mismatches. */
export interface SubnetZone {
  readonly zoneId: string;
  readonly label: string;
  readonly cidr: string;
  /** Rectangle in canvas coords. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A device positioned on the canvas — same shape as BacnetIpDevice plus a
 *  center point so the zone check is geometric. */
export interface PlacedBacnetIpDevice extends BacnetIpDevice {
  /** Center of the node's rendered rect, in canvas coords. */
  readonly x: number;
  readonly y: number;
}

function pointInRect(px: number, py: number, z: SubnetZone): boolean {
  return px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h;
}

/** Validate subnet zones against placed devices.
 *
 *  Findings:
 *   - ipv4.zone-invalid-cidr: a zone's CIDR string doesn't parse.
 *   - ipv4.zone-cidr-mismatch: a device sits geometrically inside a zone
 *     but its IP is outside that zone's CIDR (the "you put it on this VLAN
 *     but its IP says otherwise" mistake).
 *   - ipv4.outside-any-zone: a device has an IP but isn't inside any drawn
 *     zone. Informational — only fires when at least one zone exists, so
 *     a canvas with no zones doesn't drown the user in noise. */
export function validateIpZones(
  devices: readonly PlacedBacnetIpDevice[],
  zones: readonly SubnetZone[],
): Ipv4Finding[] {
  const findings: Ipv4Finding[] = [];
  // Pre-parse every zone CIDR; flag the invalid ones up front.
  const parsedZones: Array<{ zone: SubnetZone; cidr: ParsedCidr | null }> = [];
  for (const z of zones) {
    const cidr = parseCidr(z.cidr);
    if (cidr === null) {
      findings.push({
        id: 'ipv4.zone-invalid-cidr',
        severity: 'error',
        title: `Invalid CIDR "${z.cidr}" on zone ${z.label}`,
        description: `A subnet zone needs a valid CIDR like 10.0.1.0/24. Fix the zone's CIDR or delete it.`,
      });
    }
    parsedZones.push({ zone: z, cidr });
  }
  if (zones.length === 0) return findings;

  for (const d of devices) {
    const ip = parseIpv4(d.ipAddress);
    if (ip === null) continue; // no IP, nothing to compare
    let containingZone: { zone: SubnetZone; cidr: ParsedCidr | null } | null = null;
    for (const pz of parsedZones) {
      if (pointInRect(d.x, d.y, pz.zone)) {
        containingZone = pz;
        break; // first hit wins; overlapping zones are an authoring problem
      }
    }
    if (!containingZone) {
      findings.push({
        id: 'ipv4.outside-any-zone',
        severity: 'info',
        title: `${d.label} (${d.ipAddress}) isn't in any subnet zone`,
        description: `Drop a subnet zone around this device to model the VLAN/subnet it actually lives on. (Geometric containment only — not a config error by itself.)`,
        nodeIds: [d.nodeId],
      });
      continue;
    }
    if (containingZone.cidr === null) continue; // already flagged above
    if (!ipInCidr(ip, containingZone.cidr)) {
      findings.push({
        id: 'ipv4.zone-cidr-mismatch',
        severity: 'error',
        title: `${d.label} (${d.ipAddress}) is on zone ${containingZone.zone.label} but its IP is outside ${containingZone.zone.cidr}`,
        description: `The device is drawn inside the ${containingZone.zone.label} subnet zone, but ${d.ipAddress} doesn't fall in ${containingZone.zone.cidr}. Either move the device to the correct zone or re-IP it so it actually belongs.`,
        nodeIds: [d.nodeId],
      });
    }
  }
  return findings;
}
