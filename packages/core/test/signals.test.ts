import { describe, it, expect } from 'vitest';
import {
  engToSignal,
  signalToEng,
  defaultTerminalConfig,
  kindForSensorSignal,
  kindForTerminalInput,
} from '../src/sim/signals.js';
import type { TerminalConfig } from '../src/sim/signals.js';
import type { SensorSignal } from '../src/equipment/sensors.js';

describe('engToSignal', () => {
  it('4-20mA: encodes range mid-scale to 12 mA', () => {
    const r = engToSignal(1000, 'analog-4-20ma', [0, 2000]);
    expect(r.kind).toBe('current-ma');
    expect(r.value).toBeCloseTo(12, 3);
  });

  it('4-20mA: encodes 0% of range to 4 mA (live zero)', () => {
    const r = engToSignal(0, 'analog-4-20ma', [0, 2000]);
    expect(r.value).toBeCloseTo(4, 3);
  });

  it('4-20mA: encodes 100% of range to 20 mA', () => {
    const r = engToSignal(2000, 'analog-4-20ma', [0, 2000]);
    expect(r.value).toBeCloseTo(20, 3);
  });

  it('2-10V: live zero at 2 V', () => {
    const r = engToSignal(0, 'analog-2-10v', [0, 100]);
    expect(r.kind).toBe('voltage-v');
    expect(r.value).toBeCloseTo(2, 3);
  });

  it('0-10V: 50 % of range encodes to 5 V', () => {
    const r = engToSignal(50, 'analog-0-10v', [0, 100]);
    expect(r.value).toBeCloseTo(5, 3);
  });

  it('Pt1000: 72 °F → ~1085 Ω', () => {
    // 72°F = 22.22°C; R = 1000·(1 + 0.00385·22.22) = 1085.6 Ω
    const r = engToSignal(72, 'rtd-pt1000', [-40, 250]);
    expect(r.kind).toBe('resistance-ohms');
    expect(r.value).toBeCloseTo(1085.6, 0);
  });

  it('Pt1000: 32 °F (ice point) = 1000 Ω', () => {
    const r = engToSignal(32, 'rtd-pt1000', [-40, 250]);
    expect(r.value).toBeCloseTo(1000, 1);
  });

  it('Pt100: 32 °F (ice point) = 100 Ω', () => {
    const r = engToSignal(32, 'rtd-pt100', [-40, 250]);
    expect(r.value).toBeCloseTo(100, 2);
  });

  it('Ni1000: 32 °F (ice point) = 1000 Ω', () => {
    const r = engToSignal(32, 'rtd-ni1000', [-40, 250]);
    expect(r.kind).toBe('resistance-ohms');
    expect(r.value).toBeCloseTo(1000, 1);
  });

  it('Ni1000 climbs steeper than Pt1000 above the ice point', () => {
    // Same temperature, nickel's higher coefficient → more ohms.
    const ni = engToSignal(150, 'rtd-ni1000', [-40, 250]).value;
    const pt = engToSignal(150, 'rtd-pt1000', [-40, 250]).value;
    expect(ni).toBeGreaterThan(pt);
  });

  it('10kΩ T2 thermistor: 77 °F (25 °C) = ~10 000 Ω', () => {
    const r = engToSignal(77, 'thermistor-10k-t2', [-40, 250]);
    expect(r.value).toBeCloseTo(10000, -1);
  });

  it('10kΩ T2 thermistor: NTC — colder reads HIGHER resistance', () => {
    const cold = engToSignal(32, 'thermistor-10k-t2', [-40, 250]).value;
    const warm = engToSignal(77, 'thermistor-10k-t2', [-40, 250]).value;
    const hot = engToSignal(140, 'thermistor-10k-t2', [-40, 250]).value;
    expect(cold).toBeGreaterThan(warm);
    expect(warm).toBeGreaterThan(hot);
  });

  it('binary-dry: maps occupancy 1/0 to wire state', () => {
    expect(engToSignal(1, 'binary-dry', [0, 1]).value).toBe(1);
    expect(engToSignal(0, 'binary-dry', [0, 1]).value).toBe(0);
  });
});

