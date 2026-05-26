// Byte-exact tests for the wire-format encoder.
//
// Reference bytes for Who-Is + I-Am come from a one-shot bacpypes3
// encode session — see the script comment in each test for the exact
// invocation. Reference bytes for ReadProperty + SimpleAck come from
// the ASHRAE 135 standard form which has no ambiguous fields once we
// pin maxSegs=0 / maxResp=5 (1476-byte cap, the modern default).

import { describe, it, expect } from 'vitest';
import {
  encodeWhoIs,
  encodeIAm,
  encodeReadProperty,
  encodeReadPropertyAck,
  encodeSubscribeCov,
  encodeSimpleAck,
  bytesToHex,
} from '../src/bacnet/wire.js';

describe('wire encoder — byte-exact against bacpypes3 reference', () => {
  it('encodes Who-Is broadcast (unbounded form)', () => {
    // bacpypes3:
    //   from bacpypes3.apdu import WhoIsRequest
    //   req = WhoIsRequest(); req.apduSeg=0; req.apduMor=0
    //   wire = req.encode().encode().pduData
    //   manual_npdu = bytes([0x01, 0x20, 0xff, 0xff, 0x00, 0xff])
    //   frame = bvlc_wrap(0x0b, manual_npdu + wire)
    // → 810b000c0120ffff00ff1008
    expect(bytesToHex(encodeWhoIs())).toBe('810b000c0120ffff00ff1008');
  });

  it('encodes I-Am broadcast with the standard four fields', () => {
    // bacpypes3 reference:
    //   IAmRequest(
    //     iAmDeviceIdentifier=('device', 1234),
    //     maxAPDULengthAccepted=1024,
    //     segmentationSupported=Segmentation('segmented-both'),
    //     vendorID=260,
    //   ).encode().encode().pduData wrapped in broadcast NPDU + BVLC.
    // → 810b00190120ffff00ff1000c4020004d22204009100220104
    //   ─── ──── ─── ─── ───── ── ── ───────── ───── ── ──────
    //   BVLC NPDU broadcast hdr APDU svc obj-id  maxApdu seg vendor
    expect(bytesToHex(encodeIAm({
      deviceInstance: 1234,
      maxApdu: 1024,
      segmentation: 'segmented-both',
      vendorId: 260,
    }))).toBe('810b00190120ffff00ff1000c4020004d22204009100220104');
  });

  it('encodes I-Am with 1-byte max-APDU and 1-byte vendor', () => {
    // Smaller field widths — vendor 5 (JCI), maxAPDU 50 (the spec
    // minimum). Tests the variable-length Unsigned encoder.
    // Expected (manual): 81 0b 00 17 01 20 ff ff 00 ff 10 00 c4 02 00 04 d2 21 32 91 00 21 05
    //                                                          obj 1234     maxApdu seg vendor
    expect(bytesToHex(encodeIAm({
      deviceInstance: 1234,
      maxApdu: 50,
      segmentation: 'segmented-both',
      vendorId: 5,
    }))).toBe('810b00170120ffff00ff1000c4020004d221329100210' + '5');
  });

  it('encodes ReadProperty AI:1 present-value (invokeId 42)', () => {
    // ASHRAE 135 §20.1.2 manual decode:
    //   APDU header: 00 (confirmed-request) 05 (maxSegs=0/maxResp=5)
    //                2a (invokeID=42) 0c (service ReadProperty=12)
    //   Context tag 0 (objectId, len 4): 0c 00 00 00 01
    //                                       ─── type=0 (AI) inst=1
    //   Context tag 1 (propertyId): 19 55 (tag class+1+length 1, value 85)
    //   NPDU control 0x04 = Expecting-Reply
    //   Total APDU = 11 bytes, NPDU = 2, BVLC = 4 → length 17 = 0x11
    expect(bytesToHex(encodeReadProperty({
      invokeId: 42,
      objectId: 'AI:1',
      propertyId: 85,
    }))).toBe('810a0011010400052a0c0c000000011955');
  });

  it('encodes SimpleAck (invokeId 99, service 20 = ReinitializeDevice)', () => {
    // ASHRAE 135 §20.1.3: SimpleAck is header-only.
    //   APDU: 20 (type 2 << 4) 63 (invokeID=99=0x63) 14 (service=20)
    //   NPDU control 0x00 — responses don't set Expecting-Reply.
    //   Total: 4 (BVLC) + 2 (NPDU) + 3 (APDU) = 9 bytes (0x09)
    expect(bytesToHex(encodeSimpleAck({
      invokeId: 99,
      serviceChoice: 20,
    }))).toBe('810a000901002063' + '14');
  });

  it('Who-Is with bounded range adds two context-tagged limits', () => {
    // Per §16.10.1 bounded form: context-tag 0 = low limit, ctx-tag 1 = high.
    // Manual: same broadcast wrapper, APDU body adds:
    //   09 00      (ctx tag 0, length 1, value 0)
    //   19 64      (ctx tag 1, length 1, value 100)
    // After 10 08, len grows by 4 → total 16 = 0x10.
    expect(bytesToHex(encodeWhoIs({ lowLimit: 0, highLimit: 100 }))).toBe(
      '810b00100120ffff00ff10080900' + '1964'
    );
  });

  it('encodes ReadProperty-ACK AI:1 = 73.4 °F (invokeId 42)', () => {
    // bacpypes3 reference (ReadPropertyACK with AnyAtomic(Real(73.4))):
    //   → 810a00170100302a0c0c0000000119553e444292cccd3f
    //   ─── ──── ─── ───── ────── ── ──── ─ ─────────── ─
    //   BVLC NPDU APDU-hdr ctx0(objId)  pid op real-val cl
    // 73.4 as IEEE 754 single-precision big-endian = 0x4292CCCD.
    expect(bytesToHex(encodeReadPropertyAck({
      invokeId: 42,
      objectId: 'AI:1',
      propertyId: 85,
      value: 73.4,
    }))).toBe('810a00170100302a0c0c0000000119553e444292cccd3f');
  });

  it('encodes SubscribeCOV (process=1, AI:1, confirmed, 600s lifetime, invokeId 7)', () => {
    // bacpypes3 reference (SubscribeCOVRequest):
    //   → 810a001601040005070509011c0000000129013a0258
    //   ─── ──── ──────── ── ── ───── ─────────── ───── ──────
    //   BVLC NPDU APDU-hdr ctx0  ctx1(objId AI:1)  ctx2 ctx3(600s)
    expect(bytesToHex(encodeSubscribeCov({
      invokeId: 7,
      subscriberProcessId: 1,
      monitoredObjectId: 'AI:1',
      issueConfirmed: true,
      lifetimeSeconds: 600,
    }))).toBe('810a001601040005070509011c0000000129013a0258');
  });

  it('encodes ReadProperty-ACK with negative + non-trivial Real values', () => {
    // Cold-zone reading. -10.5 = 0xC1280000 in IEEE 754 single.
    // AI:2 = type 0 (analog-input), instance 2 → objId raw 0x00000002.
    // Frame: BVLC(4) + NPDU(2) + APDU-hdr(3) + ctx0(5) + ctx1(2) + open(1)
    //        + real(5) + close(1) = 23 bytes (0x17).
    expect(bytesToHex(encodeReadPropertyAck({
      invokeId: 1,
      objectId: 'AI:2',
      propertyId: 85,
      value: -10.5,
    }))).toBe('810a0017010030010c0c000000021955 3e44c1280000 3f'.replace(/\s/g, ''));
  });

  it('encodes SubscribeCOV indefinite (lifetime=0) + unconfirmed notifications', () => {
    // Lifetime=0 means "indefinite subscription" per §13.1. The
    // lifetime tag encodes 0 as a 1-byte Unsigned.
    // AV:5 = type 2 (analog-value), instance 5 → raw 0x00800005.
    // invokeId 200 = 0xc8. Frame total 21 bytes (0x15).
    expect(bytesToHex(encodeSubscribeCov({
      invokeId: 200,
      subscriberProcessId: 42,
      monitoredObjectId: 'AV:5',
      issueConfirmed: false,
      lifetimeSeconds: 0,
    }))).toBe('810a001501040005c805 092a 1c00800005 2900 3900'.replace(/\s/g, ''));
  });

  it('produces structurally valid BVLC framing — length matches actual byte count', () => {
    // Defensive: for every encoder, the BVLC length field (bytes 3-4)
    // must equal the actual byte length of the frame. A drift here
    // would be a real codec bug that breaks every downstream consumer.
    const frames = [
      encodeWhoIs(),
      encodeIAm({ deviceInstance: 7, maxApdu: 480, segmentation: 'no-segmentation', vendorId: 37 }),
      encodeReadProperty({ invokeId: 0, objectId: 'AI:1', propertyId: 85 }),
      encodeSimpleAck({ invokeId: 0, serviceChoice: 14 }),
    ];
    for (const f of frames) {
      expect(f[0]).toBe(0x81);
      const declaredLen = (f[2] << 8) | f[3];
      expect(declaredLen).toBe(f.length);
    }
  });
});
