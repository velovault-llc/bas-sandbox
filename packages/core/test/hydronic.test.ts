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
