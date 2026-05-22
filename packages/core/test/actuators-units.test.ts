import { describe, it, expect } from 'vitest';
import {
  ACTUATOR_CATALOG,
  EQUIPMENT_CATALOG,
  findActuatorModel,
  findEquipmentModel,
  actuatorCatalogByKind,
  equipmentCatalogByKind,
} from '../src/index.js';

describe('Actuator catalog', () => {
  it('has at least 10 actuator models across the major kinds', () => {
    expect(ACTUATOR_CATALOG.length).toBeGreaterThanOrEqual(10);
    const kinds = new Set(ACTUATOR_CATALOG.map((a) => a.kind));
    expect(kinds.has('damper-modulating')).toBe(true);
    expect(kinds.has('valve-modulating')).toBe(true);
    expect(kinds.has('vfd')).toBe(true);
    expect(kinds.has('contactor')).toBe(true);
  });

  it('every actuator has a positive stroke time and a fail-safe', () => {
    for (const a of ACTUATOR_CATALOG) {
      expect(a.strokeSeconds, `${a.id} strokeSeconds`).toBeGreaterThan(0);
      expect(a.failSafe, `${a.id} failSafe`).toBeTruthy();
    }
  });

  it('findActuatorModel resolves a known id', () => {
    expect(findActuatorModel('belimo-af24-mft')?.vendor).toBe('Belimo');
    expect(findActuatorModel('does-not-exist')).toBeUndefined();
  });

  it('groups actuators by kind', () => {
    const byKind = actuatorCatalogByKind();
    expect((byKind.get('damper-modulating') ?? []).length).toBeGreaterThan(0);
    expect((byKind.get('vfd') ?? []).length).toBeGreaterThan(0);
  });
});

describe('Equipment-unit catalog', () => {
  it('has VAV, AHU, FCU, pump, boiler, chiller entries', () => {
    const kinds = new Set(EQUIPMENT_CATALOG.map((e) => e.kind));
    expect(kinds.has('vav-box')).toBe(true);
    expect(kinds.has('ahu')).toBe(true);
    expect(kinds.has('fcu')).toBe(true);
    expect(kinds.has('pump')).toBe(true);
    expect(kinds.has('boiler')).toBe(true);
    expect(kinds.has('chiller')).toBe(true);
  });

  it('every equipment lists required actuators and sensors', () => {
    for (const e of EQUIPMENT_CATALOG) {
      expect(e.requiredActuators.length, `${e.id} requiredActuators`).toBeGreaterThan(0);
      expect(e.requiredSensors.length, `${e.id} requiredSensors`).toBeGreaterThan(0);
    }
  });

  it('findEquipmentModel resolves a known id', () => {
    expect(findEquipmentModel('titus-desv')?.vendor).toBe('Titus');
    expect(findEquipmentModel('does-not-exist')).toBeUndefined();
  });

  it('groups equipment by kind', () => {
    const byKind = equipmentCatalogByKind();
    expect((byKind.get('vav-box') ?? []).length).toBeGreaterThan(0);
    expect((byKind.get('ahu') ?? []).length).toBeGreaterThan(0);
  });
});
