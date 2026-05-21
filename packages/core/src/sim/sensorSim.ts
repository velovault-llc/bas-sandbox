// Per-subject sensor value computation.
//
// The thermal sim drives zone temperature; every other sensor subject
// (occupancy, damper position, CO2, humidity, airflow, pressure, current,
// valve position) needs its own value source. This module centralizes the
// computation so the UI sim tick can ask "what does this sensor read right
// now?" given the sim's current state.
//
// The contract is intentionally narrow:
//   - inputs: SensorSubject + a minimal SimContext (sim hour, primary
//     actuator command, primary zone temp, etc.)
//   - output: a numeric value + a display string + a canonical input-key
//     used to inject the value into a controller program's env
//
// First pass implements occupancy + damper/valve position behaviorally
// (the two cases the VAV starter scenario needs). The rest return plausible
// placeholder values so the sensor node displays something subject-relevant
// instead of every sensor reading "73.1 °F".

import type { SensorSubject } from '../equipment/sensors.js';

export interface SimContext {
  /** Sim hour of day, 0..24 (fractional). */
  readonly hour: number;
  /** Latest actuator command from the controller this sensor pairs with,
   *  0..1. Used for feedback sensors (damper-position, valve-position). */
  readonly actuator: number;
  /** Latest zone-temp sample (°F). Used for the few subjects that depend on
   *  thermal state — humidity model, CO2 decay, etc. */
  readonly zoneTemp: number;
  /** Outside-air temp (°F) — relevant for OA-side humidity / CO2 models. */
  readonly outsideTemp: number;
}

export interface SensorReading {
  /** Numeric value in subject-native units (0/1 for occ, 0..100 for damper
   *  percent, ppm for CO2, etc.). */
  readonly value: number;
  /** Display string with units, ready to paint onto a sensor node. */
  readonly display: string;
  /** Canonical env-input key. The FBD INPUT block reads this name. */
  readonly inputKey: string;
}

/**
 * Compute the current reading for a sensor of the given subject under the
 * given sim context. Pure function — no side effects, deterministic.
 */
export function computeSensorReading(
  subject: SensorSubject,
  ctx: SimContext,
): SensorReading {
  switch (subject) {
    case 'temp': {
      // Temp sensors are still driven by the thermal sim's T_sensed via the
      // primary-target wiring path; this branch only fires for *secondary*
      // temp sensors (e.g., a duct-mount that isn't the primary feedback).
      // Use zone temp as a sensible default.
      return {
        value: ctx.zoneTemp,
        display: `${ctx.zoneTemp.toFixed(1)} °F`,
        inputKey: 'sensed',
      };
    }
    case 'occupancy': {
      // Simple commercial-office schedule: occupied 7am to 7pm.
      const occ = ctx.hour >= 7 && ctx.hour < 19 ? 1 : 0;
      return {
        value: occ,
        display: occ === 1 ? 'OCC · 1 (occupied)' : 'OCC · 0 (vacant)',
        inputKey: 'occ',
      };
    }
    case 'damper-position': {
      // Feedback sensor on a damper actuator: reports what the actuator is
      // commanded to (0..100%). In real life there's a small lag and a
      // mechanical hysteresis band — we omit those for now since the
      // starter graphs don't model them.
      const pct = ctx.actuator * 100;
      return {
        value: pct,
        display: `${pct.toFixed(0)} %`,
        inputKey: 'damper',
      };
    }
    case 'valve-position': {
      // Same shape as damper feedback.
      const pct = ctx.actuator * 100;
      return {
        value: pct,
        display: `${pct.toFixed(0)} % open`,
        inputKey: 'valve',
      };
    }
    case 'co2': {
      // Plausible occupied/unoccupied ppm: 450 ppm baseline outdoors, climbs
      // to ~900 under full occupancy and declines with ventilation. The
      // damper command stands in for ventilation rate.
      const occupied = ctx.hour >= 7 && ctx.hour < 19 ? 1 : 0;
      const ppm = 450 + occupied * (450 * (1 - ctx.actuator));
      return {
        value: ppm,
        display: `${ppm.toFixed(0)} ppm`,
        inputKey: 'co2',
      };
    }
    case 'humidity': {
      // Indoor RH tracks zone temp loosely: warmer air can hold more water,
      // so for a fixed moisture mass RH falls as temp rises. Anchor at 45%
      // RH at 72°F.
      const rh = Math.max(15, Math.min(85, 45 - (ctx.zoneTemp - 72) * 1.2));
      return {
        value: rh,
        display: `${rh.toFixed(0)} % RH`,
        inputKey: 'rh',
      };
    }
    case 'air-flow': {
      // CFM scales with damper position. A typical small VAV box runs
      // 200–1200 CFM across its modulation range.
      const cfm = 200 + ctx.actuator * 1000;
      return {
        value: cfm,
        display: `${cfm.toFixed(0)} CFM`,
        inputKey: 'cfm',
      };
    }
    case 'pressure-static': {
      // Duct static pressure climbs as the damper closes (fan working against
      // restriction). Typical range ~0.5 to 2.0 inWC.
      const ps = 0.5 + (1 - ctx.actuator) * 1.5;
      return {
        value: ps,
        display: `${ps.toFixed(2)} inWC`,
        inputKey: 'ps',
      };
    }
    case 'pressure-differential': {
      // ΔP across a filter / coil — small steady value with a touch of noise.
      const dp = 0.4 + ctx.actuator * 0.2;
      return {
        value: dp,
        display: `${dp.toFixed(2)} inWC`,
        inputKey: 'dp',
      };
    }
    case 'current': {
      // Motor current (amps) as a proxy for whether a fan/pump is running.
      // 0 when actuator is closed, ramps with command.
      const amps = ctx.actuator * 8.5;
      return {
        value: amps,
        display: `${amps.toFixed(1)} A`,
        inputKey: 'amps',
      };
    }
  }
}
