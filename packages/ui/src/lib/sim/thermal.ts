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
  /** True zone temperature, °F (what the room actually is). */
  readonly T_zone: number;
  /** What the sensor reports to the controller, °F. Diverges from T_zone
   *  under fault. Equals T_zone when sensor is healthy. */
  readonly T_sensed: number;
  /** Outdoor air temperature, °F. */
  readonly T_OA: number;
  /** Setpoint, °F. */
  readonly setpoint: number;
  /** Actuator output, 0..1. */
  readonly actuator: number;
}

/**
 * Sensor fault modes — what a BAS tech actually sees in the field.
 *  - `open`: wire break / out-of-range high (RTD reads ~250°F max)
 *  - `short`: wire short / out-of-range low (~-40°F)
 *  - `stuck`: sensor frozen at last good value (firmware lockup or comm fail)
 *  - `drift`: slow bias creep — ~1°F per 10 simulated minutes
 */
/** Sensor fault mode. Each maps to a different physical failure pattern
 *  a field tech would see in the wild:
 *   - normal: true zone temp
 *   - open: wire break — RTD/thermistor reads full-scale high (~250°F)
 *   - short: wire short — full-scale low (~-40°F)
 *   - stuck: sensor frozen at last good value (firmware lockup, comm fail)
 *   - drift: slow bias creep — ~1°F per 10 simulated minutes
 *   - calibration: persistent offset bias (+5°F, e.g. installed in direct sun)
 *   - noise: high-frequency jitter around the true value (loose wiring, EMI)
 *   - intermittent: drops out every few seconds (loose terminal screw)
 *   - rail: pegged at one end of the scale (saturated, ADC stuck)
 */
export type SensorFault =
  | 'normal'
  | 'open'
  | 'short'
  | 'stuck'
  | 'drift'
  | 'calibration'
  | 'noise'
  | 'intermittent'
  | 'rail';

export interface SensorState {
  fault: SensorFault;
  /** Frozen reading active under `stuck` (°F). Captured on entering stuck. */
  stuckValue: number;
  /** Accumulated bias from `drift` (°F). Reset on returning to normal. */
  driftBias: number;
  /** Last reading the controller actually saw — drives ghost-on-canvas display. */
  lastReading: number;
  /** Persistent offset for `calibration` (°F). Defaults to +5. */
  calibrationOffset?: number;
  /** RMS amplitude of `noise` (°F). Defaults to 1.5. */
  noiseAmplitude?: number;
  /** Drop-out probability per tick under `intermittent` (0..1). Defaults to 0.15. */
  dropoutRate?: number;
  /** Rail end for `rail` fault — true zone is replaced by either 'high'
   *  (250°F) or 'low' (-40°F). Defaults to 'high'. */
  railEnd?: 'high' | 'low';
  /** Internal counter for intermittent drop-out hold state. */
  _intermittentHoldUntil?: number;
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
  /** Setpoint (°F). Used directly unless `schedule.enabled` overrides it. */
  setpoint: number;
  /** Proportional gain. Units: actuator-fraction per °F of error. */
  Kp: number;
  /** Integral gain. Units: actuator-fraction per (°F·second) of accumulated error. */
  Ki: number;
  /** Sim time step per tick (seconds). */
  dt: number;
  /** History window length (number of samples retained). */
  historyLength: number;
  /**
   * Optional occupancy schedule. When enabled, `setpoint` is computed each
   * tick from sim-time-of-day:
   *   - occupied hours → `occupiedSetpoint`
   *   - everything else (night setback) → `unoccupiedSetpoint`
   *
   * Sim time advances at `dt` sim-seconds per tick. occStartHour / occEndHour
   * are wall-clock hours (0-24) wrapping a midnight boundary if needed.
   */
  schedule?: {
    enabled: boolean;
    occupiedSetpoint: number;
    unoccupiedSetpoint: number;
    occStartHour: number;
    occEndHour: number;
  };
  /**
   * Two-zone thermal coupling factor (0..1). When > 0, this zone "feels" its
   * neighbors' temperatures — useful for modeling sibling VAVs that share an
   * AHU and bleed heat through return-air mixing or interior walls. The
   * canvas computes neighbor temps and writes them to `couplingNeighborTemp`
   * each tick; the model uses that value, weighted by this factor.
   *
   * 0 = isolated (current behavior). 0.3 = mild coupling (most realistic for
   * adjacent VAVs in an open floorplan). 1.0 = the neighbor's temp is as
   * dominant as the envelope itself.
   */
  couplingFactor?: number;
  /**
   * Controller mode: cool removes heat from the zone, heat adds it.
   * The PI logic flips its error sign accordingly so the actuator always
   * opens in the direction that drives sensed temp toward the setpoint.
   * Defaults to 'cool' so existing scenarios stay valid.
   */
  mode?: 'cool' | 'heat';
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

/**
 * Pick the active setpoint for this tick. Honors the optional occupancy
 * schedule — outside occupied hours, the unoccupied setpoint takes over
 * (night setback). Handles schedules that wrap midnight (e.g. 22:00–06:00).
 */
function effectiveSetpoint(config: SingleZoneConfig, simSeconds: number): number {
  const sched = config.schedule;
  if (!sched || !sched.enabled) return config.setpoint;
  const hourOfDay = (simSeconds / 3600) % 24;
  const { occStartHour: start, occEndHour: end } = sched;
  const occupied =
    start <= end ? hourOfDay >= start && hourOfDay < end : hourOfDay >= start || hourOfDay < end;
  return occupied ? sched.occupiedSetpoint : sched.unoccupiedSetpoint;
}

export class SingleZoneSystem {
  T_zone: number;
  actuator: number;
  integral: number;
  history: Sample[] = [];
  tick = 0;
  /** Sim-seconds elapsed since start. Drives the occupancy schedule. */
  simSeconds = 0;
  /**
   * Neighbor temp written by the canvas each tick when coupling is enabled.
   * `null` = isolated this tick; the model falls back to single-zone math.
   */
  couplingNeighborTemp: number | null = null;
  /** Sensor model the controller reads through. Mutated by setFault(). */
  sensor: SensorState = {
    fault: 'normal',
    stuckValue: 72,
    driftBias: 0,
    lastReading: 72,
  };
  /** Comm/trunk failure — sensor reading freezes at last good value, distinct
   *  from a sensor fault (which the device itself owns). Set by the canvas
   *  when reachability through the wires breaks. */
  offline = false;
  /** When set (0..1), the actuator is held at this value and the PI loop is
   *  bypassed. Mirrors a tech "commanding" a point in the BAS for testing or
   *  balancing. null = PI controls normally. */
  manualOverride: number | null = null;

