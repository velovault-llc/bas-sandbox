// BACnet object catalog — authoritative reference for the conformance
// checker. Combines two sources:
//
//   1. ASHRAE Standard 135-2024 §12 — defines every BACnet object's
//      required + optional properties. Free read-only at:
//      https://ashrae.iwrapper.com/ASHRAE_PREVIEW_ONLY_STANDARDS/STD_135_2024
//
//   2. JCI Metasys Site Management Portal Help — JCI's own attribute
//      tables for each Metasys object. The Metasys product family is
//      the most-deployed BACnet supervisor in North America; their
//      attribute extensions (Use COV Min Send Time, Use Remote
//      Alarming, Intrinsic Alarming Defined, etc.) are documented as
//      proprietary extensions on top of the standard objects.
//
// Numeric property IDs come from §12 of the spec. We only catalog
// objects + properties the sandbox actually emits or might soon —
// growing the table is one TS edit + a conformance rule pickup.
//
// Letter codes from the JCI help (preserved here for cross-reference):
//   B - Exposed as standard BACnet property
//   C - Configurable
//   D - Default Attribute for Display
//   N - Value Not Required
//   R - Affected by Extension's Reliability
//   W - Writable

/** Numeric BACnet object type code, as defined in ASHRAE 135 §12. */
export type BacnetObjectTypeCode =
  | 0  // analog-input
  | 1  // analog-output
  | 2  // analog-value
  | 3  // binary-input
  | 4  // binary-output
  | 5  // binary-value
  | 6  // calendar
  | 8  // device
  | 9  // event-enrollment
  | 12 // loop
  | 13 // multi-state-input
  | 14 // multi-state-output
  | 15 // notification-class
  | 17 // schedule
  | 19 // multi-state-value
  | 20 // trend-log
  | 23; // accumulator

export interface BacnetPropertyDef {
  /** Property name in spec-canonical kebab-case (e.g., "present-value"). */
  readonly name: string;
  /** Numeric property identifier from ASHRAE 135 §12 / §21. */
  readonly id: number;
  /** Per §12, is the property required on this object type? */
  readonly required: boolean;
  /** ASHRAE 135 type tag for the property value. */
  readonly type: string;
  /** When true, this property is JCI proprietary (not in the spec).
   *  These appear in Metasys help but won't show up in a non-JCI device. */
  readonly jciProprietary?: boolean;
  /** Short description suitable for a tooltip / log annotation. */
  readonly description?: string;
}

export interface BacnetObjectDef {
  /** Spec-canonical name (kebab-case). */
  readonly objectType: string;
  /** Numeric type code from ASHRAE 135 §12. */
  readonly typeCode: BacnetObjectTypeCode;
  /** Human label used by JCI and most BACnet UIs. */
  readonly displayName: string;
  /** One-paragraph summary suitable for a tooltip. */
  readonly description: string;
  /** Required + optional properties. */
  readonly properties: ReadonlyArray<BacnetPropertyDef>;
}

// Common properties present on EVERY BACnet object per §12.1.
// We don't repeat these in each object's `properties` array; instead
// they're queried via `commonProperties()`.
const COMMON_PROPERTIES: readonly BacnetPropertyDef[] = [
  { name: 'object-identifier', id: 75, required: true, type: 'BACnetObjectIdentifier', description: 'Numeric identifier: <type, instance>. Site-wide unique per device.' },
  { name: 'object-name', id: 77, required: true, type: 'CharacterString', description: 'Human-readable name for the object (e.g., "ZN-T-101").' },
  { name: 'object-type', id: 79, required: true, type: 'BACnetObjectType', description: 'Echoes the object type as an enum (analog-input, binary-value, etc.).' },
  { name: 'description', id: 28, required: false, type: 'CharacterString', description: 'Free-text description. Often the rich label the supervisor displays.' },
];

export function commonProperties(): readonly BacnetPropertyDef[] {
  return COMMON_PROPERTIES;
}

// ─────────────────────────────────────────────────────────────────────
// Object catalog
// ─────────────────────────────────────────────────────────────────────

