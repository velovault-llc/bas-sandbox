import { describe, it, expect } from 'vitest';
import {
  emitWhoIs,
  emitIAm,
  emitReadProperty,
  emitReadPropertyAck,
  emitSubscribeCov,
  emitSubscribeCovAck,
  emitCovNotification,
  emitTokenPass,
  emitPollForMaster,
  emitTimeout,
  toConformancePacket,
  checkBacnetConformance,
} from '../src/index.js';

describe('emit module — wire-format builders', () => {
  describe('emitWhoIs', () => {
    it('local subnet broadcast carries BVLC fn 0x0b suffix', () => {
      const p = emitWhoIs({
        simSec: 30,
        srcLabel: 'NAE-1',
        srcMac: 0,
        transport: 'broadcast-ip',
      });
      expect(p.service).toBe('Who-Is');
      expect(p.summary).toContain('NAE-1 (MAC 0) Who-Is broadcast');
      expect(p.summary).toContain('BVLC fn 0x0b Original-Broadcast-NPDU');
      expect(p.layer).toBe('app');
    });

    it('BBMD-forwarded variant carries BVLC fn 0x04 suffix', () => {
      const p = emitWhoIs({
        simSec: 30,
        srcLabel: 'JACE-OPS',
        srcIp: '10.0.1.10',
        transport: 'forwarded-ip',
        context: '→ reaches JACE-TENANT via BBMD bridge',
      });
      expect(p.summary).toContain('BVLC fn 0x04 Forwarded-NPDU');
      expect(p.summary).toContain('(10.0.1.10)');
      expect(p.summary).toContain('via BBMD bridge');
    });
  });

  describe('emitIAm', () => {
    it('matches the bacpypes3 wire format verified in BBMD lab', () => {
      // Ground truth captured 2026-05-23 from bbmd_node.py:
      //   device,1801 maxAPDU 1024 segmented-both vendorId 999
      const p = emitIAm({
        simSec: 0.1,
        srcLabel: 'BBMD-A',
        srcMac: 0,
        deviceInstance: 1801,
        vendorId: 999,
      });
      expect(p.service).toBe('I-Am');
      expect(p.summary).toContain('I-Am device,1801');
      expect(p.summary).toContain('maxAPDU 1024');
      expect(p.summary).toContain('segmentation segmented-both');
      expect(p.summary).toContain('vendorId 999');
      // Default transport = unicast IP (post-Who-Is reply).
      expect(p.summary).toContain('BVLC fn 0x0a Original-Unicast-NPDU');
    });

    it('honors non-default segmentation + maxApdu', () => {
      const p = emitIAm({
        simSec: 0,
        srcLabel: 'old-FEC',
        deviceInstance: 100,
        vendorId: 5,
        maxApdu: 480,
        segmentation: 'no-segmentation',
      });
      expect(p.summary).toContain('maxAPDU 480');
      expect(p.summary).toContain('segmentation no-segmentation');
    });

    it('all four ASHRAE 135 §16.10.2 required fields appear in the summary', () => {
      // The conformance checker scrapes I-Am summaries for these
      // exact substrings. This is a regression guard.
      const p = emitIAm({
        simSec: 0,
        srcLabel: 'X',
        deviceInstance: 42,
        vendorId: 15,
      });
      expect(/device,\d+/.test(p.summary)).toBe(true);
      expect(/maxAPDU \d+/.test(p.summary)).toBe(true);
      expect(/segmentation [a-z-]+/.test(p.summary)).toBe(true);
      expect(/vendorId \d+/.test(p.summary)).toBe(true);
    });
  });

  describe('emitReadProperty / emitReadPropertyAck', () => {
    it('request carries invokeId + Expecting-Reply NPDU flag', () => {
      const p = emitReadProperty({
        simSec: 1,
        srcLabel: 'SUP',
        dstLabel: 'VAV-1',
        objectId: 'analog-input,1',
        propertyName: 'present-value',
        propertyId: 85,
        invokeId: 7,
      });
      expect(p.service).toBe('ReadProperty');
      expect(p.summary).toContain('SUP → VAV-1');
      expect(p.summary).toContain('analog-input,1');
      expect(p.summary).toContain('present-value (85)');
      expect(p.summary).toContain('invokeId 7');
      expect(p.summary).toContain('NPDU Expecting-Reply');
    });

    it('ACK with same invokeId pairs correctly via conformance check', () => {
      const req = emitReadProperty({
        simSec: 1,
        srcLabel: 'SUP',
        objectId: 'analog-input,1',
        propertyName: 'present-value',
        propertyId: 85,
        invokeId: 12,
      });
      const ack = emitReadPropertyAck({
        simSec: 1.05,
        srcLabel: 'VAV-1',
        objectId: 'analog-input,1',
        propertyName: 'present-value',
        invokeId: 12,
        value: 72.4,
      });
      // Drive the conformance checker with real emit output — no
      // synthetic strings. This is the whole point of the refactor:
      // experiments + UI + conformance all share one packet shape.
      const findings = checkBacnetConformance([
        // Need a Who-Is in the trace to avoid the no-whois finding
        // distracting from the actual assertion.
        toConformancePacket(
          emitWhoIs({ simSec: 0, srcLabel: 'SUP', transport: 'broadcast-ip' }),
        ),
        toConformancePacket(req),
        toConformancePacket(ack),
      ]);
      expect(findings.some((f) => f.id === 'bacnet.readproperty-no-ack')).toBe(false);
      expect(findings.some((f) => f.id === 'bacnet.missing-invoke-id')).toBe(false);
    });
  });

  describe('emitCovNotification', () => {
    it('includes statusFlags by default (§13.10 requirement)', () => {
      const p = emitCovNotification({
        simSec: 60,
        srcLabel: 'VAV-1',
        objectId: 'analog-input,1',
        value: 72.4,
      });
      expect(p.summary).toContain('statusFlags F,F,F,F');
    });

    it('statusFlags override (e.g. fault active)', () => {
      const p = emitCovNotification({
        simSec: 60,
        srcLabel: 'VAV-1',
        objectId: 'analog-input,1',
        value: 0,
        statusFlags: 'F,T,F,F',
      });
      expect(p.summary).toContain('statusFlags F,T,F,F');
    });
  });

  describe('MS/TP link-layer emitters', () => {
    it('Token-Pass is link layer, has no BVLC tag', () => {
      const p = emitTokenPass({
        simSec: 0,
        trunkId: 'trunk-1',
        srcMac: 1,
        srcLabel: 'FEC-A',
        dstMac: 2,
        dstLabel: 'FEC-B',
      });
      expect(p.service).toBe('Token-Pass');
      expect(p.layer).toBe('link');
      expect(p.summary).not.toContain('BVLC');
    });

    it('Poll-For-Master format', () => {
      const p = emitPollForMaster({
        simSec: 0,
        trunkId: 'trunk-1',
        srcMac: 0,
        srcLabel: 'NAE',
        dstMac: 5,
      });
      expect(p.service).toBe('Poll-For-Master');
      expect(p.summary).toContain('polls for master at MAC 5');
    });
  });

  describe('emitTimeout', () => {
    it('synthetic packet with TIMEOUT marker', () => {
      const p = emitTimeout({
        simSec: 4,
        srcLabel: 'SUP',
        dstLabel: 'VAV-1',
        serviceName: 'ReadProperty',
        invokeId: 7,
      });
      expect(p.service).toBe('Timeout');
      expect(p.summary).toContain('ReadProperty TIMEOUT');
      expect(p.summary).toContain('invokeId 7');
    });
  });

  describe('toConformancePacket', () => {
    it('round-trips fields cleanly', () => {
      const built = emitIAm({
        simSec: 1.5,
        srcLabel: 'NAE',
        srcMac: 0,
        dstMac: 3,
        deviceInstance: 1001,
        vendorId: 5,
      });
      const cp = toConformancePacket(built);
      expect(cp.simSec).toBe(1.5);
      expect(cp.service).toBe('I-Am');
      expect(cp.srcMac).toBe(0);
      expect(cp.dstMac).toBe(3);
      expect(cp.summary).toBe(built.summary);
    });
  });
});
