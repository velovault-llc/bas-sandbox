// Zone (room) thermal model.
//
// A zone is the physical space the BAS cares about — an office, a conf
// room, an open-plan floor. Each zone has its own thermal state that
// drifts based on:
//   1. Envelope loss   — heat conducting to/from OAT through exterior walls
//   2. Internal loads  — people, lights, equipment (all heat sources)
//   3. Solar gain      — windows (proxy: function of OAT + time-of-day)
//   4. Adjacent zones  — heat through interior walls (Session B.2)
//   5. Conditioned air — supply air from a VAV/AHU/FCU (Session B.4)
//
// Multi-zone modeling unlocks the commissioning scenarios where the
// air-side really matters: "south-facing zone overheats at 2pm,"
// "conf room is too cold because its VAV is undersized," "the lobby
// is freezing because of stack-effect infiltration." These are the
// problems real commissioning agents diagnose; modeling them in the
// sandbox makes the training meaningful.
//
// Thermodynamics again:
//   Q [BTU/hr] = mass × specific_heat × ΔT/Δt
// Air density 0.075 lb/ft³, Cp 0.24 BTU/lb·°F. But furniture + walls
// add a LOT of thermal capacitance — typical office thermal mass is
// ~5-10× the air alone. Use a "mass multiplier" to capture that.

export interface ZoneConfig {
  /** Volume in cubic feet. A typical 12'×14'×9' office is ~1500 ft³. */
  readonly volume_cu_ft: number;
  /** Floor area in square feet — drives sqft-based load calcs (lighting). */
  readonly floor_area_sqft: number;
  /** Exterior wall area in square feet — drives envelope loss. */
  readonly exterior_wall_area_sqft: number;
  /** Overall U-value (BTU/hr·ft²·°F) for the exterior walls + windows. */
  readonly exterior_u_value: number;
  /** Thermal mass multiplier — captures furniture, drywall, partition
   *  contribution beyond just the air mass. 1.0 = bare room, 8.0 = heavily
   *  furnished office. Default 5.0. */
  readonly mass_multiplier: number;
  /** Lighting power density, W/sqft. ~0.5 LED, ~2.0 older fluorescent. */
  readonly lighting_w_per_sqft: number;
  /** Equipment/plug load, W/sqft. ~1.0 typical office, ~5+ server room. */
  readonly equipment_w_per_sqft: number;
  /** Occupancy schedule + headcount (peak occupants). Sim derives current
   *  occupants from the schedule × peak. */
  readonly peak_occupants: number;
}

export interface ZoneState {
  readonly T_zone: number;
}

export interface ZoneInputs {
  /** Outside air temp (°F). */
  readonly outsideTemp: number;
  /** Sim hour of day, 0..24. */
  readonly hour: number;
  /** Occupancy multiplier — 0 = empty, 1 = peak. Use a schedule if
   *  modeling occupancy by time, or set to a manual override. */
  readonly occupancy_frac: number;
  /** Supply-air heat delivery (positive = heating, negative = cooling).
   *  BTU/hr. Wired by AHU/VAV coupling in Session B.4. */
  readonly supplyAir_btu_per_hr: number;
}

export const DEFAULT_ZONE_CONFIG: ZoneConfig = {
  volume_cu_ft: 1500,
  floor_area_sqft: 168,        // 12' × 14'
  exterior_wall_area_sqft: 108, // one 12' × 9' exterior wall
  exterior_u_value: 0.08,       // R-13 typical for newer commercial
  mass_multiplier: 5,
  lighting_w_per_sqft: 0.5,
  equipment_w_per_sqft: 1.0,
  peak_occupants: 2,
};

const BTU_PER_WATT = 3.412;
const BTU_PER_PERSON = 250; // sensible heat per occupant at typical activity

export function initZoneState(config: ZoneConfig, ambientTemp: number = 70): ZoneState {
  void config;
  return { T_zone: ambientTemp };
}

