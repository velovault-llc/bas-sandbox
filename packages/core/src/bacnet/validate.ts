// MS/TP trunk validation — catches the configuration mistakes that
// would cause real-world commissioning headaches.
//
// These are NOT physics or programming bugs — they're the network-layer
// hygiene checks every BAS tech eventually learns from getting burned:
//
//   - Duplicate MAC on one segment: two devices fight for the same
//     token slot; one eventually wins, the other looks "dead." Tech
//     wastes hours chasing a wiring problem that's actually a dip-switch
//     problem.
//   - MAC out of range: MS/TP is 0-127. MAC 128+ = the device never
//     joins. (Some vendors silently mod-128 it, making the bug worse.)
//   - >32 devices on one trunk: spec allows 127, but realistic poll
//     rate degrades sharply past 32. A 50-device trunk takes ~3-4s per
//     rotation — alarms get sluggish.
//   - Zero supervisors (MAC 0): no master means token bring-up depends
//     on Poll-For-Master timing — works, but it's slow.
//   - Multiple supervisors (multiple MAC 0): two devices both think
//     they own the token, you get token collisions on every rotation.
//
// Each finding follows the Validator / ValidationFinding shape used
// elsewhere in the package, so the same UI surface that renders
// dbexport / brick findings can render these too.

import type { MstpDevice, MstpAddressingNode, MstpAddressingEdge } from './mstp.js';
import { mstpComponents } from './mstp.js';

export type MstpFindingId =
  | 'mstp.duplicate-mac'
  | 'mstp.mac-out-of-range'
  | 'mstp.trunk-overloaded'
  | 'mstp.no-supervisor'
  | 'mstp.multiple-supervisors'
  | 'mstp.t-tap'
  | 'mstp.eol-missing'
  | 'mstp.eol-mid-chain'
  | 'mstp.eol-unset'
  | 'mstp.multiple-engines';

export interface MstpFinding {
  readonly id: MstpFindingId;
  readonly severity: 'error' | 'warning' | 'info';
  readonly trunkId: string;
  readonly title: string;
  readonly description: string;
  /** Node ids implicated in the finding, when known. */
  readonly nodeIds?: readonly string[];
}

export interface MstpTrunkSnapshot {
  readonly trunkId: string;
  readonly devices: readonly MstpDevice[];
}

/** Per-trunk thresholds (knobs for future tuning). */
export const MSTP_TRUNK_RECOMMENDED_MAX_DEVICES = 32;
export const MSTP_MAC_MIN = 0;
export const MSTP_MAC_MAX = 127;

/** Run every check against every trunk and return a flat finding list.
 *  Pure — no IO, no time, no randomness. */
export function validateMstpTrunks(
  trunks: readonly MstpTrunkSnapshot[],
): MstpFinding[] {
  const findings: MstpFinding[] = [];
  for (const t of trunks) {
    findings.push(...validateOneTrunk(t));
  }
  return findings;
}

/**
 * MS/TP PHYSICAL topology validation — wiring-shape mistakes (vs the
 * config mistakes validateMstpTrunks catches). RS-485 is a daisy-chained
 * bus: every device has an IN and an OUT lug and the cable runs device to
 * device, terminated at the two physical ends.
 *
 *   - T-tap / star: 3+ wires landing on one device means the bus branches.
 *     Reflections off the un-terminated stub corrupt frames — the classic
 *     "worked at 9600, dies at 38400" field failure. Only a repeater may
 *     legitimately branch a segment.
 *   - EOL termination: exactly the two chain-end devices should have their
 *     termination switch on. Missing → reflections at speed; mid-chain →
 *     bus loading. (Opt-in: silent until a device on the trunk has the
 *     switch modeled, so legacy scenarios aren't nagged — an info-level
 *     hint surfaces the feature in the trunk inspector.)
 *
 * Operates on the same node/edge shapes as `assignMstpAddressing` and the
 * same component grouping, so trunk keys always match the addressing map.
 */