  constructor(readonly config: SingleZoneConfig = DEFAULT_CONFIG) {
    this.T_zone = config.initialZone;
    this.actuator = 0;
    this.integral = 0;
    this.sensor.stuckValue = config.initialZone;
    this.sensor.lastReading = config.initialZone;
  }

  /**
   * Compute what the sensor reports right now from the true zone temp.
   * Fault modes mirror what a JCI Reliability property surfaces:
   *  open → 250°F (RTD/thermistor full-scale high)
   *  short → -40°F (full-scale low)
   *  stuck → the value captured when the fault was injected
   *  drift → true zone + accumulated bias
   */
  private senseZone(): number {
    // Comm fault wins over sensor faults — if we can't talk to the device,
    // the reading freezes at whatever we last heard, regardless of what's
    // happening on the device side.
    if (this.offline) return this.sensor.lastReading;
    switch (this.sensor.fault) {
      case 'open':
        return 250;
      case 'short':
        return -40;
      case 'stuck':
        return this.sensor.stuckValue;
      case 'drift':
        return this.T_zone + this.sensor.driftBias;
      case 'calibration':
        return this.T_zone + (this.sensor.calibrationOffset ?? 5);
      case 'noise': {
        // Gaussian-ish noise via central-limit summing of two uniforms.
        const amp = this.sensor.noiseAmplitude ?? 1.5;
        const u = (Math.random() + Math.random() - 1) * amp;
        return this.T_zone + u;
      }
      case 'intermittent': {
        // Drop-out: roughly `dropoutRate` of ticks the sensor pegs at
        // either rail or freezes — emulating a loose terminal screw
        // bouncing the contact. Holds the dropped state for a few
        // ticks at a time so the trace shows visible discontinuities.
        const rate = this.sensor.dropoutRate ?? 0.15;
        if (this.simSeconds < (this.sensor._intermittentHoldUntil ?? 0)) {
          return this.sensor.lastReading; // still in a drop-out
        }
        if (Math.random() < rate) {
          // Enter a 3-8 sim-second drop-out at a random rail.
          this.sensor._intermittentHoldUntil = this.simSeconds + 3 + Math.random() * 5;
          return Math.random() < 0.5 ? 250 : -40;
        }
        return this.T_zone;
      }
      case 'rail':
        return (this.sensor.railEnd ?? 'high') === 'low' ? -40 : 250;
      case 'normal':
      default:
        return this.T_zone;
    }
  }

