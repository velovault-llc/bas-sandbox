// BACnet packet emission — pure builder functions.
//
// What this is: the single source of truth for "given this scenario,
// produce a packet record with the EXACT summary string + service
// code + transport metadata a real BACnet stack would put on the
// wire." Validated against bacpypes3 output in the BBMD lab.
//
// What it is NOT: a tick loop, an asyncio runtime, a UDP socket.
// This is a pure data builder. BuildCanvas calls these when stepping
// the sim. The experiment harness calls these to assemble synthetic
// scenarios that drive the real emission code, not lookalike strings.
// The future Node bridge will also call these to feed real UDP.
//
// Why centralize: previously the same I-Am summary string was built
// inline in BuildCanvas's tick loop AND in the experiment catalog's
// `iAm()` helper AND in any future bridge that needs to emit. That's
// three places that can drift. One module = one wire format.
//
// All ground-truth claims here are anchored to bacpypes3 output as
// of 2026-05-23 (verified in tools/bacnet-reference/bbmd-lab/BBMD_LAB.md):
//
//   - device,N notation (BACnetObjectIdentifier encoding §20.2.14)
//   - segmented-both / segmented-transmit / segmented-receive /
//     no-segmentation (ASHRAE 135 enum, kebab-case wire form)
//   - maxAPDULengthAccepted 1024 (typical for small JCI / Tridium FECs)
//   - BVLC function-code suffixes:
//       0x0a Original-Unicast-NPDU      — addressed app traffic
//       0x0b Original-Broadcast-NPDU    — local-subnet broadcast
//       0x04 Forwarded-NPDU             — BBMD-to-BBMD bridging
//       0x05 Register-Foreign-Device    — FD registration
//
// Each emitter returns a `BuiltPacket` — the structural shape that
// matches both the UI's BacnetPacket AND the core's
// ConformancePacket. Callers cast/extend as needed.

import type { ConformancePacket } from './conformance.js';
import {
  encodeWhoIs as wireEncodeWhoIs,
  encodeIAm as wireEncodeIAm,
  encodeReadProperty as wireEncodeReadProperty,
  bytesToHex,
} from './wire.js';

/** Transport that wraps the packet. Drives the BVLC function code
 *  suffix in the summary line. */
export type Transport =
  /** Unicast IP — BVLC fn 0x0a Original-Unicast-NPDU. */
  | 'unicast-ip'
  /** Local subnet broadcast — BVLC fn 0x0b Original-Broadcast-NPDU. */
  | 'broadcast-ip'
  /** BBMD-forwarded — BVLC fn 0x04 Forwarded-NPDU. */
  | 'forwarded-ip'
  /** Foreign-device registration — BVLC fn 0x05. */
  | 'register-foreign'
  /** MS/TP frame — no BVLC layer. */
  | 'mstp';

/** ASHRAE 135 segmentation-supported enum, kebab-case wire form. */
export type Segmentation =
  | 'segmented-both'
  | 'segmented-transmit'
  | 'segmented-receive'
  | 'no-segmentation';

/** The packet shape returned by all emitters. Strict superset of
 *  ConformancePacket; the UI's BacnetPacket has a few extra display
 *  fields (id, trunkLabel) added when the packet is logged. */
export interface BuiltPacket {
  readonly simSec: number;
  readonly service: string;
  readonly summary: string;
  readonly srcMac?: number;
  readonly dstMac?: number;
  /** Human-readable source label ("JACE-MAIN", "VAV-101"). Falls back
   *  to MAC-based display when absent. Always populated by the emit
   *  module so the packet panel can render proper names even when
   *  srcMac is undefined (BACnet/IP traffic). */
  readonly srcLabel?: string;
  /** Human-readable destination label. Undefined for broadcasts. */
  readonly dstLabel?: string;
  readonly trunkId?: string;
  readonly objectId?: string;
  /** Optional friendlier object name to surface in the panel, e.g.
   *  "ZN-101 zone temp" instead of "analog-input,1". */
  readonly objectLabel?: string;
  /** ASHRAE 135 §12/§21 property identifier (numeric), when this
   *  packet targets a specific property. 85 = present-value. */
  readonly propertyId?: number;
  /** Kebab-case property name matching the wire decode. */
  readonly propertyName?: string;
  readonly value?: number | boolean;
  /** 'app' = application layer (ReadProperty etc.). 'link' = MS/TP
   *  link-layer (Token-Pass etc.). */
  readonly layer: 'app' | 'link';
  /** Real BACnet/IP wire bytes when the wire encoder supports this
   *  service. Lowercase hex. Optional because not every service has a
   *  TS encoder yet (see packages/core/src/bacnet/wire.ts for the
   *  currently-covered set). The packet inspector renders these
   *  alongside the real-corpus reference when present. */
  readonly bytes?: string;
}

