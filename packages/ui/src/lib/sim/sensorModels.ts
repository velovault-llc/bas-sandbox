// Catalog of common BAS sensor signal types. Vendor-neutral but the templates
// match what a tech actually pulls out of a box:
//   - Pt1000 RTD: typical zone temp on JCI/Honeywell, BACnet/IP devices
//   - 10kΩ Type II thermistor: JCI's signature curve for VMA-series VAVs
//   - 0–10V analog: damper position feedback, humidity, CO₂
//   - 4–20mA loop: pressure (Setra/Veris), flow, longer cable runs
//   - Dry contact: airflow proof, fan status, end-switch
//
// Each carries enough metadata to render a reasonable subtitle on a sensor
// node without the user having to click into anything ("Pt1000 RTD · -40-250°F").

export type SensorSignal =
  | 'rtd-pt1000'
  | 'thermistor-10k-t2'
  | 'analog-0-10v'
  | 'analog-4-20ma'
  | 'binary-dry';

export interface SensorTemplate {
  id: SensorSignal;
  /** Short label shown on chips and subtitles. */
  label: string;
  /** Native measurement units. */
  units: string;
  /** Sensor's electrical range (°F for RTDs/thermistors, % for analog, etc.). */
  range: [number, number];
  /** Typical poll cadence the supervisor uses for this signal type (wall seconds). */
  pollSec: number;
  /** Manufacturer-typical accuracy spec. */
  accuracy: string;
  /** Default measurement subject — what this sensor usually monitors. */
  subject: 'temp' | 'pressure' | 'humidity' | 'position' | 'status';
}

export const SENSOR_TEMPLATES: readonly SensorTemplate[] = [
  {
    id: 'rtd-pt1000',
    label: 'Pt1000 RTD',
    units: '°F',
    range: [-40, 250],
    pollSec: 5,
    accuracy: '±0.3°F',
    subject: 'temp',
  },
  {
    id: 'thermistor-10k-t2',
    label: '10kΩ Type II',
    units: '°F',
    range: [-40, 250],
    pollSec: 5,
    accuracy: '±0.36°F',
    subject: 'temp',
  },
  {
    id: 'analog-0-10v',
    label: '0–10V',
    units: '%',
    range: [0, 100],
    pollSec: 10,
    accuracy: '±1%',
    subject: 'position',
  },
  {
    id: 'analog-4-20ma',
    label: '4–20mA',
    units: 'in WC',
    range: [-1, 5],
    pollSec: 10,
    accuracy: '±0.5%',
    subject: 'pressure',
  },
  {
    id: 'binary-dry',
    label: 'Dry contact',
    units: '',
    range: [0, 1],
    pollSec: 1,
    accuracy: 'binary',
    subject: 'status',
  },
];

export const SENSOR_TEMPLATE_BY_ID = new Map<SensorSignal, SensorTemplate>(
  SENSOR_TEMPLATES.map((t) => [t.id, t]),
);

/** Default signal type for a fresh sensor drop. */
export const DEFAULT_SENSOR_SIGNAL: SensorSignal = 'rtd-pt1000';