const ANALOG_INPUT: BacnetObjectDef = {
  objectType: 'analog-input',
  typeCode: 0,
  displayName: 'Analog Input',
  description:
    'Reads a physical analog input (RTD, thermistor, 4-20mA, 0-10V). Present Value tracks the calibrated reading. Status flags surface alarm / fault / override / out-of-service. Most common BACnet input type — ~70% of points in a typical HVAC install are AI.',
  properties: [
    { name: 'present-value', id: 85, required: true, type: 'Real', description: 'Current reading in engineering units (e.g., 72.4 °F).' },
    { name: 'status-flags', id: 111, required: true, type: 'BACnetStatusFlags', description: 'Four-bit field: in-alarm, fault, overridden, out-of-service.' },
    { name: 'event-state', id: 36, required: true, type: 'BACnetEventState', description: 'normal / fault / offnormal / high-limit / low-limit.' },
    { name: 'reliability', id: 103, required: false, type: 'BACnetReliability', description: 'no-fault-detected / unreliable-high / unreliable-low / configuration-error / etc.' },
    { name: 'out-of-service', id: 81, required: true, type: 'Boolean', description: 'When true, Present Value is decoupled from the physical input (manual override / commissioning).' },
    { name: 'units', id: 117, required: true, type: 'BACnetEngineeringUnits', description: 'Engineering units (°F, °C, kPa, %, ppm, etc.).' },
    { name: 'min-pres-value', id: 69, required: false, type: 'Real', description: 'Lower bound for reliable Present Value.' },
    { name: 'max-pres-value', id: 65, required: false, type: 'Real', description: 'Upper bound for reliable Present Value.' },
    { name: 'cov-increment', id: 22, required: false, type: 'Real', description: 'Minimum Present Value change that triggers a COV notification.' },
    { name: 'resolution', id: 106, required: false, type: 'Real', description: 'Smallest possible Present Value change (e.g., 0.1 °F).' },
    { name: 'update-interval', id: 118, required: false, type: 'Unsigned', description: 'Time between Present Value updates, in 0.01s units.' },
    // JCI extensions per Metasys SMP help:
    { name: 'jci-use-cov-min-send-time', id: 16000, required: false, type: 'Boolean', jciProprietary: true, description: '[JCI] Force COV on a fixed period instead of strictly on Present Value change exceeding cov-increment.' },
    { name: 'jci-use-remote-alarming', id: 16001, required: false, type: 'Boolean', jciProprietary: true, description: '[JCI] When true, accept alarms from remote integrated object; when false, originate at the local NxE.' },
    { name: 'jci-intrinsic-alarming-defined', id: 16002, required: false, type: 'Boolean', jciProprietary: true, description: '[JCI] Enable BACnet Intrinsic Alarming on this object.' },
  ],
};

const ANALOG_VALUE: BacnetObjectDef = {
  objectType: 'analog-value',
  typeCode: 2,
  displayName: 'Analog Value',
  description:
    'Holds a calculated or software-only analog value (no physical input). Common for setpoints, calculated values, virtual sensors. Supports priority array for command priority (§19.2).',
  properties: [
    { name: 'present-value', id: 85, required: true, type: 'Real', description: 'Calculated or commanded value.' },
    { name: 'status-flags', id: 111, required: true, type: 'BACnetStatusFlags', description: 'in-alarm / fault / overridden / out-of-service.' },
    { name: 'event-state', id: 36, required: true, type: 'BACnetEventState', description: 'Alarm state.' },
    { name: 'reliability', id: 103, required: false, type: 'BACnetReliability', description: 'Reliability indicator.' },
    { name: 'out-of-service', id: 81, required: true, type: 'Boolean', description: 'Override flag.' },
    { name: 'units', id: 117, required: true, type: 'BACnetEngineeringUnits', description: 'Engineering units.' },
    { name: 'priority-array', id: 87, required: false, type: 'BACnetPriorityArray', description: '16-level command priority array per §19.2.' },
    { name: 'relinquish-default', id: 104, required: false, type: 'Real', description: 'Value used when all priorities are NULL.' },
  ],
};