/** Standard occupancy schedule. Returns 0..1 multiplier on peak. */
export function defaultOccupancySchedule(hour: number): number {
  // Ramp up 6-7am, peak 8am-5pm, ramp down 5-7pm.
  if (hour < 6 || hour >= 19) return 0;
  if (hour < 7) return (hour - 6);
  if (hour < 17) return 1;
  if (hour < 19) return 1 - (hour - 17) / 2;
  return 0;
}

/** Advance a zone by `dt` seconds. Substeps internally when `dt` is large
 *  (fast-forward modes) to keep the explicit-Euler integration stable.
 *  Without substeps, a 1500-second tick at 300× speed makes wall heat-
 *  transfer overshoot the zone's thermal capacity and the temp explodes. */
export function stepZone(state: ZoneState, config: ZoneConfig, inputs: ZoneInputs, dt: number): ZoneState {
  const MAX_SUBSTEP_S = 60;
  if (dt > MAX_SUBSTEP_S) {
    const steps = Math.ceil(dt / MAX_SUBSTEP_S);
    const sub_dt = dt / steps;
    let s = state;
    for (let i = 0; i < steps; i++) s = stepZoneInner(s, config, inputs, sub_dt);
    return s;
  }
  return stepZoneInner(state, config, inputs, dt);
}

function stepZoneInner(state: ZoneState, config: ZoneConfig, inputs: ZoneInputs, dt: number): ZoneState {
  // 1. Envelope loss (BTU/hr). Positive Q means heat IN.
  const envelope_btu = -config.exterior_u_value * config.exterior_wall_area_sqft * (state.T_zone - inputs.outsideTemp);

  // 2. Internal loads. Lighting + equipment scale with occupancy (most
  // commercial buildings drop to ~10% baseline overnight for security
  // lighting + always-on equipment, then ramp to full at occupied).
  const occ_load_factor = 0.1 + 0.9 * inputs.occupancy_frac;
  const lighting_w = config.floor_area_sqft * config.lighting_w_per_sqft * occ_load_factor;
  const equipment_w = config.floor_area_sqft * config.equipment_w_per_sqft * occ_load_factor;
  const people_btu = config.peak_occupants * inputs.occupancy_frac * BTU_PER_PERSON;
  const internal_btu = (lighting_w + equipment_w) * BTU_PER_WATT + people_btu;

  // 3. Solar gain — proxy: more solar when OAT is warm AND mid-day.
  // Crude approximation good enough for v1; real implementation needs
  // orientation + cloud cover + window area.
  const solar_factor = inputs.hour > 6 && inputs.hour < 18
    ? Math.sin(((inputs.hour - 6) / 12) * Math.PI)
    : 0;
  const solar_btu = solar_factor * Math.max(0, inputs.outsideTemp - 50) * 6;

  // 4. Supply air delivery from coils (already in BTU/hr).
  const supply_btu = inputs.supplyAir_btu_per_hr;

  // Total net heat into the zone (BTU/hr).
  const net_btu = envelope_btu + internal_btu + solar_btu + supply_btu;

  // Apply over dt to compute ΔT.
  // Air mass = volume × 0.075 lb/ft³; effective mass = air × multiplier.
  // Cp of air ≈ 0.24 BTU/lb·°F. Guard against zero/negative inputs that
  // would NaN/Infinity the result (user can set floor_area=0 via the
  // inspector, which used to blow the sim up).
  const safe_volume = Math.max(50, config.volume_cu_ft);
  const safe_mass_mult = Math.max(1, config.mass_multiplier);
  const air_mass = safe_volume * 0.075;
  const effective_mass = air_mass * safe_mass_mult;
  const cp = 0.24;
  const dt_hours = dt / 3600;
  const raw_dT = (net_btu * dt_hours) / (effective_mass * cp);
  // Clamp per-substep ΔT to ±5°F. Real zones don't change temp faster
  // than this — anything bigger is numerical instability, not physics.
  const dT = Math.max(-5, Math.min(5, raw_dT));

  return { T_zone: state.T_zone + dT };
}
