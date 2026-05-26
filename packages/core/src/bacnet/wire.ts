// BACnet wire-format encoder — pure TypeScript byte builders.
//
// What this is: a focused subset of the BACnet/IP wire codec that
// produces byte-exact output matching the reference open-source stacks
// (bacpypes3 in particular, validated in tools/bacnet-reference/bbmd-lab/).
// Currently covers the services bas-sandbox actively emits in its tick
// loop — Who-Is, I-Am, ReadProperty (basic), SimpleAck. Not a full
// codec; the deliberately-incomplete shape forces us to extend as we
// need new services, with test coverage tracking each addition.
//
// What this is NOT: a parser. Decoding is bacpypes3's job (Python-side
// in tools/bacnet-harness). The browser-side codec only needs to emit
// — the harness validates emitted bytes against real-corpus references.
//
// Why a fresh TS codec instead of porting bacpypes3: bacpypes3 ships
// 5,000+ lines of Python that assume asyncio. We need ~200 lines of
// synchronous TS that produce wire bytes for ~6 services. The right
// boundary is "match bacpypes3's output for these services" and skip
// everything else.
//
// ASHRAE 135 wire-format reference embedded as comments per function.
// All values in this file are big-endian on the wire per §6.4.

import type { Segmentation } from './emit.js';

// ── BVLC (BACnet Virtual Link Control) function codes ────────────────
// First byte of every BACnet/IP frame is 0x81 (BACnet/IP marker).
// Second byte is the function code below. Bytes 3-4 are the length
// of the FULL packet including the 4-byte BVLC header (big-endian).
//
// Reference: ASHRAE 135 Annex J §J.2.
export const BVLC_TYPE_BACNET_IP = 0x81;
export const BVLC_FN_ORIGINAL_UNICAST_NPDU = 0x0a;
export const BVLC_FN_ORIGINAL_BROADCAST_NPDU = 0x0b;
export const BVLC_FN_FORWARDED_NPDU = 0x04;

// ── NPDU control bit positions (§6.2.2) ──────────────────────────────
// The control octet's bits enable variable-shape NPDU headers:
const NPDU_CONTROL_HAS_DEST = 0x20;     // DNET + DLEN + DADR follow
const NPDU_CONTROL_EXPECTING_REPLY = 0x04; // Confirmed services set this
// const NPDU_CONTROL_HAS_SOURCE = 0x08;  // SNET + SLEN + SADR — not emitted yet
// Priority bits 0-1: 00 normal, 01 urgent, 10 critical, 11 life-safety.

// ── APDU type codes (top 4 bits of byte 0) ───────────────────────────
export const APDU_TYPE_CONFIRMED_REQUEST = 0;
export const APDU_TYPE_UNCONFIRMED_REQUEST = 1;
export const APDU_TYPE_SIMPLE_ACK = 2;
export const APDU_TYPE_COMPLEX_ACK = 3;

// ── Service choices we emit (subset of §21 enumerations) ─────────────
export const UNCONFIRMED_SVC_I_AM = 0;
export const UNCONFIRMED_SVC_COV_NOTIFICATION = 2;
export const UNCONFIRMED_SVC_WHO_IS = 8;
export const CONFIRMED_SVC_COV_NOTIFICATION = 1;
export const CONFIRMED_SVC_SUBSCRIBE_COV = 5;
export const CONFIRMED_SVC_READ_PROPERTY = 12;

// ── Application tag numbers (§20.2) ──────────────────────────────────
const APP_TAG_UNSIGNED = 2;
const APP_TAG_ENUMERATED = 9;
const APP_TAG_OBJECT_ID = 12;

// ── BACnetObjectType enumeration (subset — see §21) ──────────────────
const OBJECT_TYPE_ANALOG_INPUT = 0;
const OBJECT_TYPE_ANALOG_VALUE = 2;
const OBJECT_TYPE_BINARY_VALUE = 5;
const OBJECT_TYPE_DEVICE = 8;

// Map our object-id strings ("AI:1", "BV:3", "device,1234") to a
// numeric BACnetObjectType. Returns null for unknown — the caller
// should fall back to AI (most common) or skip encoding.
function objectTypeFromString(s: string): number | null {
  // Two formats in the codebase: "AI:1" (panel display) and
  // "device,1234" (bacpypes3-style). Both supported.
  const m = /^([a-z]+)[,:](\d+)$/i.exec(s);
  if (!m) return null;
  const t = m[1].toLowerCase();
  if (t === 'ai' || t === 'analog-input') return OBJECT_TYPE_ANALOG_INPUT;
  if (t === 'av' || t === 'analog-value') return OBJECT_TYPE_ANALOG_VALUE;
  if (t === 'bv' || t === 'binary-value') return OBJECT_TYPE_BINARY_VALUE;
  if (t === 'device') return OBJECT_TYPE_DEVICE;
  return null;
}

