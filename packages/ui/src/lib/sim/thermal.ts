// Single-zone thermal sim with a PI cooling controller.
//
// Model:
//   dT_zone/dt = (T_OA - T_zone) / tau    [envelope drift toward outdoor air]
//                - actuator * coolingMax   [cooling delivered by the VAV/AHU]
//
// Controller: PI with anti-windup, output clamped to [0, 1].
//   error = T_zone - setpoint
//   integral += error * dt  (skip when output saturated against the error)
//   actuator = clamp(Kp * error + Ki * integral, 0, 1)
//
// All temperatures in °F. Time in seconds. One step = `dt` seconds of
// simulated time. The UI ticks at 1 Hz wall-clock but `dt` is sim-time per
// tick (default 60 s = 1 simulated minute), so 10 wall seconds shows about
// 10 minutes of zone response.

export interface Sample {
  /** Tick number (1-indexed). */
  readonly t: number;
  /** Zone temperature, °F. */
  readonly T_zone: number;
  /** Outdoor air temperature, °F. */
  readonly T_OA: number;
  /** Setpoint, °F. */
  readonly setpoint: number;
  /** Actuator output, 0..1. */
  readonly actuator: number;
}

export interface SingleZoneConfig {
  /** Thermal time constant (seconds). Larger = slower envelope response. */
  tau: number;
  /** Max cooling rate at actuator = 1 (°F per second). */
  coolingMax: number;
  /** Initial zone temperature (°F). */
  initialZone: number;
  /** Outdoor air temperature, treated as a constant disturbance (°F). */
  outdoorAir: number;
  /** Setpoint (°F). */
  setpoint: number;
  /** Proportional gain. Units: actuator-fraction per °F of error. */
  Kp: number;
  /** Integral gain. Units: actuator-fraction per (°F·second) of accumulated error. */
  Ki: number;
  /** Sim time step per tick (seconds). */
  dt: number;
  /** History window length (number of samples retained). */
  historyLength: number;
}

export const DEFAULT_CONFIG: SingleZoneConfig = {
  tau: 600, // 10-min time constant
  coolingMax: 0.04, // 2.4 °F/min at full cooling
  initialZone: 76, // start 4°F above setpoint so first tick shows action
  outdoorAir: 92,
  setpoint: 72,
  Kp: 0.3,
  Ki: 0.001,
  dt: 60, // 1 sim minute per tick
  historyLength: 60,
};

export class SingleZoneSystem {
  T_zone: number;
  actuator: number;
  integral: number;
  history: Sample[] = [];
  tick = 0;

  constructor(readonly config: SingleZoneConfig = DEFAULT_CONFIG) {
    this.T_zone = config.initialZone;
    this.actuator = 0;
    this.integral = 0;
  }

  step(): Sample {
    const { tau, coolingMax, setpoint, Kp, Ki, dt, outdoorAir } = this.config;

    // 1) Thermal (explicit Euler — fine for dt/tau ≤ 0.1)
    const drift = (outdoorAir - this.T_zone) / tau;
    const cooling = -this.actuator * coolingMax;
    this.T_zone += dt * (drift + cooling);

    // 2) PI with anti-windup
    const error = this.T_zone - setpoint;
    const candidate = Kp * error + Ki * this.integral;
    const next = Math.max(0, Math.min(1, candidate));
    // Only integrate when not pushing further into a saturated direction.
    const saturatedHigh = next >= 1 && error > 0;
    const saturatedLow = next <= 0 && error < 0;
    if (!saturatedHigh && !saturatedLow) {
      this.integral += error * dt;
    }
    this.actuator = next;

    // 3) Record
    this.tick++;
    const sample: Sample = {
      t: this.tick,
      T_zone: this.T_zone,
      T_OA: outdoorAir,
      setpoint,
      actuator: this.actuator,
    };
    this.history.push(sample);
    if (this.history.length > this.config.historyLength) {
      this.history.shift();
    }
    return sample;
  }

  reset(): void {
    this.T_zone = this.config.initialZone;
    this.actuator = 0;
    this.integral = 0;
    this.history = [];
    this.tick = 0;
  }
}
