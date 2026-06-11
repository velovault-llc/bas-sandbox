import { describe, it, expect } from 'vitest';
import {
  stepLoop,
  initLoopState,
  HW_LOOP_DEFAULTS,
  CHW_LOOP_DEFAULTS,
} from '../src/sim/hydronic.js';

describe('Hot-water loop physics', () => {
  const cfg = HW_LOOP_DEFAULTS;

  it('cold start: T_supply = T_return = ambient', () => {
    const s = initLoopState(cfg, 70);
    expect(s.T_supply).toBe(70);
    expect(s.T_return).toBe(70);
    expect(s.flow_gpm).toBe(0);
  });

  it('boiler fires + pump running + no load → supply temp rises', () => {
    let s = initLoopState(cfg, 70);
    // 5 minutes of full firing, full flow, no load.
    for (let i = 0; i < 60; i++) {
      s = stepLoop(s, cfg, { plantCommand: 1, pumpCommand: 1, loadCommand: 0, outsideTemp: 30 }, 5);
    }
    expect(s.T_supply).toBeGreaterThan(70);
    // With 1.5 MBH heat into ~500 gal × 8.33 lb/gal = 4,165 lb water,
    // 5 minutes (1/12 hr) puts in 125,000 BTU. ΔT = 125,000 / 4,165 ≈ 30 °F.
    expect(s.T_supply).toBeGreaterThan(95);
    expect(s.T_supply).toBeLessThan(220); // sane upper bound
  });

  it('at steady state with matching plant+load, ΔT settles near design', () => {
    let s = initLoopState(cfg, 180);
    // Plant at 50%, load at 50%, full flow. Net = 0, T should hold; ΔT
    // reflects the load draw.
    for (let i = 0; i < 200; i++) {
      s = stepLoop(s, cfg, { plantCommand: 0.5, pumpCommand: 1, loadCommand: 0.5, outsideTemp: 50 }, 5);
    }
    // Supply > return for HW.
    expect(s.T_supply).toBeGreaterThan(s.T_return);
    // ΔT roughly matches 50% load: 750,000 BTU/hr / (500 × 100 GPM) = 15°F.
    const dT = s.T_supply - s.T_return;
    expect(dT).toBeGreaterThan(10);
    expect(dT).toBeLessThan(25);
  });

  it('cooling off: with no firing + no load, drifts toward OAT', () => {
    let s = initLoopState(cfg, 180);
    // 1 hour of nothing.
    for (let i = 0; i < 720; i++) {
      s = stepLoop(s, cfg, { plantCommand: 0, pumpCommand: 0, loadCommand: 0, outsideTemp: 50 }, 5);
    }
    expect(s.T_supply).toBeLessThan(180);
  });
});

describe('Chilled-water loop physics', () => {
  const cfg = CHW_LOOP_DEFAULTS;

  it('chiller stages + pump running + no load → supply temp drops', () => {
    let s = initLoopState(cfg, 70);
    for (let i = 0; i < 60; i++) {
      s = stepLoop(s, cfg, { plantCommand: 1, pumpCommand: 1, loadCommand: 0, outsideTemp: 95 }, 5);
    }
    expect(s.T_supply).toBeLessThan(70);
  });

  it('at steady state with matching plant+load, supply is below return', () => {
    let s = initLoopState(cfg, 44);
    for (let i = 0; i < 200; i++) {
      s = stepLoop(s, cfg, { plantCommand: 0.5, pumpCommand: 1, loadCommand: 0.5, outsideTemp: 85 }, 5);
    }
    // CHW supply < return.
    expect(s.T_supply).toBeLessThan(s.T_return);
  });
});

describe('OA lockout', () => {
  it('boiler locks out above 65°F changeover', () => {
    let s = initLoopState(HW_LOOP_DEFAULTS, 70);
    // Full firing command, hot summer outside.
    for (let i = 0; i < 60; i++) {
      s = stepLoop(s, HW_LOOP_DEFAULTS, { plantCommand: 1, pumpCommand: 1, loadCommand: 0, outsideTemp: 88 }, 5);
    }
    // Should NOT have warmed up — lockout overrides the command.
    expect(s.T_supply).toBeLessThan(110);
  });

  it('boiler fires normally below 65°F', () => {
    let s = initLoopState(HW_LOOP_DEFAULTS, 70);
    for (let i = 0; i < 60; i++) {
      s = stepLoop(s, HW_LOOP_DEFAULTS, { plantCommand: 1, pumpCommand: 1, loadCommand: 0, outsideTemp: 40 }, 5);
    }
    expect(s.T_supply).toBeGreaterThan(100);
  });

  it('chiller has no built-in lockout (runs year-round)', () => {
    let s = initLoopState(CHW_LOOP_DEFAULTS, 70);
    // Winter morning — chiller should still cool if commanded.
    for (let i = 0; i < 60; i++) {
      s = stepLoop(s, CHW_LOOP_DEFAULTS, { plantCommand: 1, pumpCommand: 1, loadCommand: 0, outsideTemp: 35 }, 5);
    }
    expect(s.T_supply).toBeLessThan(70);
  });
});

