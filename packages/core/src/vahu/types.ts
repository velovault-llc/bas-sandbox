// vAHU — virtual single-zone VAV air-handling-unit controller.
//
// Implements ASHRAE Guideline 36 §5.18 (single-zone VAV AHU) at a
// fidelity sufficient to show the sequence of operation working:
// mode transitions, economizer enable, supply-air-temp setpoint
// reset, heating/cooling valve PI control, OA damper minimum
// position. Not a CFD-grade thermodynamic model; the mixing math
// is first-order and the PI loops are textbook.
//
// Why this module exists: the sandbox previously had "virtual
// controllers" that were node shapes without any actual control
// logic. Dropping a `vAHU` now puts a real sequence on the canvas
// — read OAT/MAT/RAT, decide a mode, modulate dampers/valves,
// produce a DAT. Everything the controller "does" surfaces as
// BACnet objects, so the packet log shows realistic activity.

/** AHU operating modes per G36 §5.18.1. We map "Setup" / "Setback"
 *  together as 'unoccupied' for the v1 — the difference is just
 *  setpoint band selection, not sequence structure. */
export type VAhuMode =
  | 'off'
  /** Occupied + heating loop active (DAT > MAT). */
  | 'heating'
  /** Occupied + cooling loop active (DAT < MAT). */
  | 'cooling'
  /** Free-cooling: OA damper modulating, no mechanical cooling. */
  | 'economizer'
  /** Unoccupied night cycle. */
  | 'unoccupied';

/** Static config — the dials a commissioning agent would set. */
export interface VAhuConfig {
  /** Occupied zone temp setpoint (°F). G36 default 70-72. */
  readonly zoneSetpoint: number;
  /** Discharge-air-temp setpoint when cooling (°F). G36 default 55. */
  readonly satCoolSetpoint: number;
  /** Discharge-air-temp setpoint when heating (°F). G36 default 95. */
  readonly satHeatSetpoint: number;
  /** OA temp above which the economizer is locked out (°F).
   *  G36 §5.18.2 — typical fixed dry-bulb high limit = 65°F in
   *  most US climates. */
  readonly econHighLimitOAT: number;
  /** Minimum OA damper position during occupied periods, percent.
   *  Set by ventilation code (ASHRAE 62.1) — typical 15-25%. */
  readonly minOaDamperPctOccupied: number;
  /** PI gains for the heating/cooling valve loops. Tuned moderate. */
  readonly piKp: number;
  readonly piKi: number;
  /** Supply fan max airflow expressed as 0-1 normalized speed.
   *  The VFD modulates between 30% and 100% during occupied. */
  readonly fanMinSpeed: number;
  readonly fanMaxSpeed: number;
}

export const DEFAULT_VAHU_CONFIG: VAhuConfig = {
  zoneSetpoint: 72,
  satCoolSetpoint: 55,
  satHeatSetpoint: 95,
  econHighLimitOAT: 65,
  minOaDamperPctOccupied: 20,
  piKp: 3.5,
  piKi: 0.04,
  fanMinSpeed: 0.30,
  fanMaxSpeed: 1.0,
};

/** Per-tick sensor inputs an AHU normally has. */
export interface VAhuInputs {
  /** Outside air temp (°F). */
  readonly oat: number;
  /** Return air temp (°F) — usually ≈ zone temp on a single-zone unit. */
  readonly rat: number;
  /** Current zone temp (°F). */
  readonly zoneTemp: number;
  /** True during scheduled occupied period. G36 §5.18.1 uses this
   *  to switch between Occupied and Unoccupied mode families. */
  readonly occupied: boolean;
}

/** AHU's running state — what the controller "remembers" between ticks. */
export interface VAhuState {
  readonly mode: VAhuMode;
  /** Discharge-air-temp setpoint after Trim-and-Respond reset.
   *  G36 §5.18.6: starts at satCoolSetpoint, trims down or responds
   *  up based on zone temp error. For the v1 we hold it at the
   *  base setpoint without TR. */
  readonly satSetpoint: number;
  /** Outside-air damper position, 0-100%. */
  readonly oaDamperPct: number;
  /** Heating valve position, 0-100%. */
  readonly heatValvePct: number;
  /** Cooling valve position, 0-100%. */
  readonly coolValvePct: number;
  /** Supply fan speed, 0-1 normalized (VFD command). */
  readonly fanSpeed: number;
  /** PI integrator state — kept separate per loop. */
  readonly heatPiIntegrator: number;
  readonly coolPiIntegrator: number;
  /** Last MAT computed (°F). Held for display + BACnet exposure. */
  readonly mat: number;
  /** Last DAT computed (°F). */
  readonly dat: number;
  /** Sim-second timestamp of the last step — used for dt. */
  readonly lastStepSec: number;
}

export function initVAhuState(simSec: number, config: VAhuConfig = DEFAULT_VAHU_CONFIG): VAhuState {
  return {
    mode: 'off',
    satSetpoint: config.satCoolSetpoint,
    oaDamperPct: config.minOaDamperPctOccupied,
    heatValvePct: 0,
    coolValvePct: 0,
    fanSpeed: 0,
    heatPiIntegrator: 0,
    coolPiIntegrator: 0,
    mat: 70,
    dat: 70,
    lastStepSec: simSec,
  };
}