  /** Update fault mode mid-run. Captures the current reading when entering stuck. */
  setFault(fault: SensorFault): void {
    if (fault === this.sensor.fault) return;
    if (fault === 'stuck') {
      // Freeze at whatever the controller last saw (so the freeze is visible
      // relative to where the trace is, not a jump).
      this.sensor.stuckValue = this.sensor.lastReading;
    }
    if (fault === 'normal') {
      // Clear accumulated drift bias so "fix the sensor" gives a clean slate.
      this.sensor.driftBias = 0;
    }
    this.sensor.fault = fault;
  }

  step(): Sample {
    const { tau, coolingMax, Kp, Ki, dt, outdoorAir } = this.config;
    const mode = this.config.mode ?? 'cool';
    // Setpoint is either the static config value or the scheduled value
    // (occupied vs. unoccupied) depending on schedule.enabled.
    const setpoint = effectiveSetpoint(this.config, this.simSeconds);

    // 1) Thermal (explicit Euler — fine for dt/tau ≤ 0.1).
    //    With coupling on, a fraction of the drift term is replaced by
    //    pull-toward-neighbor instead of pull-toward-OAT.
    //    Heat mode adds energy to the zone; cool mode removes it. Same
    //    config knob (`coolingMax`) is reused as the equipment's capacity,
    //    just signed by mode.
    const drift = (outdoorAir - this.T_zone) / tau;
    const couplingFactor = Math.max(0, Math.min(1, this.config.couplingFactor ?? 0));
    let couplingPull = 0;
    if (couplingFactor > 0 && this.couplingNeighborTemp !== null) {
      couplingPull = (couplingFactor * (this.couplingNeighborTemp - this.T_zone)) / tau;
    }
    const equipmentDelta = (mode === 'cool' ? -1 : +1) * this.actuator * coolingMax;
    this.T_zone += dt * (drift + equipmentDelta + couplingPull);

    // 2) Accumulate drift bias *before* sensing (so this tick already reflects it).
    //    Tuned so drift fault adds ~1°F per 10 sim-minutes (~600 sim-seconds).
    if (this.sensor.fault === 'drift') {
      this.sensor.driftBias += dt / 600;
    }

    // 3) PI with anti-windup, fed the *sensed* zone temp — this is the
    //    whole point of the sensor layer: the controller chases what the
    //    sensor says, not what the room actually is. Manual override
    //    short-circuits this — the actuator is held at the commanded value
    //    and the PI integral freezes so it doesn't wind up while the loop
    //    is open.
    //    In cool mode, positive error = "too hot, open actuator". In heat
    //    mode, positive error = "too cold, open actuator". The PI math is
    //    identical; only the sign of (sensed - setpoint) flips.
    const sensed = this.senseZone();
    this.sensor.lastReading = sensed;
    if (this.manualOverride !== null) {
      this.actuator = Math.max(0, Math.min(1, this.manualOverride));
    } else {
      const error = mode === 'cool' ? sensed - setpoint : setpoint - sensed;
      const candidate = Kp * error + Ki * this.integral;
      const next = Math.max(0, Math.min(1, candidate));
      // Only integrate when not pushing further into a saturated direction.
      const saturatedHigh = next >= 1 && error > 0;
      const saturatedLow = next <= 0 && error < 0;
      if (!saturatedHigh && !saturatedLow) {
        this.integral += error * dt;
      }
      this.actuator = next;
    }

    // 4) Record. simSeconds advances by dt so schedule lookup is monotonic.
    this.tick++;
    this.simSeconds += dt;
    const sample: Sample = {
      t: this.tick,
      T_zone: this.T_zone,
      T_sensed: sensed,
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
    this.sensor.driftBias = 0;
    this.sensor.stuckValue = this.config.initialZone;
    this.sensor.lastReading = this.config.initialZone;
    this.history = [];
    this.tick = 0;
    this.simSeconds = 0;
    this.couplingNeighborTemp = null;
  }
}
