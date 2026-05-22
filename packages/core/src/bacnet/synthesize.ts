// Synthesize the BACnet object list for a controller.
//
// Inputs come from the sim's runtime state:
//   - controller's vendor model (gives point counts per terminal kind)
//   - Point Assignment bindings (gives names + which env-key flows through)
//   - latest env.outputs snapshot (gives AV values)
//   - latest secondary input values (gives AI/BI readings)
//
// Output is the same list a supervisor would discover via Who-Is + a
// ReadPropertyMultiple on each object. The point is that the user can
// open the BACnet Objects panel and SEE what their controller is
// exposing to upstream BAS gear — same view a tech gets in YABE.

import { findControllerModel, type PointCount } from '../equipment/catalog.js';
import { findTileTemplate, type ControllerBindings } from '../speclang/index.js';
import {
  bacnetObjectId,
  bacnetUnitsForRole,
  type BacnetObject,
} from './objects.js';

export interface SynthesizeInputs {
  /** Vendor model id from the controller's node data, if any. */
  readonly vendorModelId: string | undefined;
  /** Point Assignment bindings from programStore. */
  readonly bindings: ControllerBindings | undefined;
  /** Latest env.inputs map for the controller (after sim tick). */
  readonly envInputs: Record<string, number | boolean> | undefined;
  /** Latest env.outputs map for the controller. */
  readonly envOutputs: Record<string, number> | undefined;
}

/**
 * Build the controller's BACnet object list. Stable across ticks: each
 * physical terminal owns the same object id; only PresentValue changes.
 */
export function synthesizeBacnetObjects(input: SynthesizeInputs): BacnetObject[] {
  const objects: BacnetObject[] = [];
  const model = input.vendorModelId ? findControllerModel(input.vendorModelId) : undefined;
  const points: PointCount = model?.points ?? { UI: 8, AI: 4, BI: 4, UO: 4, AO: 4, BO: 4 };
  const bindings = input.bindings?.bindings ?? [];
  const envOut = input.envOutputs ?? {};
  const envIn = input.envInputs ?? {};

  // ── Physical inputs (UI / AI / BI) → AI / BI objects ─────────────────
  let aiInstance = 1;
  let biInstance = 1;
  for (const kind of ['UI', 'AI', 'BI'] as const) {
    const count = (points[kind] ?? 0) as number;
    for (let i = 1; i <= count; i++) {
      const terminalId = `${kind}-${i}`;
      const binding = bindings.find((b) => b.terminalId === terminalId);
      const roleTpl = binding ? findTileTemplate(binding.role) : undefined;
      const envKey = roleTpl?.envKey;
      const value = envKey && envKey in envIn ? envIn[envKey] : 0;
      const treatAsBinary = kind === 'BI' ||
        binding?.role === 'occupancy' ||
        roleTpl?.envKey === 'occ' ||
        roleTpl?.envKey === 'heating_season' ||
        roleTpl?.envKey === 'cooling_season';
      if (treatAsBinary) {
        objects.push({
          id: bacnetObjectId('binary-input', biInstance),
          type: 'binary-input',
          instance: biInstance++,
          name: roleTpl ? roleTpl.display : `BI-${i} (unassigned)`,
          description: roleTpl?.description,
          presentValue: typeof value === 'number' ? value > 0.5 : !!value,
          terminalId,
        });
      } else {
        objects.push({
          id: bacnetObjectId('analog-input', aiInstance),
          type: 'analog-input',
          instance: aiInstance++,
          name: roleTpl ? roleTpl.display : `${terminalId} (unassigned)`,
          description: roleTpl?.description,
          units: bacnetUnitsForRole(binding?.role),
          presentValue: typeof value === 'number' ? value : 0,
          terminalId,
        });
      }
    }
  }

  // ── Physical outputs (UO / AO / BO) → AO / BO objects ────────────────
  let aoInstance = 1;
  let boInstance = 1;
  for (const kind of ['UO', 'AO', 'BO'] as const) {
    const count = (points[kind] ?? 0) as number;
    for (let i = 1; i <= count; i++) {
      const terminalId = `${kind}-${i}`;
      const binding = bindings.find((b) => b.terminalId === terminalId);
      const roleTpl = binding ? findTileTemplate(binding.role) : undefined;
      const envKey = roleTpl?.envKey;
      const value = envKey && envKey in envOut ? envOut[envKey] : 0;
      const isBinary = kind === 'BO' || binding?.role === 'chiller-enable';
      if (isBinary) {
        objects.push({
          id: bacnetObjectId('binary-output', boInstance),
          type: 'binary-output',
          instance: boInstance++,
          name: roleTpl ? roleTpl.display : `${terminalId} (unassigned)`,
          description: roleTpl?.description,
          presentValue: typeof value === 'number' ? value > 0.5 : !!value,
          terminalId,
        });
      } else {
        // AO/UO objects normalize to 0-100 % from the 0-1 env values.
        const pct = (typeof value === 'number' ? value : 0) * 100;
        objects.push({
          id: bacnetObjectId('analog-output', aoInstance),
          type: 'analog-output',
          instance: aoInstance++,
          name: roleTpl ? roleTpl.display : `${terminalId} (unassigned)`,
          description: roleTpl?.description,
          units: bacnetUnitsForRole(binding?.role) || '%',
          presentValue: pct,
          terminalId,
        });
      }
    }
  }

  // ── Computed AV objects: extra env.outputs the program writes that
  // aren't tied to a physical terminal (setpoints, calculated values). ──
  let avInstance = 1;
  const seenEnvKeys = new Set<string>();
  for (const b of bindings) {
    const tpl = findTileTemplate(b.role);
    if (tpl?.envKey) seenEnvKeys.add(tpl.envKey);
  }
  for (const [key, value] of Object.entries(envOut)) {
    if (seenEnvKeys.has(key)) continue;
    if (key === 'actuator' || key === 'setpoint') {
      // These are special — show as AV (cooling setpoint readback / PI cmd)
      objects.push({
        id: bacnetObjectId('analog-value', avInstance),
        type: 'analog-value',
        instance: avInstance++,
        name: key === 'setpoint' ? 'Cooling Setpoint' : 'PI Command (actuator)',
        units: key === 'setpoint' ? '°F' : '%',
        presentValue: key === 'actuator' ? value * 100 : value,
      });
    }
  }

  // Heating-season / cooling-season as BV objects (computed booleans).
  for (const seasonKey of ['heating_season', 'cooling_season'] as const) {
    if (seasonKey in envIn) {
      const display = seasonKey === 'heating_season' ? 'Heating Season Active' : 'Cooling Season Active';
      objects.push({
        id: bacnetObjectId('binary-value', objects.filter((o) => o.type === 'binary-value').length + 1),
        type: 'binary-value',
        instance: objects.filter((o) => o.type === 'binary-value').length + 1,
        name: display,
        presentValue: !!envIn[seasonKey],
      });
    }
  }

  return objects;
}
