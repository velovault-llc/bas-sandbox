// Signal-level fidelity for BAS field wiring.
//
// Real BAS sensors don't put engineering units on the wire — they put
// current (mA), voltage (V), or resistance (Ω). The controller's terminal
// is configured (jumper, software, or board personality) to interpret that
// raw signal as a particular kind of sensor, then scales it to engineering
// units the program reads.
//
// Three things commissioning techs run into in the field that the sandbox
// needs to model honestly:
//
//   1. Live-zero signals (4-20mA, 2-10V) — a broken wire reads 0mA/0V,
//      which is OUTSIDE the live range, so the controller can detect "wire
//      broken" vs "sensor reads minimum." This is why 4-20mA is the
//      industrial standard.
//
//   2. Mismatched terminal config — you wire a 4-20mA CO₂ sensor into a
//      universal input configured as Pt1000. The controller doesn't error.
//      It happily reads the current as if it were a resistance and gives
//      you a wrong but plausible number. THIS is the #1 commissioning
//      mistake — silent misconfiguration that produces a number that
//      looks fine until the loop won't tune.
//
//   3. Faults — open circuit (broken wire), short circuit (chafed wire),
//      over-range / under-range (sensor reads outside calibration).
//
// This module is the math. The sim loop calls `engToSignal` on the sensor
// side and `signalToEng` on the controller side, with a per-terminal
// `TerminalConfig` in between. When the kinds line up, the result matches
// engineering value through the round-trip; when they don't, the
// controller gets a wrong number AND a `mismatch` flag the UI can surface.

import type { SensorSignal } from '../equipment/sensors.js';

/** Physical signal kind on the wire. The shape of what a multimeter reads. */
export type SignalKind =
  | 'current-ma'      // 4-20mA, 0-20mA — current loops
  | 'voltage-v'       // 0-10V, 2-10V, 0-5V — voltage outputs
  | 'resistance-ohms' // RTDs (Pt100, Pt1000), thermistors — passive resistive
  | 'binary'          // dry contact — closed (0Ω) or open (∞Ω)
  | 'bacnet-network'; // digital point — no analog signal, value passes through

/** Possible fault state on a signal — same fault names whether seen by the
 *  sensor (cause) or the controller (effect). */
export type SignalFault =
  | 'open-circuit'   // wire broken or sensor unplugged
  | 'short-circuit'  // wire chafed to ground/common
  | 'over-range'     // signal above the live range
  | 'under-range';   // signal below the live range

export interface RawSignal {
  readonly kind: SignalKind;
  /** Numeric value in the signal's native units (mA, V, Ω, or 0/1 for binary,
   *  or engineering value for bacnet-network where there's no wire-level
   *  representation). */
  readonly value: number;
  /** Optional fault tag carried with the signal. Sensor-side faults
   *  propagate through to the controller; controller-side fault detection
   *  may add additional tags during scaling. */
  readonly fault?: SignalFault;
}

/** How a universal input is configured. The same physical terminal can be
 *  interpreted multiple ways depending on jumpers / software config — this
 *  is the "input type" setting on every BAS controller's point list. */
export type TerminalInputType =
  | 'rtd-pt1000'
  | 'rtd-pt100'
  | 'rtd-ni1000'
  | 'thermistor-10k-t2'
  | 'thermistor-10k-t3'
  | 'thermistor-20k'
  | 'analog-0-10v'
  | 'analog-2-10v'
  | 'analog-0-5v'
  | 'analog-4-20ma'
  | 'analog-0-20ma'
  | 'binary-dry';

export interface TerminalConfig {
  readonly inputType: TerminalInputType;
  /** Engineering-units range the controller expects this terminal to span.
   *  For an RTD/thermistor the controller doesn't really care — it scales
   *  from R via the curve — but for any analog signal this is the user's
   *  "0V/4mA = engMin, 10V/20mA = engMax" configuration. */
  readonly engMin: number;
  readonly engMax: number;
}

export interface ScaledReading {
  /** Engineering value the program sees on env.inputs.<key>. */
  readonly value: number;
  /** Set when the controller detects a fault (or one propagated from the
   *  sensor side). Programs that care about fault states would read this. */
  readonly fault?: SignalFault;
  /** True when the raw signal's kind doesn't match the configured input
   *  type. The controller still produces a number; the value is "wrong but
   *  plausible" — exactly what real techs see when they wire a 4-20mA
   *  sensor into a Pt1000-configured terminal. */
  readonly mismatch?: boolean;
}

