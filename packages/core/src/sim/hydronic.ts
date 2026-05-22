// Hydronic loop physics — hot-water + chilled-water plant dynamics.
//
// A hydronic loop is a closed circuit of water that carries heat between
// a *plant* (boiler / chiller) and one or more *loads* (AHU coils, VAV
// reheat coils, FCU coils, perimeter baseboard). The sim models four
// quantities per loop:
//
//   T_supply  — water temp leaving the plant, °F
//   T_return  — water temp coming back to the plant, °F
//   flow_gpm  — volumetric flow rate, gallons per minute
//   load_btu  — heat being delivered (HW) or absorbed (CHW) by loads, BTU/hr
//
// The thermodynamics are deliberately simple — enough to give the user
// "this looks like a boiler" behavior without modeling steam tables, two-
// phase refrigerant, or pipe friction in detail. The goal is BAS-realism:
// the supply temp ramps when you fire the burner, the return temp depends
// on load, the differential temperature (ΔT) tells you how hard the
// system is working. That's what commissioning agents read off the
// gauges.
//
// First law of thermodynamics applied to water:
//   Q [BTU/hr] = 500 × flow_gpm × ΔT [°F]
// (500 = 60 min/hr × 8.33 lb/gal × 1.0 BTU/lb·°F, a memorized number
// every commercial HVAC tech has tattooed somewhere.)
//
// Plant heat input modulates with the burner / compressor command. Loads
// extract a fraction of available heat based on their coil command. The
// loop self-balances over a few minutes — that's why boiler reset is a
// slow setpoint trim, not a real-time chase.

export type LoopKind = 'hot-water' | 'chilled-water' | 'condenser-water';

export interface LoopState {
  /** Water temp at the plant supply header (°F). */
  readonly T_supply: number;
  /** Water temp at the plant return header (°F). */
  readonly T_return: number;
  /** System flow in GPM — driven by primary loop pump speed. */
  readonly flow_gpm: number;
  /** Heat delivered (HW) or absorbed (CHW) this tick, in BTU/hr. */
  readonly load_btu: number;
}

export interface LoopConfig {
  readonly kind: LoopKind;
  /** Design supply temp at full load. HW typical 180°F, CHW 44°F. */
  readonly designSupplyTemp: number;
  /** Design return temp at full load. HW typical 160°F, CHW 56°F. */
  readonly designReturnTemp: number;
  /** Design flow at full load. */
  readonly designFlowGpm: number;
  /** Plant capacity — max heat input/output rate at firing rate 1.0
   *  (HW boilers) or compressor stage max (CHW chillers). BTU/hr. */
  readonly capacityBtu: number;
  /** Thermal mass of the loop — affects how fast supply temp ramps.
   *  Bigger = slower response. Gallons of water in the loop × 8.33 lb/gal. */
  readonly loopMassLbs: number;
}

export interface LoopInputs {
  /** Plant firing / staging command, 0-1. 1.0 = full output. */
  readonly plantCommand: number;
  /** Pump speed command, 0-1. 1.0 = design flow. */
  readonly pumpCommand: number;
  /** Aggregate load draw, 0-1. 1.0 = all coils fully open. */
  readonly loadCommand: number;
  /** Ambient OAT — chilled water + boilers both interact with ambient. */
  readonly outsideTemp: number;
}

/** OA lockout state — most commercial boilers / cooling towers have a
 *  hardware changeover switch that disables firing when ambient is out
 *  of season. Independent of BAS control. */
export interface OaLockout {
  /** True = plant is locked out and won't fire regardless of command. */
  readonly active: boolean;
  /** OAT threshold the lockout decision was based on (°F). */
  readonly threshold: number;
  /** Direction: 'above' = lockout when OAT > threshold (boiler in summer);
   *  'below' = lockout when OAT < threshold (tower in winter). */
  readonly direction: 'above' | 'below';
}

/** Compute OA lockout for a plant given its config and current OAT.
 *  Returns null when the plant has no built-in lockout (e.g., chillers,
 *  which run year-round in commercial buildings with internal IT loads). */
export function computeOaLockout(
  kind: LoopKind,
  oaTemp: number,
): OaLockout | null {
  if (kind === 'hot-water') {
    // Boilers lock out above changeover — default 65°F.
    return { active: oaTemp > 65, threshold: 65, direction: 'above' };
  }
  if (kind === 'condenser-water') {
    // Cooling towers lock out below ~50°F (freeze risk + basin care).
    return { active: oaTemp < 50, threshold: 50, direction: 'below' };
  }
  // Chillers run year-round — no built-in lockout.
  return null;
}

