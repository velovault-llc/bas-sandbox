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
  encodeConfirmedCovNotification,
  encodeUnconfirmedCovNotification,
  encodeSimpleAck,
  encodeBvlcResult,
  encodeRegisterForeignDevice,
  encodeForwardedNpdu,
  encodeDistributeBroadcastToNetwork,
  BVLC_RESULT_SUCCESS,
  BVLC_RESULT_REGISTER_FOREIGN_DEVICE_NAK,
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

  it('encodes ConfirmedCOVNotification (process=1, device:4321 reports AI:1 = 73.4)', () => {
    // bacpypes3 reference (ConfirmedCOVNotificationRequest with the
    // standard two-property listOfValues — present-value + status-flags
    // all clear). Frame breakdown:
    //   810a002b 0104 00 05 0b 01           ← BVLC + NPDU + APDU header (svc=1, inv=11)
    //   09 01                                ← ctx0  procId=1
    //   1c 020010e1                          ← ctx1  device,4321 (0x008<<22 | 0x10e1)
    //   2c 00000001                          ← ctx2  analog-input,1
    //   3a 021c                              ← ctx3  timeRemaining=540
    //   4e                                   ← opening tag 4 (listOfValues)
    //     09 55  2e 44 4292cccd 2f           ← present-value = 73.4 (Real)
    //     09 6f  2e 82 04 00 2f              ← status-flags  = BitString (4 zero bits)
    //   4f                                   ← closing tag 4
    expect(bytesToHex(encodeConfirmedCovNotification({
      invokeId: 11,
      subscriberProcessId: 1,
      initiatingDeviceId: 4321,
      monitoredObjectId: 'AI:1',
      timeRemainingSec: 540,
      presentValue: 73.4,
      statusFlags: { inAlarm: false, fault: false, overridden: false, outOfService: false },
    }))).toBe('810a002b010400050b0109011c020010e12c000000013a021c4e09552e444292cccd2f096f2e8204002f4f');
  });

  it('encodes UnconfirmedCOVNotification (same payload, no invokeID, no Expecting-Reply)', () => {
    // bacpypes3 reference. Differences vs the confirmed variant:
    //   - APDU header is 2 bytes (10 02) — type 1 unconfirmed-req + svc 2
    //   - NPDU control is 0x00 (no Expecting-Reply)
    //   - Total 4 bytes shorter
    expect(bytesToHex(encodeUnconfirmedCovNotification({
      subscriberProcessId: 1,
      initiatingDeviceId: 4321,
      monitoredObjectId: 'AI:1',
      timeRemainingSec: 540,
      presentValue: 73.4,
      statusFlags: { inAlarm: false, fault: false, overridden: false, outOfService: false },
    }))).toBe('810a00290100100209011c020010e12c000000013a021c4e09552e444292cccd2f096f2e8204002f4f');
  });

  it('encodes COV-Notification with in-alarm status (statusFlags BitString = 0x80)', () => {
    // inAlarm=true, others false → packed bits 1000 0000 = 0x80.
    // Only the BitString data byte changes vs the previous test —
    // tag header (82 04) and structure stay identical. Defends
    // against accidentally swapping the bit-pack endianness.
    const hex = bytesToHex(encodeUnconfirmedCovNotification({
      subscriberProcessId: 1,
      initiatingDeviceId: 4321,
      monitoredObjectId: 'AI:1',
      timeRemainingSec: 540,
      presentValue: 73.4,
      statusFlags: { inAlarm: true, fault: false, overridden: false, outOfService: false },
    }));
    expect(hex.endsWith('8204802f4f')).toBe(true);
    // Earlier same-position byte (clean status) ended with 8204002f4f.
    expect(hex.replace('8204802f4f', '8204002f4f')).toBe(
      '810a00290100100209011c020010e12c000000013a021c4e09552e444292cccd2f096f2e8204002f4f'
    );
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
      encodeBvlcResult({ resultCode: BVLC_RESULT_SUCCESS }),
      encodeRegisterForeignDevice({ ttlSeconds: 60 }),
      encodeForwardedNpdu({ originatorIp: '192.168.1.10', inner: encodeWhoIs() }),
      encodeDistributeBroadcastToNetwork({ inner: encodeWhoIs() }),
    ];
    for (const f of frames) {
      expect(f[0]).toBe(0x81);
      const declaredLen = (f[2] << 8) | f[3];
      expect(declaredLen).toBe(f.length);
    }
  });
});

describe('wire encoder — BACnet/IP broadcast management (Annex J)', () => {
  it('encodes BVLC-Result success (0x0000)', () => {
    // §J.2.1: 81 00 <len=0006> <result-code>. Success is the only
    // non-NAK code.
    expect(bytesToHex(encodeBvlcResult({ resultCode: BVLC_RESULT_SUCCESS }))).toBe('810000060000');
  });

  it('encodes BVLC-Result Register-Foreign-Device NAK (0x0030)', () => {
    expect(
      bytesToHex(encodeBvlcResult({ resultCode: BVLC_RESULT_REGISTER_FOREIGN_DEVICE_NAK })),
    ).toBe('810000060030');
  });

  it('encodes Register-Foreign-Device with a 2-byte TTL', () => {
    // §J.2.6: 81 05 <len=0006> <ttl-hi> <ttl-lo>. TTL 60s = 0x003c.
    expect(bytesToHex(encodeRegisterForeignDevice({ ttlSeconds: 60 }))).toBe('81050006003c');
    // 600s = 0x0258 — exercises the high byte.
    expect(bytesToHex(encodeRegisterForeignDevice({ ttlSeconds: 600 }))).toBe('810500060258');
  });

  it('encodes Forwarded-NPDU wrapping a Who-Is, preserving the originator B/IP', () => {
    // §J.2.5: 81 04 <len> <6-byte origin B/IP> <original NPDU+APDU>.
    //   origin 192.168.1.10:47808 = c0 a8 01 0a ba c0
    //   inner Who-Is NPDU+APDU (BVLC stripped) = 01 20 ff ff 00 ff 10 08
    //   len = 4 + 6 + 8 = 18 = 0x12
    expect(
      bytesToHex(encodeForwardedNpdu({ originatorIp: '192.168.1.10', inner: encodeWhoIs() })),
    ).toBe('81040012c0a8010abac00120ffff00ff1008');
  });

  it('encodes Forwarded-NPDU with a non-default port', () => {
    // 10.0.2.10:47809 = 0a 00 02 0a ba c1
    expect(
      bytesToHex(
        encodeForwardedNpdu({
          originatorIp: '10.0.2.10',
          originatorPort: 0xbac1,
          inner: encodeWhoIs(),
        }),
      ),
    ).toBe('810400120a00020abac10120ffff00ff1008');
  });

  it('rejects a malformed originator IP', () => {
    expect(() => encodeForwardedNpdu({ originatorIp: '999.1.1.1', inner: encodeWhoIs() })).toThrow();
    expect(() => encodeForwardedNpdu({ originatorIp: '10.0.0', inner: encodeWhoIs() })).toThrow();
  });

  it('encodes Distribute-Broadcast-To-Network wrapping a Who-Is', () => {
    // §J.2.10: 81 09 <len> <original NPDU+APDU>. No address field.
    //   inner = 01 20 ff ff 00 ff 10 08 → len = 4 + 8 = 12 = 0x0c
    expect(
      bytesToHex(encodeDistributeBroadcastToNetwork({ inner: encodeWhoIs() })),
    ).toBe('8109000c0120ffff00ff1008');
  });
});