const BINARY_VALUE: BacnetObjectDef = {
  objectType: 'binary-value',
  typeCode: 5,
  displayName: 'Binary Value',
  description:
    'Calculated/commanded boolean (no physical input). Typical for occupancy state, mode flags, alarm bits. Also supports priority array.',
  properties: [
    { name: 'present-value', id: 85, required: true, type: 'BACnetBinaryPV', description: 'inactive (0) / active (1).' },
    { name: 'status-flags', id: 111, required: true, type: 'BACnetStatusFlags', description: 'in-alarm / fault / overridden / out-of-service.' },
    { name: 'event-state', id: 36, required: true, type: 'BACnetEventState', description: 'Alarm state.' },
    { name: 'out-of-service', id: 81, required: true, type: 'Boolean', description: 'Override flag.' },
    { name: 'inactive-text', id: 46, required: false, type: 'CharacterString', description: 'Human label for the "0" state (e.g., "Unoccupied").' },
    { name: 'active-text', id: 4, required: false, type: 'CharacterString', description: 'Human label for the "1" state (e.g., "Occupied").' },
    { name: 'priority-array', id: 87, required: false, type: 'BACnetPriorityArray', description: '16-level priority array.' },
    { name: 'relinquish-default', id: 104, required: false, type: 'BACnetBinaryPV', description: 'Default value when all priorities NULL.' },
  ],
};

const DEVICE: BacnetObjectDef = {
  objectType: 'device',
  typeCode: 8,
  displayName: 'Device',
  description:
    'Every BACnet device has exactly one Device object. Holds device-wide metadata: device instance, vendor, model, segmentation support, services supported, object list, APDU timeout/retries. The Device object is what gets returned in I-Am.',
  properties: [
    { name: 'system-status', id: 112, required: true, type: 'BACnetDeviceStatus', description: 'operational / fault / no-fault-detected / etc.' },
    { name: 'vendor-name', id: 121, required: true, type: 'CharacterString', description: 'Vendor name as marketed.' },
    { name: 'vendor-identifier', id: 120, required: true, type: 'Unsigned16', description: 'ASHRAE-registered vendor ID number.' },
    { name: 'model-name', id: 70, required: true, type: 'CharacterString', description: 'Vendor model (e.g., "JACE-8000", "NCE25").' },
    { name: 'firmware-revision', id: 44, required: true, type: 'CharacterString', description: 'Firmware version.' },
    { name: 'application-software-version', id: 12, required: true, type: 'CharacterString', description: 'App software version.' },
    { name: 'protocol-version', id: 98, required: true, type: 'Unsigned', description: 'BACnet protocol version (currently 1).' },
    { name: 'protocol-revision', id: 139, required: true, type: 'Unsigned', description: 'BACnet protocol revision (24 for ASHRAE 135-2024).' },
    { name: 'protocol-services-supported', id: 97, required: true, type: 'BACnetServicesSupported', description: 'Bit string — which BACnet services this device implements.' },
    { name: 'protocol-object-types-supported', id: 96, required: true, type: 'BACnetObjectTypesSupported', description: 'Bit string — which BACnet object types this device hosts.' },
    { name: 'object-list', id: 76, required: true, type: 'BACnetARRAY[N] of BACnetObjectIdentifier', description: 'Every object hosted by this device.' },
    { name: 'max-apdu-length-accepted', id: 62, required: true, type: 'Unsigned', description: 'Largest APDU this device can receive.' },
    { name: 'segmentation-supported', id: 107, required: true, type: 'BACnetSegmentation', description: 'segmented-both / segmented-transmit / segmented-receive / no-segmentation.' },
    { name: 'apdu-timeout', id: 11, required: true, type: 'Unsigned', description: 'APDU timeout (ms) before retry. Default 3000.' },
    { name: 'number-of-apdu-retries', id: 73, required: true, type: 'Unsigned', description: 'Max retries before declaring CommunicationLost.' },
    { name: 'database-revision', id: 155, required: true, type: 'Unsigned', description: 'Increments when objects added/removed — supervisor uses to detect schema change.' },
  ],
};

const NOTIFICATION_CLASS: BacnetObjectDef = {
  objectType: 'notification-class',
  typeCode: 15,
  displayName: 'Notification Class',
  description:
    'Routes alarm and event notifications to recipients. Every BACnet object with intrinsic alarming references a Notification Class to determine WHO to notify and how. Recipient list per-priority-level (low / medium / high).',
  properties: [
    { name: 'notification-class', id: 17, required: true, type: 'Unsigned', description: 'Instance number of this notification class.' },
    { name: 'priority', id: 86, required: true, type: 'BACnetARRAY[3] of Unsigned', description: 'Three priority levels (to-offnormal, to-fault, to-normal).' },
    { name: 'ack-required', id: 1, required: true, type: 'BACnetEventTransitionBits', description: 'Which transitions require acknowledgment.' },
    { name: 'recipient-list', id: 102, required: true, type: 'BACnetLIST of BACnetDestination', description: 'Who to notify, when, on which days/hours.' },
  ],
};