// ── Sensor side: engineering value → raw signal ──────────────────────────

/** Encode an engineering value as the raw signal a sensor of that signal
 *  type would put on the wire. Pure function; deterministic.
 *
 *  When `fault` is provided, the signal value is replaced with the
 *  characteristic fault reading for the signal type (e.g., 0mA for an
 *  open-circuited 4-20mA loop). */
export function engToSignal(
  engValue: number,
  signal: SensorSignal,
  range: readonly [number, number],
  fault?: SignalFault,
): RawSignal {
  if (fault === 'open-circuit') return openCircuit(signal);
  if (fault === 'short-circuit') return shortCircuit(signal);

  const [eMin, eMax] = range;
  const span = eMax - eMin || 1;
  const frac = (engValue - eMin) / span; // 0..1 within range

  switch (signal) {
    case 'analog-4-20ma':
      return { kind: 'current-ma', value: 4 + frac * 16 };
    case 'analog-0-10v':
      return { kind: 'voltage-v', value: frac * 10 };
    case 'analog-2-10v':
      return { kind: 'voltage-v', value: 2 + frac * 8 };
    case 'analog-0-5v':
      return { kind: 'voltage-v', value: frac * 5 };
    case 'rtd-pt1000':
    case 'rtd-pt100': {
      // Engineering value is in °F per the catalog convention (BAPI/JCI both
      // ship °F-labeled product literature for the US market). Convert to °C
      // then apply linear RTD curve: R = R0·(1 + α·T).
      const tempC = fahrenheitToCelsius(engValue);
      const R0 = signal === 'rtd-pt1000' ? 1000 : 100;
      return { kind: 'resistance-ohms', value: R0 * (1 + RTD_ALPHA * tempC) };
    }
    case 'rtd-ni1000': {
      // Nickel-1000: same linear form, steeper coefficient (~6180 ppm/°C vs
      // platinum's 3850). R0 = 1000Ω at 0°C. This steeper slope is exactly
      // why a Ni1000 read by a Pt1000-configured terminal reads HIGH.
      const tempC = fahrenheitToCelsius(engValue);
      return { kind: 'resistance-ohms', value: 1000 * (1 + NICKEL_ALPHA * tempC) };
    }
    case 'thermistor-10k-t2':
    case 'thermistor-10k-t3':
    case 'thermistor-20k': {
      const tempC = fahrenheitToCelsius(engValue);
      const tempK = tempC + 273.15;
      const { r25, beta } = thermistorParams(signal);
      // Beta equation: R = R25·exp(β·(1/T - 1/T25))
      const R = r25 * Math.exp(beta * (1 / tempK - 1 / T25_K));
      return { kind: 'resistance-ohms', value: R };
    }
    case 'binary-dry':
      return { kind: 'binary', value: engValue >= 0.5 ? 1 : 0 };
    case 'bacnet-mstp':
      // Network point — no wire-level signal. Value passes through as-is.
      return { kind: 'bacnet-network', value: engValue };
  }
}

/** Open-circuit raw signal for a given sensor type — what the wire reads
 *  when the sensor is unplugged or the lead is broken. */
function openCircuit(signal: SensorSignal): RawSignal {
  switch (signal) {
    case 'analog-4-20ma':
      return { kind: 'current-ma', value: 0, fault: 'open-circuit' };
    case 'analog-0-10v':
    case 'analog-2-10v':
    case 'analog-0-5v':
      return { kind: 'voltage-v', value: 0, fault: 'open-circuit' };
    case 'rtd-pt1000':
    case 'rtd-pt100':
    case 'rtd-ni1000':
    case 'thermistor-10k-t2':
    case 'thermistor-10k-t3':
    case 'thermistor-20k':
      // Resistive sensors read infinite resistance when the lead is open.
      return { kind: 'resistance-ohms', value: Number.POSITIVE_INFINITY, fault: 'open-circuit' };
    case 'binary-dry':
      // For a dry contact "open" IS the normal state; we still tag the
      // fault so callers can distinguish "intentionally open" from
      // "wire broken."
      return { kind: 'binary', value: 0, fault: 'open-circuit' };
    case 'bacnet-mstp':
      return { kind: 'bacnet-network', value: 0, fault: 'open-circuit' };
  }
}

/** Short-circuit raw signal — what the wire reads when the lead is shorted
 *  to ground/common or the sensor element fails dead-short. */
