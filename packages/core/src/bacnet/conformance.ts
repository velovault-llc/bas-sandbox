// BACnet conformance checker.
//
// Inspects a packet log (or any equivalent stream of BACnet service
// records) against the requirements in ASHRAE Standard 135 — the
// authoritative BACnet protocol spec. Each rule maps to a specific
// section of the standard so a finding can be argued against the
// source document, not just "we said so."
//
// The sandbox's packet log uses a simplified shape; this module's job
// is to assert that what we DO emit lines up with what the spec
// requires when a real device emits the same service. Federal /
// commercial evaluators (and the user) can run this and see: "your
// sim's I-Am replies include all 4 required fields, but your COV
// notifications are missing statusFlags — that wouldn't pass a real
// conformance test, here's the citation."
//
// Pure module. No DOM, no I/O — input is the packet record array we
// already maintain. Output is a Finding[] using the same shape as
// the other validators (ipv4, mstp).

/** A single emitted/observed packet, in the minimal shape this
 *  checker cares about. Real BACnet has many more fields; we work
 *  with what the sandbox actually produces today. */
export interface ConformancePacket {
  /** Sim seconds when this packet was emitted. */
  readonly simSec: number;
  /** BACnet service name. Matches the sandbox's BacnetService enum. */
  readonly service: string;
  /** Source MAC (link-layer). Optional — IP packets have no MAC. */
  readonly srcMac?: number;
  /** Destination MAC, or undefined for broadcasts. */
  readonly dstMac?: number;
  /** Trunk identifier (representative edge id). */
  readonly trunkId?: string;
  /** Pretty-printed summary — only used to look for keywords in
   *  weakly-typed packets (e.g. "Device Instance N" embedded in an
   *  I-Am summary). When the sandbox grows fully-structured fields
   *  these summary scrapes will retire. */
  readonly summary?: string;
  /** Object reference for application-layer packets. */
  readonly objectId?: string;
  /** Free-form value field used by ReadProperty / WriteProperty. */
  readonly value?: number | boolean;
}

export type ConformanceFindingId =
  | 'bacnet.no-whois'
  | 'bacnet.whois-too-rare'
  | 'bacnet.iam-missing-fields'
  | 'bacnet.iam-without-whois'
  | 'bacnet.readproperty-no-ack'
  | 'bacnet.cov-missing-statusflags'
  | 'bacnet.token-timing-slow'
  | 'bacnet.duplicate-instance'
  | 'bacnet.unknown-service';

export interface ConformanceFinding {
  readonly id: ConformanceFindingId;
  readonly severity: 'info' | 'warning' | 'error';
  readonly title: string;
  readonly description: string;
  /** ASHRAE Standard 135 section / clause cited by this rule. Empty
   *  when the rule is sandbox-internal rather than spec-derived. */
  readonly citation?: string;
  /** Packet sample sim-seconds where the finding triggered. */
  readonly sampleSimSecs?: readonly number[];
}

/** Run every conformance rule against the supplied packet stream
 *  and return a flat list of findings. Ordering: failures first,
 *  warnings, then info-level "this is fine but worth noting." */
