// Layer-2 switching + VLAN validation — the link-layer sibling to the L3
// checks in ipv4.ts. This is the half of the network that corners a BAS
// tech on an IT-managed site: two devices can have flawless IPs on the
// same subnet and STILL not talk, because the switch ports they plug into
// are on different VLANs.
//
// What we model:
//
//   - Switches with a port table. Access ports carry one untagged VLAN
//     (where end devices plug in); trunk ports carry many tagged VLANs
//     (switch-to-switch uplinks, 802.1Q) plus a native (untagged) VLAN.
//
//   - Broadcast domains, COMPUTED from the switch fabric. A VLAN spans
//     switches only across trunks that actually carry it. Two devices are
//     in the same broadcast domain (a Who-Is reaches both) iff their
//     access segments land in the same connected component.
//
//   - The mismatches a tech meets in the field, as findings: a port on the
//     wrong VLAN, a trunk that forgot a VLAN, a native-VLAN mismatch, an IP
//     that disagrees with its port's VLAN subnet.
//
// Two facts this layer is here to teach:
//
//   1. VLAN != subnet, but they should agree. The classic bug is a device
//      whose IP belongs to one subnet but whose port is on another VLAN.
//   2. Same subnet does NOT mean reachable. Same /24, different VLAN, no
//      comms — the L2 explanation the ipv4.subnet-mismatch check can't give.
//
// All checks are pure. No name resolution, no live IO. Reuses the IPv4
// helpers (parseIpv4, parseCidr, ipInCidr, …) so addressing math stays in
// one place.

import {
  parseIpv4,
  parseCidr,
  ipInCidr,
  networkAddress,
  isContiguousMask,
  formatIpv4,
} from './ipv4.js';

// ── Model ────────────────────────────────────────────────────────────

/** Valid 802.1Q VLAN id range. 0 and 4095 are reserved by the standard. */
export const VLAN_MIN = 1;
export const VLAN_MAX = 4094;

export type SwitchPortMode = 'access' | 'trunk';

/** One physical jack on a switch. Configured the way you'd see it in the
 *  switch's web UI: access (one untagged VLAN) or trunk (tagged list +
 *  native untagged VLAN). */
export interface SwitchPort {
  /** Stable id, used as the canvas edge's targetHandle so a device-to-switch
   *  link knows which port it lands on. */
  readonly id: string;
  readonly label?: string;
  readonly mode: SwitchPortMode;
  /** Required when mode === 'access' — the single VLAN this port carries. */
  readonly accessVlan?: number;
  /** Required when mode === 'trunk' — the tagged VLANs allowed on the trunk. */
  readonly trunkVlans?: readonly number[];
  /** Untagged VLAN on a trunk (802.1Q native). Defaults to 1 when omitted. */
  readonly nativeVlan?: number;
}

export interface L2Switch {
  readonly nodeId: string;
  readonly label: string;
  readonly ports: readonly SwitchPort[];
}

/** An edge as the L2 layer sees it. When an endpoint is a switch, the
 *  matching handle is the port id the link lands on. */
export interface L2Link {
  readonly edgeId: string;
  readonly aNodeId: string;
  readonly aHandle?: string;
  readonly bNodeId: string;
  readonly bHandle?: string;
}

/** A device on the fabric — anything that isn't a switch. IP fields are
 *  optional; they drive the IP-vs-VLAN-subnet cross-check. */
export interface L2Device {
  readonly nodeId: string;
  readonly label: string;
  readonly ipAddress?: string;
  readonly subnetMask?: string;
}

/** A VLAN definition, derived on the UI side from a subnet zone that carries
 *  a `vlanId`. Ties a VLAN id to a CIDR + human label so we can flag a
 *  device whose IP doesn't belong to the VLAN its port is on. */
export interface VlanDef {
  readonly vlanId: number;
  readonly cidr?: string;
  readonly label?: string;
}

export type L2FindingId =
  | 'l2.vlan-id-invalid'
  | 'l2.access-port-no-vlan'
  | 'l2.trunk-no-vlans'
  | 'l2.link-port-unresolved'
  | 'l2.endpoint-on-wrong-port-mode'
  | 'l2.vlan-isolated-pair'
  | 'l2.trunk-missing-vlan'
  | 'l2.native-vlan-mismatch'
  | 'l2.ip-vlan-subnet-mismatch'
  | 'l2.vlan-no-devices';

/** Same shape as Ipv4Finding so the network-health pill, runtime-log
 *  de-dup, and findings panel render L2 findings with zero new plumbing. */
