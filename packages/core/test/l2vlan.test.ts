import { describe, it, expect } from 'vitest';
import {
  validateL2Vlan,
  computeBroadcastDomains,
  VLAN_MAX,
  type L2Switch,
  type L2Device,
  type L2Link,
  type VlanDef,
  type L2Finding,
  type L2FindingId,
  type SwitchPort,
} from '../src/bacnet/l2vlan.js';

// ── builders ───────────────────────────────────────────────────────────
const access = (id: string, vlan?: number): SwitchPort => ({ id, mode: 'access', accessVlan: vlan });
const trunk = (id: string, vlans: number[], native = 1): SwitchPort => ({
  id,
  mode: 'trunk',
  trunkVlans: vlans,
  nativeVlan: native,
});
const sw = (nodeId: string, label: string, ports: SwitchPort[]): L2Switch => ({ nodeId, label, ports });
const dev = (
  nodeId: string,
  label: string,
  ipAddress?: string,
  subnetMask?: string,
): L2Device => ({ nodeId, label, ipAddress, subnetMask });
const link = (
  edgeId: string,
  aNodeId: string,
  bNodeId: string,
  aHandle?: string,
  bHandle?: string,
): L2Link => ({ edgeId, aNodeId, bNodeId, aHandle, bHandle });

const ids = (fs: L2Finding[]): L2FindingId[] => fs.map((f) => f.id);
const has = (fs: L2Finding[], id: L2FindingId): boolean => fs.some((f) => f.id === id);

// ── computeBroadcastDomains ─────────────────────────────────────────────
describe('computeBroadcastDomains', () => {
  it('two devices on the same access VLAN share a domain', () => {
    const s = sw('s1', 'SW-1', [access('p1', 10), access('p2', 10)]);
    const devs = [dev('a', 'A'), dev('b', 'B')];
    const links = [link('e1', 'a', 's1', undefined, 'p1'), link('e2', 'b', 's1', undefined, 'p2')];
    const r = computeBroadcastDomains([s], devs, links);
    expect(r.domainOf.get('a')).toBe(r.domainOf.get('b'));
    expect(r.deviceVlan.get('a')).toBe(10);
    expect(r.accessMembers.get('s1|10')).toBe(2);
  });

  it('different access VLANs on one switch = separate domains', () => {
    const s = sw('s1', 'SW-1', [access('p1', 10), access('p2', 20)]);
    const devs = [dev('a', 'A'), dev('b', 'B')];
    const links = [link('e1', 'a', 's1', undefined, 'p1'), link('e2', 'b', 's1', undefined, 'p2')];
    const r = computeBroadcastDomains([s], devs, links);
    expect(r.domainOf.get('a')).not.toBe(r.domainOf.get('b'));
  });

  it('VLAN spans a trunk that carries it', () => {
    const s1 = sw('s1', 'SW-1', [access('p1', 10), trunk('t1', [10, 20])]);
    const s2 = sw('s2', 'SW-2', [access('p1', 10), trunk('t1', [10, 20])]);
    const devs = [dev('a', 'A'), dev('b', 'B')];
    const links = [
      link('e1', 'a', 's1', undefined, 'p1'),
      link('e2', 'b', 's2', undefined, 'p1'),
      link('up', 's1', 's2', 't1', 't1'),
    ];
    const r = computeBroadcastDomains([s1, s2], devs, links);
    expect(r.domainOf.get('a')).toBe(r.domainOf.get('b'));
  });

  it('VLAN does NOT span a trunk that omits it', () => {
    const s1 = sw('s1', 'SW-1', [access('p1', 10), trunk('t1', [20])]);
    const s2 = sw('s2', 'SW-2', [access('p1', 10), trunk('t1', [20])]);
    const devs = [dev('a', 'A'), dev('b', 'B')];
    const links = [
      link('e1', 'a', 's1', undefined, 'p1'),
      link('e2', 'b', 's2', undefined, 'p1'),
      link('up', 's1', 's2', 't1', 't1'),
    ];
    const r = computeBroadcastDomains([s1, s2], devs, links);
    expect(r.domainOf.get('a')).not.toBe(r.domainOf.get('b'));
  });

  it('back-compat: direct device↔device edge with no switch shares a domain', () => {
    const devs = [dev('a', 'A'), dev('b', 'B')];
    const r = computeBroadcastDomains([], devs, [link('e1', 'a', 'b')]);
    expect(r.domainOf.get('a')).toBe(r.domainOf.get('b'));
  });

  it('unconnected device is not attached', () => {
    const devs = [dev('a', 'A')];
    const r = computeBroadcastDomains([], devs, []);
    expect(r.domainOf.has('a')).toBe(false);
  });

  it('end device on a trunk port lands on the native VLAN', () => {
    const s = sw('s1', 'SW-1', [trunk('t1', [10, 20], 5)]);
    const r = computeBroadcastDomains([s], [dev('a', 'A')], [link('e1', 'a', 's1', undefined, 't1')]);
    expect(r.deviceVlan.get('a')).toBe(5);
  });
});