describe('engToSignal — fault modes', () => {
  it('open-circuit on 4-20mA reads 0 mA', () => {
    const r = engToSignal(1000, 'analog-4-20ma', [0, 2000], 'open-circuit');
    expect(r.value).toBe(0);
    expect(r.fault).toBe('open-circuit');
  });

  it('open-circuit on 2-10V reads 0 V (below live zero)', () => {
    const r = engToSignal(50, 'analog-2-10v', [0, 100], 'open-circuit');
    expect(r.value).toBe(0);
    expect(r.fault).toBe('open-circuit');
  });

  it('open-circuit on Pt1000 reads infinite resistance', () => {
    const r = engToSignal(72, 'rtd-pt1000', [-40, 250], 'open-circuit');
    expect(r.value).toBe(Infinity);
    expect(r.fault).toBe('open-circuit');
  });

  it('short-circuit on RTD reads 0 Ω', () => {
    const r = engToSignal(72, 'rtd-pt1000', [-40, 250], 'short-circuit');
    expect(r.value).toBe(0);
    expect(r.fault).toBe('short-circuit');
  });
});

describe('signalToEng — matched-kind round-trip', () => {
  // For every analog signal type the catalog uses, round-trip eng → signal
  // → eng should preserve the engineering value to within sub-percent. This
  // proves the math is consistent in both directions.
  const cases: Array<{
    signal: SensorSignal;
    range: readonly [number, number];
    values: readonly number[];
  }> = [
    { signal: 'analog-4-20ma', range: [0, 2000], values: [0, 500, 1000, 1500, 2000] },
    { signal: 'analog-0-10v', range: [0, 100], values: [0, 25, 50, 75, 100] },
    { signal: 'analog-2-10v', range: [0, 100], values: [0, 25, 50, 75, 100] },
    { signal: 'analog-0-5v', range: [0, 100], values: [0, 25, 50, 75, 100] },
    { signal: 'rtd-pt1000', range: [-40, 250], values: [-40, 0, 32, 72, 200, 250] },
    { signal: 'rtd-pt100', range: [-40, 250], values: [-40, 0, 32, 72, 200, 250] },
    { signal: 'rtd-ni1000', range: [-40, 250], values: [-40, 0, 32, 72, 200, 250] },
    { signal: 'thermistor-10k-t2', range: [-40, 250], values: [0, 32, 72, 150, 200] },
    { signal: 'thermistor-10k-t3', range: [-40, 250], values: [0, 32, 72, 150, 200] },
    { signal: 'thermistor-20k', range: [-40, 250], values: [0, 32, 72, 150, 200] },
  ];

  for (const c of cases) {
    it(`${c.signal}: round-trips through range`, () => {
      const cfg = defaultTerminalConfig(c.signal, c.range);
      for (const v of c.values) {
        const raw = engToSignal(v, c.signal, c.range);
        const back = signalToEng(raw, cfg);
        expect(back.value).toBeCloseTo(v, 1);
        expect(back.fault).toBeUndefined();
        expect(back.mismatch).toBeUndefined();
      }
    });
  }
});

describe('signalToEng — mismatch (wrong terminal config)', () => {
  it('wires 4-20mA CO₂ sensor (900 ppm) into Pt1000-configured UI → wrong but plausible reading', () => {
    // Sensor produces a 4-20mA signal corresponding to 900 ppm CO₂.
    const raw = engToSignal(900, 'analog-4-20ma', [0, 2000]); // ~11.2 mA
    // Terminal mistakenly configured as Pt1000 with a -40..250 °F span.
    const wrongCfg: TerminalConfig = {
      inputType: 'rtd-pt1000',
      engMin: -40,
      engMax: 250,
    };
    const result = signalToEng(raw, wrongCfg);
    expect(result.mismatch).toBe(true);
    // The number is wrong, but NOT NaN — it looks like a temperature.
    expect(Number.isFinite(result.value)).toBe(true);
  });

  it('Ni1000 sensor on a Pt1000-configured terminal reads HIGH — the silent nickel/platinum miss', () => {
    // A nickel sensor at 72 °F puts ~1137 Ω on the wire. Both nickel and
    // platinum are resistive, so the controller never flags a kind-mismatch —
    // it just decodes 1137 Ω with the platinum curve and gets a too-high temp.
    const raw = engToSignal(72, 'rtd-ni1000', [-40, 250]);
    const ptCfg: TerminalConfig = { inputType: 'rtd-pt1000', engMin: -40, engMax: 250 };
    const result = signalToEng(raw, ptCfg);
    // Same signal kind (resistance) → no mismatch flag; this is why it's silent.
    expect(result.mismatch).toBeUndefined();
    expect(Number.isFinite(result.value)).toBe(true);
    // Reads meaningfully HIGH (≈96 °F instead of 72 °F).
    expect(result.value).toBeGreaterThan(85);
    // And configuring the terminal correctly as Ni1000 reads it right.
    const niCfg: TerminalConfig = { inputType: 'rtd-ni1000', engMin: -40, engMax: 250 };
    expect(signalToEng(raw, niCfg).value).toBeCloseTo(72, 0);
  });

  it('wires Pt1000 (1085 Ω at 72 °F) into 0-10V UI → wrong but plausible reading', () => {
    const raw = engToSignal(72, 'rtd-pt1000', [-40, 250]); // ~1085 Ω
    const wrongCfg: TerminalConfig = {
      inputType: 'analog-0-10v',
      engMin: 0,
      engMax: 100, // pretending it's a % RH sensor
    };
    const result = signalToEng(raw, wrongCfg);
    expect(result.mismatch).toBe(true);
    expect(Number.isFinite(result.value)).toBe(true);
  });

  it('flags mismatch but still returns a finite value (controller never errors)', () => {
    // Wire a binary dry contact (occupancy) into a 4-20mA terminal.
    const raw = engToSignal(1, 'binary-dry', [0, 1]);
    const wrongCfg: TerminalConfig = {
      inputType: 'analog-4-20ma',
      engMin: 0,
      engMax: 100,
    };
    const result = signalToEng(raw, wrongCfg);
    expect(result.mismatch).toBe(true);
    expect(Number.isFinite(result.value)).toBe(true);
  });
});

