import { describe, it, expect } from 'vitest';
import { synthesizeBacnetObjects, bacnetObjectId } from '../src/bacnet/index.js';

describe('BACnet object synthesis', () => {
  it('emits AI objects for UI/AI terminals, AO objects for AO/UO, BO for BO', () => {
    const objs = synthesizeBacnetObjects({
      vendorModelId: 'distech-ecy-vav',
      bindings: { bindings: [] },
      envInputs: {},
      envOutputs: {},
    });
    const ai = objs.filter((o) => o.type === 'analog-input');
    const ao = objs.filter((o) => o.type === 'analog-output');
    const bo = objs.filter((o) => o.type === 'binary-output');
    // ECY-VAV: 5 UI, 2 AO, 3 BO. UI maps to AI (analog-default).
    expect(ai.length).toBe(5);
    expect(ao.length).toBe(2);
    expect(bo.length).toBe(3);
  });

  it('uses binding role for ObjectName when available', () => {
    const objs = synthesizeBacnetObjects({
      vendorModelId: 'distech-ecy-vav',
      bindings: {
        bindings: [{ terminalId: 'UI-1', role: 'zone-temp' }],
      },
      envInputs: { sensed: 72.4 },
      envOutputs: {},
    });
    const ai1 = objs.find((o) => o.id === 'AI:1');
    expect(ai1?.name).toBe('zone temp');
    expect(ai1?.presentValue).toBe(72.4);
    expect(ai1?.units).toBe('°F');
  });

  it('routes occupancy bindings to BI instead of AI', () => {
    const objs = synthesizeBacnetObjects({
      vendorModelId: 'distech-ecy-vav',
      bindings: {
        bindings: [{ terminalId: 'UI-2', role: 'occupancy' }],
      },
      envInputs: { occ: 1 },
      envOutputs: {},
    });
    // UI-2 should produce a BI object, not AI, because occupancy is binary.
    const occObj = objs.find((o) => o.name === 'occupancy');
    expect(occObj?.type).toBe('binary-input');
    expect(occObj?.presentValue).toBe(true);
  });

  it('AO values are scaled 0-1 → 0-100%', () => {
    const objs = synthesizeBacnetObjects({
      vendorModelId: 'distech-ecy-vav',
      bindings: {
        bindings: [{ terminalId: 'AO-1', role: 'primary-damper' }],
      },
      envInputs: {},
      envOutputs: { actuator: 0.83 },
    });
    const ao = objs.find((o) => o.id === 'AO:1');
    expect(ao?.presentValue).toBeCloseTo(83, 1);
    expect(ao?.units).toBe('%');
  });

  it('emits BV objects for heating/cooling season', () => {
    const objs = synthesizeBacnetObjects({
      vendorModelId: 'distech-ecy-vav',
      bindings: { bindings: [] },
      envInputs: { heating_season: 1, cooling_season: 0 },
      envOutputs: {},
    });
    const heat = objs.find((o) => o.name === 'Heating Season Active');
    const cool = objs.find((o) => o.name === 'Cooling Season Active');
    expect(heat?.type).toBe('binary-value');
    expect(heat?.presentValue).toBe(true);
    expect(cool?.presentValue).toBe(false);
  });

  it('object ids are stable and follow BACnet AI:N / AO:N notation', () => {
    expect(bacnetObjectId('analog-input', 3)).toBe('AI:3');
    expect(bacnetObjectId('binary-output', 12)).toBe('BO:12');
    expect(bacnetObjectId('analog-value', 1)).toBe('AV:1');
  });
});
