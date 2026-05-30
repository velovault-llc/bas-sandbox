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

/** ASHRAE 135 §12.2.18 Reliability property values. Subset relevant to
 *  the sensor-fault path the sandbox models — the spec defines more
 *  (process-error, multi-state-fault, configuration-error, etc.) we
 *  don't surface yet because no sim path produces them. */
export type BacnetReliability =
  | 'no-fault-detected'  // 0 — sensor is healthy
  | 'over-range'         // 2 — signal above the live range
  | 'under-range'        // 3 — signal below the live range
  | 'open-loop'          // 4 — open circuit (broken wire / unplugged)
  | 'shorted-loop'       // 5 — short circuit (chafed wire / element short)
  | 'no-output'          // 6 — sensor disconnected / no signal at all
  | 'unreliable-other';  // 7 — generic catch-all

/** BACnet Status_Flags bit positions (ASHRAE 135 §12.2.15). All four
 *  bits are always emitted; the shorthand below is "in_alarm,fault,
 *  overridden,oos" with "T" / "F" per bit. */
export interface StatusFlags {
  /** Bit 0 — IN_ALARM. Set when the object is in an alarm state per
   *  its intrinsic alarming config (high/low threshold crossings etc). */
  readonly inAlarm?: boolean;
  /** Bit 1 — FAULT. Set whenever Reliability != 'no-fault-detected'. */
  readonly fault?: boolean;
  /** Bit 2 — OVERRIDDEN. Set when the value is being held by manual
   *  override (out-of-service or write-to-priority-array-priority-1). */
  readonly overridden?: boolean;
  /** Bit 3 — OUT_OF_SERVICE. Set when the controller has decoupled the
   *  object from its physical input/output for commissioning purposes. */
  readonly outOfService?: boolean;
}

/** Normalize StatusFlags into the "T,F,T,F" wire-summary shorthand the
 *  packet log + emitters use throughout the sandbox. */
export function formatStatusFlags(s: StatusFlags | undefined): string {
  const f = (b: boolean | undefined) => (b ? 'T' : 'F');
  if (!s) return 'F,F,F,F';
  return `${f(s.inAlarm)},${f(s.fault)},${f(s.overridden)},${f(s.outOfService)}`;
}

/** Map an ASHRAE-135 reliability code to a human-friendly label. The
 *  packet inspector renders this directly. */
export const RELIABILITY_LABELS: Record<BacnetReliability, string> = {
  'no-fault-detected': 'No fault',
  'over-range': 'Over range',
  'under-range': 'Under range',
  'open-loop': 'Open loop',
  'shorted-loop': 'Shorted loop',
  'no-output': 'No output',
  'unreliable-other': 'Unreliable',
};

/** Numeric ASHRAE-135 code for each reliability state — exported so the
 *  wire encoder can emit the enumerated property correctly. */
export const RELIABILITY_CODES: Record<BacnetReliability, number> = {
  'no-fault-detected': 0,
  'over-range': 2,
  'under-range': 3,
  'open-loop': 4,
  'shorted-loop': 5,
  'no-output': 6,
  'unreliable-other': 7,
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
  /** ASHRAE 135 Reliability property. When omitted, defaults to
   *  'no-fault-detected' in emitters. */
  readonly reliability?: BacnetReliability;
  /** ASHRAE 135 Status_Flags property. When omitted, defaults to
   *  all-clear (F,F,F,F) in emitters. */
  readonly statusFlags?: StatusFlags;
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