describe('signalToEng — sensor fault propagation', () => {
  it('open-circuit on 4-20mA pegs eng value at engMin and tags fault', () => {
    const raw = engToSignal(1000, 'analog-4-20ma', [0, 2000], 'open-circuit');
    const cfg = defaultTerminalConfig('analog-4-20ma', [0, 2000]);
    const result = signalToEng(raw, cfg);
    expect(result.fault).toBe('open-circuit');
    expect(result.value).toBe(0); // engMin
  });

  it('open-circuit on Pt1000 (∞ Ω) pegs at engMax (controller computes very high temp)', () => {
    const raw = engToSignal(72, 'rtd-pt1000', [-40, 250], 'open-circuit');
    const cfg = defaultTerminalConfig('rtd-pt1000', [-40, 250]);
    const result = signalToEng(raw, cfg);
    expect(result.fault).toBe('open-circuit');
    expect(result.value).toBe(250); // engMax
  });

  it('open-circuit on 2-10V is detectable (drops below 2V live zero)', () => {
    const raw = engToSignal(50, 'analog-2-10v', [0, 100], 'open-circuit');
    const cfg = defaultTerminalConfig('analog-2-10v', [0, 100]);
    const result = signalToEng(raw, cfg);
    expect(result.fault).toBe('open-circuit');
  });

  it('short-circuit on thermistor (0 Ω) pegs at engMax (NTC reads very hot when shorted)', () => {
    const raw = engToSignal(72, 'thermistor-10k-t2', [-40, 250], 'short-circuit');
    const cfg = defaultTerminalConfig('thermistor-10k-t2', [-40, 250]);
    const result = signalToEng(raw, cfg);
    expect(result.fault).toBe('short-circuit');
    expect(result.value).toBe(250);
  });
});

describe('signalToEng — over/under-range without explicit fault', () => {
  it('detects under-range on 4-20mA (3 mA reads as broken)', () => {
    const raw = { kind: 'current-ma', value: 3, units: 'mA' } as const;
    const cfg = defaultTerminalConfig('analog-4-20ma', [0, 2000]);
    const result = signalToEng(raw, cfg);
    expect(result.fault).toBe('under-range');
  });

  it('detects over-range on 4-20mA (22 mA exceeds top of loop)', () => {
    const raw = { kind: 'current-ma', value: 22, units: 'mA' } as const;
    const cfg = defaultTerminalConfig('analog-4-20ma', [0, 2000]);
    const result = signalToEng(raw, cfg);
    expect(result.fault).toBe('over-range');
  });
});

describe('signal-kind helpers', () => {
  it('matches sensor signal kind to terminal kind for compatible types', () => {
    expect(kindForSensorSignal('analog-4-20ma')).toBe(kindForTerminalInput('analog-4-20ma'));
    expect(kindForSensorSignal('rtd-pt1000')).toBe(kindForTerminalInput('rtd-pt1000'));
    expect(kindForSensorSignal('binary-dry')).toBe(kindForTerminalInput('binary-dry'));
  });

  it('distinguishes incompatible types', () => {
    expect(kindForSensorSignal('analog-4-20ma')).not.toBe(kindForTerminalInput('rtd-pt1000'));
    expect(kindForSensorSignal('rtd-pt1000')).not.toBe(kindForTerminalInput('analog-0-10v'));
  });
});