function objectInstanceFromString(s: string): number {
  const m = /^[a-z]+[,:](\d+)$/i.exec(s);
  return m ? parseInt(m[1], 10) : 0;
}

// Segmentation enum (§21) — wire form is integer 0-3.
function segmentationCode(s: Segmentation): number {
  switch (s) {
    case 'segmented-both': return 0;
    case 'segmented-transmit': return 1;
    case 'segmented-receive': return 2;
    case 'no-segmentation': return 3;
  }
}

// ── Tag-encoding helpers ─────────────────────────────────────────────

/** Encode an unsigned integer as 1-4 bytes, minimum width.
 *  BACnet unsigned values are big-endian (§20.2.5). */
function encodeUnsignedBytes(v: number): number[] {
  if (v < 0) throw new Error('encodeUnsignedBytes: negative');
  if (v <= 0xff) return [v & 0xff];
  if (v <= 0xffff) return [(v >> 8) & 0xff, v & 0xff];
  if (v <= 0xffffff) return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  return [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** Build a single application-tagged element. The tag byte's top nibble
 *  is the tag number (§20.2.1), bit 3 is 0 (application class), low 3
 *  bits are the length. Length > 4 escapes via the extended encoding
 *  (not needed for the small primitives this codec emits). */
function appTagBytes(tagNumber: number, lengthOrValue: number, data: number[]): number[] {
  if (tagNumber < 0 || tagNumber > 14) {
    throw new Error(`appTagBytes: tag ${tagNumber} out of single-byte range`);
  }
  if (lengthOrValue <= 4) {
    return [((tagNumber << 4) | (lengthOrValue & 0x07)) & 0xff, ...data];
  }
  // Extended length: tag byte's low nibble = 5, then 1-byte length follows.
  return [((tagNumber << 4) | 0x05) & 0xff, lengthOrValue & 0xff, ...data];
}

/** Encode a BACnetObjectIdentifier — app tag 12, 4 bytes:
 *  bits 31-22 = type (10 bits), bits 21-0 = instance (22 bits). */
function encodeObjectId(typeCode: number, instance: number): number[] {
  const packed = ((typeCode & 0x3ff) << 22) | (instance & 0x3fffff);
  return appTagBytes(APP_TAG_OBJECT_ID, 4, [
    (packed >>> 24) & 0xff,
    (packed >>> 16) & 0xff,
    (packed >>> 8) & 0xff,
    packed & 0xff,
  ]);
}

/** Encode an Unsigned (app tag 2). */
function encodeUnsigned(v: number): number[] {
  const data = encodeUnsignedBytes(v);
  return appTagBytes(APP_TAG_UNSIGNED, data.length, data);
}

/** Encode a BACnet BitString (app tag 8) for the 4-bit statusFlags
 *  field. Wire layout: 1 byte unused-bit-count + N bytes packed bits
 *  MSB-first (§20.2.10). For statusFlags the standard always uses
 *  1 data byte with 4 unused bits. */
function encodeStatusFlags(flags: {
  readonly inAlarm: boolean;
  readonly fault: boolean;
  readonly overridden: boolean;
  readonly outOfService: boolean;
}): number[] {
  let bits = 0;
  if (flags.inAlarm)       bits |= 0x80;
  if (flags.fault)         bits |= 0x40;
  if (flags.overridden)    bits |= 0x20;
  if (flags.outOfService)  bits |= 0x10;
  // tag header: app tag 8, length 2 → 0x82
  // payload: [unused-bits=4, packed-bits]
  return [0x82, 0x04, bits & 0xff];
}

/** Encode a Real (app tag 4) as 4-byte big-endian IEEE 754 single. */
function encodeReal(v: number): number[] {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, v, false); // big-endian
  const arr = new Uint8Array(buf);
  return appTagBytes(4, 4, [arr[0], arr[1], arr[2], arr[3]]);
}

/** Encode a 4-byte BACnetObjectIdentifier as raw value bytes (no tag).
 *  Used inside context-tag wrappers where the caller emits the tag. */
function objectIdRawBytes(typeCode: number, instance: number): number[] {
  const packed = ((typeCode & 0x3ff) << 22) | (instance & 0x3fffff);
  return [
    (packed >>> 24) & 0xff,
    (packed >>> 16) & 0xff,
    (packed >>> 8) & 0xff,
    packed & 0xff,
  ];
}

/** Opening tag for a context-tagged constructed sequence (§20.2.1). */
function openingTag(tagNumber: number): number {
  return ((tagNumber << 4) | 0x08 | 0x06) & 0xff;
}

/** Closing tag. */
function closingTag(tagNumber: number): number {
  return ((tagNumber << 4) | 0x08 | 0x07) & 0xff;
}

/** Encode an Enumerated (app tag 9). Same length rules as Unsigned. */
function encodeEnumerated(v: number): number[] {
  const data = encodeUnsignedBytes(v);
  return appTagBytes(APP_TAG_ENUMERATED, data.length, data);
}

/** Encode a context-tagged length-prefixed value. Context-class is bit 3
 *  set (0x08 in the tag byte). For length-1 values like "service-choice
 *  property-id" the encoding is `1<n>` where n is tag number. */
function ctxTagBytes(tagNumber: number, data: number[]): number[] {
  return [((tagNumber << 4) | 0x08 | (data.length & 0x07)) & 0xff, ...data];
}

// ── BVLC + NPDU wrappers ─────────────────────────────────────────────

interface NpduOptions {
  /** True for confirmed services that need a reply. Sets Expecting-Reply bit. */
  readonly expectingReply?: boolean;
  /** Set when this packet targets a remote network — DNET + DLEN + DADR
   *  occupy bytes 3..N of the NPDU. Broadcasts use DNET 0xffff DLEN 0. */
  readonly destNet?: number;
  /** Destination MAC bytes (when DNET is set). [] for broadcast. */
  readonly destAddr?: readonly number[];
  /** Hop count for routed traffic. Default 255 per §6.2.5 max. */
  readonly hopCount?: number;
}

function buildNpdu(opts: NpduOptions): number[] {
  let control = 0;
  if (opts.expectingReply) control |= NPDU_CONTROL_EXPECTING_REPLY;
  const hasDest = opts.destNet !== undefined;
  if (hasDest) control |= NPDU_CONTROL_HAS_DEST;
  const out = [0x01, control & 0xff];  // version 1, control
  if (hasDest) {
    out.push((opts.destNet! >> 8) & 0xff, opts.destNet! & 0xff);
    const da = opts.destAddr ?? [];
    out.push(da.length & 0xff, ...da);
    out.push((opts.hopCount ?? 255) & 0xff);
  }
  return out;
}

function buildBvlc(fn: number, npduPlusApdu: number[]): Uint8Array {
  const totalLen = 4 + npduPlusApdu.length;
  const bvlc = [BVLC_TYPE_BACNET_IP, fn, (totalLen >> 8) & 0xff, totalLen & 0xff];
  const out = new Uint8Array(bvlc.length + npduPlusApdu.length);
  out.set(bvlc, 0);
  out.set(npduPlusApdu, bvlc.length);
  return out;
}

// ── Service-specific encoders ────────────────────────────────────────

/** Encode a Who-Is broadcast (§16.10.1). No body for the unbounded form.
 *  The bounded form (with low/high device-instance limits) adds two
 *  context-tagged unsigneds; not emitted by our sim yet. */
export function encodeWhoIs(opts?: { lowLimit?: number; highLimit?: number }): Uint8Array {
  const apdu: number[] = [
    APDU_TYPE_UNCONFIRMED_REQUEST << 4,  // 0x10
    UNCONFIRMED_SVC_WHO_IS,              // 0x08
  ];
  if (opts?.lowLimit !== undefined && opts?.highLimit !== undefined) {
    apdu.push(...ctxTagBytes(0, encodeUnsignedBytes(opts.lowLimit)));
    apdu.push(...ctxTagBytes(1, encodeUnsignedBytes(opts.highLimit)));
  }
  // Who-Is is a broadcast — DNET 0xffff, DLEN 0, HopCount 255.
  const npdu = buildNpdu({ destNet: 0xffff, destAddr: [], hopCount: 255 });
  return buildBvlc(BVLC_FN_ORIGINAL_BROADCAST_NPDU, [...npdu, ...apdu]);
}

/** Encode an I-Am unconfirmed-response (§16.10.2). Four required fields
 *  in the order specified by the standard: deviceObjectIdentifier,
 *  maxAPDULengthAccepted, segmentationSupported, vendorID. */
export function encodeIAm(opts: {
  readonly deviceInstance: number;
  readonly maxApdu: number;
  readonly segmentation: Segmentation;
  readonly vendorId: number;
  /** If true, send via Original-Broadcast-NPDU (the typical I-Am path).
   *  Set false for a direct unicast reply to a Who-Is. */
  readonly broadcast?: boolean;
}): Uint8Array {
  const apdu: number[] = [
    APDU_TYPE_UNCONFIRMED_REQUEST << 4,
    UNCONFIRMED_SVC_I_AM,
    ...encodeObjectId(OBJECT_TYPE_DEVICE, opts.deviceInstance),
    ...encodeUnsigned(opts.maxApdu),
    ...encodeEnumerated(segmentationCode(opts.segmentation)),
    ...encodeUnsigned(opts.vendorId),
  ];
  const npdu = opts.broadcast !== false
    ? buildNpdu({ destNet: 0xffff, destAddr: [], hopCount: 255 })
    : buildNpdu({});
  const fn = opts.broadcast !== false
    ? BVLC_FN_ORIGINAL_BROADCAST_NPDU
    : BVLC_FN_ORIGINAL_UNICAST_NPDU;
  return buildBvlc(fn, [...npdu, ...apdu]);
}

/** Encode a ReadProperty confirmed-request (§15.5.1). The minimum form
 *  carries objectIdentifier + propertyIdentifier; propertyArrayIndex is
 *  optional and omitted here. maxSegs=0/maxResp=5 = "no segmentation,
 *  max APDU 1476" which is the conventional default. */
export function encodeReadProperty(opts: {
  readonly invokeId: number;
  readonly objectId: string;
  readonly propertyId: number;
}): Uint8Array {
  const typeCode = objectTypeFromString(opts.objectId);
  if (typeCode === null) {
    throw new Error(`encodeReadProperty: unknown object-id syntax "${opts.objectId}"`);
  }
  const instance = objectInstanceFromString(opts.objectId);
  const apduHeader: number[] = [
    // type=0 (confirmed-request), no flags, no segmentation
    (APDU_TYPE_CONFIRMED_REQUEST << 4),
    // maxSegs(0) << 4 | maxResp(5) — see ASHRAE 135 §20.1.2.5/.6
    0x05,
    opts.invokeId & 0xff,
    CONFIRMED_SVC_READ_PROPERTY,
  ];
  const body: number[] = [
    ...ctxTagBytes(0, [
      ((typeCode & 0x3ff) << 22 | (instance & 0x3fffff)) >>> 24 & 0xff,
      ((typeCode & 0x3ff) << 22 | (instance & 0x3fffff)) >>> 16 & 0xff,
      ((typeCode & 0x3ff) << 22 | (instance & 0x3fffff)) >>> 8 & 0xff,
      ((typeCode & 0x3ff) << 22 | (instance & 0x3fffff)) & 0xff,
    ]),
    ...ctxTagBytes(1, encodeUnsignedBytes(opts.propertyId)),
  ];
  const apdu = [...apduHeader, ...body];
  // Confirmed-request needs Expecting-Reply set.
  const npdu = buildNpdu({ expectingReply: true });
  return buildBvlc(BVLC_FN_ORIGINAL_UNICAST_NPDU, [...npdu, ...apdu]);
}

/** Encode a SimpleAck (§20.1.3). Header-only PDU — just the type bits,
 *  the invokeID, and the service choice being acknowledged. */
export function encodeSimpleAck(opts: {
  readonly invokeId: number;
  readonly serviceChoice: number;
}): Uint8Array {
  const apdu = [
    APDU_TYPE_SIMPLE_ACK << 4,
    opts.invokeId & 0xff,
    opts.serviceChoice & 0xff,
  ];
  const npdu = buildNpdu({});
  return buildBvlc(BVLC_FN_ORIGINAL_UNICAST_NPDU, [...npdu, ...apdu]);
}

/** Encode a ReadProperty Complex-ACK (§15.5.2). Echoes the request's
 *  object + property and carries the resolved value as a context-3-
 *  tagged constructed sequence with one application-tagged primitive
 *  inside. Real (IEEE 754 single) is the dominant case for analog
 *  inputs; the only `valueType` we accept right now reflects that.
 *  Future revisions can add Boolean / Unsigned / Enumerated as the
 *  emit module starts surfacing them. */
export function encodeReadPropertyAck(opts: {
  readonly invokeId: number;
  readonly objectId: string;
  readonly propertyId: number;
  readonly value: number;
  readonly valueType?: 'real'; // future: 'unsigned' | 'boolean' | 'enumerated'
}): Uint8Array {
  const typeCode = objectTypeFromString(opts.objectId);
  if (typeCode === null) {
    throw new Error(`encodeReadPropertyAck: unknown object-id syntax "${opts.objectId}"`);
  }
  const instance = objectInstanceFromString(opts.objectId);
  const apduHeader: number[] = [
    APDU_TYPE_COMPLEX_ACK << 4,
    opts.invokeId & 0xff,
    CONFIRMED_SVC_READ_PROPERTY,
  ];
  const valueBytes = encodeReal(opts.value);
  const body: number[] = [
    ...ctxTagBytes(0, objectIdRawBytes(typeCode, instance)),
    ...ctxTagBytes(1, encodeUnsignedBytes(opts.propertyId)),
    openingTag(3),
    ...valueBytes,
    closingTag(3),
  ];
  // Complex-ack is a response — NPDU has no Expecting-Reply.
  const npdu = buildNpdu({});
  return buildBvlc(BVLC_FN_ORIGINAL_UNICAST_NPDU, [...npdu, ...apduHeader, ...body]);
}

/** Encode a SubscribeCOV confirmed-request (§13.1, §16.10.4). Four
 *  context-tagged fields: subscriberProcessIdentifier, monitored
 *  objectIdentifier, issueConfirmedNotifications, lifetime. The latter
 *  two are technically optional but our supervisor always supplies them. */
export function encodeSubscribeCov(opts: {
  readonly invokeId: number;
  readonly subscriberProcessId: number;
  readonly monitoredObjectId: string;
  readonly issueConfirmed: boolean;
  /** Lifetime in seconds. 0 = indefinite. */
  readonly lifetimeSeconds: number;
}): Uint8Array {
  const typeCode = objectTypeFromString(opts.monitoredObjectId);
  if (typeCode === null) {
    throw new Error(`encodeSubscribeCov: unknown object-id "${opts.monitoredObjectId}"`);
  }
  const instance = objectInstanceFromString(opts.monitoredObjectId);
  const apduHeader: number[] = [
    APDU_TYPE_CONFIRMED_REQUEST << 4,
    0x05,                          // maxSegs=0, maxResp=5 (1476-byte cap)
    opts.invokeId & 0xff,
    CONFIRMED_SVC_SUBSCRIBE_COV,
  ];
  const body: number[] = [
    ...ctxTagBytes(0, encodeUnsignedBytes(opts.subscriberProcessId)),
    ...ctxTagBytes(1, objectIdRawBytes(typeCode, instance)),
    ...ctxTagBytes(2, [opts.issueConfirmed ? 1 : 0]),
    ...ctxTagBytes(3, encodeUnsignedBytes(opts.lifetimeSeconds)),
  ];
  const npdu = buildNpdu({ expectingReply: true });
  return buildBvlc(BVLC_FN_ORIGINAL_UNICAST_NPDU, [...npdu, ...apduHeader, ...body]);
}

/** Public type for the four BACnet status-flag bits. */
export interface StatusFlagsBits {
  readonly inAlarm: boolean;
  readonly fault: boolean;
  readonly overridden: boolean;
  readonly outOfService: boolean;
}

/** Build the listOfValues body shared by both ConfirmedCOVNotification
 *  and UnconfirmedCOVNotification. The standard PropertyValue entry
 *  layout is: ctx0=propId, ctx1=arrayIdx (optional, skipped),
 *  ctx2=opening tag wrapping the Any value, closing tag 2, ctx3=
 *  priority (optional, skipped). We emit two entries:
 *     present-value (85, Real)
 *     status-flags (111, BitString)
 *  Wrapped in opening/closing tag 4. */
function buildCovListOfValues(presentValue: number, flags: StatusFlagsBits): number[] {
  return [
    openingTag(4),
      // ── property[0] present-value ──
      ...ctxTagBytes(0, encodeUnsignedBytes(85)),
      openingTag(2),
        ...encodeReal(presentValue),
      closingTag(2),
      // ── property[1] status-flags ──
      ...ctxTagBytes(0, encodeUnsignedBytes(111)),
      openingTag(2),
        ...encodeStatusFlags(flags),
      closingTag(2),
    closingTag(4),
  ];
}

/** Encode a ConfirmedCOVNotification confirmed-request (§13.5.1).
 *  Carries the standard payload shape used by every real BACnet
 *  device: process-id, initiating-device, monitored-object,
 *  time-remaining, and a listOfValues of (present-value, status-
 *  flags). Real-only present-value for now; Boolean/Enumerated for
 *  binary objects when we need them. */
export function encodeConfirmedCovNotification(opts: {
  readonly invokeId: number;
  readonly subscriberProcessId: number;
  /** Device instance of the controller sending this notification. */
  readonly initiatingDeviceId: number;
  /** The monitored object — "AI:1", "AV:3", "BV:2", etc. */
  readonly monitoredObjectId: string;
  /** Seconds remaining in the subscription's lifetime. 0 for indefinite
   *  subscriptions on a real device. */
  readonly timeRemainingSec: number;
  readonly presentValue: number;
  readonly statusFlags: StatusFlagsBits;
}): Uint8Array {
  const typeCode = objectTypeFromString(opts.monitoredObjectId);
  if (typeCode === null) {
    throw new Error(`encodeConfirmedCovNotification: unknown object-id "${opts.monitoredObjectId}"`);
  }
  const instance = objectInstanceFromString(opts.monitoredObjectId);
  const apduHeader: number[] = [
    APDU_TYPE_CONFIRMED_REQUEST << 4,
    0x05,                                  // maxSegs=0, maxResp=5
    opts.invokeId & 0xff,
    CONFIRMED_SVC_COV_NOTIFICATION,
  ];
  const body: number[] = [
    ...ctxTagBytes(0, encodeUnsignedBytes(opts.subscriberProcessId)),
    ...ctxTagBytes(1, objectIdRawBytes(OBJECT_TYPE_DEVICE, opts.initiatingDeviceId)),
    ...ctxTagBytes(2, objectIdRawBytes(typeCode, instance)),
    ...ctxTagBytes(3, encodeUnsignedBytes(opts.timeRemainingSec)),
    ...buildCovListOfValues(opts.presentValue, opts.statusFlags),
  ];
  const npdu = buildNpdu({ expectingReply: true });
  return buildBvlc(BVLC_FN_ORIGINAL_UNICAST_NPDU, [...npdu, ...apduHeader, ...body]);
}

/** Encode an UnconfirmedCOVNotification unconfirmed-request (§13.6).
 *  Same payload as the confirmed variant minus the invokeID + maxSegs/
 *  maxResp byte. Apt for high-volume notifications where ACK overhead
 *  isn't worth it. */
export function encodeUnconfirmedCovNotification(opts: {
  readonly subscriberProcessId: number;
  readonly initiatingDeviceId: number;
  readonly monitoredObjectId: string;
  readonly timeRemainingSec: number;
  readonly presentValue: number;
  readonly statusFlags: StatusFlagsBits;
}): Uint8Array {
  const typeCode = objectTypeFromString(opts.monitoredObjectId);
  if (typeCode === null) {
    throw new Error(`encodeUnconfirmedCovNotification: unknown object-id "${opts.monitoredObjectId}"`);
  }
  const instance = objectInstanceFromString(opts.monitoredObjectId);
  const apduHeader: number[] = [
    APDU_TYPE_UNCONFIRMED_REQUEST << 4,
    UNCONFIRMED_SVC_COV_NOTIFICATION,
  ];
  const body: number[] = [
    ...ctxTagBytes(0, encodeUnsignedBytes(opts.subscriberProcessId)),
    ...ctxTagBytes(1, objectIdRawBytes(OBJECT_TYPE_DEVICE, opts.initiatingDeviceId)),
    ...ctxTagBytes(2, objectIdRawBytes(typeCode, instance)),
    ...ctxTagBytes(3, encodeUnsignedBytes(opts.timeRemainingSec)),
    ...buildCovListOfValues(opts.presentValue, opts.statusFlags),
  ];
  const npdu = buildNpdu({});
  return buildBvlc(BVLC_FN_ORIGINAL_UNICAST_NPDU, [...npdu, ...apduHeader, ...body]);
}

/** Convert a Uint8Array to a lowercase hex string for logging / display. */
export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    s += b[i].toString(16).padStart(2, '0');
  }
  return s;
}
