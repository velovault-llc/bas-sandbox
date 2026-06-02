import { describe, it, expect } from 'vitest';
import {
  initMstpTrunkState,
  stepMstpToken,
  tokenHoldSeconds,
  defaultDeviceInstance,
  mstpServiceLatencySeconds,
  BACNET_IP_RTT_SECONDS,
  assignMstpAddressing,
  type MstpDevice,
  type MstpAddressingNode,
  type MstpAddressingEdge,
} from '../src/bacnet/mstp.js';

const devs: MstpDevice[] = [
  { nodeId: 'n1', mac: 0, label: 'NAE' },
  { nodeId: 'n2', mac: 1, label: 'FEC-1' },
  { nodeId: 'n3', mac: 2, label: 'FEC-2' },
  { nodeId: 'n4', mac: 3, label: 'VAV-1' },
];

describe('MS/TP token cycling', () => {
  it('starts on MAC 0 with zero rotations', () => {
    const s = initMstpTrunkState(devs);
    expect(s.tokenIndex).toBe(0);
    expect(s.rotations).toBe(0);
    expect(s.devices[s.tokenIndex].mac).toBe(0);
  });

  it('advances one device per hold-window', () => {
    let s = initMstpTrunkState(devs, 38400);
    const hold = tokenHoldSeconds(38400);
    s = stepMstpToken(s, hold);
    expect(s.tokenIndex).toBe(1);
    s = stepMstpToken(s, hold);
    expect(s.tokenIndex).toBe(2);
  });

  it('counts rotations when the token wraps back to MAC 0', () => {
    let s = initMstpTrunkState(devs, 38400);
    const hold = tokenHoldSeconds(38400);
    // 4 devices × hold each = 1 full rotation
    s = stepMstpToken(s, hold * 4);
    expect(s.tokenIndex).toBe(0);
    expect(s.rotations).toBe(1);
  });

  it('handles multi-hop steps when dt is large (fast-forward)', () => {
    let s = initMstpTrunkState(devs, 38400);
    const hold = tokenHoldSeconds(38400);
    // 10 rotations of 4 devices = 40 hops. Pad by 1% so float precision
    // doesn't leave us stopped one hop short.
    s = stepMstpToken(s, hold * 40.01);
    expect(s.rotations).toBe(10);
    expect(s.tokenIndex).toBe(0);
  });

  it('faster baud → shorter hold time', () => {
    expect(tokenHoldSeconds(76800)).toBeLessThan(tokenHoldSeconds(38400));
    expect(tokenHoldSeconds(9600)).toBeGreaterThan(tokenHoldSeconds(38400));
  });

  it('single-device trunk: token stays put (no peers to pass to)', () => {
    const solo = [devs[0]];
    let s = initMstpTrunkState(solo);
    s = stepMstpToken(s, 100);
    expect(s.tokenIndex).toBe(0);
  });

  it('defaultDeviceInstance: deterministic, distinct per MAC', () => {
    expect(defaultDeviceInstance(0)).toBe(1000);
    expect(defaultDeviceInstance(1)).toBe(1001);
    expect(defaultDeviceInstance(127)).toBe(1127);
    // distinct
    const ids = new Set([0, 1, 2, 5, 17].map(defaultDeviceInstance));
    expect(ids.size).toBe(5);
  });

  it('MstpDevice accepts optional deviceInstance field', () => {
    const d: MstpDevice = { nodeId: 'n', mac: 5, label: 'FEC-1', deviceInstance: 5005 };
    expect(d.deviceInstance).toBe(5005);
    // omitting deviceInstance still typechecks (optional field)
    const d2: MstpDevice = { nodeId: 'n2', mac: 6, label: 'FEC-2' };
    expect(d2.deviceInstance).toBeUndefined();
  });

  it('mstpServiceLatencySeconds: faster baud → faster RTT', () => {
    const at9600 = mstpServiceLatencySeconds(9600);
    const at38400 = mstpServiceLatencySeconds(38400);
    const at76800 = mstpServiceLatencySeconds(76800);
    expect(at9600).toBeGreaterThan(at38400);
    expect(at38400).toBeGreaterThan(at76800);
    // Sanity: 38400 round-trip lands in the 50-100ms range
    expect(at38400).toBeGreaterThan(0.05);
    expect(at38400).toBeLessThan(0.1);
  });

  it('mstpServiceLatencySeconds: token-wait floor of 50ms', () => {
    // Even at infinitely fast baud the queue dominates → at least 50ms.
    expect(mstpServiceLatencySeconds(1_000_000)).toBeGreaterThanOrEqual(0.05);
  });

  it('BACNET_IP_RTT_SECONDS is faster than any MS/TP baud', () => {
    expect(BACNET_IP_RTT_SECONDS).toBeLessThan(mstpServiceLatencySeconds(76800));
  });
});

