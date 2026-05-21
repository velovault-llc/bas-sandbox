import { describe, it, expect } from 'vitest';
import { computeSensorReading } from '../src/sim/sensorSim.js';

const ctx = (over: Partial<Parameters<typeof computeSensorReading>[1]> = {}) => ({
  hour: 12,
  actuator: 0.5,
  zoneTemp: 72,
  outsideTemp: 60,
  ...over,
});

describe('computeSensorReading', () => {
  it('occupancy: occupied between 7am and 7pm', () => {
    expect(computeSensorReading('occupancy', ctx({ hour: 12 })).value).toBe(1);
    expect(computeSensorReading('occupancy', ctx({ hour: 7 })).value).toBe(1);
    expect(computeSensorReading('occupancy', ctx({ hour: 19 })).value).toBe(0);
    expect(computeSensorReading('occupancy', ctx({ hour: 3 })).value).toBe(0);
  });

  it('occupancy: emits canonical "occ" input key', () => {
    expect(computeSensorReading('occupancy', ctx()).inputKey).toBe('occ');
  });

  it('damper-position: mirrors actuator command', () => {
    expect(computeSensorReading('damper-position', ctx({ actuator: 0 })).value).toBe(0);
    expect(computeSensorReading('damper-position', ctx({ actuator: 0.75 })).value).toBeCloseTo(75);
    expect(computeSensorReading('damper-position', ctx({ actuator: 1 })).value).toBe(100);
  });

  it('damper-position: emits canonical "damper" input key', () => {
    expect(computeSensorReading('damper-position', ctx()).inputKey).toBe('damper');
  });

  it('valve-position: same shape as damper', () => {
    const r = computeSensorReading('valve-position', ctx({ actuator: 0.4 }));
    expect(r.value).toBeCloseTo(40);
    expect(r.inputKey).toBe('valve');
  });

  it('co2: rises with occupancy, falls with ventilation', () => {
    const noVent = computeSensorReading('co2', ctx({ hour: 10, actuator: 0 })).value;
    const fullVent = computeSensorReading('co2', ctx({ hour: 10, actuator: 1 })).value;
    expect(noVent).toBeGreaterThan(fullVent);
    expect(noVent).toBeCloseTo(900, 0);
    expect(fullVent).toBeCloseTo(450, 0);
  });

  it('co2: stays at baseline when unoccupied', () => {
    expect(computeSensorReading('co2', ctx({ hour: 2, actuator: 0 })).value).toBeCloseTo(450, 0);
  });

  it('humidity: falls as zone temp rises (Magnus-style)', () => {
    const cool = computeSensorReading('humidity', ctx({ zoneTemp: 68 })).value;
    const warm = computeSensorReading('humidity', ctx({ zoneTemp: 78 })).value;
    expect(cool).toBeGreaterThan(warm);
  });

  it('all subjects emit a display string with units', () => {
    const subjects = [
      'temp', 'occupancy', 'damper-position', 'valve-position',
      'co2', 'humidity', 'air-flow', 'pressure-static',
      'pressure-differential', 'current',
    ] as const;
    for (const s of subjects) {
      const r = computeSensorReading(s, ctx());
      expect(r.display).toBeTruthy();
      expect(r.display.length).toBeGreaterThan(2);
    }
  });
});
