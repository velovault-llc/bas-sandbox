// Real-world equipment-unit catalog.
//
// Equipment units are the things HVAC ACTUALLY DOES: a VAV box delivers
// air to a zone, an AHU conditions outside air, a boiler makes hot
// water. They sit between actuators (the muscle) and sensors (the
// nervous system) in the BAS topology:
//
//   Controller AO ─→ Actuator ─→ Equipment unit ─→ Sensor ─→ Controller UI
//
// Modeling them explicitly lets the sandbox:
//   - bundle related actuators ("VAV box has a primary damper AND an
//     optional reheat valve")
//   - drive realistic physics ("supply temp = mix temp ± coil ΔT")
//   - generate proper commissioning docs ("VAV-1: serves zone 203,
//     primary CFM 200-1200, reheat coil 12 MBH")

export type EquipmentKind =
  | 'vav-box'        // variable air volume terminal — air delivery to a zone
  | 'ahu'            // air handling unit — central air conditioning
  | 'rtu'            // packaged roof-top unit — AHU + DX cooling + heat
  | 'fcu'            // fan coil unit — local water-coil air handler
  | 'pump'           // hydronic pump (primary / secondary / condenser)
  | 'boiler'         // hot water boiler (low-pressure HW or steam)
  | 'chiller'        // chilled water plant (air- or water-cooled)
  | 'cooling-tower'; // condenser-water cooling tower

export interface EquipmentModel {
  readonly id: string;
  readonly vendor: string;
  readonly model: string;
  readonly kind: EquipmentKind;
  /** Short tag describing service tier / size range. */
  readonly category: string;
  /** Capacity in equipment-native units. Free-text because units differ
   *  by kind: CFM for AHU/VAV, GPM for pumps, MBH for boilers, tons for
   *  chillers. */
  readonly capacity: string;
  /** Logical actuators this equipment requires the controller to drive.
   *  Used by the wiring validator and the commissioning report. */
  readonly requiredActuators: readonly string[];
  /** Logical sensors this equipment requires for closed-loop control.
   *  Each sensor token maps to a SUBJECT tile in the SpecLang catalog. */
  readonly requiredSensors: readonly string[];
  readonly notes: string;
}

