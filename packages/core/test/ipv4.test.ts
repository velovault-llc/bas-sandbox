import { describe, it, expect } from 'vitest';
import {
  validateBacnetIpNetwork,
  parseIpv4,
  formatIpv4,
  networkAddress,
  isContiguousMask,
  isPrivateIpv4,
  type BacnetIpDevice,
  type BacnetIpEdge,
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