export function checkBacnetConformance(packets: readonly ConformancePacket[]): ConformanceFinding[] {
  const out: ConformanceFinding[] = [];
  out.push(...checkWhoIsCadence(packets));
  out.push(...checkIAmFields(packets));
  out.push(...checkIAmTriggered(packets));
  out.push(...checkReadPropertyAcked(packets));
  out.push(...checkCovStatusFlags(packets));
  out.push(...checkUniqueDeviceInstances(packets));
  out.push(...checkUnknownServices(packets));
  // Stable severity-first sort: error > warning > info.
  const rank: Record<ConformanceFinding['severity'], number> = { error: 0, warning: 1, info: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return out;
}

// ── Rule: Who-Is cadence ─────────────────────────────────────────────
//
// A BACnet device that wants to discover its peers SHOULD periodically
// broadcast Who-Is. ASHRAE 135 doesn't mandate a single cadence —
// installs typically run 30-60s between sweeps, with extra sweeps on
// device boot. We flag two failure modes:
//   1. Zero Who-Is broadcasts in the entire window (nothing's ever
//      going to discover anything new on this network)
//   2. Who-Is broadcasts more than 5 minutes apart on average (sweep
//      cadence too slow — new devices stay invisible too long)

function checkWhoIsCadence(packets: readonly ConformancePacket[]): ConformanceFinding[] {
  const whoIs = packets.filter((p) => p.service === 'Who-Is');
  if (whoIs.length === 0) {
    return [
      {
        id: 'bacnet.no-whois',
        severity: 'warning',
        title: 'No Who-Is broadcasts emitted',
        description:
          'A BACnet device that wants to discover its peers should periodically broadcast Who-Is. ' +
          'Without it, new devices joining the network stay invisible to the supervisor. ' +
          'Real installs typically broadcast every 30-60 seconds.',
        citation: 'ASHRAE 135 §16.10 (Who-Is service)',
      },
    ];
  }
  if (whoIs.length < 2) return [];
  // Average gap between consecutive Who-Is broadcasts.
  let totalGap = 0;
  for (let i = 1; i < whoIs.length; i++) {
    totalGap += whoIs[i].simSec - whoIs[i - 1].simSec;
  }
  const avgGap = totalGap / (whoIs.length - 1);
  if (avgGap > 300) {
    return [
      {
        id: 'bacnet.whois-too-rare',
        severity: 'info',
        title: `Who-Is cadence is ${Math.round(avgGap)}s (slow side of normal)`,
        description:
          `Sandbox emits Who-Is every ~${Math.round(avgGap)} seconds on average. Real installs ` +
          'typically sweep every 30-60s so new devices appear within a minute of plug-in. ' +
          'Not a conformance failure; just a tuning observation.',
        citation: 'ASHRAE 135 §16.10.1',
      },
    ];
  }
  return [];
}

// ── Rule: I-Am required fields ───────────────────────────────────────
//
// I-Am MUST include four fields per ASHRAE 135 §16.10.2:
//   - i-Am Device Identifier (Device Instance)
//   - Max APDU Length Accepted
//   - Segmentation Supported
//   - Vendor ID
//
// The sandbox's I-Am summary today reads:
//   "<label> (MAC <n>) I-Am — Device Instance <inst>"
// which omits maxAPDU, segmentation, and vendorId. Real BACnet
// receivers parse those out of the PDU; our summary scrape is a
// rough proxy. Once we move to structured fields, this rule should
// inspect the structured form directly.

function checkIAmFields(packets: readonly ConformancePacket[]): ConformanceFinding[] {
  const iAms = packets.filter((p) => p.service === 'I-Am');
  if (iAms.length === 0) return [];
  const missing: number[] = [];
  for (const p of iAms) {
    const s = p.summary ?? '';
    const hasInstance = /Device Instance \d+/.test(s);
    const hasMaxApdu = /max[- ]?APDU|maxAPDU|max apdu/i.test(s);
    const hasSegmentation = /segmentation/i.test(s);
    const hasVendorId = /vendor[- ]?id|vendorId/i.test(s);
    if (!hasInstance || !hasMaxApdu || !hasSegmentation || !hasVendorId) {
      missing.push(p.simSec);
    }
  }
  if (missing.length === 0) return [];
  return [
    {
      id: 'bacnet.iam-missing-fields',
      severity: 'warning',
      title: `I-Am replies missing required fields (${missing.length} of ${iAms.length})`,
      description:
        'I-Am must include Device Instance, Max APDU Length Accepted, Segmentation Supported, ' +
        'and Vendor ID. The sandbox\'s I-Am summary currently only includes Device Instance — ' +
        "a real BACnet sniffer would reject the abbreviated form. Sandbox-internal limitation; " +
        'fix in the upcoming structured-PDU migration.',
      citation: 'ASHRAE 135 §16.10.2',
      sampleSimSecs: missing.slice(0, 3),
    },
  ];
}

// ── Rule: I-Am triggered by Who-Is ───────────────────────────────────
//
// I-Am should be sent in response to Who-Is (within a few seconds)
// OR unsolicited on device boot. An I-Am with NO recent Who-Is and
// NO sim-boot context is unusual — flag as info.

function checkIAmTriggered(packets: readonly ConformancePacket[]): ConformanceFinding[] {
  const iAms = packets.filter((p) => p.service === 'I-Am');
  const whoIs = packets.filter((p) => p.service === 'Who-Is');
  if (iAms.length === 0) return [];
  // "Boot window" = first 5 seconds of the trace, where unsolicited
  // I-Am is expected. Outside the boot window, an I-Am must have a
  // Who-Is within the prior 10 seconds on the same trunk.
  const orphaned: number[] = [];
  for (const ia of iAms) {
    if (ia.simSec <= 5) continue; // boot window
    const recentWhoIs = whoIs.find(
      (w) =>
        w.simSec >= ia.simSec - 10 &&
        w.simSec <= ia.simSec &&
        (w.trunkId === undefined || ia.trunkId === undefined || w.trunkId === ia.trunkId),
    );
    if (!recentWhoIs) orphaned.push(ia.simSec);
  }
  if (orphaned.length === 0) return [];
  return [
    {
      id: 'bacnet.iam-without-whois',
      severity: 'info',
      title: `${orphaned.length} I-Am reply(s) without a recent Who-Is`,
      description:
        'Unsolicited I-Am is legitimate at device boot. After the boot window, an I-Am should ' +
        'follow a Who-Is request within ~10 seconds. Standalone I-Ams may indicate the device ' +
        "is re-announcing itself after a comm restore, which is allowed but worth flagging.",
      citation: 'ASHRAE 135 §16.10.2',
      sampleSimSecs: orphaned.slice(0, 3),
    },
  ];
}

// ── Rule: ReadProperty must be acknowledged ──────────────────────────
//
// A confirmed service like ReadProperty must receive either a
// ReadProperty-ACK or an Error/Reject within the APDU timeout
// window (default ~3 seconds). Otherwise the supervisor retries,
// then declares CommunicationLost.

function checkReadPropertyAcked(packets: readonly ConformancePacket[]): ConformanceFinding[] {
  const reqs = packets.filter((p) => p.service === 'ReadProperty');
  if (reqs.length === 0) return [];
  const acks = packets.filter(
    (p) => p.service === 'ReadProperty-ACK' || p.service === 'Timeout',
  );
  const unanswered: number[] = [];
  for (const req of reqs) {
    const matched = acks.find(
      (a) =>
        a.simSec >= req.simSec &&
        a.simSec <= req.simSec + 3 &&
        a.objectId === req.objectId &&
        // ACK source should be the request's destination.
        (req.dstMac === undefined || a.srcMac === req.dstMac),
    );
    if (!matched) unanswered.push(req.simSec);
  }
  if (unanswered.length === 0) return [];
  return [
    {
      id: 'bacnet.readproperty-no-ack',
      severity: 'error',
      title: `${unanswered.length} ReadProperty request(s) unanswered within 3s`,
      description:
        'ReadProperty is a confirmed service — the responder must reply with a ReadProperty-ACK ' +
        '(success) or BACnetError (failure) within the APDU timeout (typically 3 seconds). ' +
        'Without a reply the supervisor retries, then eventually flags Communication-Lost. ' +
        'Check that the sandbox is emitting ACKs for every ReadProperty it processes.',
      citation: 'ASHRAE 135 §15.5.1 (ReadProperty service procedure)',
      sampleSimSecs: unanswered.slice(0, 3),
    },
  ];
}

// ── Rule: COV notifications carry statusFlags ────────────────────────
//
// ConfirmedCOVNotification includes a `listOfValues` that MUST
// include the statusFlags property when sent for any object that
// has statusFlags (which is every analog + binary input/output/value
// per the spec). We don't structurally encode this yet — the
// summary scrape catches the gap.

function checkCovStatusFlags(packets: readonly ConformancePacket[]): ConformanceFinding[] {
  const covs = packets.filter((p) => p.service === 'ConfirmedCOVNotification');
  if (covs.length === 0) return [];
  const missing: number[] = [];
  for (const p of covs) {
    if (!/statusFlags|status[- ]?flags/i.test(p.summary ?? '')) missing.push(p.simSec);
  }
  if (missing.length === 0) return [];
  return [
    {
      id: 'bacnet.cov-missing-statusflags',
      severity: 'warning',
      title: `COV notifications missing statusFlags (${missing.length} of ${covs.length})`,
      description:
        'A ConfirmedCOVNotification\'s listOfValues should include statusFlags so the subscriber ' +
        'knows whether the value is in-alarm, in-fault, overridden, or out-of-service. The ' +
        'sandbox synthesizes COVs with presentValue only — a real receiver would still accept ' +
        'this but lose visibility into alarm/override state.',
      citation: 'ASHRAE 135 §13.10 (Change of Value reporting), §12.2.4 (statusFlags property)',
      sampleSimSecs: missing.slice(0, 3),
    },
  ];
}

// ── Rule: Unique Device Instance per network ─────────────────────────
//
// Every BACnet device on a network must have a unique Device
// Instance. Two devices sharing instance == one of them is invisible
// to broadcast addressing. We scrape from I-Am summaries.

function checkUniqueDeviceInstances(
  packets: readonly ConformancePacket[],
): ConformanceFinding[] {
  const iAms = packets.filter((p) => p.service === 'I-Am');
  const seen = new Map<number, { srcMacs: Set<number>; simSecs: number[] }>();
  for (const p of iAms) {
    const m = /Device Instance (\d+)/.exec(p.summary ?? '');
    if (!m) continue;
    const inst = Number(m[1]);
    if (!seen.has(inst)) seen.set(inst, { srcMacs: new Set(), simSecs: [] });
    const slot = seen.get(inst)!;
    if (p.srcMac !== undefined) slot.srcMacs.add(p.srcMac);
    slot.simSecs.push(p.simSec);
  }
  const out: ConformanceFinding[] = [];
  for (const [inst, slot] of seen) {
    if (slot.srcMacs.size > 1) {
      out.push({
        id: 'bacnet.duplicate-instance',
        severity: 'error',
        title: `Duplicate Device Instance ${inst}`,
        description:
          `Device Instance ${inst} was announced by ${slot.srcMacs.size} different MACs ` +
          `(${[...slot.srcMacs].join(', ')}). BACnet requires every device on the network to ` +
          'have a unique Device Instance. Re-address one of them.',
        citation: 'ASHRAE 135 §12.11.40 (Device_Identifier)',
        sampleSimSecs: slot.simSecs.slice(0, 3),
      });
    }
  }
  return out;
}

// ── Rule: Unknown services in the stream ─────────────────────────────
//
// Sanity check — if the sandbox emits a service name that isn't in
// the recognized BACnet vocabulary, flag it as a likely typo /
// stub. Helps catch the sandbox growing internal service names that
// would never appear on a real wire.

const KNOWN_SERVICES = new Set([
  'Token-Pass',
  'Poll-For-Master',
  'I-Am',
  'Who-Is',
  'ReadProperty',
  'ReadProperty-ACK',
  'WriteProperty',
  'WriteProperty-ACK',
  'SubscribeCOV',
  'SubscribeCOV-ACK',
  'ConfirmedCOVNotification',
  'Timeout',
  'CommunicationLost',
  'CommunicationRestored',
]);

function checkUnknownServices(packets: readonly ConformancePacket[]): ConformanceFinding[] {
  const unknown = new Map<string, number[]>();
  for (const p of packets) {
    if (KNOWN_SERVICES.has(p.service)) continue;
    if (!unknown.has(p.service)) unknown.set(p.service, []);
    unknown.get(p.service)!.push(p.simSec);
  }
  if (unknown.size === 0) return [];
  const out: ConformanceFinding[] = [];
  for (const [svc, simSecs] of unknown) {
    out.push({
      id: 'bacnet.unknown-service',
      severity: 'warning',
      title: `Unrecognized service "${svc}"`,
      description:
        `Packet log contains a service "${svc}" that isn't part of the standard BACnet vocabulary. ` +
        'Likely a sandbox-internal label that won\'t appear on a real wire. Either rename to a ' +
        'real service or move it into a separate diagnostic stream.',
      sampleSimSecs: simSecs.slice(0, 3),
    });
  }
  return out;
}

/** Summary score over a set of findings. Useful for the UI panel
 *  to render a one-line "compliance: 7 pass, 2 warn, 1 fail" pill. */
export interface ConformanceSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
  readonly total: number;
}

export function summarizeConformance(findings: readonly ConformanceFinding[]): ConformanceSummary {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const f of findings) {
    if (f.severity === 'error') errors++;
    else if (f.severity === 'warning') warnings++;
    else infos++;
  }
  return { errors, warnings, infos, total: findings.length };
}
