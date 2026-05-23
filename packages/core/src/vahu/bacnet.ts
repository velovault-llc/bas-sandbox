// vAHU → BACnet object surface.
//
// What a real BACnet AHU controller exposes to its supervisor:
//   - AI 1..4: OAT, MAT, RAT, DAT (sensors)
//   - AI 5:    ZN-T  (zone temp — physical input from a thermostat)
//   - AV 1..3: SAT-SP, Zone-SP, Econ-High-Limit (operator-settable setpoints)
//   - AO 1..4: SF-Speed-Cmd, OAD-Pos-Cmd, HV-Pos-Cmd, CV-Pos-Cmd (commands)
//   - BV 1..3: Occupied, Alarm, Econ-Active (states + flags)
//   - MSV 1:   Mode  (multi-state value: off/heating/cooling/econ/unocc)
//   - Device:  the AHU itself as a BACnet device object
//
// Object names follow JCI Metasys + Tridium Niagara conventions —
// short identifiers a tech reads on a Wireshark capture without
// needing a legend. Object descriptions explain the role for
// less-experienced viewers via the packet log's hover-tooltip.

import { bacnetObjectId, type BacnetObject } from '../bacnet/objects.js';
import type { VAhuConfig, VAhuState } from './types.js';

/** Build the full BACnet object list exposed by a vAHU at its
 *  current state. Stable object IDs across ticks: the supervisor's
 *  Object List doesn't change between scans; only PresentValue does. */
export function synthesizeVAhuObjects(
  state: VAhuState,
  config: VAhuConfig,
  inputs: { oat: number; rat: number; zoneTemp: number; occupied: boolean },
): BacnetObject[] {
  const ai = (instance: number, name: string, value: number, units: string, description: string): BacnetObject => ({
    id: bacnetObjectId('analog-input', instance),
    type: 'analog-input',
    instance,
    name,
    description,
    presentValue: Number.isFinite(value) ? value : 0,
    units,
  });
  const av = (instance: number, name: string, value: number, units: string, description: string): BacnetObject => ({
    id: bacnetObjectId('analog-value', instance),
    type: 'analog-value',
    instance,
    name,
    description,
    presentValue: Number.isFinite(value) ? value : 0,
    units,
  });
  const ao = (instance: number, name: string, value: number, units: string, description: string): BacnetObject => ({
    id: bacnetObjectId('analog-output', instance),
    type: 'analog-output',
    instance,
    name,
    description,
    presentValue: Number.isFinite(value) ? value : 0,
    units,
  });
  const bv = (instance: number, name: string, value: boolean, description: string): BacnetObject => ({
    id: bacnetObjectId('binary-value', instance),
    type: 'binary-value',
    instance,
    name,
    description,
    presentValue: value,
  });

  return [
    // ── Analog inputs (sensors) ──────────────────────────────────
    ai(1, 'OAT', inputs.oat, 'degreesFahrenheit', 'Outside Air Temperature'),
    ai(2, 'MAT', state.mat, 'degreesFahrenheit', 'Mixed Air Temperature'),
    ai(3, 'RAT', inputs.rat, 'degreesFahrenheit', 'Return Air Temperature'),
    ai(4, 'DAT', state.dat, 'degreesFahrenheit', 'Discharge Air Temperature'),
    ai(5, 'ZN-T', inputs.zoneTemp, 'degreesFahrenheit', 'Zone Temperature'),

    // ── Analog values (setpoints) ────────────────────────────────
    av(1, 'SAT-SP', state.satSetpoint, 'degreesFahrenheit', 'Supply Air Temp Setpoint (G36 §5.18.6 reset target)'),
    av(2, 'ZN-SP', config.zoneSetpoint, 'degreesFahrenheit', 'Zone Temperature Setpoint'),
    av(3, 'OAT-ECON-LIM', config.econHighLimitOAT, 'degreesFahrenheit', 'Economizer OA high-limit lockout (G36 §5.18.2)'),

    // ── Analog outputs (commands to actuators) ───────────────────
    ao(1, 'SF-SPD', state.fanSpeed * 100, 'percent', 'Supply Fan VFD Speed Command'),
    ao(2, 'OAD-POS', state.oaDamperPct, 'percent', 'Outside Air Damper Position Command'),
    ao(3, 'HV-POS', state.heatValvePct, 'percent', 'Heating Valve Position Command (G36 §5.18.3)'),
    ao(4, 'CV-POS', state.coolValvePct, 'percent', 'Cooling Valve Position Command (G36 §5.18.4)'),

    // ── Binary values (states + flags) ───────────────────────────
    bv(1, 'OCC', inputs.occupied, 'Occupied schedule state'),
    bv(2, 'ECON-ACT', state.mode === 'economizer', 'Economizer active (free cooling)'),
    bv(3, 'ALARM', false, 'Unit alarm summary (any active alarm)'),
  ];
}

/** Convenience: just the changed-since-last-tick subset, used by
 *  the COV-notification emit path. Caller passes the prior state
 *  + the new state; we return BACnet objects whose presentValue
 *  crossed a deadband. Empty array == nothing to notify. */
export function vAhuCovDeltas(
  prev: VAhuState,
  next: VAhuState,
  config: VAhuConfig,
  inputs: { oat: number; rat: number; zoneTemp: number; occupied: boolean },
  prevInputs: { oat: number; rat: number; zoneTemp: number; occupied: boolean },
): BacnetObject[] {
  const nextObjects = synthesizeVAhuObjects(next, config, inputs);
  const prevObjects = synthesizeVAhuObjects(prev, config, prevInputs);
  const out: BacnetObject[] = [];
  const DEFAULT_DEADBAND = 0.5; // °F or %
  for (const newObj of nextObjects) {
    const oldObj = prevObjects.find((o) => o.id === newObj.id);
    if (!oldObj) {
      out.push(newObj);
      continue;
    }
    const nv = newObj.presentValue;
    const ov = oldObj.presentValue;
    if (typeof nv === 'boolean' || typeof ov === 'boolean') {
      if (nv !== ov) out.push(newObj);
    } else {
      if (Math.abs(nv - ov) >= DEFAULT_DEADBAND) out.push(newObj);
    }
  }
  return out;
}
