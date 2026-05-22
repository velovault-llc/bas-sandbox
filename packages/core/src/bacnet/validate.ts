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

import type { MstpDevice } from './mstp.js';

export type MstpFindingId =
  | 'mstp.duplicate-mac'
  | 'mstp.mac-out-of-range'
  | 'mstp.trunk-overloaded'
  | 'mstp.no-supervisor'
  | 'mstp.multiple-supervisors';

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