export function validateMstpTopology(
  nodes: readonly MstpAddressingNode[],
  edges: readonly MstpAddressingEdge[],
): MstpFinding[] {
  const out: MstpFinding[] = [];
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));

  for (const comp of mstpComponents(edges)) {
    // Degree per member node, over this trunk's MS/TP edges only.
    const degree = new Map<string, number>();
    for (const e of comp.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }

    // 1. T-tap / star.
    for (const [nodeId, deg] of degree) {
      if (deg < 3) continue;
      const n = nodeById.get(nodeId);
      if (!n || n.kind === 'repeater') continue;
      out.push({
        id: 'mstp.t-tap',
        severity: 'error',
        trunkId: comp.trunkKey,
        title: `${n.label} T-taps the RS-485 bus (${deg} wires)`,
        description:
          `MS/TP is a daisy-chain: the cable lands on a device's IN lugs and continues from its OUT lugs — ` +
          `${deg} wires on ${n.label} means the bus branches into a star. Reflections off the unterminated ` +
          `stubs corrupt frames (works at 9600 baud, dies at 38400). Re-route the cable as a chain through ` +
          `each device, or branch through an RS-485 repeater.`,
        nodeIds: [nodeId],
      });
    }

    // 2. EOL termination — only once someone on the trunk models the switch.
    const members = comp.nodeIds
      .map((id) => nodeById.get(id))
      .filter((n): n is MstpAddressingNode => !!n);

    // 1b. Multiple engines on one field bus. MS/TP is multi-master, so the
    // token still passes — but in BAS practice ONE engine owns a trunk.
    // Two supervisors on the same segment fight over the same field
    // devices (conflicting polls/writes, overlapping site databases), and
    // the addressing demotes one of them to a child MAC, which is exactly
    // the silent weirdness a learner shouldn't have to decode.
    const engines = members.filter((n) => n.kind === 'supervisor');
    if (engines.length > 1) {
      out.push({
        id: 'mstp.multiple-engines',
        severity: 'error',
        trunkId: comp.trunkKey,
        title: `${engines.length} engines on one MS/TP trunk`,
        description:
          `${engines.map((n) => n.label).join(' and ')} are both supervisors on the same field bus. ` +
          `MS/TP physically allows it (multi-master token), but in practice one engine OWNS a trunk — ` +
          `two engines fight over the same field devices with conflicting polls and overlapping site ` +
          `databases, and only one gets MAC 0 (the other quietly becomes a child). ` +
          `Move one engine to its own trunk, or connect the two over BACnet/IP instead.`,
        nodeIds: engines.map((n) => n.id),
      });
    }
    const anyEolModeled = members.some((n) => typeof n.eolTerminated === 'boolean');
    const chainEnds = members.filter((n) => (degree.get(n.id) ?? 0) === 1);
    if (!anyEolModeled) {
      out.push({
        id: 'mstp.eol-unset',
        severity: 'info',
        trunkId: comp.trunkKey,
        title: 'EOL termination not set on this trunk',
        description:
          `A real RS-485 segment needs end-of-line termination at its two physical ends ` +
          `(${chainEnds.map((n) => n.label).join(' and ') || 'the chain ends'}). ` +
          `Flip the EOL switch in each end device's inspector to model it.`,
        nodeIds: chainEnds.map((n) => n.id),
      });
    } else {
      for (const n of chainEnds) {
        if (n.eolTerminated !== true) {
          out.push({
            id: 'mstp.eol-missing',
            severity: 'warning',
            trunkId: comp.trunkKey,
            title: `Missing EOL termination at ${n.label}`,
            description:
              `${n.label} sits at a physical end of the chain but its termination switch is off. ` +
              `An unterminated end reflects the signal back down the bus — intermittent token loss ` +
              `that gets worse with baud rate and cable length.`,
            nodeIds: [n.id],
          });
        }
      }
      for (const n of members) {
        if (n.eolTerminated === true && (degree.get(n.id) ?? 0) > 1) {
          out.push({
            id: 'mstp.eol-mid-chain',
            severity: 'warning',
            trunkId: comp.trunkKey,
            title: `EOL termination set mid-chain at ${n.label}`,
            description:
              `${n.label} has its termination switch on but sits in the middle of the chain. ` +
              `Extra termination loads the bus — drivers can't swing the line properly and ` +
              `far devices drop off. Only the two physical ends terminate.`,
            nodeIds: [n.id],
          });
        }
      }
    }
  }
  return out;
}

