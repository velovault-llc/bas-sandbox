// Experiment catalog — the seed set of declarative validation
// scenarios. Each entry exercises a specific invariant (or absence
// of it) so a regression suite + the autonomous-play agent both
// have a starting set of probes.
//
// Adding entries: keep ids stable, prefer minimal inputs, and write
// expectations from the user's perspective: "I gave you X, you
// should warn about Y". Try to cover both the positive case
// (rule fires when it should) and the negative case (rule stays
// quiet when it shouldn't) per validator family.

import type { ExperimentSpec } from './types.js';
import type { ConformancePacket } from '../bacnet/conformance.js';
import {
  emitWhoIs,
  emitIAm,
  emitReadProperty,
  emitReadPropertyAck,
  toConformancePacket,
} from '../bacnet/emit.js';

// ── Helpers for building synthetic packet traces ────────────────────
//
// These adapt the pure emit builders into the ConformancePacket shape
// the experiment harness uses. Experiments now exercise the SAME
// wire-format builders the UI ships with — when emit.ts changes, the
// catalog scenarios automatically reflect that change.

function whoIs(simSec: number): ConformancePacket {
  return toConformancePacket(
    emitWhoIs({ simSec, srcLabel: 'SUP', transport: 'broadcast-ip' }),
  );
}

function iAm(simSec: number, instance: number, opts: {
  maxApdu?: number;
  segmentation?: 'segmented-both' | 'segmented-transmit' | 'segmented-receive' | 'no-segmentation';
  vendorId?: number;
  srcMac?: number;
  dstMac?: number;
  /** When true, deliberately emit a malformed I-Am that omits the
   *  required ASHRAE §16.10.2 fields. Used by the iam-missing-fields
   *  experiment. */
  malformed?: boolean;
} = {}): ConformancePacket {
  if (opts.malformed) {
    // Bypass emit's contract on purpose — we WANT a malformed packet
    // to confirm the conformance checker catches it.
    return {
      simSec,
      service: 'I-Am',
      summary: `I-Am device,${instance}`,
      srcMac: opts.srcMac,
      dstMac: opts.dstMac,
    };
  }
  return toConformancePacket(
    emitIAm({
      simSec,
      srcLabel: 'DEV',
      srcMac: opts.srcMac,
      dstMac: opts.dstMac,
      deviceInstance: instance,
      maxApdu: opts.maxApdu,
      segmentation: opts.segmentation,
      vendorId: opts.vendorId ?? 260,
    }),
  );
}

function readProp(simSec: number, instance: number, prop: string, opts: {
  acked?: boolean;
  withInvokeId?: number;
} = {}): ConformancePacket[] {
  const inv = opts.withInvokeId ?? 1;
  const req = toConformancePacket(
    emitReadProperty({
      simSec,
      srcLabel: 'SUP',
      dstLabel: `device,${instance}`,
      objectId: `device,${instance}`,
      propertyName: prop,
      propertyId: 85,
      invokeId: inv,
    }),
  );
  if (opts.acked === false) return [req];
  const ack = toConformancePacket(
    emitReadPropertyAck({
      simSec: simSec + 0.05,
      srcLabel: `device,${instance}`,
      dstLabel: 'SUP',
      objectId: `device,${instance}`,
      propertyName: prop,
      invokeId: inv,
      value: 70.5,
    }),
  );
  return [req, ack];
}

// ── Catalog ─────────────────────────────────────────────────────────

