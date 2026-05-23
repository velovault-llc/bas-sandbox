// vAHU tick — one step of the G36 §5.18 sequence.
//
// Order of operations matches what a real controller does each scan:
//
//   1. Determine mode (occupancy + temp error vs deadband).
//   2. Economizer enable test (OAT < high limit).
//   3. Pick supply-air-temp setpoint per mode.
//   4. Compute OA damper position:
//        - Occupied non-econ: minimum position
//        - Occupied econ active: modulate to maintain MAT setpoint
//        - Unoccupied: closed
//   5. Mix MAT = (OAD% * OAT) + (1 - OAD%) * RAT.
//   6. PI loops on heating + cooling valves:
//        - Error = SAT_setpoint - DAT
//        - One loop active per mode; other zeroed
//   7. Compute DAT = MAT + heat_effect - cool_effect.
//   8. Update fan speed (occupied: modulate by demand; off otherwise).
//
// All math runs at first-order fidelity — the goal is right behavior
// not right enthalpy. A future revision could swap the mixing math
// for a proper enthalpy-balance once the sandbox needs psychrometrics.

import {
  DEFAULT_VAHU_CONFIG,
  type VAhuConfig,
  type VAhuInputs,
  type VAhuMode,
  type VAhuState,
} from './types.js';

const HEAT_COIL_MAX_RISE_F = 50; // °F MAT→DAT max delta-T at 100% valve
const COOL_COIL_MAX_DROP_F = 30; // °F MAT→DAT max delta-T at 100% valve
const ZONE_DEADBAND_F = 1.0;     // ± around zone setpoint for mode hysteresis
const FAN_DEMAND_SPAN = 20;      // °F zone-error span that maps 0→100% extra fan

/** Advance one sim tick. Pure: takes prior state + inputs + config,
 *  returns the next state. Caller persists. */