function validateOneTrunk(t: MstpTrunkSnapshot): MstpFinding[] {
  const out: MstpFinding[] = [];

  // 1. Duplicate MAC.
  const byMac = new Map<number, MstpDevice[]>();
  for (const d of t.devices) {
    const arr = byMac.get(d.mac) ?? [];
    arr.push(d);
    byMac.set(d.mac, arr);
  }
  for (const [mac, devs] of byMac) {
    if (devs.length > 1) {
      out.push({
        id: 'mstp.duplicate-mac',
        severity: 'error',
        trunkId: t.trunkId,
        title: `Duplicate MAC ${mac} on trunk`,
        description: `${devs.length} devices share MAC ${mac}: ${devs.map((d) => d.label).join(', ')}. On a real bus only one would join — the other is invisible to the supervisor. Re-assign one of them to a free MAC.`,
        nodeIds: devs.map((d) => d.nodeId),
      });
    }
  }

  // 2. MAC out of range.
  for (const d of t.devices) {
    if (d.mac < MSTP_MAC_MIN || d.mac > MSTP_MAC_MAX) {
      out.push({
        id: 'mstp.mac-out-of-range',
        severity: 'error',
        trunkId: t.trunkId,
        title: `MAC ${d.mac} is out of MS/TP range`,
        description: `${d.label} has MAC ${d.mac}. MS/TP only addresses ${MSTP_MAC_MIN}–${MSTP_MAC_MAX}. Some vendors silently mod-128 this, but you can't rely on it — set the dip switches or device tool to a value in range.`,
        nodeIds: [d.nodeId],
      });
    }
  }

  // 3. Trunk overloaded (poll cadence degrades).
  if (t.devices.length > MSTP_TRUNK_RECOMMENDED_MAX_DEVICES) {
    out.push({
      id: 'mstp.trunk-overloaded',
      severity: 'warning',
      trunkId: t.trunkId,
      title: `${t.devices.length} devices on one trunk (recommend ≤${MSTP_TRUNK_RECOMMENDED_MAX_DEVICES})`,
      description: `MS/TP spec allows 127 MACs, but past ~${MSTP_TRUNK_RECOMMENDED_MAX_DEVICES} devices the token rotation slows enough that alarms and overrides get sluggish. Consider splitting onto a second trunk.`,
    });
  }

  // 4. Supervisor count.
  const supervisorMacs = t.devices.filter((d) => d.mac === 0);
  if (supervisorMacs.length === 0 && t.devices.length > 0) {
    out.push({
      id: 'mstp.no-supervisor',
      severity: 'warning',
      trunkId: t.trunkId,
      title: 'No supervisor (MAC 0) on trunk',
      description: 'The trunk can still pass the token via Poll-For-Master, but startup is slow and there\'s nothing to originate ReadProperty polls. Add a JACE / NAE / NX as MAC 0.',
    });
  } else if (supervisorMacs.length > 1) {
    out.push({
      id: 'mstp.multiple-supervisors',
      severity: 'error',
      trunkId: t.trunkId,
      title: `${supervisorMacs.length} devices claim MAC 0`,
      description: `Two supervisors fighting over MAC 0 = token collisions every rotation. Devices: ${supervisorMacs.map((d) => d.label).join(', ')}. Demote all but one to a non-zero MAC.`,
      nodeIds: supervisorMacs.map((d) => d.nodeId),
    });
  }

  return out;
}