const SCHEDULE: BacnetObjectDef = {
  objectType: 'schedule',
  typeCode: 17,
  displayName: 'Schedule',
  description:
    'Time-of-day schedule that writes values to other objects. Weekly schedule (per day-of-week) + exception schedule (calendar-driven). Drives occupied/unoccupied setpoint transitions, lighting schedules, etc.',
  properties: [
    { name: 'effective-period', id: 32, required: true, type: 'BACnetDateRange', description: 'Date range during which the schedule is active.' },
    { name: 'weekly-schedule', id: 123, required: false, type: 'BACnetARRAY[7] of BACnetDailySchedule', description: 'Per-weekday time/value pairs.' },
    { name: 'exception-schedule', id: 38, required: false, type: 'BACnetARRAY[N] of BACnetSpecialEvent', description: 'Calendar-driven overrides (holidays, etc.).' },
    { name: 'schedule-default', id: 174, required: true, type: 'ANY', description: 'Default value when no schedule entry applies.' },
    { name: 'list-of-object-property-references', id: 54, required: true, type: 'BACnetLIST of BACnetDeviceObjectPropertyReference', description: 'Targets to write to as the schedule fires.' },
    { name: 'priority-for-writing', id: 88, required: true, type: 'Unsigned', description: 'Priority level (1-16) used when writing.' },
    { name: 'status-flags', id: 111, required: true, type: 'BACnetStatusFlags', description: 'Standard status bits.' },
    { name: 'reliability', id: 103, required: false, type: 'BACnetReliability', description: 'Reliability indicator.' },
    { name: 'out-of-service', id: 81, required: true, type: 'Boolean', description: 'When true, schedule does not fire.' },
  ],
};

const TREND_LOG: BacnetObjectDef = {
  objectType: 'trend-log',
  typeCode: 20,
  displayName: 'Trend Log',
  description:
    'Periodically samples a property of another object and stores the history. Used for energy reports, performance trending, fault postmortem. Buffer default 144, max 5000 per Metasys docs.',
  properties: [
    { name: 'enable', id: 133, required: true, type: 'Boolean', description: 'Master on/off for trend collection.' },
    { name: 'log-device-object-property', id: 132, required: true, type: 'BACnetDeviceObjectPropertyReference', description: 'What to log.' },
    { name: 'log-interval', id: 134, required: true, type: 'Unsigned', description: 'Sample period in hundredths of a second.' },
    { name: 'buffer-size', id: 126, required: true, type: 'Unsigned', description: 'Maximum number of samples retained.' },
    { name: 'record-count', id: 141, required: true, type: 'Unsigned', description: 'Current sample count.' },
    { name: 'total-record-count', id: 145, required: true, type: 'Unsigned', description: 'Lifetime sample count (rolls past buffer-size).' },
    { name: 'stop-when-full', id: 144, required: true, type: 'Boolean', description: 'true = stop logging when buffer full; false = wrap.' },
  ],
};

export const BACNET_OBJECT_CATALOG: readonly BacnetObjectDef[] = [
  ANALOG_INPUT,
  ANALOG_VALUE,
  BINARY_VALUE,
  DEVICE,
  NOTIFICATION_CLASS,
  SCHEDULE,
  TREND_LOG,
];

/** Look up an object definition by canonical type name. */
export function findObjectDef(objectType: string): BacnetObjectDef | undefined {
  return BACNET_OBJECT_CATALOG.find((o) => o.objectType === objectType);
}

/** Required properties for a given object type, including the four
 *  common properties every BACnet object has. Useful for validating
 *  that an emitted object covers the spec minimum. */
export function requiredProperties(objectType: string): readonly BacnetPropertyDef[] {
  const def = findObjectDef(objectType);
  if (!def) return [];
  const common = COMMON_PROPERTIES.filter((p) => p.required);
  const own = def.properties.filter((p) => p.required && !p.jciProprietary);
  return [...common, ...own];
}

/** All JCI-specific (proprietary) properties — useful when the
 *  conformance checker wants to flag JCI-extension fields appearing
 *  on packets claiming to be from a non-JCI device. */
export function jciExtensions(objectType: string): readonly BacnetPropertyDef[] {
  const def = findObjectDef(objectType);
  if (!def) return [];
  return def.properties.filter((p) => p.jciProprietary === true);
}