export function stepVAhu(
  prev: VAhuState,
  inputs: VAhuInputs,
  simSec: number,
  config: VAhuConfig = DEFAULT_VAHU_CONFIG,
): VAhuState {
  const dt = Math.max(0.01, simSec - prev.lastStepSec);

  // ── 1. Mode determination ────────────────────────────────────────
  const mode = pickMode(prev, inputs, config);

  // ── 2. Economizer enable ─────────────────────────────────────────
  // G36 §5.18.2: fixed dry-bulb high limit. Enabled when OAT < limit.
  const econAvailable = inputs.oat < config.econHighLimitOAT;
  const econActive = mode === 'economizer' && econAvailable;

  // ── 3. Supply-air-temp setpoint ──────────────────────────────────
  // Heating mode targets the heat setpoint; everything else targets
  // the cooling setpoint (which is the cold deck temp the unit holds
  // when economizer or mech cooling is active).
  const satSetpoint =
    mode === 'heating' ? config.satHeatSetpoint : config.satCoolSetpoint;

  // ── 4. OA damper position ────────────────────────────────────────
  let oaDamperPct: number;
  if (mode === 'unoccupied' || mode === 'off') {
    oaDamperPct = 0;
  } else if (econActive) {
    // Modulate OAD to drive MAT toward SAT setpoint (free cooling).
    // Simple proportional control on the OAT-RAT span.
    if (Math.abs(inputs.rat - inputs.oat) < 0.5) {
      oaDamperPct = 100; // No mixing gradient — open up.
    } else {
      // Inverse-mix to hit target MAT: solve mat = a*oat + (1-a)*rat for a.
      const target = satSetpoint;
      const ratio = (target - inputs.rat) / (inputs.oat - inputs.rat);
      const pct = clamp(ratio * 100, config.minOaDamperPctOccupied, 100);
      oaDamperPct = pct;
    }
  } else {
    oaDamperPct = config.minOaDamperPctOccupied;
  }

  // ── 5. Mixed air temperature ────────────────────────────────────
  const oadFraction = oaDamperPct / 100;
  const mat = oadFraction * inputs.oat + (1 - oadFraction) * inputs.rat;

  // ── 6. PI loops on heating + cooling valves ─────────────────────
  // The valve POSITION is itself the integrator: each tick we nudge
  // it in the direction of the DAT error and clamp 0-100. Pure-
  // integral control is stable + slow, no overshoot. Steady state
  // is reached when the valve position holds the discharge temp at
  // setpoint — the position equals whatever the coil needs to
  // balance the MAT-to-SAT delta. This matches how field controllers
  // actually behave on slow processes (HW valves, CHW valves) better
  // than aggressive PID with derivative kick.
  //
  // piKp is reinterpreted as gain on the valve-position rate:
  //   valve%[k+1] = valve%[k] + Kp * err * dt  (clamped 0..100)
  //
  // piKi is unused in this simplification — kept in the config so the
  // future v2 can wire it back in once we have a non-trivial plant
  // model (coil lag, duct thermal mass).
  let heatValvePct = prev.heatValvePct;
  let coolValvePct = prev.coolValvePct;
  // PI integrator state retained in the type so a future v2 with
  // real plant dynamics can re-introduce a proportional+integral
  // term — for now the valve position itself is the integrator.
  const heatPi = prev.heatPiIntegrator;
  const coolPi = prev.coolPiIntegrator;

  if (mode === 'heating') {
    const err = satSetpoint - prev.dat; // °F under-temperature
    heatValvePct = clamp(prev.heatValvePct + err * config.piKp * dt * 0.05, 0, 100);
    coolValvePct = Math.max(0, prev.coolValvePct - config.piKp * dt * 0.5);
  } else if (mode === 'cooling') {
    const err = prev.dat - satSetpoint; // °F over-temperature
    coolValvePct = clamp(prev.coolValvePct + err * config.piKp * dt * 0.05, 0, 100);
    heatValvePct = Math.max(0, prev.heatValvePct - config.piKp * dt * 0.5);
  } else {
    // off / unoccupied / economizer — both valves close down.
    heatValvePct = Math.max(0, prev.heatValvePct - config.piKp * dt * 0.5);
    coolValvePct = Math.max(0, prev.coolValvePct - config.piKp * dt * 0.5);
  }

  // ── 7. Discharge air temperature ────────────────────────────────
  // First-order coil model: each valve contributes its max delta-T
  // scaled by valve position fraction.
  const heatDelta = (heatValvePct / 100) * HEAT_COIL_MAX_RISE_F;
  const coolDelta = (coolValvePct / 100) * COOL_COIL_MAX_DROP_F;
  const dat = mat + heatDelta - coolDelta;

  // ── 8. Fan speed ────────────────────────────────────────────────
  let fanSpeed: number;
  if (mode === 'off') {
    fanSpeed = 0;
  } else if (mode === 'unoccupied') {
    // Cycled fan — for the v1 we use a steady "low" speed; future
    // work can implement actual occupancy-cycling logic.
    fanSpeed = config.fanMinSpeed * 0.5;
  } else {
    // Modulate between min and max based on zone error magnitude.
    const zoneErr = Math.abs(inputs.zoneTemp - config.zoneSetpoint);
    const demand = clamp(zoneErr / FAN_DEMAND_SPAN, 0, 1);
    fanSpeed = config.fanMinSpeed + demand * (config.fanMaxSpeed - config.fanMinSpeed);
  }

  return {
    mode,
    satSetpoint,
    oaDamperPct,
    heatValvePct,
    coolValvePct,
    fanSpeed,
    heatPiIntegrator: heatPi,
    coolPiIntegrator: coolPi,
    mat,
    dat,
    lastStepSec: simSec,
  };
}

/** Pick mode using zone temp + occupancy + a deadband around the
 *  zone setpoint. G36 §5.18.1 — Occupied: Heating below SP-deadband,
 *  Cooling above SP+deadband, Economizer when cooling AND OA is
 *  cold enough for free cooling. */
function pickMode(
  prev: VAhuState,
  inputs: VAhuInputs,
  config: VAhuConfig,
): VAhuMode {
  if (!inputs.occupied) return 'unoccupied';

  const below = inputs.zoneTemp < config.zoneSetpoint - ZONE_DEADBAND_F;
  const above = inputs.zoneTemp > config.zoneSetpoint + ZONE_DEADBAND_F;
  // Hysteresis: don't change mode while inside the deadband — hold
  // the previous mode if it's still applicable.
  if (!below && !above) {
    if (prev.mode === 'heating' || prev.mode === 'cooling' || prev.mode === 'economizer') {
      return prev.mode;
    }
    return 'cooling';
  }
  if (below) return 'heating';
  // above — cooling required. If OAT cold enough, prefer economizer.
  if (inputs.oat < config.econHighLimitOAT) return 'economizer';
  return 'cooling';
}

// ── Helpers ─────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

