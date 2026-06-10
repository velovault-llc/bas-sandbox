import { describe, it, expect } from 'vitest';
import {
  validateBacnetIpNetwork,
  validateIpZones,
  parseIpv4,
  formatIpv4,
  networkAddress,
  isContiguousMask,
  isPrivateIpv4,
  parseCidr,
  ipInCidr,
  formatCidr,
  type BacnetIpDevice,
  type BacnetIpEdge,
  type BacnetIpRouter,
  type PlacedBacnetIpDevice,
  type SubnetZone,
} from '../src/bacnet/ipv4.js';

describe('IPv4 helpers', () => {
  it('parseIpv4 round-trips through formatIpv4', () => {
    for (const s of ['0.0.0.0', '10.0.0.1', '192.168.1.10', '255.255.255.255']) {
      const ip = parseIpv4(s);
      expect(ip).not.toBeNull();
      expect(formatIpv4(ip!)).toBe(s);
    }
  });

  it('parseIpv4 rejects malformed input', () => {
    expect(parseIpv4(undefined)).toBeNull();
    expect(parseIpv4('')).toBeNull();
    expect(parseIpv4('192.168.1')).toBeNull();
    expect(parseIpv4('192.168.1.1.1')).toBeNull();
    expect(parseIpv4('192.168.1.256')).toBeNull();
    expect(parseIpv4('a.b.c.d')).toBeNull();
    expect(parseIpv4('-1.0.0.0')).toBeNull();
  });

  it('isContiguousMask: real masks pass, weird ones fail', () => {
    expect(isContiguousMask(parseIpv4('255.255.255.0')!)).toBe(true);
    expect(isContiguousMask(parseIpv4('255.255.0.0')!)).toBe(true);
    expect(isContiguousMask(parseIpv4('255.255.255.255')!)).toBe(true);
    expect(isContiguousMask(parseIpv4('0.0.0.0')!)).toBe(true);
    expect(isContiguousMask(parseIpv4('255.0.255.0')!)).toBe(false);
    expect(isContiguousMask(parseIpv4('255.255.255.128')!)).toBe(true);
    expect(isContiguousMask(parseIpv4('255.255.128.255')!)).toBe(false);
  });

  it('networkAddress masks correctly', () => {
    const ip = parseIpv4('192.168.1.42')!;
    const mask = parseIpv4('255.255.255.0')!;
    expect(formatIpv4(networkAddress(ip, mask))).toBe('192.168.1.0');
  });

  it('isPrivateIpv4: RFC1918 in, public out', () => {
    expect(isPrivateIpv4(parseIpv4('10.0.0.1')!)).toBe(true);
    expect(isPrivateIpv4(parseIpv4('172.16.5.5')!)).toBe(true);
    expect(isPrivateIpv4(parseIpv4('172.31.255.255')!)).toBe(true);
    expect(isPrivateIpv4(parseIpv4('172.32.0.1')!)).toBe(false);
    expect(isPrivateIpv4(parseIpv4('192.168.1.1')!)).toBe(true);
    expect(isPrivateIpv4(parseIpv4('8.8.8.8')!)).toBe(false);
    expect(isPrivateIpv4(parseIpv4('203.0.113.1')!)).toBe(false);
  });
});

// Helper builders
const dev = (overrides: Partial<BacnetIpDevice> & { nodeId: string; label: string }): BacnetIpDevice => ({
  ipAddress: undefined,
  subnetMask: undefined,
  gateway: undefined,
  ...overrides,
});
const edge = (a: string, b: string, id?: string): BacnetIpEdge => ({
  edgeId: id ?? `${a}-${b}`,
  aNodeId: a,
  bNodeId: b,
});