/**
 * Advance a hydronic loop by `dt` seconds. Pure function — no side
 * effects, deterministic. The caller carries `state` across ticks.
 */
export function stepLoop(
  state: LoopState,
  config: LoopConfig,
  inputs: LoopInputs,
  dt: number,
): LoopState {
  const isCooling = config.kind === 'chilled-water';
  // Pump-driven flow. Zero-flow at zero command means loop ΔT goes to
  // infinity in the formula below, so clamp to a small idle flow.
  const flow_gpm = Math.max(0.5, inputs.pumpCommand * config.designFlowGpm);

  // Honor OA lockout: hardware-level disable independent of BAS command.
  // Boiler in summer + cooling tower in winter = zero firing regardless
  // of what the program writes.
  const lockout = computeOaLockout(config.kind, inputs.outsideTemp);
  const effectivePlantCmd = lockout?.active ? 0 : inputs.plantCommand;

  // Heat being added (HW) or removed (CHW) by the plant this tick.
  // BTU/hr at the plant heat exchanger.
  const plant_btu = effectivePlantCmd * config.capacityBtu * (isCooling ? -1 : 1);

  // Load draw. HW: loads pull heat OUT (cooling the return water).
  //            CHW: loads dump heat IN (warming the return water).
  // Loads can never extract more heat than the plant supplies at design;
  // we model load_btu as up to plant capacity at full coil command.
  const max_load_btu = config.capacityBtu * (isCooling ? -1 : 1);
  const load_btu = inputs.loadCommand * max_load_btu;

  // Net energy balance in the loop body (BTU added this tick).
  // dt is seconds, but plant/load rates are BTU/hr — convert.
  const net_btu_per_hr = plant_btu - load_btu;
  const dt_hours = dt / 3600;
  const dQ_btu = net_btu_per_hr * dt_hours;

  // Loop average temp ramps by dQ / (mass × specific heat).
  // Specific heat of water = 1.0 BTU/lb·°F.
  const T_avg_prev = (state.T_supply + state.T_return) / 2;
  const dT_avg = dQ_btu / Math.max(1, config.loopMassLbs);
  let T_avg = T_avg_prev + dT_avg;

  // Mild reversion toward design when plant + load are zero — accounts
  // for jacket losses and ambient interaction. Slow drift, ~0.1 °F/min.
  if (inputs.plantCommand < 0.02 && Math.abs(load_btu) < config.capacityBtu * 0.02) {
    const driftTarget = inputs.outsideTemp;
    T_avg += (driftTarget - T_avg) * 0.0017 * dt; // ~0.1 °F/min toward OAT
  }

  // Distribute the loop's average temp across supply/return based on the
  // current load. At zero load, supply == return. At full load:
  //   ΔT = (load_btu) / (500 × flow_gpm)
  const deltaT_full = (Math.abs(load_btu) || 1) / (500 * flow_gpm);
  // Cap ΔT to a sane band so a transient overshoot doesn't blow up.
  const deltaT = Math.min(50, deltaT_full);

  const T_supply = isCooling ? T_avg - deltaT / 2 : T_avg + deltaT / 2;
  const T_return = isCooling ? T_avg + deltaT / 2 : T_avg - deltaT / 2;

  return {
    T_supply,
    T_return,
    flow_gpm,
    load_btu,
  };
}

/** Sensible cold-start state for a HW loop (just turned on, ambient water). */
export function initLoopState(_config: LoopConfig, ambientTemp: number = 70): LoopState {
  return {
    T_supply: ambientTemp,
    T_return: ambientTemp,
    flow_gpm: 0,
    load_btu: 0,
  };
}

/** Convenience: standard HW config for a mid-size condensing boiler
 *  (1,500 MBH, 100 GPM, ~500 gallons of system water). */
export const HW_LOOP_DEFAULTS: LoopConfig = {
  kind: 'hot-water',
  designSupplyTemp: 180,
  designReturnTemp: 160,
  designFlowGpm: 100,
  capacityBtu: 1_500_000,
  loopMassLbs: 500 * 8.33,
};

/** Standard CHW config for a 150-ton air-cooled chiller. */
export const CHW_LOOP_DEFAULTS: LoopConfig = {
  kind: 'chilled-water',
  designSupplyTemp: 44,
  designReturnTemp: 56,
  designFlowGpm: 360, // ~2.4 GPM/ton
  capacityBtu: 150 * 12_000, // 150 tons × 12,000 BTU/hr/ton
  loopMassLbs: 800 * 8.33,
};
