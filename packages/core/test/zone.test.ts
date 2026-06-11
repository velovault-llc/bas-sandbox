import { describe, it, expect } from 'vitest';
import {
  stepZone,
  initZoneState,
  defaultOccupancySchedule,
  DEFAULT_ZONE_CONFIG,
} from '../src/sim/zone.js';

describe('Zone envelope physics', () => {
  it('cold OAT + no internal loads → zone temp drifts down', () => {
    let s = initZoneState(DEFAULT_ZONE_CONFIG, 72);
    for (let i = 0; i < 360; i++) { // 30 sim-minutes
      s = stepZone(s, DEFAULT_ZONE_CONFIG, {
        outsideTemp: 20,
        hour: 3,
        occupancy_frac: 0,
        supplyAir_btu_per_hr: 0,
      }, 5);
    }
    expect(s.T_zone).toBeLessThan(72);
  });

  it('warm OAT + no internal loads → zone temp drifts up', () => {
    let s = initZoneState(DEFAULT_ZONE_CONFIG, 72);
    for (let i = 0; i < 360; i++) {
      s = stepZone(s, DEFAULT_ZONE_CONFIG, {
        outsideTemp: 95,
        hour: 3,
        occupancy_frac: 0,
        supplyAir_btu_per_hr: 0,
      }, 5);
    }
    expect(s.T_zone).toBeGreaterThan(72);
  });

  it('full occupancy raises zone temp despite mild OAT', () => {
    let s = initZoneState(DEFAULT_ZONE_CONFIG, 72);
    for (let i = 0; i < 720; i++) { // 1 hour
      s = stepZone(s, DEFAULT_ZONE_CONFIG, {
        outsideTemp: 70,
        hour: 12,
        occupancy_frac: 1,
        supplyAir_btu_per_hr: 0,
      }, 5);
    }
    expect(s.T_zone).toBeGreaterThan(72);
  });

  it('cooling supply (negative BTU) keeps a hot zone from runaway warming', () => {
    let unc = initZoneState(DEFAULT_ZONE_CONFIG, 75); // uncooled comparison
    let cooled = initZoneState(DEFAULT_ZONE_CONFIG, 75);
    for (let i = 0; i < 720; i++) {
      unc = stepZone(unc, DEFAULT_ZONE_CONFIG, {
        outsideTemp: 95,
        hour: 14,
        occupancy_frac: 1,
        supplyAir_btu_per_hr: 0,
      }, 5);
      cooled = stepZone(cooled, DEFAULT_ZONE_CONFIG, {
        outsideTemp: 95,
        hour: 14,
        occupancy_frac: 1,
        supplyAir_btu_per_hr: -2500,
      }, 5);
    }
    // Cooled zone should be measurably cooler than uncooled.
    expect(cooled.T_zone).toBeLessThan(unc.T_zone);
  });

  it('heating supply (positive BTU) warms a cold zone', () => {
    let s = initZoneState(DEFAULT_ZONE_CONFIG, 60);
    for (let i = 0; i < 720; i++) {
      s = stepZone(s, DEFAULT_ZONE_CONFIG, {
        outsideTemp: 20,
        hour: 8,
        occupancy_frac: 0.5,
        supplyAir_btu_per_hr: 5000,
      }, 5);
    }
    expect(s.T_zone).toBeGreaterThan(60);
  });
});

describe('Infiltration (envelope leakage)', () => {
  it('an unconditioned occupied zone settles WELL below the sealed-box equilibrium', () => {
    // Regression for the mega-site runaway (2026-06-11): with no
    // infiltration term, default office loads against one R-13 wall
    // settled at +150°F over OAT and the demo zones cooked past 240°F.
    // With 0.35 ACH leakage the equilibrium must stay in the "hot
    // unconditioned room" band, not the "oven" band.
    let s = initZoneState(DEFAULT_ZONE_CONFIG, 75);
    for (let i = 0; i < 24 * 60; i++) { // 24 sim-hours of 60 s steps
      s = stepZone(s, DEFAULT_ZONE_CONFIG, {
        outsideTemp: 92,
        hour: 12,
        occupancy_frac: 1,
        supplyAir_btu_per_hr: 0,
      }, 60);
    }
    // Still hotter than OAT — the loads are real. Bounded ~177°F by
    // leakage vs the sealed-box ~278°F. The residual excess is the
    // missing interior-partition/ceiling loss (logged for the slice-5
    // physics pass) — tighten this bound when that term lands.
    expect(s.T_zone).toBeGreaterThan(92);
    expect(s.T_zone).toBeLessThan(200);
  });

  it('more leakage pulls the equilibrium toward OAT', () => {
    const leaky = { ...DEFAULT_ZONE_CONFIG, infiltration_ach: 1.5 };
    const tight = { ...DEFAULT_ZONE_CONFIG, infiltration_ach: 0.1 };
    let sl = initZoneState(leaky, 75);
    let st = initZoneState(tight, 75);
    for (let i = 0; i < 24 * 60; i++) {
      const inputs = { outsideTemp: 92, hour: 12, occupancy_frac: 1, supplyAir_btu_per_hr: 0 };
      sl = stepZone(sl, leaky, inputs, 60);
      st = stepZone(st, tight, inputs, 60);
    }
    expect(sl.T_zone).toBeLessThan(st.T_zone);
  });
});

describe('Occupancy schedule', () => {
  it('returns 0 outside work hours', () => {
    expect(defaultOccupancySchedule(2)).toBe(0);
    expect(defaultOccupancySchedule(22)).toBe(0);
  });

  it('returns 1 during peak hours', () => {
    expect(defaultOccupancySchedule(10)).toBe(1);
    expect(defaultOccupancySchedule(14)).toBe(1);
  });

  it('ramps up in the morning and down in the evening', () => {
    expect(defaultOccupancySchedule(6.5)).toBeCloseTo(0.5, 1);
    expect(defaultOccupancySchedule(18)).toBeCloseTo(0.5, 1);
  });
});