describe('assignMstpAddressing — deterministic MAC assignment from topology', () => {
  // A small trunk: NAE supervisor + two FECs, all on one MS/TP segment.
  const nodes: MstpAddressingNode[] = [
    { id: 'sup', label: 'NAE-1', kind: 'supervisor' },
    { id: 'fa', label: 'FEC-A', kind: 'controller' },
    { id: 'fb', label: 'FEC-B', kind: 'controller' },
  ];
  const trunk1: MstpAddressingEdge[] = [
    { id: 'e1', source: 'sup', target: 'fa', wireKind: 'mstp', baud: 38400 },
    { id: 'e2', source: 'fa', target: 'fb', wireKind: 'mstp', baud: 38400 },
  ];

  it('puts the supervisor at MAC 0 and assigns children in label order', () => {
    const { byNode } = assignMstpAddressing(nodes, trunk1);
    expect(byNode.get('sup')?.mac).toBe(0);
    expect(byNode.get('fa')?.mac).toBe(1);
    expect(byNode.get('fb')?.mac).toBe(2);
  });

  it('defaults device instance to 1000 + mac', () => {
    const { byNode } = assignMstpAddressing(nodes, trunk1);
    expect(byNode.get('sup')?.deviceInstance).toBe(1000);
    expect(byNode.get('fb')?.deviceInstance).toBe(1002);
  });

  it('honors a forcedMac override (dip-switch) over auto-assignment', () => {
    const withForce: MstpAddressingNode[] = [
      ...nodes.slice(0, 2),
      { id: 'fb', label: 'FEC-B', kind: 'controller', forcedMac: 17 },
    ];
    const { byNode } = assignMstpAddressing(withForce, trunk1);
    expect(byNode.get('fb')?.mac).toBe(17);
    expect(byNode.get('fb')?.deviceInstance).toBe(1017);
  });

  it('honors an explicit deviceInstance override', () => {
    const withInst: MstpAddressingNode[] = [
      { id: 'sup', label: 'NAE-1', kind: 'supervisor', deviceInstance: 99001 },
      ...nodes.slice(1),
    ];
    const { byNode } = assignMstpAddressing(withInst, trunk1);
    expect(byNode.get('sup')?.mac).toBe(0);
    expect(byNode.get('sup')?.deviceInstance).toBe(99001);
  });

  it('leaves no MAC 0 when a trunk has no master role (known quirk)', () => {
    // No supervisor, no forced-0, no IP uplink → there is no master role,
    // so children simply number from MAC 1 and the segment has no MAC 0.
    // (A real MS/TP segment must have a master; the trunk validator warns
    // about this separately. This test pins the actual addressing behavior
    // so it can't silently change.)
    const noSup: MstpAddressingNode[] = [
      { id: 'fa', label: 'FEC-A', kind: 'controller' },
      { id: 'fb', label: 'FEC-B', kind: 'controller' },
    ];
    const { byNode } = assignMstpAddressing(noSup, [
      { id: 'e1', source: 'fa', target: 'fb', wireKind: 'mstp' },
    ]);
    expect(byNode.get('fa')?.mac).toBe(1);
    expect(byNode.get('fb')?.mac).toBe(2);
  });

  it('a BACnet/IP-uplinked router is the MS/TP master when no supervisor', () => {
    const router: MstpAddressingNode[] = [
      { id: 'jace', label: 'ZZZ-JACE', kind: 'router' },
      { id: 'fa', label: 'FEC-A', kind: 'controller' },
    ];
    const edges: MstpAddressingEdge[] = [
      { id: 'm1', source: 'jace', target: 'fa', wireKind: 'mstp' },
      { id: 'ip1', source: 'jace', target: 'sup', wireKind: 'bacnet-ip' },
    ];
    const { byNode } = assignMstpAddressing(router, edges);
    // Even though ZZZ-JACE sorts last, its IP uplink makes it MAC 0.
    expect(byNode.get('jace')?.mac).toBe(0);
    expect(byNode.get('fa')?.mac).toBe(1);
  });

  it('separates disjoint trunks into independent MAC rings', () => {
    const twoTrunks: MstpAddressingNode[] = [
      { id: 'sA', label: 'NAE-A', kind: 'supervisor' },
      { id: 'c1', label: 'CTL-1', kind: 'controller' },
      { id: 'sB', label: 'NAE-B', kind: 'supervisor' },
      { id: 'c2', label: 'CTL-2', kind: 'controller' },
    ];
    const edges: MstpAddressingEdge[] = [
      { id: 'tA', source: 'sA', target: 'c1', wireKind: 'mstp' },
      { id: 'tB', source: 'sB', target: 'c2', wireKind: 'mstp' },
    ];
    const { trunks, byNode } = assignMstpAddressing(twoTrunks, edges);
    expect(trunks.length).toBe(2);
    // Each trunk restarts MAC numbering at its own master.
    expect(byNode.get('sA')?.mac).toBe(0);
    expect(byNode.get('c1')?.mac).toBe(1);
    expect(byNode.get('sB')?.mac).toBe(0);
    expect(byNode.get('c2')?.mac).toBe(1);
    // Trunk key is the representative edge id.
    expect(byNode.get('c1')?.trunkKey).toBe('tA');
    expect(byNode.get('c2')?.trunkKey).toBe('tB');
  });

  it('ignores non-MS/TP edges (pure BACnet/IP devices get no MAC)', () => {
    const ipOnly: MstpAddressingNode[] = [
      { id: 'a', label: 'AHU-IP', kind: 'controller' },
      { id: 'b', label: 'BLR-IP', kind: 'controller' },
    ];
    const { byNode, trunks } = assignMstpAddressing(ipOnly, [
      { id: 'ip1', source: 'a', target: 'b', wireKind: 'bacnet-ip' },
    ]);
    expect(trunks.length).toBe(0);
    expect(byNode.size).toBe(0);
  });

  it('devices come back sorted into MAC (token-ring) order', () => {
    const { trunks } = assignMstpAddressing(nodes, trunk1);
    const macs = trunks[0].devices.map((d) => d.mac);
    expect(macs).toEqual([...macs].sort((a, b) => a - b));
  });
});