/** Convert a BuiltPacket to a ConformancePacket (drops UI-only
 *  fields). Convenience for the experiment harness which works in
 *  ConformancePacket terms. */
export function toConformancePacket(p: BuiltPacket): ConformancePacket {
  return {
    simSec: p.simSec,
    service: p.service,
    summary: p.summary,
    srcMac: p.srcMac,
    dstMac: p.dstMac,
    trunkId: p.trunkId,
    objectId: p.objectId,
    value: p.value,
  };
}

// ── Transport tag helpers ───────────────────────────────────────────

function bvlcTag(t: Transport): string {
  switch (t) {
    case 'unicast-ip':
      return 'BVLC fn 0x0a Original-Unicast-NPDU';
    case 'broadcast-ip':
      return 'BVLC fn 0x0b Original-Broadcast-NPDU';
    case 'forwarded-ip':
      return 'BVLC fn 0x04 Forwarded-NPDU';
    case 'register-foreign':
      return 'BVLC fn 0x05 Register-Foreign-Device';
    case 'mstp':
      return ''; // No BVLC layer on MS/TP.
  }
}

// ── Emitters ────────────────────────────────────────────────────────

/** Who-Is broadcast. ASHRAE 135 §16.10.1.
 *  Use transport='broadcast-ip' for local-subnet broadcast,
 *  'forwarded-ip' when the packet has been forwarded by a BBMD. */
export function emitWhoIs(opts: {
  simSec: number;
  trunkId?: string;
  srcMac?: number;
  srcLabel: string;
  /** Optional dot-quad of source IP, for the broadcast trace. */
  srcIp?: string;
  transport: Transport;
  /** Optional context string appended after the source identifier,
   *  e.g. "discover devices on this trunk" or "DROPPED at BBMD-B (no bridge)". */
  context?: string;
}): BuiltPacket {
  const tag = bvlcTag(opts.transport);
  const macPart = opts.srcMac !== undefined ? ` (MAC ${opts.srcMac})` : '';
  const ipPart = opts.srcIp ? ` (${opts.srcIp})` : '';
  const ctx = opts.context ? ` ${opts.context}` : '';
  const summary = `${opts.srcLabel}${macPart}${ipPart} Who-Is broadcast${ctx}` +
    (tag ? ` · ${tag}` : '');
  return {
    simSec: opts.simSec,
    service: 'Who-Is',
    summary,
    srcMac: opts.srcMac,
    srcLabel: opts.srcLabel,
    trunkId: opts.trunkId,
    layer: 'app',
    // Real wire bytes — the unbounded form is byte-stable.
    bytes: bytesToHex(wireEncodeWhoIs()),
  };
}

/** I-Am reply. ASHRAE 135 §16.10.2 — must carry deviceInstance,
 *  maxAPDULengthAccepted, segmentationSupported, vendorID. */
export function emitIAm(opts: {
  simSec: number;
  trunkId?: string;
  srcMac?: number;
  srcLabel: string;
  dstMac?: number;
  /** BACnet device instance number (0-4194302). */
  deviceInstance: number;
  /** Max APDU length the device accepts. Typical 1024 or 1476. */
  maxApdu?: number;
  segmentation?: Segmentation;
  /** ASHRAE-registered vendor id. */
  vendorId: number;
  /** Defaults to unicast-ip (the dominant I-Am case after a Who-Is). */
  transport?: Transport;
}): BuiltPacket {
  const transport = opts.transport ?? 'unicast-ip';
  const tag = bvlcTag(transport);
  const maxApdu = opts.maxApdu ?? 1024;
  const seg: Segmentation = opts.segmentation ?? 'segmented-both';
  const macPart = opts.srcMac !== undefined ? ` (MAC ${opts.srcMac})` : '';
  const summary =
    `${opts.srcLabel}${macPart} I-Am device,${opts.deviceInstance} · ` +
    `maxAPDU ${maxApdu} · segmentation ${seg} · vendorId ${opts.vendorId}` +
    (tag ? ` · ${tag}` : '');
  return {
    simSec: opts.simSec,
    service: 'I-Am',
    summary,
    srcMac: opts.srcMac,
    srcLabel: opts.srcLabel,
    dstMac: opts.dstMac,
    trunkId: opts.trunkId,
    layer: 'app',
    bytes: bytesToHex(wireEncodeIAm({
      deviceInstance: opts.deviceInstance,
      maxApdu: maxApdu,
      segmentation: seg,
      vendorId: opts.vendorId,
      broadcast: transport !== 'unicast-ip',
    })),
  };
}