describe('Loop ΔT scales with load', () => {
  const cfg = HW_LOOP_DEFAULTS;

  it('higher load command produces higher ΔT', () => {
    let lo = initLoopState(cfg, 180);
    let hi = initLoopState(cfg, 180);
    for (let i = 0; i < 100; i++) {
      lo = stepLoop(lo, cfg, { plantCommand: 0.5, pumpCommand: 1, loadCommand: 0.25, outsideTemp: 50 }, 5);
      hi = stepLoop(hi, cfg, { plantCommand: 0.5, pumpCommand: 1, loadCommand: 0.85, outsideTemp: 50 }, 5);
    }
    const dTlo = lo.T_supply - lo.T_return;
    const dThi = hi.T_supply - hi.T_return;
    expect(dThi).toBeGreaterThan(dTlo);
  });
});

describe('Numerical stability at fast-forward tick sizes', () => {
  it('an IDLE loop stays bounded at dt=1800 s (regression: CHWS hit 1.6e+41 °F)', () => {
    // 30× sim speed × 60 s base dt = 1800 s ticks. The old linear
    // ambient-drift term had gain 0.0017×1800 = 3.06 → alternating-sign
    // exponential divergence on any idle plant. Exact exp relaxation
    // must converge toward OAT instead.
    let s = initLoopState(CHW_LOOP_DEFAULTS, 44);
    for (let i = 0; i < 500; i++) {
      s = stepLoop(s, CHW_LOOP_DEFAULTS, { plantCommand: 0, pumpCommand: 0, loadCommand: 0, outsideTemp: 92 }, 1800);
    }
    expect(Number.isFinite(s.T_supply)).toBe(true);
    expect(s.T_supply).toBeGreaterThan(40);
    expect(s.T_supply).toBeLessThan(100); // drifted toward OAT, not Andromeda
    // And it actually converges to ambient, not just stays finite.
    expect(Math.abs(((s.T_supply + s.T_return) / 2) - 92)).toBeLessThan(2);
  });

  it('a RUNNING chiller against an idle load floors at the freeze limit, not -1287 °F', () => {
    // Regression: full chiller command + 15% idle load at dt=1800 s
    // integrated the loop to -1287 °F. The evaporator envelope must
    // asymptote CHWS near its 36 °F freeze-protect floor.
    let s = initLoopState(CHW_LOOP_DEFAULTS, 70);
    for (let i = 0; i < 200; i++) {
      s = stepLoop(s, CHW_LOOP_DEFAULTS, { plantCommand: 1, pumpCommand: 1, loadCommand: 0.15, outsideTemp: 92 }, 1800);
    }
    expect(Number.isFinite(s.T_supply)).toBe(true);
    expect(s.T_supply).toBeGreaterThan(30);
    expect(s.T_supply).toBeLessThan(50);
  });

  it('a full-fire boiler with no load caps at the high limit, not past it', () => {
    let s = initLoopState(HW_LOOP_DEFAULTS, 70);
    for (let i = 0; i < 200; i++) {
      s = stepLoop(s, HW_LOOP_DEFAULTS, { plantCommand: 1, pumpCommand: 1, loadCommand: 0, outsideTemp: 30 }, 1800);
    }
    expect(s.T_supply).toBeLessThan(215);
    expect(s.T_supply).toBeGreaterThan(180);
  });

  it('idle HW loop at dt=1800 s converges the same way', () => {
    let s = initLoopState(HW_LOOP_DEFAULTS, 180);
    for (let i = 0; i < 500; i++) {
      s = stepLoop(s, HW_LOOP_DEFAULTS, { plantCommand: 0, pumpCommand: 0, loadCommand: 0, outsideTemp: 30 }, 1800);
    }
    expect(Number.isFinite(s.T_supply)).toBe(true);
    expect(Math.abs(((s.T_supply + s.T_return) / 2) - 30)).toBeLessThan(2);
  });
});