export interface L2Finding {
  readonly id: L2FindingId;
  readonly severity: 'error' | 'warning' | 'info';
  readonly title: string;
  readonly description: string;
  readonly nodeIds?: readonly string[];
  readonly edgeIds?: readonly string[];
}

// ── Broadcast-domain computation ─────────────────────────────────────

export interface BroadcastDomainResult {
  /** Canonical domain key per device node id. Only present for devices that
   *  are actually attached to the fabric (wired to a switch port, or
   *  directly to another device). Two devices share a broadcast domain iff
   *  their keys are equal. */
  readonly domainOf: ReadonlyMap<string, string>;
  /** Access VLAN each switch-attached device sits on. */
  readonly deviceVlan: ReadonlyMap<string, number>;
  /** Device node ids grouped by canonical domain key (attached devices only). */
  readonly groups: ReadonlyMap<string, readonly string[]>;
  /** "switchId|vlan" → count of access-member devices on that segment. */
  readonly accessMembers: ReadonlyMap<string, number>;
}

/** Disjoint-set (union-find) over string keys — device node ids and switch
 *  segment keys ("seg:<switchId>:<vlan>") live in the same namespace. */
class DSU {
  private parent = new Map<string, string>();
  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
  find(x: string): string {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression.
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const segKey = (switchId: string, vlan: number): string => `seg:${switchId}:${vlan}`;
const memberKey = (switchId: string, vlan: number): string => `${switchId}|${vlan}`;

/** The set of VLANs a trunk port carries on the wire — the tagged list
 *  plus the native (untagged) VLAN. */
function carriedVlans(port: SwitchPort): Set<number> {
  const s = new Set<number>(port.trunkVlans ?? []);
  s.add(port.nativeVlan ?? 1);
  return s;
}

function resolvePort(sw: L2Switch, handle: string | undefined): SwitchPort | undefined {
  if (!handle) return undefined;
  return sw.ports.find((p) => p.id === handle);
}

/**
 * Partition the fabric into VLAN broadcast domains.
 *
 * - An access port attaches its device to segment (switch, accessVlan).
 * - An end device on a trunk port lands on the trunk's native VLAN
 *   (what a real switch does with untagged frames).
 * - A trunk↔trunk uplink unions segment (A, V) with (B, V) for every VLAN
 *   V carried by BOTH ends — so a VLAN the trunk omits stays islanded.
 * - A direct device↔device edge (neither end a switch) unions them
 *   directly: a switch-less canvas behaves exactly as before.
 */
export function computeBroadcastDomains(
  switches: readonly L2Switch[],
  devices: readonly L2Device[],
  links: readonly L2Link[],
): BroadcastDomainResult {
  const dsu = new DSU();
  const switchMap = new Map(switches.map((s) => [s.nodeId, s]));
  const deviceSet = new Set(devices.map((d) => d.nodeId));
  const deviceVlan = new Map<string, number>();
  const accessMembers = new Map<string, number>();
  const attached = new Set<string>();

  const bumpMember = (switchId: string, vlan: number) => {
    const k = memberKey(switchId, vlan);
    accessMembers.set(k, (accessMembers.get(k) ?? 0) + 1);
  };

  for (const link of links) {
    const aSw = switchMap.get(link.aNodeId);
    const bSw = switchMap.get(link.bNodeId);

    // Direct device↔device — implicit same broadcast domain (back-compat).
    if (!aSw && !bSw) {
      if (deviceSet.has(link.aNodeId) && deviceSet.has(link.bNodeId)) {
        dsu.union(link.aNodeId, link.bNodeId);
        attached.add(link.aNodeId);
        attached.add(link.bNodeId);
      }
      continue;
    }

    // Switch↔switch — an uplink. Bridge each VLAN both ends carry.
    if (aSw && bSw) {
      const pa = resolvePort(aSw, link.aHandle);
      const pb = resolvePort(bSw, link.bHandle);
      if (!pa || !pb) continue; // unresolved port — flagged by validator
      if (pa.mode === 'trunk' && pb.mode === 'trunk') {
        const carried = carriedVlans(pa);
        const otherCarried = carriedVlans(pb);
        for (const v of carried) {
          if (otherCarried.has(v)) {
            dsu.union(segKey(aSw.nodeId, v), segKey(bSw.nodeId, v));
          }
        }
      } else {
        // Access (or mixed) uplink: only the access VLAN(s) cross, untagged.
        const va = pa.mode === 'access' ? pa.accessVlan : pa.nativeVlan ?? 1;
        const vb = pb.mode === 'access' ? pb.accessVlan : pb.nativeVlan ?? 1;
        if (va != null && vb != null) {
          dsu.union(segKey(aSw.nodeId, va), segKey(bSw.nodeId, vb));
        }
      }
      continue;
    }

    // One switch, one device — the common access-port case.
    const sw = (aSw ?? bSw)!;
    const devId = aSw ? link.bNodeId : link.aNodeId;
    const handle = aSw ? link.aHandle : link.bHandle;
    if (!deviceSet.has(devId)) continue;
    const port = resolvePort(sw, handle);
    if (!port) continue; // unresolved — flagged by validator
    const vlan = port.mode === 'access' ? port.accessVlan : port.nativeVlan ?? 1;
    if (vlan == null) continue; // access port with no VLAN — flagged by validator
    dsu.union(devId, segKey(sw.nodeId, vlan));
    deviceVlan.set(devId, vlan);
    bumpMember(sw.nodeId, vlan);
    attached.add(devId);
  }

  const domainOf = new Map<string, string>();
  const groups = new Map<string, string[]>();
  for (const id of attached) {
    const root = dsu.find(id);
    domainOf.set(id, root);
    const arr = groups.get(root) ?? [];
    arr.push(id);
    groups.set(root, arr);
  }

  return { domainOf, deviceVlan, groups, accessMembers };
}

// ── Validator ────────────────────────────────────────────────────────

function maskToCidr(mask: number): number {
  let count = 0;
  let m = mask >>> 0;
  while (m) {
    count += m & 1;
    m >>>= 1;
  }
  return count;
}

function vlanInRange(v: number): boolean {
  return Number.isInteger(v) && v >= VLAN_MIN && v <= VLAN_MAX;
}

/**
 * Validate the L2/VLAN layer. Returns findings in the shared finding shape.
 *
 * The headline finding is `l2.vlan-isolated-pair`: devices whose IPs land in
 * the same subnet but whose switch ports put them in different broadcast
 * domains. That's the "same /24, can't ping" lesson the L3 checks can't see.
 */
export function validateL2Vlan(
  switches: readonly L2Switch[],
  devices: readonly L2Device[],
  links: readonly L2Link[],
  vlans: readonly VlanDef[] = [],
): L2Finding[] {
  const findings: L2Finding[] = [];
  const switchMap = new Map(switches.map((s) => [s.nodeId, s]));
  const deviceMap = new Map(devices.map((d) => [d.nodeId, d]));

  // 0. VLAN-id range sanity on every configured port.
  for (const sw of switches) {
    for (const p of sw.ports) {
      const bad: number[] = [];
      if (p.mode === 'access' && p.accessVlan != null && !vlanInRange(p.accessVlan)) {
        bad.push(p.accessVlan);
      }
      if (p.mode === 'trunk') {
        for (const v of p.trunkVlans ?? []) if (!vlanInRange(v)) bad.push(v);
        if (p.nativeVlan != null && !vlanInRange(p.nativeVlan)) bad.push(p.nativeVlan);
      }
      if (bad.length > 0) {
        findings.push({
          id: 'l2.vlan-id-invalid',
          severity: 'error',
          title: `Invalid VLAN id on ${sw.label} port ${p.label ?? p.id}`,
          description: `VLAN ${bad.join(', ')} is outside the valid 802.1Q range (${VLAN_MIN}–${VLAN_MAX}). 0 and 4095 are reserved. Fix the port's VLAN.`,
          nodeIds: [sw.nodeId],
        });
      }
    }
  }

  const domains = computeBroadcastDomains(switches, devices, links);

  // 1. Per-link port checks — unresolved port, wrong port mode, access port
  //    with no VLAN, trunk with no VLANs.
  const usedTrunkPorts = new Set<string>(); // `${switchId}:${portId}` flagged once
  for (const link of links) {
    const aSw = switchMap.get(link.aNodeId);
    const bSw = switchMap.get(link.bNodeId);
    if (!aSw && !bSw) continue;

    const endpoints: Array<{ sw: L2Switch; handle?: string; otherIsSwitch: boolean }> = [];
    if (aSw) endpoints.push({ sw: aSw, handle: link.aHandle, otherIsSwitch: !!bSw });
    if (bSw) endpoints.push({ sw: bSw, handle: link.bHandle, otherIsSwitch: !!aSw });

    for (const { sw, handle, otherIsSwitch } of endpoints) {
      const port = resolvePort(sw, handle);
      if (!port) {
        findings.push({
          id: 'l2.link-port-unresolved',
          severity: 'warning',
          title: `Link to ${sw.label} doesn't land on a known port`,
          description: `A cable into ${sw.label} has no resolvable port (handle ${handle ?? '—'}). Re-drop the wire onto a specific port so its VLAN can be validated.`,
          nodeIds: [sw.nodeId],
          edgeIds: [link.edgeId],
        });
        continue;
      }
      if (port.mode === 'access') {
        if (port.accessVlan == null) {
          findings.push({
            id: 'l2.access-port-no-vlan',
            severity: 'error',
            title: `${sw.label} port ${port.label ?? port.id} has no VLAN`,
            description: `An access port carrying a device must be assigned a VLAN. Set the access VLAN on this port — until then the device sits in no broadcast domain.`,
            nodeIds: [sw.nodeId],
            edgeIds: [link.edgeId],
          });
        }
        if (otherIsSwitch) {
          findings.push({
            id: 'l2.endpoint-on-wrong-port-mode',
            severity: 'warning',
            title: `Switch uplink on an access port (${sw.label} ${port.label ?? port.id})`,
            description: `${sw.label} is wired to another switch through an ACCESS port, so only one untagged VLAN crosses the link. Switch-to-switch uplinks are normally trunk ports so every VLAN can pass. Convert it to a trunk unless single-VLAN is intentional.`,
            nodeIds: [sw.nodeId],
            edgeIds: [link.edgeId],
          });
        }
      } else {
        // trunk
        const carriedCount = (port.trunkVlans ?? []).length;
        const tkey = `${sw.nodeId}:${port.id}`;
        if (carriedCount === 0 && !usedTrunkPorts.has(tkey)) {
          usedTrunkPorts.add(tkey);
          findings.push({
            id: 'l2.trunk-no-vlans',
            severity: 'warning',
            title: `${sw.label} trunk ${port.label ?? port.id} carries no tagged VLANs`,
            description: `This trunk port has an empty allowed-VLAN list, so only its native VLAN (${port.nativeVlan ?? 1}) crosses. Add the VLANs this uplink is meant to carry.`,
            nodeIds: [sw.nodeId],
            edgeIds: [link.edgeId],
          });
        }
        if (!otherIsSwitch) {
          findings.push({
            id: 'l2.endpoint-on-wrong-port-mode',
            severity: 'warning',
            title: `End device on a trunk port (${sw.label} ${port.label ?? port.id})`,
            description: `A controller/supervisor is plugged into a TRUNK port. It'll land on the native VLAN (${port.nativeVlan ?? 1}) and ignore tagged traffic — rarely what you want. Move it to an access port on its intended VLAN.`,
            nodeIds: [sw.nodeId],
            edgeIds: [link.edgeId],
          });
        }
      }
    }
  }

  // 2. Native-VLAN mismatch + trunk-missing-VLAN on switch↔switch trunks.
  for (const link of links) {
    const aSw = switchMap.get(link.aNodeId);
    const bSw = switchMap.get(link.bNodeId);
    if (!aSw || !bSw) continue;
    const pa = resolvePort(aSw, link.aHandle);
    const pb = resolvePort(bSw, link.bHandle);
    if (!pa || !pb || pa.mode !== 'trunk' || pb.mode !== 'trunk') continue;

    const na = pa.nativeVlan ?? 1;
    const nb = pb.nativeVlan ?? 1;
    if (na !== nb) {
      findings.push({
        id: 'l2.native-vlan-mismatch',
        severity: 'warning',
        title: `Native-VLAN mismatch on trunk ${aSw.label} ↔ ${bSw.label}`,
        description: `${aSw.label} uses native VLAN ${na}, ${bSw.label} uses ${nb}. Untagged frames land on the wrong VLAN at the far end (and it's a VLAN-hopping risk). Set both ends to the same native VLAN.`,
        nodeIds: [aSw.nodeId, bSw.nodeId],
        edgeIds: [link.edgeId],
      });
    }

    // A VLAN that has access members on BOTH switches but isn't carried by
    // the trunk → those members are islanded from each other.
    const carriedA = carriedVlans(pa);
    const carriedB = carriedVlans(pb);
    const vlansOn = (switchId: string): Set<number> => {
      const out = new Set<number>();
      for (const [k, count] of domains.accessMembers) {
        if (count <= 0) continue;
        const [sid, v] = k.split('|');
        if (sid === switchId) out.add(Number(v));
      }
      return out;
    };
    const both = [...vlansOn(aSw.nodeId)].filter((v) => vlansOn(bSw.nodeId).has(v));
    for (const v of both) {
      if (!(carriedA.has(v) && carriedB.has(v))) {
        findings.push({
          id: 'l2.trunk-missing-vlan',
          severity: 'error',
          title: `Trunk ${aSw.label} ↔ ${bSw.label} doesn't carry VLAN ${v}`,
          description: `Both switches have devices on VLAN ${v}, but the uplink between them doesn't pass VLAN ${v} on both ends. Those devices can't see each other across the trunk. Add VLAN ${v} to the trunk's allowed list on both sides.`,
          nodeIds: [aSw.nodeId, bSw.nodeId],
          edgeIds: [link.edgeId],
        });
      }
    }
  }

  // 3. The headline check — same subnet, different broadcast domain. Only
  //    runs when the L2 fabric is engaged (≥1 switch) and only over devices
  //    actually attached to the fabric, so unconnected singletons don't
  //    masquerade as "isolated."
  if (switches.length > 0) {
    type SubGroup = { netLabel: string; devs: L2Device[] };
    const bySubnet = new Map<string, SubGroup>();
    for (const d of devices) {
      if (!domains.domainOf.has(d.nodeId)) continue; // not attached
      const ip = parseIpv4(d.ipAddress);
      const mask = parseIpv4(d.subnetMask);
      if (ip === null || mask === null || !isContiguousMask(mask)) continue;
      const net = networkAddress(ip, mask);
      const key = `${net}/${maskToCidr(mask)}`;
      const g = bySubnet.get(key) ?? { netLabel: `${formatIpv4(net)}/${maskToCidr(mask)}`, devs: [] };
      g.devs.push(d);
      bySubnet.set(key, g);
    }
    for (const g of bySubnet.values()) {
      if (g.devs.length < 2) continue;
      const distinctDomains = new Set(g.devs.map((d) => domains.domainOf.get(d.nodeId)!));
      if (distinctDomains.size > 1) {
        const withVlan = g.devs
          .map((d) => {
            const v = domains.deviceVlan.get(d.nodeId);
            return v != null ? `${d.label} (VLAN ${v})` : d.label;
          })
          .join(', ');
        findings.push({
          id: 'l2.vlan-isolated-pair',
          severity: 'error',
          title: `Same subnet (${g.netLabel}), split across VLANs`,
          description: `${withVlan} all live in ${g.netLabel} but their switch ports put them in different broadcast domains — so they can't reach each other even though the IPs look right. Put them on the same VLAN (or carry that VLAN across the trunk between their switches).`,
          nodeIds: g.devs.map((d) => d.nodeId),
        });
      }
    }
  }

  // 4. IP vs VLAN-subnet — device's IP doesn't belong to the CIDR mapped to
  //    the VLAN its access port is on.
  const vlanCidr = new Map<number, { cidr: string; label?: string }>();
  for (const v of vlans) {
    if (v.cidr) vlanCidr.set(v.vlanId, { cidr: v.cidr, label: v.label });
  }
  for (const [devId, vlan] of domains.deviceVlan) {
    const def = vlanCidr.get(vlan);
    if (!def) continue;
    const d = deviceMap.get(devId);
    const ip = parseIpv4(d?.ipAddress);
    if (!d || ip === null) continue;
    const cidr = parseCidr(def.cidr);
    if (!cidr) continue; // invalid zone CIDR is the IPv4 validator's problem
    if (!ipInCidr(ip, cidr)) {
      findings.push({
        id: 'l2.ip-vlan-subnet-mismatch',
        severity: 'error',
        title: `${d.label} IP doesn't match its VLAN ${vlan} subnet`,
        description: `${d.label} (${d.ipAddress}) is on an access port for VLAN ${vlan}${def.label ? ` (${def.label})` : ''}, whose subnet is ${def.cidr}. The IP doesn't fall in that range. Either re-IP the device into ${def.cidr} or move its port to the VLAN that matches its address.`,
        nodeIds: [devId],
      });
    }
  }

  // 5. Defined VLAN with no members — usually a typo or a stale zone.
  for (const v of vlans) {
    let hasMember = false;
    for (const [k, count] of domains.accessMembers) {
      if (count > 0 && Number(k.split('|')[1]) === v.vlanId) {
        hasMember = true;
        break;
      }
    }
    if (!hasMember) {
      findings.push({
        id: 'l2.vlan-no-devices',
        severity: 'info',
        title: `VLAN ${v.vlanId}${v.label ? ` (${v.label})` : ''} has no devices`,
        description: `VLAN ${v.vlanId} is defined${v.cidr ? ` for ${v.cidr}` : ''} but no device sits on an access port for it. Fine if it's planned headroom; otherwise it may be a typo or a leftover from a removed device.`,
      });
    }
  }

  return findings;
}