/** ReadProperty request. Carries the invoke ID so a matching ACK
 *  can be paired (§20.1.2.4). */
export function emitReadProperty(opts: {
  simSec: number;
  trunkId?: string;
  srcMac?: number;
  srcLabel: string;
  dstMac?: number;
  dstLabel?: string;
  objectId: string;
  /** Property name in kebab-case (e.g. 'present-value'). */
  propertyName: string;
  /** Numeric property id from ASHRAE 135 §12 / §21. */
  propertyId: number;
  invokeId: number;
}): BuiltPacket {
  const dstPart = opts.dstLabel ? ` → ${opts.dstLabel}` : '';
  const summary =
    `${opts.srcLabel}${dstPart}: ReadProperty ${opts.objectId} ` +
    `${opts.propertyName} (${opts.propertyId}) · invokeId ${opts.invokeId} · NPDU Expecting-Reply`;
  // Real wire bytes when the object-id syntax matches our known set.
  // Fall through to undefined for unsupported object types — the
  // inspector renders honest placeholder text rather than fake bytes.
  let wireBytes: string | undefined;
  try {
    wireBytes = bytesToHex(wireEncodeReadProperty({
      invokeId: opts.invokeId,
      objectId: opts.objectId,
      propertyId: opts.propertyId,
    }));
  } catch {
    wireBytes = undefined;
  }
  return {
    simSec: opts.simSec,
    service: 'ReadProperty',
    summary,
    srcMac: opts.srcMac,
    srcLabel: opts.srcLabel,
    dstMac: opts.dstMac,
    dstLabel: opts.dstLabel,
    trunkId: opts.trunkId,
    objectId: opts.objectId,
    propertyId: opts.propertyId,
    propertyName: opts.propertyName,
    layer: 'app',
    bytes: wireBytes,
  };
}

/** ReadProperty Complex-ACK. Carries the same invoke id as its
 *  matching request. */
export function emitReadPropertyAck(opts: {
  simSec: number;
  trunkId?: string;
  srcMac?: number;
  srcLabel: string;
  dstMac?: number;
  dstLabel?: string;
  objectId: string;
  propertyName: string;
  invokeId: number;
  value: number | boolean;
}): BuiltPacket {
  const dstPart = opts.dstLabel ? ` → ${opts.dstLabel}` : '';
  const summary =
    `${opts.srcLabel}${dstPart}: ReadProperty-ACK ${opts.objectId} ` +
    `${opts.propertyName}=${opts.value} · invokeId ${opts.invokeId}`;
  return {
    simSec: opts.simSec,
    service: 'ReadProperty-ACK',
    summary,
    srcMac: opts.srcMac,
    srcLabel: opts.srcLabel,
    dstMac: opts.dstMac,
    dstLabel: opts.dstLabel,
    trunkId: opts.trunkId,
    objectId: opts.objectId,
    propertyName: opts.propertyName,
    value: opts.value,
    layer: 'app',
  };
}

/** SubscribeCOV request. */
export function emitSubscribeCov(opts: {
  simSec: number;
  trunkId?: string;
  srcMac?: number;
  srcLabel: string;
  dstMac?: number;
  dstLabel?: string;
  objectId: string;
  deadband: number;
  deadbandUnits?: string;
}): BuiltPacket {
  const dstPart = opts.dstLabel ? ` → ${opts.dstLabel}` : '';
  const unitsPart = opts.deadbandUnits ?? '';
  const summary =
    `${opts.srcLabel}${dstPart}: SubscribeCOV ${opts.objectId} ` +
    `(deadband ${opts.deadband}${unitsPart})`;
  return {
    simSec: opts.simSec,
    service: 'SubscribeCOV',
    summary,
    srcMac: opts.srcMac,
    srcLabel: opts.srcLabel,
    dstMac: opts.dstMac,
    dstLabel: opts.dstLabel,
    trunkId: opts.trunkId,
    objectId: opts.objectId,
    layer: 'app',
  };
}

