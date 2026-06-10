import { describe, it, expect } from 'vitest';
import {
  validateMstpTrunks,
  validateMstpTopology,
  MSTP_TRUNK_RECOMMENDED_MAX_DEVICES,
  type MstpDevice,
  type MstpAddressingNode,
  type MstpAddressingEdge,
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
});

// ── Physical topology: T-tap / star + EOL termination ────────────────

const tnode = (
  id: string,
  kind = 'controller',
  eolTerminated?: boolean,
): MstpAddressingNode => ({ id, label: id.toUpperCase(), kind, eolTerminated });
const wire = (id: string, a: string, b: string): MstpAddressingEdge => ({
  id,
  source: a,
  target: b,
  wireKind: 'mstp',
});

describe('validateMstpTopology', () => {
  it('clean daisy-chain: no T-tap; un-modeled EOL surfaces one info hint', () => {
    // sup — a — b (chain, degrees 1-2-1)
    const findings = validateMstpTopology(
      [tnode('sup', 'supervisor'), tnode('a'), tnode('b')],
      [wire('e1', 'sup', 'a'), wire('e2', 'a', 'b')],
    );
    expect(findings.filter((f) => f.id === 'mstp.t-tap')).toEqual([]);
    const hint = findings.find((f) => f.id === 'mstp.eol-unset');
    expect(hint).toBeDefined();
    expect(hint!.severity).toBe('info');
    // The hint names the two physical chain ends.
    expect(hint!.nodeIds).toContain('sup');
    expect(hint!.nodeIds).toContain('b');
  });

  it('hub-spoke wiring is a T-tap error on the hub', () => {
    // sup feeds 3 controllers star-style — 3 wires on sup.
    const findings = validateMstpTopology(
      [tnode('sup', 'supervisor'), tnode('a'), tnode('b'), tnode('c')],
      [wire('e1', 'sup', 'a'), wire('e2', 'sup', 'b'), wire('e3', 'sup', 'c')],
    );
    const t = findings.find((f) => f.id === 'mstp.t-tap');
    expect(t).toBeDefined();
    expect(t!.severity).toBe('error');
    expect(t!.nodeIds).toEqual(['sup']);
  });

  it('a repeater may branch the segment without a T-tap finding', () => {
    const findings = validateMstpTopology(
      [tnode('rep', 'repeater'), tnode('a'), tnode('b'), tnode('c')],
      [wire('e1', 'rep', 'a'), wire('e2', 'rep', 'b'), wire('e3', 'rep', 'c')],
    );
    expect(findings.filter((f) => f.id === 'mstp.t-tap')).toEqual([]);
  });

  it('EOL: correctly terminated chain ends → no warnings', () => {
    const findings = validateMstpTopology(
      [tnode('sup', 'supervisor', true), tnode('a', 'controller', false), tnode('b', 'controller', true)],
      [wire('e1', 'sup', 'a'), wire('e2', 'a', 'b')],
    );
    expect(findings.filter((f) => f.id.startsWith('mstp.eol'))).toEqual([]);
  });

  it('EOL: missing at a chain end + set mid-chain are both flagged', () => {
    // b (end) unterminated; a (middle) terminated.
    const findings = validateMstpTopology(
      [tnode('sup', 'supervisor', true), tnode('a', 'controller', true), tnode('b', 'controller', false)],
      [wire('e1', 'sup', 'a'), wire('e2', 'a', 'b')],
    );
    const missing = findings.find((f) => f.id === 'mstp.eol-missing');
    const mid = findings.find((f) => f.id === 'mstp.eol-mid-chain');
    expect(missing).toBeDefined();
    expect(missing!.nodeIds).toEqual(['b']);
    expect(mid).toBeDefined();
    expect(mid!.nodeIds).toEqual(['a']);
  });

  it('two engines on one trunk: error naming both supervisors', () => {
    // sup1 — fec — sup2: physically a legal multi-master chain, but in BAS
    // practice one engine OWNS a field bus — the addressing demotes one
    // supervisor to a child MAC and they fight over the same devices.
    const findings = validateMstpTopology(
      [tnode('sup1', 'supervisor'), tnode('fec'), tnode('sup2', 'supervisor')],
      [wire('e1', 'sup1', 'fec'), wire('e2', 'fec', 'sup2')],
    );
    const f = findings.find((x) => x.id === 'mstp.multiple-engines');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
    expect(f!.nodeIds).toContain('sup1');
    expect(f!.nodeIds).toContain('sup2');
  });

  it('one engine per trunk across separate trunks: no multiple-engines finding', () => {
    const findings = validateMstpTopology(
      [tnode('sup1', 'supervisor'), tnode('a'), tnode('sup2', 'supervisor'), tnode('b')],
      [wire('e1', 'sup1', 'a'), wire('e2', 'sup2', 'b')],
    );
    expect(findings.filter((x) => x.id === 'mstp.multiple-engines')).toEqual([]);
  });

  it('two separate trunks validate independently', () => {
    const findings = validateMstpTopology(
      [tnode('s1', 'supervisor'), tnode('a'), tnode('b'), tnode('c'), tnode('s2', 'supervisor'), tnode('x')],
      [
        // trunk 1: star on s1 (T-tap)
        wire('e1', 's1', 'a'),
        wire('e2', 's1', 'b'),
        wire('e3', 's1', 'c'),
        // trunk 2: clean pair
        wire('e4', 's2', 'x'),
      ],
    );
    const taps = findings.filter((f) => f.id === 'mstp.t-tap');
    expect(taps).toHaveLength(1);
    expect(taps[0].trunkId).toBe('e1');
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
