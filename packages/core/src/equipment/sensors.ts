// Real-world BAS sensor catalog.
//
// Each entry mirrors a shipping product. The catalog focuses on what a tech
// actually pulls out of a box on a typical commercial HVAC job: zone/duct/
// outdoor temperature, building/duct static pressure, differential pressure,
// air flow, humidity, CO₂, occupancy, current sensing, and damper/valve
// feedback. Vendors weighted toward the broadly-deployed names (BAPI, Veris,
// Belimo, Vaisala, Honeywell, JCI) — not exhaustive.
//
// Vendor names + model numbers are factual product identifiers; this catalog
// does not redistribute any vendor's proprietary documentation, schematics,
// or firmware. Per-spec datasheet values are independently observable from
// each vendor's public marketing literature.

export type SensorSubject =
  | 'temp'
  | 'pressure-static'
  | 'pressure-differential'
  | 'air-flow'
  | 'humidity'
  | 'co2'
  | 'occupancy'
  | 'current'
  | 'damper-position'
  | 'valve-position';

export type SensorSignal =
  | 'rtd-pt1000'
  | 'rtd-pt100'
  | 'rtd-ni1000'
  | 'thermistor-10k-t2'
  | 'thermistor-10k-t3'
  | 'thermistor-20k'
  | 'analog-0-10v'
  | 'analog-2-10v'
  | 'analog-4-20ma'
  | 'analog-0-5v'
  | 'binary-dry'
  | 'bacnet-mstp';

export type SensorMounting =
  | 'wall'
  | 'duct-probe'
  | 'duct-averaging'
  | 'outdoor'
  | 'immersion'
  | 'strap-on'
  | 'ceiling'
  | 'clamp-on';

export interface SensorModel {
  readonly id: string;
  readonly vendor: string;
  readonly model: string;
  readonly subject: SensorSubject;
  readonly signal: SensorSignal;
  readonly mounting: SensorMounting;
  /** Measurement range in native units (e.g. [-40, 250] °F for a temp sensor). */
  readonly range: readonly [number, number];
  readonly units: string;
  readonly accuracy: string;
  /** Typical wiring terminal (UI/AI/BI on the controller side). */
  readonly inputTerminal: 'UI' | 'AI' | 'BI';
  /** Short marketing-grade one-liner. */
  readonly notes: string;
}