describe('validateBacnetIpNetwork', () => {
  it('healthy 2-device segment: no findings', () => {
    const devs: BacnetIpDevice[] = [
      dev({ nodeId: 'a', label: 'NAE-1', ipAddress: '192.168.1.10', subnetMask: '255.255.255.0', gateway: '192.168.1.1' }),
      dev({ nodeId: 'b', label: 'JACE-1', ipAddress: '192.168.1.20', subnetMask: '255.255.255.0', gateway: '192.168.1.1' }),
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')]);
    expect(findings).toEqual([]);
  });

  it('devices without IPs are skipped (not flagged)', () => {
    const devs: BacnetIpDevice[] = [
      dev({ nodeId: 'a', label: 'NAE-1' }),
      dev({ nodeId: 'b', label: 'JACE-1' }),
    ];
    expect(validateBacnetIpNetwork(devs, [edge('a', 'b')])).toEqual([]);
  });

  it('flags duplicate IP', () => {
    const devs: BacnetIpDevice[] = [
      dev({ nodeId: 'a', label: 'NAE-1', ipAddress: '192.168.1.10', subnetMask: '255.255.255.0' }),
      dev({ nodeId: 'b', label: 'JACE-1', ipAddress: '192.168.1.10', subnetMask: '255.255.255.0' }),
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')]);
    const dup = findings.find((f) => f.id === 'ipv4.duplicate-ip');
    expect(dup).toBeDefined();
    expect(dup!.severity).toBe('error');
    expect(dup!.nodeIds).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('flags subnet mismatch between two devices on same bacnet-ip edge', () => {
    const devs: BacnetIpDevice[] = [
      dev({ nodeId: 'a', label: 'NAE-1', ipAddress: '192.168.1.10', subnetMask: '255.255.255.0' }),
      dev({ nodeId: 'b', label: 'JACE-2', ipAddress: '192.168.2.10', subnetMask: '255.255.255.0' }),
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')]);
    const mis = findings.find((f) => f.id === 'ipv4.subnet-mismatch');
    expect(mis).toBeDefined();
    expect(mis!.severity).toBe('error');
  });

  it('flags inconsistent mask on the same trunk', () => {
    const devs: BacnetIpDevice[] = [
      dev({ nodeId: 'a', label: 'NAE-1', ipAddress: '10.0.0.10', subnetMask: '255.255.255.0' }),
      dev({ nodeId: 'b', label: 'JACE-2', ipAddress: '10.0.0.20', subnetMask: '255.255.0.0' }),
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')]);
    const im = findings.find((f) => f.id === 'ipv4.inconsistent-mask');
    expect(im).toBeDefined();
    expect(im!.severity).toBe('warning');
  });

  it('flags gateway not on device subnet (classic /24 vs gw on .254 typo)', () => {
    const devs: BacnetIpDevice[] = [
      dev({
        nodeId: 'a',
        label: 'NAE-1',
        ipAddress: '192.168.1.10',
        subnetMask: '255.255.255.0',
        gateway: '192.168.2.1', // gw on .2.x = unreachable
      }),
    ];
    const findings = validateBacnetIpNetwork(devs, []);
    const f = findings.find((f) => f.id === 'ipv4.gateway-not-in-subnet');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('flags non-contiguous (invalid) mask', () => {
    const devs: BacnetIpDevice[] = [
      dev({ nodeId: 'a', label: 'NAE-1', ipAddress: '10.0.0.10', subnetMask: '255.0.255.0' }),
    ];
    const findings = validateBacnetIpNetwork(devs, []);
    const f = findings.find((f) => f.id === 'ipv4.invalid-mask');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('flags malformed IP string', () => {
    const devs: BacnetIpDevice[] = [
      dev({ nodeId: 'a', label: 'NAE-1', ipAddress: '192.168.1' }),
    ];
    const findings = validateBacnetIpNetwork(devs, []);
    const f = findings.find((f) => f.id === 'ipv4.invalid-ip');
    expect(f).toBeDefined();
  });

  it('flags private-public mix on one trunk', () => {
    const devs: BacnetIpDevice[] = [
      dev({ nodeId: 'a', label: 'NAE-1', ipAddress: '192.168.1.10', subnetMask: '255.255.255.0' }),
      // dropping a public IP on a controller is almost always a misconfig
      dev({ nodeId: 'b', label: 'JACE-2', ipAddress: '8.8.8.8', subnetMask: '255.255.255.0' }),
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')]);
    const f = findings.find((f) => f.id === 'ipv4.private-public-mix');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });
});

// ── BBMD / cross-subnet bridge (Net.2) ──────────────────────────────

describe('validateBacnetIpNetwork — BBMD bridging (Net.2)', () => {
  it('cross-subnet trunk with NO BBMDs: classic subnet-mismatch error', () => {
    const devs: BacnetIpDevice[] = [
      dev({ nodeId: 'a', label: 'NAE-1', ipAddress: '192.168.1.10', subnetMask: '255.255.255.0' }),
      dev({ nodeId: 'b', label: 'JACE-2', ipAddress: '192.168.2.10', subnetMask: '255.255.255.0' }),
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')]);
    expect(findings.some((f) => f.id === 'ipv4.subnet-mismatch')).toBe(true);
    expect(findings.some((f) => f.id === 'ipv4.cross-subnet-no-bridge')).toBe(false);
  });

  it('cross-subnet trunk with symmetric BBMDs: bridged (info), no error', () => {
    const devs: BacnetIpDevice[] = [
      dev({
        nodeId: 'a',
        label: 'NAE-1',
        ipAddress: '192.168.1.10',
        subnetMask: '255.255.255.0',
        isBBMD: true,
        bdtPeers: ['192.168.2.10'],
      }),
      dev({
        nodeId: 'b',
        label: 'JACE-2',
        ipAddress: '192.168.2.10',
        subnetMask: '255.255.255.0',
        isBBMD: true,
        bdtPeers: ['192.168.1.10'],
      }),
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')]);
    expect(findings.some((f) => f.id === 'ipv4.subnet-mismatch')).toBe(false);
    const ok = findings.find((f) => f.id === 'ipv4.cross-subnet-no-bridge');
    expect(ok).toBeDefined();
    expect(ok!.severity).toBe('info');
  });

  it('cross-subnet trunk with asymmetric BDT: error (broadcasts only one way)', () => {
    const devs: BacnetIpDevice[] = [
      dev({
        nodeId: 'a',
        label: 'NAE-1',
        ipAddress: '192.168.1.10',
        subnetMask: '255.255.255.0',
        isBBMD: true,
        bdtPeers: ['192.168.2.10'],
      }),
      dev({
        nodeId: 'b',
        label: 'JACE-2',
        ipAddress: '192.168.2.10',
        subnetMask: '255.255.255.0',
        isBBMD: true,
        // missing peer back to NAE-1 — asymmetric
        bdtPeers: [],
      }),
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')]);
    const f = findings.find((f) => f.id === 'ipv4.bbmd-asymmetric-bdt');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('cross-subnet trunk with only one BBMD: info (foreign-device registration, not an error)', () => {
    // Annex-J foreign-device pattern: the non-BBMD registers with the BBMD
    // and receives broadcasts as unicast Forwarded-NPDUs. This is how every
    // commissioning laptop joins a remote site — the sim emits the
    // Register-Foreign-Device flow for exactly this topology, so the
    // validator must NOT call it an error (it used to).
    const devs: BacnetIpDevice[] = [
      dev({
        nodeId: 'a',
        label: 'NAE-1',
        ipAddress: '192.168.1.10',
        subnetMask: '255.255.255.0',
        isBBMD: true,
        bdtPeers: ['192.168.2.10'],
      }),
      dev({
        nodeId: 'b',
        label: 'JACE-2',
        ipAddress: '192.168.2.10',
        subnetMask: '255.255.255.0',
        // not a BBMD at all
      }),
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')]);
    const fd = findings.find((f) => f.id === 'ipv4.cross-subnet-foreign-device');
    expect(fd).toBeDefined();
    expect(fd!.severity).toBe('info');
    expect(fd!.description).toContain('JACE-2');
    // And no error-level finding should remain on this trunk.
    expect(
      findings.find((f) => f.severity === 'error' && f.edgeIds?.includes('a-b')),
    ).toBeUndefined();
  });

  it('same-subnet trunk: BBMD flags do nothing (no bridge needed)', () => {
    const devs: BacnetIpDevice[] = [
      dev({
        nodeId: 'a',
        label: 'NAE-1',
        ipAddress: '10.0.0.10',
        subnetMask: '255.255.255.0',
        isBBMD: true,
        bdtPeers: ['10.0.0.20'],
      }),
      dev({
        nodeId: 'b',
        label: 'NAE-2',
        ipAddress: '10.0.0.20',
        subnetMask: '255.255.255.0',
      }),
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')]);
    // No subnet-mismatch / cross-subnet anything fires.
    expect(findings.some((f) => f.id === 'ipv4.subnet-mismatch')).toBe(false);
    expect(findings.some((f) => f.id === 'ipv4.cross-subnet-no-bridge')).toBe(false);
  });

  it('BBMD with empty BDT: warning', () => {
    const devs: BacnetIpDevice[] = [
      dev({
        nodeId: 'a',
        label: 'NAE-1',
        ipAddress: '10.0.0.10',
        subnetMask: '255.255.255.0',
        isBBMD: true,
        bdtPeers: [],
      }),
    ];
    const findings = validateBacnetIpNetwork(devs, []);
    const f = findings.find((f) => f.id === 'ipv4.bbmd-empty-bdt');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('BBMD with peer IP not on the canvas: warning (stale-BDT detection)', () => {
    const devs: BacnetIpDevice[] = [
      dev({
        nodeId: 'a',
        label: 'NAE-1',
        ipAddress: '10.0.0.10',
        subnetMask: '255.255.255.0',
        isBBMD: true,
        bdtPeers: ['10.0.99.99'], // doesn't exist on canvas
      }),
    ];
    const findings = validateBacnetIpNetwork(devs, []);
    const f = findings.find((f) => f.id === 'ipv4.bbmd-peer-unknown');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('BBMD with malformed peer IP: error', () => {
    const devs: BacnetIpDevice[] = [
      dev({
        nodeId: 'a',
        label: 'NAE-1',
        ipAddress: '10.0.0.10',
        subnetMask: '255.255.255.0',
        isBBMD: true,
        bdtPeers: ['not.an.ip'],
      }),
    ];
    const findings = validateBacnetIpNetwork(devs, []);
    const f = findings.find(
      (f) => f.id === 'ipv4.bbmd-peer-unknown' && f.severity === 'error',
    );
    expect(f).toBeDefined();
  });
});

// ── Router L3-bridging (Net.3) ──────────────────────────────────────

describe('validateBacnetIpNetwork — router L3 bridging (Net.3)', () => {
  it('cross-subnet trunk with a router covering both subnets: info (routed)', () => {
    const devs: BacnetIpDevice[] = [
      dev({ nodeId: 'a', label: 'NAE-A', ipAddress: '10.0.1.10', subnetMask: '255.255.255.0' }),
      dev({ nodeId: 'b', label: 'NAE-B', ipAddress: '10.0.2.10', subnetMask: '255.255.255.0' }),
    ];
    const routers: BacnetIpRouter[] = [
      {
        nodeId: 'r1',
        label: 'RTR-1',
        interfaces: [
          { ip: '10.0.1.1', cidr: '10.0.1.0/24' },
          { ip: '10.0.2.1', cidr: '10.0.2.0/24' },
        ],
      },
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')], routers);
    expect(findings.some((f) => f.id === 'ipv4.subnet-mismatch')).toBe(false);
    const info = findings.find(
      (f) => f.id === 'ipv4.cross-subnet-no-bridge' && f.severity === 'info',
    );
    expect(info).toBeDefined();
    expect(info!.title).toContain('RTR-1');
  });

  it('router covering only ONE of the two subnets: no bridge, fall through to BBMD/subnet-mismatch', () => {
    const devs: BacnetIpDevice[] = [
      dev({ nodeId: 'a', label: 'NAE-A', ipAddress: '10.0.1.10', subnetMask: '255.255.255.0' }),
      dev({ nodeId: 'b', label: 'NAE-B', ipAddress: '10.0.2.10', subnetMask: '255.255.255.0' }),
    ];
    const routers: BacnetIpRouter[] = [
      {
        nodeId: 'r1',
        label: 'RTR-PARTIAL',
        interfaces: [
          { ip: '10.0.1.1', cidr: '10.0.1.0/24' },
          { ip: '172.16.0.1', cidr: '172.16.0.0/24' }, // not the other side
        ],
      },
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')], routers);
    expect(findings.some((f) => f.id === 'ipv4.subnet-mismatch')).toBe(true);
  });

  it('router with malformed CIDR is silently ignored (no crash)', () => {
    const devs: BacnetIpDevice[] = [
      dev({ nodeId: 'a', label: 'NAE-A', ipAddress: '10.0.1.10', subnetMask: '255.255.255.0' }),
      dev({ nodeId: 'b', label: 'NAE-B', ipAddress: '10.0.2.10', subnetMask: '255.255.255.0' }),
    ];
    const routers: BacnetIpRouter[] = [
      {
        nodeId: 'r1',
        label: 'BROKEN',
        interfaces: [
          { cidr: 'garbage' },
          { cidr: 'also-bad' },
        ],
      },
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')], routers);
    expect(findings.some((f) => f.id === 'ipv4.subnet-mismatch')).toBe(true);
  });

  it('router PLUS symmetric BBMDs: router wins (reported as routed, not bridged)', () => {
    // When both bridges exist, the router path is reported because it
    // handles unicast too and is the more general bridge. Result: one
    // info finding from the router, not the BBMD bridge.
    const devs: BacnetIpDevice[] = [
      dev({
        nodeId: 'a',
        label: 'NAE-A',
        ipAddress: '10.0.1.10',
        subnetMask: '255.255.255.0',
        isBBMD: true,
        bdtPeers: ['10.0.2.10'],
      }),
      dev({
        nodeId: 'b',
        label: 'NAE-B',
        ipAddress: '10.0.2.10',
        subnetMask: '255.255.255.0',
        isBBMD: true,
        bdtPeers: ['10.0.1.10'],
      }),
    ];
    const routers: BacnetIpRouter[] = [
      {
        nodeId: 'r1',
        label: 'RTR-1',
        interfaces: [
          { cidr: '10.0.1.0/24' },
          { cidr: '10.0.2.0/24' },
        ],
      },
    ];
    const findings = validateBacnetIpNetwork(devs, [edge('a', 'b')], routers);
    const routerFinding = findings.find((f) => f.title?.includes('RTR-1'));
    expect(routerFinding).toBeDefined();
    expect(findings.some((f) => f.id === 'ipv4.bbmd-asymmetric-bdt')).toBe(false);
  });
});

// ── CIDR helpers ─────────────────────────────────────────────────────

describe('CIDR helpers', () => {
  it('parseCidr accepts canonical forms', () => {
    expect(parseCidr('10.0.1.0/24')).toEqual({ network: parseIpv4('10.0.1.0'), prefix: 24 });
    expect(parseCidr('0.0.0.0/0')).toEqual({ network: 0, prefix: 0 });
    expect(parseCidr('255.255.255.255/32')).toEqual({ network: parseIpv4('255.255.255.255'), prefix: 32 });
  });

  it('parseCidr masks off host bits when given a host IP', () => {
    // 192.168.1.42/24 should normalize to 192.168.1.0/24
    const c = parseCidr('192.168.1.42/24');
    expect(c).not.toBeNull();
    expect(formatIpv4(c!.network)).toBe('192.168.1.0');
    expect(c!.prefix).toBe(24);
  });

  it('parseCidr rejects malformed input', () => {
    expect(parseCidr(undefined)).toBeNull();
    expect(parseCidr('')).toBeNull();
    expect(parseCidr('10.0.1.0')).toBeNull(); // no prefix
    expect(parseCidr('10.0.1.0/')).toBeNull();
    expect(parseCidr('10.0.1.0/33')).toBeNull();
    expect(parseCidr('10.0.1.0/-1')).toBeNull();
    expect(parseCidr('not-an-ip/24')).toBeNull();
    expect(parseCidr('10.0.1.0/abc')).toBeNull();
  });

  it('ipInCidr: in-network IPs match, out-of-network IPs do not', () => {
    const cidr = parseCidr('10.0.1.0/24')!;
    expect(ipInCidr(parseIpv4('10.0.1.5')!, cidr)).toBe(true);
    expect(ipInCidr(parseIpv4('10.0.1.255')!, cidr)).toBe(true);
    expect(ipInCidr(parseIpv4('10.0.2.5')!, cidr)).toBe(false);
    expect(ipInCidr(parseIpv4('10.0.0.255')!, cidr)).toBe(false);
  });

  it('ipInCidr handles /0 (all IPs match) and /32 (single host)', () => {
    const any = parseCidr('0.0.0.0/0')!;
    expect(ipInCidr(parseIpv4('8.8.8.8')!, any)).toBe(true);
    expect(ipInCidr(parseIpv4('192.168.1.1')!, any)).toBe(true);
    const host = parseCidr('10.0.1.42/32')!;
    expect(ipInCidr(parseIpv4('10.0.1.42')!, host)).toBe(true);
    expect(ipInCidr(parseIpv4('10.0.1.43')!, host)).toBe(false);
  });

  it('formatCidr round-trips a parsed CIDR', () => {
    expect(formatCidr(parseCidr('192.168.1.0/24')!)).toBe('192.168.1.0/24');
  });
});

// ── Subnet-zone validator (Net.1) ────────────────────────────────────

const placed = (
  overrides: Partial<PlacedBacnetIpDevice> & {
    nodeId: string;
    label: string;
    x: number;
    y: number;
  },
): PlacedBacnetIpDevice => ({
  ipAddress: undefined,
  subnetMask: undefined,
  gateway: undefined,
  ...overrides,
});

const zone = (overrides: Partial<SubnetZone> & { zoneId: string; cidr: string }): SubnetZone => ({
  label: overrides.zoneId,
  x: 0,
  y: 0,
  w: 400,
  h: 300,
  ...overrides,
});

describe('validateIpZones', () => {
  it('no zones → no findings (Net.1 stays silent until zones are drawn)', () => {
    const devs: PlacedBacnetIpDevice[] = [
      placed({ nodeId: 'a', label: 'NAE-1', x: 100, y: 100, ipAddress: '10.0.1.10' }),
    ];
    expect(validateIpZones(devs, [])).toEqual([]);
  });

  it('healthy zone: device inside zone with matching CIDR — no findings', () => {
    const devs: PlacedBacnetIpDevice[] = [
      placed({ nodeId: 'a', label: 'NAE-1', x: 100, y: 100, ipAddress: '10.0.1.10' }),
    ];
    const zones: SubnetZone[] = [
      zone({ zoneId: 'z1', cidr: '10.0.1.0/24', x: 0, y: 0, w: 400, h: 300 }),
    ];
    expect(validateIpZones(devs, zones)).toEqual([]);
  });

  it('flags zone-cidr-mismatch when device IP is outside its containing zone', () => {
    const devs: PlacedBacnetIpDevice[] = [
      placed({ nodeId: 'a', label: 'NAE-1', x: 100, y: 100, ipAddress: '192.168.99.10' }),
    ];
    const zones: SubnetZone[] = [
      zone({ zoneId: 'z1', label: 'BMS VLAN', cidr: '10.0.1.0/24', x: 0, y: 0, w: 400, h: 300 }),
    ];
    const findings = validateIpZones(devs, zones);
    const mis = findings.find((f) => f.id === 'ipv4.zone-cidr-mismatch');
    expect(mis).toBeDefined();
    expect(mis!.severity).toBe('error');
    expect(mis!.nodeIds).toEqual(['a']);
  });

  it('flags outside-any-zone when device has an IP but no zone covers it', () => {
    const devs: PlacedBacnetIpDevice[] = [
      placed({ nodeId: 'a', label: 'JACE-2', x: 1000, y: 1000, ipAddress: '10.0.1.10' }),
    ];
    const zones: SubnetZone[] = [
      zone({ zoneId: 'z1', cidr: '10.0.1.0/24', x: 0, y: 0, w: 400, h: 300 }),
    ];
    const findings = validateIpZones(devs, zones);
    const f = findings.find((f) => f.id === 'ipv4.outside-any-zone');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  it('flags zone-invalid-cidr when zone CIDR is malformed', () => {
    const zones: SubnetZone[] = [
      zone({ zoneId: 'z1', label: 'Broken', cidr: '10.0.1/24', x: 0, y: 0, w: 400, h: 300 }),
    ];
    const findings = validateIpZones([], zones);
    const f = findings.find((f) => f.id === 'ipv4.zone-invalid-cidr');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('devices without an IP are not flagged (zone is a hint, not a requirement)', () => {
    const devs: PlacedBacnetIpDevice[] = [
      placed({ nodeId: 'a', label: 'FEC-1', x: 100, y: 100 }), // no ip
    ];
    const zones: SubnetZone[] = [
      zone({ zoneId: 'z1', cidr: '10.0.1.0/24', x: 0, y: 0, w: 400, h: 300 }),
    ];
    expect(validateIpZones(devs, zones)).toEqual([]);
  });

  it('first-zone-wins on overlapping zones', () => {
    // Two zones overlap; the first one's CIDR is what we check against.
    const devs: PlacedBacnetIpDevice[] = [
      placed({ nodeId: 'a', label: 'NAE-1', x: 100, y: 100, ipAddress: '10.0.2.10' }),
    ];
    const zones: SubnetZone[] = [
      zone({ zoneId: 'z1', label: 'A', cidr: '10.0.1.0/24', x: 0, y: 0, w: 400, h: 300 }),
      zone({ zoneId: 'z2', label: 'B', cidr: '10.0.2.0/24', x: 50, y: 50, w: 400, h: 300 }),
    ];
    const findings = validateIpZones(devs, zones);
    // Device IP 10.0.2.10 matches z2 but z1 wins by position-order — should
    // flag a mismatch against z1.
    const mis = findings.find((f) => f.id === 'ipv4.zone-cidr-mismatch');
    expect(mis).toBeDefined();
  });
});