export const EQUIPMENT_CATALOG: readonly EquipmentModel[] = [
  // ── VAV boxes ─────────────────────────────────────────────────────────
  {
    id: 'titus-desv',
    vendor: 'Titus',
    model: 'DESV (single-duct)',
    kind: 'vav-box',
    category: 'Single-duct VAV with hot-water reheat',
    capacity: '200-2000 CFM',
    requiredActuators: ['primary-damper-actuator', 'reheat-valve-actuator'],
    requiredSensors: ['zone-temp', 'damper-position', 'occupancy'],
    notes: 'Standard mid-size single-duct VAV with 2-row HW reheat coil. Pneumatic-replacement designs use 4-pipe inlet. ASHRAE G36 §5.16 sequence target.',
  },
  {
    id: 'krueger-lmhs',
    vendor: 'Krueger',
    model: 'LMHS Series',
    kind: 'vav-box',
    category: 'Low-noise VAV with reheat',
    capacity: '200-2400 CFM',
    requiredActuators: ['primary-damper-actuator', 'reheat-valve-actuator'],
    requiredSensors: ['zone-temp', 'damper-position'],
    notes: 'Slim-profile VAV for tight ceiling plenums. Same control sequence as DESV — interchangeable from a programming perspective.',
  },
  {
    id: 'trane-varitrane-vccc',
    vendor: 'Trane',
    model: 'VariTrane VCCC',
    kind: 'vav-box',
    category: 'Single-duct VAV',
    capacity: '180-1700 CFM',
    requiredActuators: ['primary-damper-actuator'],
    requiredSensors: ['zone-temp', 'damper-position'],
    notes: 'Cooling-only single-duct (no reheat). Common on interior zones / open-office cores.',
  },

  // ── AHUs ──────────────────────────────────────────────────────────────
  {
    id: 'trane-m-series',
    vendor: 'Trane',
    model: 'M-Series Climate Changer',
    kind: 'ahu',
    category: 'Built-up custom AHU',
    capacity: '4,000-60,000 CFM',
    requiredActuators: [
      'supply-fan-vfd',
      'return-fan-vfd',
      'mixed-air-damper-actuator',
      'cooling-valve-actuator',
      'heating-valve-actuator',
    ],
    requiredSensors: [
      'supply-air-temp',
      'return-air-temp',
      'mixed-air-temp',
      'oa-temp',
      'discharge-air-temp',
      'static-pressure',
      'freezestat',
      'smoke-detector',
    ],
    notes: 'Configurable single- or multi-zone AHU with economizer, full energy recovery options. Ships with Tracer SC controller but field-installable on any G36-compliant program.',
  },
  {
    id: 'carrier-39m',
    vendor: 'Carrier',
    model: '39M Series',
    kind: 'ahu',
    category: 'Modular AHU',
    capacity: '2,000-30,000 CFM',
    requiredActuators: ['supply-fan-vfd', 'mixed-air-damper-actuator', 'cooling-valve-actuator'],
    requiredSensors: ['supply-air-temp', 'mixed-air-temp', 'oa-temp', 'static-pressure', 'freezestat'],
    notes: 'Single-zone constant or VAV AHU. Direct-drive plenum fans on newer models — beware older belt-drive bearings on retrofit jobs.',
  },

  // ── RTUs ──────────────────────────────────────────────────────────────
  {
    id: 'daikin-rebel',
    vendor: 'Daikin Applied',
    model: 'Rebel',
    kind: 'rtu',
    category: 'Packaged rooftop with VFD compressor',
    capacity: '3-25 tons',
    requiredActuators: ['supply-fan-vfd', 'oa-damper-actuator'],
    requiredSensors: ['supply-air-temp', 'oa-temp', 'static-pressure'],
    notes: 'High-efficiency packaged RTU. Built-in unit controller speaks BACnet/IP — typically integrates via a JACE rather than full G36 stack.',
  },

  // ── Fan coil units ────────────────────────────────────────────────────
  {
    id: 'trane-fcu-c',
    vendor: 'Trane',
    model: 'Series F (4-pipe)',
    kind: 'fcu',
    category: 'Floor-mount fan coil unit',
    capacity: '200-1200 CFM, 2-pipe or 4-pipe',
    requiredActuators: ['supply-fan-contactor', 'cooling-valve-binary', 'heating-valve-binary'],
    requiredSensors: ['zone-temp'],
    notes: 'Local zone conditioning. 3-speed fan + 2-position valves typical on retrofits. Bypass mode = no economizer.',
  },

  // ── Pumps ─────────────────────────────────────────────────────────────
  {
    id: 'bell-gossett-e-1510',
    vendor: 'Bell & Gossett',
    model: 'Series e-1510',
    kind: 'pump',
    category: 'End-suction centrifugal hydronic pump',
    capacity: '5-1500 GPM',
    requiredActuators: ['pump-vfd'],
    requiredSensors: ['differential-pressure', 'flow'],
    notes: 'Primary/secondary chilled or hot water loop pump. VFD speed varies to maintain ΔP setpoint at the worst-case zone.',
  },

  // ── Boilers ───────────────────────────────────────────────────────────
  {
    id: 'cleaver-brooks-clearfire-h',
    vendor: 'Cleaver-Brooks',
    model: 'ClearFire-H',
    kind: 'boiler',
    category: 'Condensing hot-water boiler',
    capacity: '750-6,000 MBH',
    requiredActuators: ['burner-modulation', 'circulator-pump-vfd'],
    requiredSensors: ['boiler-supply-temp', 'boiler-return-temp', 'low-water-cutoff', 'high-limit', 'flame-proven'],
    notes: 'Modulating-firing condensing boiler. Built-in burner controller handles flame-safety chain; BAS sees a single "boiler enable" output + status feedback.',
  },

  // ── Chillers ──────────────────────────────────────────────────────────
  {
    id: 'carrier-30xa',
    vendor: 'Carrier',
    model: '30XA Aquaforce',
    kind: 'chiller',
    category: 'Air-cooled screw chiller',
    capacity: '80-500 tons',
    requiredActuators: ['chiller-enable', 'chilled-water-valve'],
    requiredSensors: ['chilled-water-supply-temp', 'chilled-water-return-temp', 'flow-switch'],
    notes: 'Packaged air-cooled chiller. Onboard ComfortLink controller manages compressor staging — BAS provides demand setpoint + enable.',
  },

  // ── Cooling towers ────────────────────────────────────────────────────
  {
    id: 'baltimore-aircoil-vtl',
    vendor: 'Baltimore Aircoil',
    model: 'VTL',
    kind: 'cooling-tower',
    category: 'Open evaporative cooling tower',
    capacity: '60-450 tons heat rejection',
    requiredActuators: ['tower-fan-vfd', 'basin-bleed-valve'],
    requiredSensors: ['condenser-water-supply-temp', 'condenser-water-return-temp', 'basin-level'],
    notes: 'Crossflow induced-draft tower. Fan VFD modulates to maintain CWS setpoint; bleed valve dumps cycles-of-concentration water to drain.',
  },
];

export function findEquipmentModel(id: string): EquipmentModel | undefined {
  return EQUIPMENT_CATALOG.find((e) => e.id === id);
}

export function equipmentCatalogByKind(): Map<EquipmentKind, EquipmentModel[]> {
  const map = new Map<EquipmentKind, EquipmentModel[]>();
  for (const e of EQUIPMENT_CATALOG) {
    const arr = map.get(e.kind) ?? [];
    arr.push(e);
    map.set(e.kind, arr);
  }
  return map;
}