// ── validateL2Vlan ──────────────────────────────────────────────────────
describe('validateL2Vlan', () => {
  it('healthy single-VLAN switch: no findings', () => {
    const s = sw('s1', 'SW-1', [access('p1', 10), access('p2', 10)]);
    const devs = [
      dev('a', 'A', '10.0.1.10', '255.255.255.0'),
      dev('b', 'B', '10.0.1.20', '255.255.255.0'),
    ];
    const links = [link('e1', 'a', 's1', undefined, 'p1'), link('e2', 'b', 's1', undefined, 'p2')];
    expect(validateL2Vlan([s], devs, links)).toEqual([]);
  });

  it('vlan-isolated-pair: same subnet, different VLAN', () => {
    const s = sw('s1', 'SW-1', [access('p1', 10), access('p2', 20)]);
    const devs = [
      dev('a', 'NAE-1', '10.0.1.10', '255.255.255.0'),
      dev('b', 'JACE-1', '10.0.1.20', '255.255.255.0'),
    ];
    const links = [link('e1', 'a', 's1', undefined, 'p1'), link('e2', 'b', 's1', undefined, 'p2')];
    const fs = validateL2Vlan([s], devs, links);
    expect(has(fs, 'l2.vlan-isolated-pair')).toBe(true);
    const f = fs.find((x) => x.id === 'l2.vlan-isolated-pair')!;
    expect(f.nodeIds).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('vlan-isolated-pair does NOT fire when subnet split is intentional (different subnets)', () => {
    const s = sw('s1', 'SW-1', [access('p1', 10), access('p2', 20)]);
    const devs = [
      dev('a', 'A', '10.0.1.10', '255.255.255.0'),
      dev('b', 'B', '10.0.2.20', '255.255.255.0'),
    ];
    const links = [link('e1', 'a', 's1', undefined, 'p1'), link('e2', 'b', 's1', undefined, 'p2')];
    expect(has(validateL2Vlan([s], devs, links), 'l2.vlan-isolated-pair')).toBe(false);
  });

  it('access-port-no-vlan: access port carrying a device with no VLAN', () => {
    const s = sw('s1', 'SW-1', [access('p1')]);
    const fs = validateL2Vlan([s], [dev('a', 'A')], [link('e1', 'a', 's1', undefined, 'p1')]);
    expect(has(fs, 'l2.access-port-no-vlan')).toBe(true);
  });

  it('trunk-missing-vlan: both switches have VLAN 10 but the trunk omits it', () => {
    const s1 = sw('s1', 'SW-1', [access('p1', 10), trunk('t1', [20])]);
    const s2 = sw('s2', 'SW-2', [access('p1', 10), trunk('t1', [20])]);
    const devs = [dev('a', 'A'), dev('b', 'B')];
    const links = [
      link('e1', 'a', 's1', undefined, 'p1'),
      link('e2', 'b', 's2', undefined, 'p1'),
      link('up', 's1', 's2', 't1', 't1'),
    ];
    const fs = validateL2Vlan([s1, s2], devs, links);
    expect(has(fs, 'l2.trunk-missing-vlan')).toBe(true);
  });

  it('trunk-missing-vlan does NOT fire when the trunk carries the VLAN', () => {
    const s1 = sw('s1', 'SW-1', [access('p1', 10), trunk('t1', [10, 20])]);
    const s2 = sw('s2', 'SW-2', [access('p1', 10), trunk('t1', [10, 20])]);
    const devs = [dev('a', 'A'), dev('b', 'B')];
    const links = [
      link('e1', 'a', 's1', undefined, 'p1'),
      link('e2', 'b', 's2', undefined, 'p1'),
      link('up', 's1', 's2', 't1', 't1'),
    ];
    expect(has(validateL2Vlan([s1, s2], devs, links), 'l2.trunk-missing-vlan')).toBe(false);
  });

  it('native-vlan-mismatch: trunk ends disagree on native VLAN', () => {
    const s1 = sw('s1', 'SW-1', [trunk('t1', [10], 1)]);
    const s2 = sw('s2', 'SW-2', [trunk('t1', [10], 99)]);
    const fs = validateL2Vlan([s1, s2], [], [link('up', 's1', 's2', 't1', 't1')]);
    expect(has(fs, 'l2.native-vlan-mismatch')).toBe(true);
  });

  it('endpoint-on-wrong-port-mode: end device on a trunk port', () => {
    const s = sw('s1', 'SW-1', [trunk('t1', [10])]);
    const fs = validateL2Vlan([s], [dev('a', 'A')], [link('e1', 'a', 's1', undefined, 't1')]);
    expect(has(fs, 'l2.endpoint-on-wrong-port-mode')).toBe(true);
  });

  it('endpoint-on-wrong-port-mode: switch uplink on an access port', () => {
    const s1 = sw('s1', 'SW-1', [access('p1', 10)]);
    const s2 = sw('s2', 'SW-2', [access('p1', 10)]);
    const fs = validateL2Vlan([s1, s2], [], [link('up', 's1', 's2', 'p1', 'p1')]);
    expect(has(fs, 'l2.endpoint-on-wrong-port-mode')).toBe(true);
  });

  it('ip-vlan-subnet-mismatch: device IP outside its VLAN subnet', () => {
    const s = sw('s1', 'SW-1', [access('p1', 20)]);
    const devs = [dev('a', 'A', '10.0.1.10', '255.255.255.0')]; // VLAN 20 = 10.0.2.0/24
    const links = [link('e1', 'a', 's1', undefined, 'p1')];
    const vlans: VlanDef[] = [{ vlanId: 20, cidr: '10.0.2.0/24', label: 'Corp' }];
    const fs = validateL2Vlan([s], devs, links, vlans);
    expect(has(fs, 'l2.ip-vlan-subnet-mismatch')).toBe(true);
  });

  it('ip-vlan-subnet-mismatch does NOT fire when IP matches the VLAN subnet', () => {
    const s = sw('s1', 'SW-1', [access('p1', 20)]);
    const devs = [dev('a', 'A', '10.0.2.10', '255.255.255.0')];
    const links = [link('e1', 'a', 's1', undefined, 'p1')];
    const vlans: VlanDef[] = [{ vlanId: 20, cidr: '10.0.2.0/24' }];
    expect(has(validateL2Vlan([s], devs, links, vlans), 'l2.ip-vlan-subnet-mismatch')).toBe(false);
  });

  it('vlan-id-invalid: VLAN out of range', () => {
    const s = sw('s1', 'SW-1', [access('p1', VLAN_MAX + 1)]);
    const fs = validateL2Vlan([s], [dev('a', 'A')], [link('e1', 'a', 's1', undefined, 'p1')]);
    expect(has(fs, 'l2.vlan-id-invalid')).toBe(true);
  });

  it('link-port-unresolved: cable into a switch with no port handle', () => {
    const s = sw('s1', 'SW-1', [access('p1', 10)]);
    const fs = validateL2Vlan([s], [dev('a', 'A')], [link('e1', 'a', 's1')]);
    expect(has(fs, 'l2.link-port-unresolved')).toBe(true);
  });

  it('trunk-no-vlans: used trunk port with empty allowed list', () => {
    const s1 = sw('s1', 'SW-1', [{ id: 't1', mode: 'trunk', trunkVlans: [], nativeVlan: 1 }]);
    const s2 = sw('s2', 'SW-2', [trunk('t1', [10])]);
    const fs = validateL2Vlan([s1, s2], [], [link('up', 's1', 's2', 't1', 't1')]);
    expect(has(fs, 'l2.trunk-no-vlans')).toBe(true);
  });

  it('vlan-no-devices: defined VLAN with no members', () => {
    const s = sw('s1', 'SW-1', [access('p1', 10)]);
    const devs = [dev('a', 'A')];
    const links = [link('e1', 'a', 's1', undefined, 'p1')];
    const vlans: VlanDef[] = [
      { vlanId: 10, cidr: '10.0.1.0/24' },
      { vlanId: 30, cidr: '10.0.3.0/24', label: 'Guest' },
    ];
    const fs = validateL2Vlan([s], devs, links, vlans);
    const noDev = fs.filter((f) => f.id === 'l2.vlan-no-devices');
    expect(noDev).toHaveLength(1);
    expect(noDev[0].title).toContain('30');
  });

  it('no switches present: isolation check stays silent (back-compat)', () => {
    const devs = [
      dev('a', 'A', '10.0.1.10', '255.255.255.0'),
      dev('b', 'B', '10.0.1.20', '255.255.255.0'),
    ];
    expect(ids(validateL2Vlan([], devs, []))).toEqual([]);
  });
});
