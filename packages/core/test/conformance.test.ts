import { describe, it, expect } from 'vitest';
import {
  checkBacnetConformance,
  summarizeConformance,
  type ConformancePacket,
} from '../src/bacnet/conformance.js';

const pkt = (overrides: Partial<ConformancePacket> & { simSec: number; service: string }): ConformancePacket => ({
  ...overrides,
});

describe('checkBacnetConformance', () => {
  // ── Who-Is cadence ──────────────────────────────────────────────

  it('no Who-Is broadcasts → warning', () => {
    const findings = checkBacnetConformance([
      pkt({ simSec: 0, service: 'I-Am', summary: 'Device Instance 1001 maxAPDU 1476 segmentation noSegmentation vendorId 260' }),
    ]);
    const f = findings.find((x) => x.id === 'bacnet.no-whois');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
    expect(f!.citation).toMatch(/16\.10/);
  });

  it('Who-Is at healthy 30s cadence → no finding', () => {
    const packets: ConformancePacket[] = [];
    for (let t = 0; t < 300; t += 30) {
      packets.push(pkt({ simSec: t, service: 'Who-Is', summary: 'Who-Is broadcast' }));
    }
    const findings = checkBacnetConformance(packets);
    expect(findings.some((f) => f.id === 'bacnet.no-whois')).toBe(false);
    expect(findings.some((f) => f.id === 'bacnet.whois-too-rare')).toBe(false);
  });

  it('Who-Is at 600s cadence → info (too rare)', () => {
    const packets: ConformancePacket[] = [
      pkt({ simSec: 0, service: 'Who-Is' }),
      pkt({ simSec: 600, service: 'Who-Is' }),
      pkt({ simSec: 1200, service: 'Who-Is' }),
    ];
    const findings = checkBacnetConformance(packets);
    const f = findings.find((x) => x.id === 'bacnet.whois-too-rare');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  // ── I-Am required fields ────────────────────────────────────────

  it('I-Am with all 4 required fields → no missing-fields finding', () => {
    const packets = [
      pkt({
        simSec: 0,
        service: 'I-Am',
        summary: 'NAE-1 (MAC 0) I-Am — Device Instance 1001 · maxAPDU 1476 · segmentation noSegmentation · vendorId 260',
      }),
    ];
    const findings = checkBacnetConformance(packets);
    expect(findings.some((f) => f.id === 'bacnet.iam-missing-fields')).toBe(false);
  });

  it('I-Am with only Device Instance → flags missing-fields', () => {
    const packets = [
      pkt({
        simSec: 0,
        service: 'I-Am',
        summary: 'NAE-1 (MAC 0) I-Am — Device Instance 1001',
      }),
    ];
    const findings = checkBacnetConformance(packets);
    const f = findings.find((x) => x.id === 'bacnet.iam-missing-fields');
    expect(f).toBeDefined();
    expect(f!.citation).toMatch(/§16\.10\.2/);
  });

  // ── I-Am triggered by Who-Is ────────────────────────────────────

  it('I-Am during boot window → not flagged as orphan', () => {
    const packets = [
      pkt({ simSec: 2, service: 'I-Am', summary: 'Device Instance 1001 maxAPDU 1476 segmentation noSegmentation vendorId 260' }),
    ];
    const findings = checkBacnetConformance(packets);
    expect(findings.some((f) => f.id === 'bacnet.iam-without-whois')).toBe(false);
  });

  it('I-Am after recent Who-Is → not flagged', () => {
    const packets = [
      pkt({ simSec: 60, service: 'Who-Is', trunkId: 't1' }),
      pkt({ simSec: 60.5, service: 'I-Am', trunkId: 't1', summary: 'Device Instance 1001 maxAPDU 1476 segmentation noSegmentation vendorId 260' }),
    ];
    const findings = checkBacnetConformance(packets);
    expect(findings.some((f) => f.id === 'bacnet.iam-without-whois')).toBe(false);
  });

  it('I-Am with no Who-Is in window → info finding', () => {
    const packets = [
      pkt({ simSec: 100, service: 'I-Am', summary: 'Device Instance 1001 maxAPDU 1476 segmentation noSegmentation vendorId 260' }),
    ];
    const findings = checkBacnetConformance(packets);
    const f = findings.find((x) => x.id === 'bacnet.iam-without-whois');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  // ── ReadProperty acknowledgment ─────────────────────────────────

  it('ReadProperty with matching ACK within 3s → no finding', () => {
    const packets: ConformancePacket[] = [
      pkt({ simSec: 10, service: 'ReadProperty', srcMac: 0, dstMac: 3, objectId: 'AI:1' }),
      pkt({ simSec: 10.1, service: 'ReadProperty-ACK', srcMac: 3, dstMac: 0, objectId: 'AI:1', value: 72.4 }),
    ];
    const findings = checkBacnetConformance(packets);
    expect(findings.some((f) => f.id === 'bacnet.readproperty-no-ack')).toBe(false);
  });

  it('ReadProperty with no reply → error', () => {
    const packets: ConformancePacket[] = [
      pkt({ simSec: 10, service: 'ReadProperty', srcMac: 0, dstMac: 3, objectId: 'AI:1' }),
    ];
    const findings = checkBacnetConformance(packets);
    const f = findings.find((x) => x.id === 'bacnet.readproperty-no-ack');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('ReadProperty with Timeout marker → not flagged (the timeout is the response)', () => {
    const packets: ConformancePacket[] = [
      pkt({ simSec: 10, service: 'ReadProperty', srcMac: 0, dstMac: 3, objectId: 'AI:1' }),
      pkt({ simSec: 12.5, service: 'Timeout', srcMac: 3, dstMac: 0, objectId: 'AI:1' }),
    ];
    const findings = checkBacnetConformance(packets);
    expect(findings.some((f) => f.id === 'bacnet.readproperty-no-ack')).toBe(false);
  });

  // ── COV statusFlags ─────────────────────────────────────────────

  it('COV notification missing statusFlags → warning', () => {
    const packets = [
      pkt({ simSec: 5, service: 'ConfirmedCOVNotification', objectId: 'AI:1', summary: 'COV update presentValue 72.3' }),
    ];
    const findings = checkBacnetConformance(packets);
    const f = findings.find((x) => x.id === 'bacnet.cov-missing-statusflags');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('COV notification with statusFlags → no finding', () => {
    const packets = [
      pkt({
        simSec: 5,
        service: 'ConfirmedCOVNotification',
        objectId: 'AI:1',
        summary: 'COV update presentValue 72.3 statusFlags ()',
      }),
    ];
    const findings = checkBacnetConformance(packets);
    expect(findings.some((f) => f.id === 'bacnet.cov-missing-statusflags')).toBe(false);
  });

  // ── Duplicate Device Instance ───────────────────────────────────

  it('two devices claiming the same instance → error', () => {
    const packets = [
      pkt({ simSec: 0, service: 'I-Am', srcMac: 1, summary: 'Device Instance 1001 maxAPDU 1476 segmentation noSegmentation vendorId 260' }),
      pkt({ simSec: 1, service: 'I-Am', srcMac: 2, summary: 'Device Instance 1001 maxAPDU 1476 segmentation noSegmentation vendorId 260' }),
    ];
    const findings = checkBacnetConformance(packets);
    const f = findings.find((x) => x.id === 'bacnet.duplicate-instance');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
    expect(f!.title).toContain('1001');
  });

  it('two announcements from the same device → not duplicate', () => {
    const packets = [
      pkt({ simSec: 0, service: 'I-Am', srcMac: 1, summary: 'Device Instance 1001 maxAPDU 1476 segmentation noSegmentation vendorId 260' }),
      pkt({ simSec: 60, service: 'I-Am', srcMac: 1, summary: 'Device Instance 1001 maxAPDU 1476 segmentation noSegmentation vendorId 260' }),
    ];
    const findings = checkBacnetConformance(packets);
    expect(findings.some((f) => f.id === 'bacnet.duplicate-instance')).toBe(false);
  });

  // ── Unknown service ─────────────────────────────────────────────

  it('packet with non-standard service name → warning', () => {
    const packets = [pkt({ simSec: 0, service: 'GreetingsFromTheToaster' })];
    const findings = checkBacnetConformance(packets);
    const f = findings.find((x) => x.id === 'bacnet.unknown-service');
    expect(f).toBeDefined();
    expect(f!.title).toContain('GreetingsFromTheToaster');
  });

  // ── Summary ─────────────────────────────────────────────────────

  it('summarizeConformance counts by severity', () => {
    const packets = [
      // 1 error: ReadProperty without ACK
      pkt({ simSec: 10, service: 'ReadProperty', srcMac: 0, dstMac: 3, objectId: 'AI:1' }),
      // 1 warning: no Who-Is at all
      pkt({ simSec: 12, service: 'I-Am', srcMac: 1, summary: 'Device Instance 1001 maxAPDU 1476 segmentation noSegmentation vendorId 260' }),
    ];
    const findings = checkBacnetConformance(packets);
    const summary = summarizeConformance(findings);
    expect(summary.errors).toBeGreaterThanOrEqual(1);
    expect(summary.warnings).toBeGreaterThanOrEqual(1);
    expect(summary.total).toBe(summary.errors + summary.warnings + summary.infos);
  });

  it('returns findings sorted errors > warnings > infos', () => {
    const packets = [
      // Generates an error (ReadProperty no ACK), a warning (no Who-Is), an info (I-Am orphan).
      pkt({ simSec: 100, service: 'ReadProperty', srcMac: 0, dstMac: 3, objectId: 'AI:1' }),
      pkt({ simSec: 102, service: 'I-Am', srcMac: 1, summary: 'Device Instance 1001 maxAPDU 1476 segmentation noSegmentation vendorId 260' }),
    ];
    const findings = checkBacnetConformance(packets);
    const severities = findings.map((f) => f.severity);
    // First finding must be an error if any errors exist; warnings before infos.
    let lastRank = 0;
    const rank: Record<string, number> = { error: 0, warning: 1, info: 2 };
    for (const s of severities) {
      expect(rank[s]).toBeGreaterThanOrEqual(lastRank);
      lastRank = rank[s];
    }
  });
});