export const SENSOR_CATALOG: readonly SensorModel[] = [
  // ── Temperature: zone / room ──────────────────────────────────────────
  {
    id: 'bapi-ba-1k-zone',
    vendor: 'BAPI',
    model: 'BA/1K[100]-2-A2X-W-BB',
    subject: 'temp',
    signal: 'rtd-pt1000',
    mounting: 'wall',
    range: [-40, 250],
    units: '°F',
    accuracy: '±0.4°F',
    inputTerminal: 'UI',
    notes: 'Standard zone temp sensor — Pt1000 platinum, room-mount, no display.',
  },
  {
    id: 'bapi-ba-10k3-zone',
    vendor: 'BAPI',
    model: 'BA/10K-3-W-BB',
    subject: 'temp',
    signal: 'thermistor-10k-t3',
    mounting: 'wall',
    range: [-40, 250],
    units: '°F',
    accuracy: '±0.36°F',
    inputTerminal: 'UI',
    notes: 'JCI-compatible 10kΩ Type III room thermistor.',
  },
  {
    id: 'jci-te-6300',
    vendor: 'Johnson Controls',
    model: 'TE-6300 series',
    subject: 'temp',
    signal: 'rtd-pt1000',
    mounting: 'duct-averaging',
    range: [-40, 250],
    units: '°F',
    accuracy: '±0.4°F',
    inputTerminal: 'UI',
    notes: 'Averaging duct probe (8–24 ft). Mixed-air / discharge-air staple in JCI shops.',
  },
  {
    id: 'honeywell-c7770a',
    vendor: 'Honeywell',
    model: 'C7770A',
    subject: 'temp',
    signal: 'thermistor-20k',
    mounting: 'duct-averaging',
    range: [-40, 250],
    units: '°F',
    accuracy: '±0.5°F',
    inputTerminal: 'UI',
    notes: '20kΩ averaging element. Common on Honeywell Spyder / WEBs-Vykon AHUs.',
  },
  {
    id: 'greystone-te200',
    vendor: 'Greystone',
    model: 'TE200',
    subject: 'temp',
    signal: 'rtd-pt1000',
    mounting: 'outdoor',
    range: [-40, 250],
    units: '°F',
    accuracy: '±0.5°F',
    inputTerminal: 'UI',
    notes: 'Outdoor air temp, sun shield, Pt1000.',
  },
  {
    id: 'jci-te-6361-immersion',
    vendor: 'Johnson Controls',
    model: 'TE-6361',
    subject: 'temp',
    signal: 'rtd-pt1000',
    mounting: 'immersion',
    range: [-40, 250],
    units: '°F',
    accuracy: '±0.4°F',
    inputTerminal: 'UI',
    notes: 'Immersion well probe — chilled / hot water supply and return temps.',
  },
  {
    id: 'jci-te-6300-ni',
    vendor: 'Johnson Controls',
    model: 'TE-6300 (Ni1000)',
    subject: 'temp',
    signal: 'rtd-ni1000',
    mounting: 'duct-averaging',
    range: [-40, 250],
    units: '°F',
    accuracy: '±0.4°F',
    inputTerminal: 'UI',
    notes: 'Nickel-1000 (Ni1000) averaging probe — the classic JCI/legacy curve. Set the controller terminal to Ni1000, NOT Pt1000, or the reading reads high.',
  },
  {
    id: 'bapi-ba-ni1k-zone',
    vendor: 'BAPI',
    model: 'BA/N1K-2-A2X-W-BB',
    subject: 'temp',
    signal: 'rtd-ni1000',
    mounting: 'wall',
    range: [-40, 250],
    units: '°F',
    accuracy: '±0.5°F',
    inputTerminal: 'UI',
    notes: 'Nickel-1000 zone temp sensor — drop-in for older Honeywell/JCI panels wired for nickel. Curve is steeper than platinum (≈6180 ppm/°C vs 3850).',
  },

  // ── Pressure ──────────────────────────────────────────────────────────
  {
    id: 'veris-pxdlx-005',
    vendor: 'Veris',
    model: 'PXDLX01S',
    subject: 'pressure-differential',
    signal: 'analog-4-20ma',
    mounting: 'duct-probe',
    range: [0, 1],
    units: 'in WC',
    accuracy: '±1% FS',
    inputTerminal: 'AI',
    notes: 'Wet/wet differential pressure transducer, 0–1 in WC, common for water-side ΔP.',
  },
  {
    id: 'setra-264-25',
    vendor: 'Setra',
    model: '264-25',
    subject: 'pressure-differential',
    signal: 'analog-4-20ma',
    mounting: 'duct-probe',
    range: [0, 25],
    units: 'in WC',
    accuracy: '±1% FS',
    inputTerminal: 'AI',
    notes: 'Industrial differential pressure transducer, 0–25 in WC.',
  },
  {
    id: 'dwyer-616-3',
    vendor: 'Dwyer',
    model: '616KD-3',
    subject: 'pressure-static',
    signal: 'analog-4-20ma',
    mounting: 'duct-probe',
    range: [0, 3],
    units: 'in WC',
    accuracy: '±2% FS',
    inputTerminal: 'AI',
    notes: 'Duct static pressure, 0–3 in WC.',
  },
  {
    id: 'veris-pxplx-001',
    vendor: 'Veris',
    model: 'PXPLX01S',
    subject: 'pressure-static',
    signal: 'analog-0-10v',
    mounting: 'duct-probe',
    range: [-0.5, 0.5],
    units: 'in WC',
    accuracy: '±1% FS',
    inputTerminal: 'AI',
    notes: 'Building / room static — low range, bipolar, 0–10V output.',
  },

  // ── Air flow ──────────────────────────────────────────────────────────
  {
    id: 'ebtron-gold-vp',
    vendor: 'Ebtron',
    model: 'Gold VP Series',
    subject: 'air-flow',
    signal: 'analog-4-20ma',
    mounting: 'duct-probe',
    range: [0, 3000],
    units: 'CFM',
    accuracy: '±2% reading',
    inputTerminal: 'AI',
    notes: 'Thermal-dispersion airflow station; ducted economizer / outdoor air measurement.',
  },

  // ── Humidity ──────────────────────────────────────────────────────────
  {
    id: 'vaisala-hmd60',
    vendor: 'Vaisala',
    model: 'HMD60',
    subject: 'humidity',
    signal: 'analog-4-20ma',
    mounting: 'duct-probe',
    range: [0, 100],
    units: '% RH',
    accuracy: '±2% RH',
    inputTerminal: 'AI',
    notes: 'Industrial duct-mount RH transmitter. HUMICAP polymer sensing element.',
  },
  {
    id: 'bapi-brh',
    vendor: 'BAPI',
    model: 'BA/BRH',
    subject: 'humidity',
    signal: 'analog-0-10v',
    mounting: 'wall',
    range: [0, 100],
    units: '% RH',
    accuracy: '±3% RH',
    inputTerminal: 'AI',
    notes: 'Wall-mount room RH; combine with zone temp sensor for dewpoint calc.',
  },

  // ── CO₂ ───────────────────────────────────────────────────────────────
  {
    id: 'veris-cwe',
    vendor: 'Veris',
    model: 'CWE',
    subject: 'co2',
    signal: 'analog-4-20ma',
    mounting: 'wall',
    range: [0, 2000],
    units: 'ppm',
    accuracy: '±30 ppm + 3% reading',
    inputTerminal: 'AI',
    notes: 'NDIR CO₂ wall sensor. DCV (demand-control ventilation) workhorse.',
  },
  {
    id: 'senva-co2w',
    vendor: 'Senva',
    model: 'CO2W-A20',
    subject: 'co2',
    signal: 'analog-4-20ma',
    mounting: 'wall',
    range: [0, 2000],
    units: 'ppm',
    accuracy: '±30 ppm + 3% reading',
    inputTerminal: 'AI',
    notes: 'NDIR CO₂ wall sensor; common Niagara-pairing.',
  },

  // ── Occupancy ─────────────────────────────────────────────────────────
  {
    id: 'wattstopper-ut-355',
    vendor: 'WattStopper',
    model: 'UT-355',
    subject: 'occupancy',
    signal: 'binary-dry',
    mounting: 'ceiling',
    range: [0, 1],
    units: 'occ',
    accuracy: 'detection event',
    inputTerminal: 'BI',
    notes: 'PIR occupancy ceiling sensor, dry-contact output.',
  },
  {
    id: 'hubbell-atd',
    vendor: 'Hubbell',
    model: 'ATD2000',
    subject: 'occupancy',
    signal: 'binary-dry',
    mounting: 'ceiling',
    range: [0, 1],
    units: 'occ',
    accuracy: 'detection event',
    inputTerminal: 'BI',
    notes: 'Dual-tech (PIR + ultrasonic) occupancy sensor.',
  },

  // ── Current sensing ───────────────────────────────────────────────────
  {
    id: 'veris-h963',
    vendor: 'Veris',
    model: 'H963',
    subject: 'current',
    signal: 'analog-4-20ma',
    mounting: 'clamp-on',
    range: [0, 200],
    units: 'A',
    accuracy: '±1% reading',
    inputTerminal: 'AI',
    notes: 'Split-core current transducer; pump / fan run-status + load monitoring.',
  },
  {
    id: 'veris-h308',
    vendor: 'Veris',
    model: 'H308',
    subject: 'current',
    signal: 'binary-dry',
    mounting: 'clamp-on',
    range: [0, 1],
    units: 'on/off',
    accuracy: 'adjustable trip',
    inputTerminal: 'BI',
    notes: 'Current SWITCH (dry-contact run-status proof). Trips when current > set point.',
  },

  // ── Damper / valve feedback ───────────────────────────────────────────
  {
    id: 'belimo-nf24a',
    vendor: 'Belimo',
    model: 'NF24A-MFT',
    subject: 'damper-position',
    signal: 'analog-2-10v',
    mounting: 'strap-on',
    range: [0, 100],
    units: '%',
    accuracy: '±3%',
    inputTerminal: 'AI',
    notes: 'Spring-return damper actuator, 2–10V feedback, 90° rotation.',
  },
  {
    id: 'belimo-arx24',
    vendor: 'Belimo',
    model: 'ARX24-3',
    subject: 'damper-position',
    signal: 'binary-dry',
    mounting: 'strap-on',
    range: [0, 1],
    units: 'state',
    accuracy: 'aux switch',
    inputTerminal: 'BI',
    notes: 'Damper actuator with built-in end-switch; signals fully open / closed.',
  },
];

export function findSensorModel(id: string): SensorModel | undefined {
  return SENSOR_CATALOG.find((s) => s.id === id);
}

export function sensorCatalogBySubject(): Map<SensorSubject, SensorModel[]> {
  const map = new Map<SensorSubject, SensorModel[]>();
  for (const s of SENSOR_CATALOG) {
    if (!map.has(s.subject)) map.set(s.subject, []);
    map.get(s.subject)!.push(s);
  }
  return map;
}