function shortCircuit(signal: SensorSignal): RawSignal {
  switch (signal) {
    case 'analog-4-20ma':
      // A 4-20mA loop driver, when shorted past the load resistor, sees the
      // current saturate at compliance — model that as 20mA pinned at top.
      return { kind: 'current-ma', value: 20, fault: 'short-circuit' };
    case 'analog-0-10v':
    case 'analog-2-10v':
    case 'analog-0-5v':
      return { kind: 'voltage-v', value: 0, fault: 'short-circuit' };
    case 'rtd-pt1000':
    case 'rtd-pt100':
    case 'rtd-ni1000':
    case 'thermistor-10k-t2':
    case 'thermistor-10k-t3':
    case 'thermistor-20k':
      // Element shorted reads 0Ω — controller will compute an absurdly
      // cold (RTD) or absurdly hot (thermistor) temp depending on slope.
      return { kind: 'resistance-ohms', value: 0, fault: 'short-circuit' };
    case 'binary-dry':
      return { kind: 'binary', value: 1, fault: 'short-circuit' };
    case 'bacnet-mstp':
      return { kind: 'bacnet-network', value: 0, fault: 'short-circuit' };
  }
}

// ── Controller side: raw signal → engineering value ──────────────────────

/** Decode a raw signal at the controller terminal into an engineering
 *  value according to the terminal's configured input type. Pure function. */