export const EXPERIMENT_CATALOG: readonly ExperimentSpec[] = [
  // ── BACnet conformance ──────────────────────────────────────────
  {
    id: 'conformance.whois-cadence-healthy',
    title: 'Healthy Who-Is cadence (every 30s) raises no finding',
    hypothesis:
      'A supervisor emitting Who-Is every 30 sim-seconds satisfies ASHRAE §16.10.1 cadence guidance; the checker should stay quiet.',
    citation: 'ASHRAE 135 §16.10.1',
    scenario: {
      scope: 'bacnet-conformance',
      inputs: {
        packets: Array.from({ length: 10 }, (_, i) => whoIs(i * 30)),
      },
    },
    expects: [
      { id: 'bacnet.no-whois', present: false },
      { id: 'bacnet.whois-too-rare', present: false },
    ],
    tags: ['bacnet', 'who-is', 'cadence', 'positive'],
  },

  {
    id: 'conformance.iam-missing-fields',
    title: 'I-Am without max-APDU / segmentation / vendor → warning',
    hypothesis:
      'ASHRAE §16.10.2 requires I-Am to carry Device Instance, Max APDU Length Accepted, Segmentation Supported, and Vendor ID. A bare I-Am should fire the missing-fields finding.',
    citation: 'ASHRAE 135 §16.10.2',
    scenario: {
      scope: 'bacnet-conformance',
      inputs: {
        packets: [
          whoIs(0),
          // Deliberately malformed I-Am — missing maxAPDU,
          // segmentation, vendorId.
          iAm(0.1, 1234, { malformed: true }),
        ],
      },
    },
    expects: [
      { id: 'bacnet.iam-missing-fields', present: true, severity: 'warning' },
    ],
    tags: ['bacnet', 'i-am', 'fields'],
  },

  {
    id: 'conformance.readproperty-no-ack',
    title: 'ReadProperty request without ack → error',
    hypothesis:
      'Confirmed services (ReadProperty among them) must receive a Complex-ACK per §15.5. An unacked request should fire bacnet.readproperty-no-ack.',
    citation: 'ASHRAE 135 §15.5.1',
    scenario: {
      scope: 'bacnet-conformance',
      inputs: {
        packets: [
          whoIs(0),
          iAm(0.1, 1234),
          ...readProp(1, 1234, 'present-value', { acked: false, withInvokeId: 5 }),
        ],
      },
    },
    expects: [
      { id: 'bacnet.readproperty-no-ack', present: true, severity: 'error' },
    ],
    tags: ['bacnet', 'read-property', 'ack'],
  },

  {
    id: 'conformance.readproperty-acked-clean',
    title: 'ReadProperty with matching ACK → clean',
    hypothesis:
      'When a ReadProperty request is followed by a ReadProperty-Ack with the same invoke id, the round-trip is satisfied and no finding should fire.',
    citation: 'ASHRAE 135 §15.5.1 / §20.1.2.4',
    scenario: {
      scope: 'bacnet-conformance',
      inputs: {
        packets: [
          whoIs(0),
          iAm(0.1, 1234),
          ...readProp(1, 1234, 'present-value', { withInvokeId: 7 }),
        ],
      },
    },
    expects: [
      { id: 'bacnet.readproperty-no-ack', present: false },
      { id: 'bacnet.missing-invoke-id', present: false },
    ],
    tags: ['bacnet', 'read-property', 'positive'],
  },

  // ── IPv4 ────────────────────────────────────────────────────────
  {
    id: 'ipv4.duplicate-ip-flags',
    title: 'Two devices on the same IP → duplicate-ip error',
    hypothesis:
      'Two BACnet/IP devices sharing one address will collide on the network. The validator should flag this regardless of subnet.',
    scenario: {
      scope: 'ipv4',
      inputs: {
        devices: [
          { nodeId: 'a', label: 'JACE-1', ipAddress: '10.0.1.10', subnetMask: '255.255.255.0' },
          { nodeId: 'b', label: 'JACE-2', ipAddress: '10.0.1.10', subnetMask: '255.255.255.0' },
        ],
      },
    },
    expects: [
      { id: 'ipv4.duplicate-ip', present: true, severity: 'error' },
    ],
    tags: ['ipv4', 'duplicate'],
  },

  {
    id: 'ipv4.bbmd-empty-bdt-warns',
    title: 'BBMD with empty BDT → bbmd-empty-bdt warning',
    hypothesis:
      'A BBMD with no peer BBMDs in its BDT is non-functional for cross-subnet broadcast forwarding. The validator should warn.',
    scenario: {
      scope: 'ipv4',
      inputs: {
        devices: [
          {
            nodeId: 'b1',
            label: 'BBMD-A',
            ipAddress: '10.0.1.5',
            subnetMask: '255.255.255.0',
            isBBMD: true,
            // No bdtPeers populated.
          },
        ],
      },
    },
    expects: [
      { id: 'ipv4.bbmd-empty-bdt', present: true, severity: 'warning' },
    ],
    tags: ['ipv4', 'bbmd'],
  },

  // ── MS/TP ───────────────────────────────────────────────────────
  {
    id: 'mstp.duplicate-mac-flags',
    title: 'Two MS/TP devices on the same MAC → duplicate-mac error',
    hypothesis:
      'An MS/TP trunk requires unique MACs in 0-127. Two devices on MAC 2 should be flagged as duplicate-mac.',
    scenario: {
      scope: 'mstp',
      inputs: {
        trunks: [
          {
            trunkId: 'trunk-a',
            devices: [
              { nodeId: 'sup', mac: 0, label: 'JACE-1' },
              { nodeId: 'fec1', mac: 2, label: 'FEC-1' },
              { nodeId: 'fec2', mac: 2, label: 'FEC-2' },
            ],
          },
        ],
      },
    },
    expects: [
      { id: 'mstp.duplicate-mac', present: true, severity: 'error' },
    ],
    tags: ['mstp', 'duplicate'],
  },

  {
    id: 'mstp.mac-out-of-range-flags',
    title: 'MS/TP device with MAC > 127 → mac-out-of-range error',
    hypothesis:
      'Master-frame MAC field is 7 bits (0-127). MAC 130 is invalid and should be flagged.',
    scenario: {
      scope: 'mstp',
      inputs: {
        trunks: [
          {
            trunkId: 'trunk-b',
            devices: [
              { nodeId: 'sup', mac: 0, label: 'JACE-1' },
              { nodeId: 'fec', mac: 130, label: 'FEC-bad' },
            ],
          },
        ],
      },
    },
    expects: [
      { id: 'mstp.mac-out-of-range', present: true, severity: 'error' },
    ],
    tags: ['mstp', 'mac-range'],
  },
];

/** Lookup an experiment by id. */
export function findExperiment(id: string): ExperimentSpec | undefined {
  return EXPERIMENT_CATALOG.find((e) => e.id === id);
}

/** Filter the catalog by tag. */
export function experimentsByTag(tag: string): readonly ExperimentSpec[] {
  return EXPERIMENT_CATALOG.filter((e) => e.tags?.includes(tag));
}
