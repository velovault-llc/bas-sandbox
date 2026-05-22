import { describe, it, expect } from 'vitest';
import {
  initMstpTrunkState,
  stepMstpToken,
  tokenHoldSeconds,
  defaultDeviceInstance,
  mstpServiceLatencySeconds,
  BACNET_IP_RTT_SECONDS,
  type MstpDevice,
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