export function signalToEng(raw: RawSignal, cfg: TerminalConfig): ScaledReading {
  const expectedKind = kindForTerminalInput(cfg.inputType);
  const span = cfg.engMax - cfg.engMin || 1;

  // ── Mismatch path ─────────────────────────────────────────────────────
  // Real controllers don't error when the signal kind doesn't match the
  // configured type — they apply the configured scaling to whatever number
  // the ADC produced. We mimic that by treating the raw value as if it
  // were in the configured signal's native span; the result is wrong but
  // looks like a valid sensor reading. This is the silent commissioning
  // failure mode worth surfacing.
  if (raw.kind !== expectedKind) {
    const refMax = referenceMaxFor(cfg.inputType);
    const refMin = referenceMinFor(cfg.inputType);
    const refSpan = refMax - refMin || 1;
    const fakeFrac = (raw.value - refMin) / refSpan;
    return {
      value: cfg.engMin + fakeFrac * span,
      mismatch: true,
      fault: raw.fault,
    };
  }

  // Sensor-side fault propagates straight through — controller still has
  // to come up with a number, so it pegs at one rail.
  const pegOnFault: ScaledReading | null =
    raw.fault === 'open-circuit'
      ? { value: pegValueForOpen(cfg), fault: 'open-circuit' }
      : raw.fault === 'short-circuit'
        ? { value: pegValueForShort(cfg), fault: 'short-circuit' }
        : null;
  if (pegOnFault) return pegOnFault;

  // ── Matched-kind decode ───────────────────────────────────────────────
  switch (cfg.inputType) {
    case 'analog-4-20ma': {
      if (raw.value < 3.5) {
        return { value: cfg.engMin, fault: 'under-range' };
      }
      if (raw.value > 20.5) {
        return { value: cfg.engMax, fault: 'over-range' };
      }
      return { value: cfg.engMin + ((raw.value - 4) / 16) * span };
    }
    case 'analog-0-20ma': {
      if (raw.value < 0) return { value: cfg.engMin, fault: 'under-range' };
      if (raw.value > 20.5) return { value: cfg.engMax, fault: 'over-range' };
      return { value: cfg.engMin + (raw.value / 20) * span };
    }
    case 'analog-0-10v': {
      if (raw.value < 0) return { value: cfg.engMin, fault: 'under-range' };
      if (raw.value > 10.5) return { value: cfg.engMax, fault: 'over-range' };
      return { value: cfg.engMin + (raw.value / 10) * span };
    }
    case 'analog-2-10v': {
      if (raw.value < 1.8) return { value: cfg.engMin, fault: 'under-range' };
      if (raw.value > 10.5) return { value: cfg.engMax, fault: 'over-range' };
      return { value: cfg.engMin + ((raw.value - 2) / 8) * span };
    }
    case 'analog-0-5v': {
      if (raw.value < 0) return { value: cfg.engMin, fault: 'under-range' };
      if (raw.value > 5.25) return { value: cfg.engMax, fault: 'over-range' };
      return { value: cfg.engMin + (raw.value / 5) * span };
    }
    case 'rtd-pt1000':
    case 'rtd-pt100': {
      if (!Number.isFinite(raw.value) || raw.value > 5000) {
        return { value: cfg.engMax, fault: 'over-range' };
      }
      if (raw.value < 50) {
        return { value: cfg.engMin, fault: 'under-range' };
      }
      const R0 = cfg.inputType === 'rtd-pt1000' ? 1000 : 100;
      const tempC = (raw.value / R0 - 1) / RTD_ALPHA;
      return { value: celsiusToFahrenheit(tempC) };
    }
    case 'rtd-ni1000': {
      if (!Number.isFinite(raw.value) || raw.value > 5000) {
        return { value: cfg.engMax, fault: 'over-range' };
      }
      if (raw.value < 50) {
        return { value: cfg.engMin, fault: 'under-range' };
      }
      const tempC = (raw.value / 1000 - 1) / NICKEL_ALPHA;
      return { value: celsiusToFahrenheit(tempC) };
    }
    case 'thermistor-10k-t2':
    case 'thermistor-10k-t3':
    case 'thermistor-20k': {
      if (!Number.isFinite(raw.value) || raw.value > 1_000_000) {
        return { value: cfg.engMin, fault: 'over-range' }; // open = very cold to NTC
      }
      if (raw.value <= 0) {
        return { value: cfg.engMax, fault: 'under-range' }; // short = very hot to NTC
      }
      const { r25, beta } = thermistorParams(termInputToSignal(cfg.inputType));
      // Inverse of R = R25·exp(β(1/T - 1/T25))
      const invT = 1 / T25_K + Math.log(raw.value / r25) / beta;
      const tempK = 1 / invT;
      const tempC = tempK - 273.15;
      return { value: celsiusToFahrenheit(tempC) };
    }
    case 'binary-dry':
      return { value: raw.value >= 0.5 ? 1 : 0 };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Default terminal config for a sensor of the given signal type and
 *  measurement range. The controller side defaults to expecting exactly
 *  the signal the sensor produces — so a freshly-imported scenario behaves
 *  identically to pre-signal-fidelity behavior. The user can override
 *  later via the UI (session 2). */
export function defaultTerminalConfig(
  signal: SensorSignal,
  range: readonly [number, number],
): TerminalConfig {
  return {
    inputType: defaultInputTypeFor(signal),
    engMin: range[0],
    engMax: range[1],
  };
}

/** Map a sensor's emitted signal type to the matching terminal input type
 *  (when one exists). Used to default a terminal config. */
export function defaultInputTypeFor(signal: SensorSignal): TerminalInputType {
  switch (signal) {
    case 'rtd-pt1000': return 'rtd-pt1000';
    case 'rtd-pt100': return 'rtd-pt100';
    case 'rtd-ni1000': return 'rtd-ni1000';
    case 'thermistor-10k-t2': return 'thermistor-10k-t2';
    case 'thermistor-10k-t3': return 'thermistor-10k-t3';
    case 'thermistor-20k': return 'thermistor-20k';
    case 'analog-0-10v': return 'analog-0-10v';
    case 'analog-2-10v': return 'analog-2-10v';
    case 'analog-0-5v': return 'analog-0-5v';
    case 'analog-4-20ma': return 'analog-4-20ma';
    case 'binary-dry': return 'binary-dry';
    case 'bacnet-mstp': return 'analog-0-10v'; // not really applicable, harmless default
  }
}

/** What kind of physical signal a terminal input type expects. */
export function kindForTerminalInput(t: TerminalInputType): SignalKind {
  switch (t) {
    case 'analog-4-20ma':
    case 'analog-0-20ma':
      return 'current-ma';
    case 'analog-0-10v':
    case 'analog-2-10v':
    case 'analog-0-5v':
      return 'voltage-v';
    case 'rtd-pt1000':
    case 'rtd-pt100':
    case 'rtd-ni1000':
    case 'thermistor-10k-t2':
    case 'thermistor-10k-t3':
    case 'thermistor-20k':
      return 'resistance-ohms';
    case 'binary-dry':
      return 'binary';
  }
}

/** What kind of physical signal a sensor's signal type produces. */
export function kindForSensorSignal(s: SensorSignal): SignalKind {
  switch (s) {
    case 'analog-4-20ma':
      return 'current-ma';
    case 'analog-0-10v':
    case 'analog-2-10v':
    case 'analog-0-5v':
      return 'voltage-v';
    case 'rtd-pt1000':
    case 'rtd-pt100':
    case 'rtd-ni1000':
    case 'thermistor-10k-t2':
    case 'thermistor-10k-t3':
    case 'thermistor-20k':
      return 'resistance-ohms';
    case 'binary-dry':
      return 'binary';
    case 'bacnet-mstp':
      return 'bacnet-network';
  }
}

/** Top of the native-units span for a terminal type. Used when the raw
 *  signal kind doesn't match — we use the configured terminal's expected
 *  span to fake-scale the wrong-kind value. */
function referenceMaxFor(t: TerminalInputType): number {
  switch (t) {
    case 'analog-4-20ma': return 20;
    case 'analog-0-20ma': return 20;
    case 'analog-0-10v': return 10;
    case 'analog-2-10v': return 10;
    case 'analog-0-5v': return 5;
    case 'rtd-pt1000': return 1500;     // ~120°C
    case 'rtd-pt100': return 150;       // ~120°C
    case 'rtd-ni1000': return 1742;     // ~120°C (steeper nickel curve)
    case 'thermistor-10k-t2': return 30000;
    case 'thermistor-10k-t3': return 30000;
    case 'thermistor-20k': return 60000;
    case 'binary-dry': return 1;
  }
}

function referenceMinFor(t: TerminalInputType): number {
  switch (t) {
    case 'analog-4-20ma': return 4;
    case 'analog-2-10v': return 2;
    default: return 0;
  }
}

/** Where the controller will peg the eng value when the sensor is open. */
function pegValueForOpen(cfg: TerminalConfig): number {
  switch (cfg.inputType) {
    case 'analog-4-20ma':
    case 'analog-2-10v':
      // Live-zero — a clean "wire broken" detection. Peg at engMin and tag.
      return cfg.engMin;
    case 'rtd-pt1000':
    case 'rtd-pt100':
    case 'rtd-ni1000':
      // Open RTD reads ∞ → infinitely high temp → peg at engMax.
      return cfg.engMax;
    case 'thermistor-10k-t2':
    case 'thermistor-10k-t3':
    case 'thermistor-20k':
      // NTC: ∞Ω → coldest possible → peg at engMin.
      return cfg.engMin;
    default:
      return cfg.engMin;
  }
}

function pegValueForShort(cfg: TerminalConfig): number {
  switch (cfg.inputType) {
    case 'rtd-pt1000':
    case 'rtd-pt100':
    case 'rtd-ni1000':
      // Short → 0Ω → coldest possible (formula goes very negative).
      return cfg.engMin;
    case 'thermistor-10k-t2':
    case 'thermistor-10k-t3':
    case 'thermistor-20k':
      // Short → 0Ω → hottest possible.
      return cfg.engMax;
    default:
      return cfg.engMax;
  }
}

/** Used when decoding thermistors — map the terminal type back to a SensorSignal
 *  so we can look up its r25 / β. The mapping is unambiguous for thermistors. */
function termInputToSignal(t: TerminalInputType): SensorSignal {
  if (t === 'thermistor-10k-t2') return 'thermistor-10k-t2';
  if (t === 'thermistor-10k-t3') return 'thermistor-10k-t3';
  if (t === 'thermistor-20k') return 'thermistor-20k';
  // Caller should only invoke for thermistor types; default returned for type safety.
  return 'thermistor-10k-t2';
}

function thermistorParams(s: SensorSignal): { r25: number; beta: number } {
  // Catalog of NTC thermistor parameters. β values are vendor-typical:
  //   Type II ≈ 3950 (BAPI 10kΩ T2, Veris)
  //   Type III ≈ 3892 (JCI-compatible Honeywell 10kΩ T3)
  //   20kΩ ≈ 3950
  if (s === 'thermistor-10k-t3') return { r25: 10000, beta: 3892 };
  if (s === 'thermistor-20k') return { r25: 20000, beta: 3950 };
  return { r25: 10000, beta: 3950 }; // T2 default
}

// ── Constants ────────────────────────────────────────────────────────────

/** Temperature coefficient α for Pt100 / Pt1000 — DIN/IEC 60751 standard. */
const RTD_ALPHA = 0.00385;

/** Temperature coefficient α for Ni1000 nickel RTD — DIN 43760 (~6180
 *  ppm/°C average 0–100°C). Markedly steeper than platinum, which is why a
 *  nickel sensor read on a platinum-configured terminal reports high. */
const NICKEL_ALPHA = 0.00618;

/** Reference temperature for thermistor R25 spec, in Kelvin. 25°C = 298.15 K. */
const T25_K = 298.15;

function fahrenheitToCelsius(f: number): number {
  return ((f - 32) * 5) / 9;
}

function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}