/** SubscribeCOV ACK. */
export function emitSubscribeCovAck(opts: {
  simSec: number;
  trunkId?: string;
  srcMac?: number;
  srcLabel: string;
  dstMac?: number;
  dstLabel?: string;
  objectId: string;
}): BuiltPacket {
  const dstPart = opts.dstLabel ? ` → ${opts.dstLabel}` : '';
  const summary =
    `${opts.srcLabel}${dstPart}: SubscribeCOV-ACK ${opts.objectId} accepted`;
  return {
    simSec: opts.simSec,
    service: 'SubscribeCOV-ACK',
    summary,
    srcMac: opts.srcMac,
    srcLabel: opts.srcLabel,
    dstMac: opts.dstMac,
    dstLabel: opts.dstLabel,
    trunkId: opts.trunkId,
    objectId: opts.objectId,
    layer: 'app',
  };
}

/** Confirmed COV notification. Per §13.10 must carry statusFlags. */
export function emitCovNotification(opts: {
  simSec: number;
  trunkId?: string;
  srcMac?: number;
  srcLabel: string;
  dstMac?: number;
  dstLabel?: string;
  objectId: string;
  value: number | boolean;
  /** ASHRAE 135 §12 statusFlags bit field. Default 'in-alarm: false,
   *  fault: false, overridden: false, out-of-service: false' = "F,F,F,F". */
  statusFlags?: string;
}): BuiltPacket {
  const dstPart = opts.dstLabel ? ` → ${opts.dstLabel}` : '';
  const sf = opts.statusFlags ?? 'F,F,F,F';
  const summary =
    `${opts.srcLabel}${dstPart}: ConfirmedCOVNotification ${opts.objectId} ` +
    `present-value=${opts.value} · statusFlags ${sf}`;
  return {
    simSec: opts.simSec,
    service: 'ConfirmedCOVNotification',
    summary,
    srcMac: opts.srcMac,
    srcLabel: opts.srcLabel,
    dstMac: opts.dstMac,
    dstLabel: opts.dstLabel,
    trunkId: opts.trunkId,
    objectId: opts.objectId,
    propertyName: 'present-value',
    propertyId: 85,
    value: opts.value,
    layer: 'app',
  };
}

/** MS/TP token-pass frame. Link layer, no BVLC. */
export function emitTokenPass(opts: {
  simSec: number;
  trunkId: string;
  srcMac: number;
  srcLabel: string;
  dstMac: number;
  dstLabel: string;
}): BuiltPacket {
  return {
    simSec: opts.simSec,
    service: 'Token-Pass',
    summary: `${opts.srcLabel} (MAC ${opts.srcMac}) → ${opts.dstLabel} (MAC ${opts.dstMac})`,
    srcMac: opts.srcMac,
    srcLabel: opts.srcLabel,
    dstMac: opts.dstMac,
    dstLabel: opts.dstLabel,
    trunkId: opts.trunkId,
    layer: 'link',
  };
}

/** Poll-For-Master frame — MS/TP master discovery (§9.5.5). */
export function emitPollForMaster(opts: {
  simSec: number;
  trunkId: string;
  srcMac: number;
  srcLabel: string;
  dstMac: number;
}): BuiltPacket {
  return {
    simSec: opts.simSec,
    service: 'Poll-For-Master',
    summary: `${opts.srcLabel} (MAC ${opts.srcMac}) polls for master at MAC ${opts.dstMac}`,
    srcMac: opts.srcMac,
    dstMac: opts.dstMac,
    trunkId: opts.trunkId,
    layer: 'link',
  };
}

/** APDU timeout marker. Not a real packet on the wire — synthesized
 *  when a confirmed-service request goes unanswered past the 3s
 *  default APDU timeout. */
export function emitTimeout(opts: {
  simSec: number;
  trunkId?: string;
  srcMac?: number;
  srcLabel: string;
  dstMac?: number;
  dstLabel?: string;
  serviceName: string;
  invokeId?: number;
}): BuiltPacket {
  const dstPart = opts.dstLabel ? ` → ${opts.dstLabel}` : '';
  const invPart = opts.invokeId !== undefined ? ` · invokeId ${opts.invokeId}` : '';
  return {
    simSec: opts.simSec,
    service: 'Timeout',
    summary: `${opts.srcLabel}${dstPart}: ${opts.serviceName} TIMEOUT (no reply within 3s)${invPart}`,
    srcMac: opts.srcMac,
    dstMac: opts.dstMac,
    trunkId: opts.trunkId,
    layer: 'app',
  };
}
