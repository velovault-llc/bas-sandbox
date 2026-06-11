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
import { formatStatusFlags } from './objects.js';
import type { BacnetReliability, StatusFlags } from './objects.js';
import {
  encodeWhoIs as wireEncodeWhoIs,
  encodeIAm as wireEncodeIAm,
  encodeReadProperty as wireEncodeReadProperty,
  encodeReadPropertyAck as wireEncodeReadPropertyAck,
  encodeSubscribeCov as wireEncodeSubscribeCov,
  encodeConfirmedCovNotification as wireEncodeConfirmedCovNotification,
  encodeRegisterForeignDevice as wireEncodeRegisterForeignDevice,
  encodeBvlcResult as wireEncodeBvlcResult,
  encodeForwardedNpdu as wireEncodeForwardedNpdu,
  encodeDistributeBroadcastToNetwork as wireEncodeDistributeBroadcast,
  BVLC_RESULT_SUCCESS,
  bytesToHex,
  type StatusFlagsBits,
} from './wire.js';

/** Parse the "T/F,T/F,T/F,T/F" statusFlags shorthand the sandbox uses
 *  internally into the StatusFlagsBits shape the wire encoder takes. */
function parseStatusFlags(s: string | undefined): StatusFlagsBits {
  const tokens = (s ?? 'F,F,F,F').split(',').map((t) => t.trim().toUpperCase());
  return {
    inAlarm: tokens[0] === 'T',
    fault: tokens[1] === 'T',
    overridden: tokens[2] === 'T',
    outOfService: tokens[3] === 'T',
  };
}

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
  /** BBMD broadcast-management result — BVLC fn 0x00 BVLC-Result. */
  | 'bvlc-result'
  /** Foreign device asking its BBMD to redistribute — BVLC fn 0x09. */
  | 'distribute-broadcast'
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
    case 'bvlc-result':
      return 'BVLC fn 0x00 BVLC-Result';
    case 'distribute-broadcast':
      return 'BVLC fn 0x09 Distribute-Broadcast-To-Network';
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
 *  matching request.
 *
 *  When the matching object has a non-default reliability / statusFlags
 *  pair (sensor fault, override active, etc), pass them through so the
 *  packet log mirrors what a real supervisor sees in YABE / Niagara
 *  Spy. The summary surfaces them inline; the wire-bytes encoding stays
 *  present-value-only for now because that's what the legacy ReadProperty
 *  request asks for — full property-aware ACKs land when we tie in
 *  ReadPropertyMultiple. */
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
  /** When the AI/BI object has a fault, label the ACK so the packet log
   *  shows "reliability=open-loop". Real BACnet returns this as an
   *  enumerated property in a ReadPropertyMultiple-ACK; we surface it
   *  here for the packet-log narrative until RPM lands. */
  reliability?: BacnetReliability;
  /** Optional Status_Flags. Rendered in the summary as the standard
   *  "T,F,T,F" shorthand. Fault bit defaults to false when omitted. */
  statusFlags?: StatusFlags;
}): BuiltPacket {
  const dstPart = opts.dstLabel ? ` → ${opts.dstLabel}` : '';
  let summary =
    `${opts.srcLabel}${dstPart}: ReadProperty-ACK ${opts.objectId} ` +
    `${opts.propertyName}=${opts.value} · invokeId ${opts.invokeId}`;
  if (opts.reliability && opts.reliability !== 'no-fault-detected') {
    summary += ` · reliability=${opts.reliability}`;
  }
  if (opts.statusFlags) {
    const shorthand = formatStatusFlags(opts.statusFlags);
    if (shorthand !== 'F,F,F,F') {
      summary += ` · statusFlags ${shorthand}`;
    }
  }
  // Real wire bytes when value is a Real (number). Boolean / Unsigned
  // would need the corresponding application-tag encoders — covered as
  // we add them. For now boolean falls through to undefined.
  let wireBytes: string | undefined;
  if (typeof opts.value === 'number') {
    try {
      wireBytes = bytesToHex(wireEncodeReadPropertyAck({
        invokeId: opts.invokeId,
        objectId: opts.objectId,
        propertyId: 85, // present-value — the dominant case
        value: opts.value,
      }));
    } catch {
      wireBytes = undefined;
    }
  }
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
    bytes: wireBytes,
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
  /** ASHRAE 135 §13.1 lease in seconds; 0/omitted = indefinite. Real
   *  clients lease (YABE defaults to 120 s) and renew at lifetime/2. */
  lifetimeSeconds?: number;
  /** Marks a lifetime/2 renewal so the log can tell the heartbeat from
   *  the original subscribe. Wire bytes are identical either way. */
  renewal?: boolean;
}): BuiltPacket {
  const dstPart = opts.dstLabel ? ` → ${opts.dstLabel}` : '';
  const unitsPart = opts.deadbandUnits ?? '';
  const lifetimeS = opts.lifetimeSeconds ?? 0;
  const leasePart = lifetimeS > 0
    ? `${opts.renewal ? '' : ''}lifetime ${lifetimeS}s${opts.renewal ? ' · renewal' : ''}`
    : '';
  // Binary objects have no covIncrement — any state change notifies.
  const isBinaryObj = /^b[iov][,:]/i.test(opts.objectId);
  const triggerPart = isBinaryObj ? 'on change' : `deadband ${opts.deadband}${unitsPart}`;
  const detail = [triggerPart, leasePart].filter(Boolean).join(', ');
  const summary =
    `${opts.srcLabel}${dstPart}: SubscribeCOV ${opts.objectId} (${detail})`;
  let wireBytes: string | undefined;
  try {
    wireBytes = bytesToHex(wireEncodeSubscribeCov({
      // BuildCanvas doesn't track per-call invoke IDs for SubscribeCOV
      // today; use 0 as a canonical placeholder. Future revision will
      // thread the real invoke ID through here once it's lifted.
      invokeId: 0,
      subscriberProcessId: 1,
      monitoredObjectId: opts.objectId,
      issueConfirmed: true,
      lifetimeSeconds: lifetimeS,
    }));
  } catch {
    wireBytes = undefined;
  }
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
    bytes: wireBytes,
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
  // Binary objects read active/inactive like a real client renders the
  // Enumerated present-value; analog ones read as numbers.
  const isBinaryObj = /^b[iov][,:]/i.test(opts.objectId);
  const valueDisplay = isBinaryObj
    ? ((typeof opts.value === 'number' ? opts.value >= 0.5 : opts.value) ? 'active' : 'inactive')
    : `${opts.value}`;
  const summary =
    `${opts.srcLabel}${dstPart}: ConfirmedCOVNotification ${opts.objectId} ` +
    `present-value=${valueDisplay} · statusFlags ${sf}`;
  let wireBytes: string | undefined;
  if (typeof opts.value === 'number') {
    try {
      wireBytes = bytesToHex(wireEncodeConfirmedCovNotification({
        // BuildCanvas doesn't thread per-pair invoke IDs through to
        // notifications today — supervisors normally cycle invoke IDs
        // independently of the device. 0 is a canonical placeholder
        // and matches what a freshly-booted device emits. Future:
        // thread the real invoke ID once we surface it.
        invokeId: 0,
        subscriberProcessId: 1,
        // Initiating-device instance: we don't have a guaranteed device
        // ID on every COV-emitting node yet. Default to 1 — Future
        // revision will thread the device's BACnet ObjectInstance ID
        // (already on the node data as deviceInstance) through here.
        initiatingDeviceId: 1,
        monitoredObjectId: opts.objectId,
        // Lifetime tracking happens at the subscription level. Surface
        // 0 here — a real device reporting on an indefinite
        // subscription emits 0 as well.
        timeRemainingSec: 0,
        presentValue: opts.value,
        statusFlags: parseStatusFlags(opts.statusFlags),
      }));
    } catch {
      wireBytes = undefined;
    }
  }
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
    bytes: wireBytes,
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

// ── BACnet/IP broadcast management (Annex J) ─────────────────────────
// The control flow that lets BACnet broadcasts cross IP subnets. A
// foreign device registers with a BBMD; the BBMD ACKs with a BVLC-Result;
// when any device broadcasts a Who-Is, the BBMD forwards it to each BDT
// peer (Forwarded-NPDU) and a registered FD can ask the BBMD to
// redistribute on its behalf (Distribute-Broadcast-To-Network). Every
// emitter carries real Annex-J wire bytes.

/** Register-Foreign-Device (§J.2.6) — a device on a remote subnet asks a
 *  BBMD to add it to the Foreign Device Table for `ttlSeconds`. */
export function emitRegisterForeignDevice(opts: {
  simSec: number;
  trunkId?: string;
  srcLabel: string;
  srcIp?: string;
  dstLabel: string;
  dstIp?: string;
  ttlSeconds: number;
  context?: string;
}): BuiltPacket {
  const ipPart = opts.srcIp ? ` (${opts.srcIp})` : '';
  const dstPart = opts.dstIp ? ` (${opts.dstIp})` : '';
  const ctx = opts.context ? ` ${opts.context}` : '';
  return {
    simSec: opts.simSec,
    service: 'Register-Foreign-Device',
    summary:
      `${opts.srcLabel}${ipPart} → ${opts.dstLabel}${dstPart}: ` +
      `Register-Foreign-Device (TTL ${opts.ttlSeconds}s)${ctx} · ${bvlcTag('register-foreign')}`,
    srcLabel: opts.srcLabel,
    dstLabel: opts.dstLabel,
    trunkId: opts.trunkId,
    layer: 'app',
    bytes: bytesToHex(wireEncodeRegisterForeignDevice({ ttlSeconds: opts.ttlSeconds })),
  };
}

/** BVLC-Result (§J.2.1) — a BBMD's acknowledgement of a broadcast-
 *  management request (Register-Foreign-Device, Write-BDT, …). A zero
 *  result code is success; anything else is a per-function NAK. */
export function emitBvlcResult(opts: {
  simSec: number;
  trunkId?: string;
  srcLabel: string;
  srcIp?: string;
  dstLabel: string;
  dstIp?: string;
  /** Defaults to BVLC_RESULT_SUCCESS (0). */
  resultCode?: number;
  context?: string;
}): BuiltPacket {
  const code = opts.resultCode ?? BVLC_RESULT_SUCCESS;
  const ipPart = opts.srcIp ? ` (${opts.srcIp})` : '';
  const dstPart = opts.dstIp ? ` (${opts.dstIp})` : '';
  const verdict = code === BVLC_RESULT_SUCCESS ? 'ACK (success)' : `NAK (0x${code.toString(16).padStart(4, '0')})`;
  const ctx = opts.context ? ` ${opts.context}` : '';
  return {
    simSec: opts.simSec,
    service: 'BVLC-Result',
    summary:
      `${opts.srcLabel}${ipPart} → ${opts.dstLabel}${dstPart}: ` +
      `BVLC-Result ${verdict}${ctx} · ${bvlcTag('bvlc-result')}`,
    srcLabel: opts.srcLabel,
    dstLabel: opts.dstLabel,
    trunkId: opts.trunkId,
    layer: 'app',
    bytes: bytesToHex(wireEncodeBvlcResult({ resultCode: code })),
  };
}

/** Forwarded-NPDU (§J.2.5) — a BBMD relays a Who-Is it heard on its own
 *  subnet to one of its BDT peers, preserving the *original* sender's
 *  B/IP address so the far side can reply directly. */
export function emitForwardedWhoIs(opts: {
  simSec: number;
  trunkId?: string;
  /** The forwarding BBMD (the source on this hop's wire). */
  bbmdLabel: string;
  bbmdIp?: string;
  /** The device whose Who-Is is being relayed. */
  originatorLabel: string;
  originatorIp: string;
  /** The peer BBMD receiving the forward. */
  dstLabel: string;
  dstIp?: string;
  context?: string;
}): BuiltPacket {
  const bbmdPart = opts.bbmdIp ? ` (${opts.bbmdIp})` : '';
  const dstPart = opts.dstIp ? ` (${opts.dstIp})` : '';
  const ctx = opts.context ? ` ${opts.context}` : '';
  return {
    simSec: opts.simSec,
    service: 'Who-Is',
    summary:
      `${opts.bbmdLabel}${bbmdPart} → ${opts.dstLabel}${dstPart}: ` +
      `forwards ${opts.originatorLabel}'s Who-Is (orig ${opts.originatorIp})${ctx} · ${bvlcTag('forwarded-ip')}`,
    srcLabel: opts.bbmdLabel,
    dstLabel: opts.dstLabel,
    trunkId: opts.trunkId,
    layer: 'app',
    bytes: bytesToHex(
      wireEncodeForwardedNpdu({ originatorIp: opts.originatorIp, inner: wireEncodeWhoIs() }),
    ),
  };
}

/** Distribute-Broadcast-To-Network (§J.2.10) — a registered foreign
 *  device asks its BBMD to broadcast the enclosed Who-Is on the BBMD's
 *  subnet and to every BDT peer (the FD can't broadcast across subnets
 *  itself). */
export function emitDistributeBroadcast(opts: {
  simSec: number;
  trunkId?: string;
  srcLabel: string;
  srcIp?: string;
  dstLabel: string;
  dstIp?: string;
  context?: string;
}): BuiltPacket {
  const ipPart = opts.srcIp ? ` (${opts.srcIp})` : '';
  const dstPart = opts.dstIp ? ` (${opts.dstIp})` : '';
  const ctx = opts.context ? ` ${opts.context}` : '';
  return {
    simSec: opts.simSec,
    service: 'Distribute-Broadcast',
    summary:
      `${opts.srcLabel}${ipPart} → ${opts.dstLabel}${dstPart}: ` +
      `Distribute-Broadcast (Who-Is)${ctx} · ${bvlcTag('distribute-broadcast')}`,
    srcLabel: opts.srcLabel,
    dstLabel: opts.dstLabel,
    trunkId: opts.trunkId,
    layer: 'app',
    bytes: bytesToHex(wireEncodeDistributeBroadcast({ inner: wireEncodeWhoIs() })),
  };
}
