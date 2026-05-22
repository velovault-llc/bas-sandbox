// BACnet object model.
//
// Every BACnet controller exposes its data as a list of objects: AI:1
// (analog input #1), AO:3 (analog output #3), BV:12 (binary value #12),
// etc. Supervisors discover devices via Who-Is/I-Am, then query each
// object's PresentValue, ObjectName, Units, etc. via ReadProperty.
//
// The sandbox synthesizes this list per controller from:
//   1. Vendor model point counts → AI/AO/BI/BO objects (one per terminal)
//   2. Point Assignment bindings → ObjectName comes from the bound role
//   3. Program output env-keys (cooling_season, setpoint, …) → AV objects
//
// This is what a tech with YABE / a Niagara Spy view actually sees when
// they open a connection to a controller — it's the data layer of BAS.

export type BacnetObjectType =
  | 'analog-input'      // AI — sensor reading (UI/AI terminals)
  | 'analog-output'     // AO — actuator command (UO/AO terminals)
  | 'analog-value'      // AV — computed value (setpoint, env output)
  | 'binary-input'      // BI — dry contact in
  | 'binary-output'     // BO — relay/triac out
  | 'binary-value'      // BV — computed bool (occupied, season, alarm)
  | 'multistate-value'; // MSV — mode (cool/heat/auto/off)

/** Short prefix used in the standard BACnet "AI:3" notation. */
export const BACNET_TYPE_PREFIX: Record<BacnetObjectType, string> = {
  'analog-input': 'AI',
  'analog-output': 'AO',
  'analog-value': 'AV',
  'binary-input': 'BI',
  'binary-output': 'BO',
  'binary-value': 'BV',
  'multistate-value': 'MSV',
};

export interface BacnetObject {
  /** Standard "AI:3" id. Stable across ticks. */
  readonly id: string;
  readonly type: BacnetObjectType;
  /** Object instance number (1-based, per type). */
  readonly instance: number;
  /** ObjectName property. Comes from the Point Assignment binding when
   *  available ("Zone Temperature"); falls back to "AI-3 (unassigned)". */
  readonly name: string;
  /** Optional description — typically the bound role's hover blurb. */
  readonly description?: string;
  /** Engineering units (BACnet std unit string). Empty for binary types. */
  readonly units?: string;
  /** Current value. Numeric for AI/AO/AV/MSV; boolean for BI/BO/BV. */
  readonly presentValue: number | boolean;
  /** True when an Override (manual mode) is forcing a value. */
  readonly outOfService?: boolean;
  /** Physical terminal this object is bound to, if any. Used by the
   *  panel to show "AO-1 ← Maxitrol M611" wire path. */
  readonly terminalId?: string;
}

/**
 * Format an object id from type + instance:
 *   ('analog-input', 3) → 'AI:3'
 */
export function bacnetObjectId(type: BacnetObjectType, instance: number): string {
  return `${BACNET_TYPE_PREFIX[type]}:${instance}`;
}

/**
 * Standard BACnet engineering-units strings for our subject vocabulary.
 * Real BACnet uses numeric codes (degreesFahrenheit = 64) — we use the
 * human string for display.
 */
export function bacnetUnitsForRole(role: string | undefined): string {
  if (!role) return '';
  switch (role) {
    case 'zone-temp':
    case 'oa-temp':
    case 'cooling-setpoint':
    case 'heating-setpoint':
    case 'hw-supply-temp':
    case 'hw-return-temp':
    case 'chw-supply-temp':
    case 'chw-return-temp':
      return '°F';
    case 'humidity':
      return '%RH';
    case 'co2':
      return 'ppm';
    case 'airflow':
      return 'CFM';
    case 'damper-position':
    case 'valve-position':
    case 'primary-damper':
    case 'reheat-valve':
    case 'cooling-valve':
    case 'oa-damper':
    case 'burner-mod':
    case 'chiller-stage':
    case 'tower-fan':
      return '%';
    case 'occupancy':
    case 'heating-season':
    case 'cooling-season':
    case 'chiller-enable':
      return ''; // boolean / multistate, no units
    default:
      return '';
  }
}
