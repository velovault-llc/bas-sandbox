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

describe('BACnet fault propagation', () => {
  it('open-circuit on a terminal sets reliability=open-loop + FAULT bit', () => {
    const objs = synthesizeBacnetObjects({
      vendorModelId: 'distech-ecy-vav',
      bindings: { bindings: [{ terminalId: 'UI-2', role: 'co2' }] },
      envInputs: { co2: 0 },
      envOutputs: {},
      terminalFaults: new Map([['UI-2', 'open-circuit']]),
    });
    const ai2 = objs.find((o) => o.id === 'AI:2');
    expect(ai2?.reliability).toBe('open-loop');
    expect(ai2?.statusFlags?.fault).toBe(true);
    expect(ai2?.statusFlags?.inAlarm).toBe(false);
    expect(ai2?.statusFlags?.overridden).toBe(false);
    expect(ai2?.statusFlags?.outOfService).toBe(false);
  });

  it('short-circuit maps to reliability=shorted-loop', () => {
    const objs = synthesizeBacnetObjects({
      vendorModelId: 'distech-ecy-vav',
      bindings: { bindings: [] },
      envInputs: {},
      envOutputs: {},
      terminalFaults: new Map([['UI-1', 'short-circuit']]),
    });
    const ai1 = objs.find((o) => o.id === 'AI:1');
    expect(ai1?.reliability).toBe('shorted-loop');
    expect(ai1?.statusFlags?.fault).toBe(true);
  });

  it('over-range and under-range propagate intact', () => {
    const objs = synthesizeBacnetObjects({
      vendorModelId: 'distech-ecy-vav',
      bindings: { bindings: [] },
      envInputs: {},
      envOutputs: {},
      terminalFaults: new Map([
        ['UI-1', 'over-range'],
        ['UI-2', 'under-range'],
      ]),
    });
    expect(objs.find((o) => o.id === 'AI:1')?.reliability).toBe('over-range');
    expect(objs.find((o) => o.id === 'AI:2')?.reliability).toBe('under-range');
  });

  it('healthy terminals omit reliability + statusFlags entirely (clean snapshot)', () => {
    const objs = synthesizeBacnetObjects({
      vendorModelId: 'distech-ecy-vav',
      bindings: { bindings: [] },
      envInputs: {},
      envOutputs: {},
      // no terminalFaults
    });
    const ai1 = objs.find((o) => o.id === 'AI:1');
    expect(ai1?.reliability).toBeUndefined();
    expect(ai1?.statusFlags).toBeUndefined();
  });

  it('only the faulted terminal is affected — siblings stay clean', () => {
    const objs = synthesizeBacnetObjects({
      vendorModelId: 'distech-ecy-vav',
      bindings: { bindings: [] },
      envInputs: {},
      envOutputs: {},
      terminalFaults: new Map([['UI-3', 'open-circuit']]),
    });
    expect(objs.find((o) => o.id === 'AI:1')?.reliability).toBeUndefined();
    expect(objs.find((o) => o.id === 'AI:2')?.reliability).toBeUndefined();
    expect(objs.find((o) => o.id === 'AI:3')?.reliability).toBe('open-loop');
    expect(objs.find((o) => o.id === 'AI:4')?.reliability).toBeUndefined();
  });

  it('binary inputs (occupancy) propagate fault too', () => {
    const objs = synthesizeBacnetObjects({
      vendorModelId: 'distech-ecy-vav',
      bindings: { bindings: [{ terminalId: 'UI-2', role: 'occupancy' }] },
      envInputs: { occ: 1 },
      envOutputs: {},
      terminalFaults: new Map([['UI-2', 'open-circuit']]),
    });
    const occ = objs.find((o) => o.name === 'occupancy');
    expect(occ?.type).toBe('binary-input');
    expect(occ?.reliability).toBe('open-loop');
    expect(occ?.statusFlags?.fault).toBe(true);
  });

  it('mismatch is NOT a BACnet fault — by design, the controller cannot detect it', () => {
    // A real Metasys/Niagara doesn't know the wired sensor type is wrong.
    // The scaling silently produces a "valid" number; reliability stays
    // no-fault-detected; FAULT bit clear. This is the entire reason
    // mismatched terminal config is the dangerous silent commissioning
    // failure — supervisor + tech both see green and chase ghosts.
    const objs = synthesizeBacnetObjects({
      vendorModelId: 'distech-ecy-vav',
      bindings: { bindings: [] },
      envInputs: {},
      envOutputs: {},
      // intentionally no terminalFaults — mismatches don't get fed in
    });
    for (const o of objs) {
      expect(o.reliability).toBeUndefined();
      expect(o.statusFlags).toBeUndefined();
    }
  });
});
