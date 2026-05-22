import { describe, it, expect } from 'vitest';
import {
  initMstpTrunkState,
  stepMstpToken,
  tokenHoldSeconds,
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
});
