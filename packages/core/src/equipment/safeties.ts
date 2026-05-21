// Real-world safety device catalog.
//
// These are the hardwired interlocks that protect occupants and equipment
// independently of the BAS — by code in most jurisdictions. The BAS sees
// them as binary inputs (run-permission / alarm) but the *trip* logic
// lives in the device itself. A faithful sandbox needs to model this
// because programming sequences that "fight" a hardwired safety is one of
// the most common mistakes a new tech makes.

export type SafetyKind =
  | 'freezestat'
  | 'high-static-cutout'
  | 'duct-smoke'
  | 'high-limit'
  | 'low-water-cutoff'
  | 'flow-switch'
  | 'differential-pressure-switch'
  | 'vibration'
  | 'emergency-stop'
  | 'fire-alarm-shutdown';

export type SafetyResetBehavior = 'manual' | 'auto';

export interface SafetyDevice {
  readonly id: string;
  readonly vendor: string;
  readonly model: string;
  readonly kind: SafetyKind;
  /** What the contact does in normal (untripped) operation.
   *   NC = "normally closed" — opens on trip (loss of permission)
   *   NO = "normally open"   — closes on trip (alarm signal)
   *  Most BAS-tied safeties are NC so wire break = fail-safe. */
  readonly normalState: 'NC' | 'NO';
  readonly resetBehavior: SafetyResetBehavior;
  /** Trip set-point in native units; null when the device is occupancy/
   *  presence-style (smoke, manual reset stop). */
  readonly tripPoint: { value: number; units: string } | null;
  readonly notes: string;
}

export const SAFETY_CATALOG: readonly SafetyDevice[] = [
  // ── Freezestats — low-limit cutouts ──────────────────────────────────
  {
    id: 'jci-a70ha',
    vendor: 'Johnson Controls',
    model: 'A70HA-1',
    kind: 'freezestat',
    normalState: 'NC',
    resetBehavior: 'manual',
    tripPoint: { value: 38, units: '°F' },
    notes: 'Capillary-style low-limit; 20 ft averaging element across coil face. Trips fan + closes outside-air damper on coil-frost risk.',
  },
  {
    id: 'honeywell-l482a',
    vendor: 'Honeywell',
    model: 'L482A',
    kind: 'freezestat',
    normalState: 'NC',
    resetBehavior: 'manual',
    tripPoint: { value: 36, units: '°F' },
    notes: 'Vapor-charged averaging freezestat; common on Carrier / Trane AHUs.',
  },

  // ── Duct smoke detectors ─────────────────────────────────────────────
  {
    id: 'system-sensor-d4120',
    vendor: 'System Sensor',
    model: 'D4120',
    kind: 'duct-smoke',
    normalState: 'NC',
    resetBehavior: 'manual',
    tripPoint: null,
    notes: 'Photoelectric duct smoke detector. NFPA 90A requires AHU shutdown on detection > 2,000 CFM.',
  },
  {
    id: 'system-sensor-innovairflex',
    vendor: 'System Sensor',
    model: 'InnovairFlex D4S',
    kind: 'duct-smoke',
    normalState: 'NC',
    resetBehavior: 'manual',
    tripPoint: null,
    notes: 'Modern stand-alone duct detector with intelligent contamination compensation.',
  },

  // ── High-static / over-pressure cutouts ──────────────────────────────
  {
    id: 'cleveland-controls-afs-222',
    vendor: 'Cleveland Controls',
    model: 'AFS-222',
    kind: 'flow-switch',
    normalState: 'NO',
    resetBehavior: 'auto',
    tripPoint: { value: 0.05, units: 'in WC' },
    notes: 'Air-flow proving switch; closes when ΔP across blower exceeds set point.',
  },
  {
    id: 'cleveland-controls-rfs-4001',
    vendor: 'Cleveland Controls',
    model: 'RFS-4001',
    kind: 'differential-pressure-switch',
    normalState: 'NO',
    resetBehavior: 'auto',
    tripPoint: { value: 0.5, units: 'in WC' },
    notes: 'Adjustable differential pressure switch; auto-reset.',
  },
  {
    id: 'honeywell-c645a',
    vendor: 'Honeywell',
    model: 'C645A',
    kind: 'high-static-cutout',
    normalState: 'NC',
    resetBehavior: 'manual',
    tripPoint: { value: 4, units: 'in WC' },
    notes: 'High duct static cutout — kills fan if downstream damper closes against full flow.',
  },

  // ── High-limit / over-temperature ────────────────────────────────────
  {
    id: 'honeywell-l4006a',
    vendor: 'Honeywell',
    model: 'L4006A',
    kind: 'high-limit',
    normalState: 'NC',
    resetBehavior: 'manual',
    tripPoint: { value: 200, units: '°F' },
    notes: 'Aquastat high-limit on boilers; manual reset, prevents runaway combustion.',
  },
  {
    id: 'robertshaw-9210',
    vendor: 'Robertshaw',
    model: '9210',
    kind: 'high-limit',
    normalState: 'NC',
    resetBehavior: 'manual',
    tripPoint: { value: 240, units: '°F' },
    notes: 'High-limit thermostat for hot water systems.',
  },

  // ── Boiler / hydronic ────────────────────────────────────────────────
  {
    id: 'mcdonnell-miller-pse-800',
    vendor: 'McDonnell Miller',
    model: 'PSE-800',
    kind: 'low-water-cutoff',
    normalState: 'NC',
    resetBehavior: 'manual',
    tripPoint: null,
    notes: 'Probe-style low-water cutoff for steam boilers. Code-required.',
  },

  // ── Vibration / mechanical fault ─────────────────────────────────────
  {
    id: 'murphy-ms3601',
    vendor: 'FW Murphy',
    model: 'MS3601',
    kind: 'vibration',
    normalState: 'NC',
    resetBehavior: 'manual',
    tripPoint: { value: 0.3, units: 'in/s' },
    notes: 'Mechanical vibration switch on chillers / large fans.',
  },

  // ── Manual reset / E-stop ────────────────────────────────────────────
  {
    id: 'allen-bradley-800fp',
    vendor: 'Allen-Bradley',
    model: '800FP-MT44',
    kind: 'emergency-stop',
    normalState: 'NC',
    resetBehavior: 'manual',
    tripPoint: null,
    notes: 'Mushroom-head E-stop; latches on press, requires twist-to-release.',
  },

  // ── Fire-alarm tie-in ────────────────────────────────────────────────
  {
    id: 'fire-alarm-nac',
    vendor: '(generic NAC relay)',
    model: 'Auxiliary contact',
    kind: 'fire-alarm-shutdown',
    normalState: 'NC',
    resetBehavior: 'manual',
    tripPoint: null,
    notes: 'Auxiliary contact from the fire-alarm panel — drops to AHU on general fire alarm. NFPA 72 / 90A interlock.',
  },
];

export function findSafetyDevice(id: string): SafetyDevice | undefined {
  return SAFETY_CATALOG.find((s) => s.id === id);
}

export function safetyCatalogByKind(): Map<SafetyKind, SafetyDevice[]> {
  const map = new Map<SafetyKind, SafetyDevice[]>();
  for (const s of SAFETY_CATALOG) {
    if (!map.has(s.kind)) map.set(s.kind, []);
    map.get(s.kind)!.push(s);
  }
  return map;
}
