import { describe, it, expect } from 'vitest';
import {
  validateMstpTrunks,
  MSTP_TRUNK_RECOMMENDED_MAX_DEVICES,
  type MstpDevice,
} from '../src/bacnet/index.js';

function trunk(id: string, devices: MstpDevice[]) {
  return { trunkId: id, devices };
}

const sup = (mac = 0, label = 'NAE'): MstpDevice => ({ nodeId: `s-${mac}-${label}`, mac, label });
const fec = (mac: number, label = `FEC-${mac}`): MstpDevice => ({ nodeId: `f-${mac}-${label}`, mac, label });

describe('validateMstpTrunks', () => {
  it('happy trunk: 1 supervisor + a few FECs → no findings', () => {
    const findings = validateMstpTrunks([trunk('t1', [sup(), fec(1), fec(2), fec(3)])]);
    expect(findings).toEqual([]);
  });

  it('flags duplicate MACs with all involved nodes', () => {
    const a = fec(5, 'FEC-A');
    const b = fec(5, 'FEC-B');
    const findings = validateMstpTrunks([trunk('t1', [sup(), a, b])]);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('mstp.duplicate-mac');
    expect(findings[0].severity).toBe('error');
    expect(findings[0].nodeIds).toContain(a.nodeId);
    expect(findings[0].nodeIds).toContain(b.nodeId);
  });

  it('flags out-of-range MAC', () => {
    const bad = fec(128, 'WeirdBox');
    const findings = validateMstpTrunks([trunk('t1', [sup(), bad])]);
    const f = findings.find((f) => f.id === 'mstp.mac-out-of-range');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
    expect(f!.nodeIds).toEqual([bad.nodeId]);
  });

  it('flags trunk overload', () => {
    const devs = [sup()];
    for (let i = 1; i <= MSTP_TRUNK_RECOMMENDED_MAX_DEVICES + 5; i++) devs.push(fec(i));
    const findings = validateMstpTrunks([trunk('t1', devs)]);
    const f = findings.find((f) => f.id === 'mstp.trunk-overloaded');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('flags no supervisor', () => {
    const findings = validateMstpTrunks([trunk('t1', [fec(1), fec(2)])]);
    const f = findings.find((f) => f.id === 'mstp.no-supervisor');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('flags multiple supervisors', () => {
    const a = sup(0, 'NAE-1');
    const b = sup(0, 'NAE-2');
    const findings = validateMstpTrunks([trunk('t1', [a, b, fec(1)])]);
    // BOTH multiple-supervisors AND duplicate-mac fire on this
    // input (MAC 0 is duplicated) — that's by design: the two errors
    // give different remediation hints, so a user sees both.
    const ms = findings.find((f) => f.id === 'mstp.multiple-supervisors');
    const dm = findings.find((f) => f.id === 'mstp.duplicate-mac');
    expect(ms).toBeDefined();
    expect(dm).toBeDefined();
  });

  it('empty trunk: no findings', () => {
    const findings = validateMstpTrunks([trunk('t1', [])]);
    expect(findings).toEqual([]);
  });

  it('multi-trunk: findings carry their trunkId', () => {
    const findings = validateMstpTrunks([
      trunk('healthy', [sup(), fec(1)]),
      trunk('broken', [fec(5), fec(5)]),
    ]);
    expect(findings.every((f) => ['healthy', 'broken'].includes(f.trunkId))).toBe(true);
    expect(findings.find((f) => f.id === 'mstp.duplicate-mac')!.trunkId).toBe('broken');
  });
});
