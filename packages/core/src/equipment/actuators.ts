// Real-world actuator catalog.
//
// An actuator is the muscle that turns a controller output into physical
// motion: damper position, valve stroke, motor speed, contactor state.
// The controller's AO/BO/UO terminal wires INTO the actuator's signal
// input. Many actuators also have a position-feedback line that wires
// BACK to a controller UI/AI — closing the loop so the program can see
// "did the damper actually move where I told it to?"
//
// Modeling actuators as their own nodes (rather than implicit at the
// controller's terminal) lets the sandbox:
//   - validate wire-signal compatibility (BO can't drive a modulating
//     actuator; AO can't drive a binary contactor)
//   - simulate stroke time (a real damper takes 60-150s to fully open)
//   - inject failure modes (stuck actuator, lost feedback, spring-return
//     failed open) — the kind of thing real techs diagnose in the field
//   - generate accurate commissioning docs ("AO-1 → Belimo AF24-MFT →
//     mixed-air damper") instead of vague "AO-1 → actuator"

export type ActuatorKind =
  | 'damper-modulating'  // 0-10V / 2-10V / 4-20mA proportional damper
  | 'damper-binary'      // 2-position (open/closed) damper, 24VAC
  | 'valve-modulating'   // proportional valve (cooling/heating coil)
  | 'valve-floating'     // 3-point floating valve (open/close pulses)
  | 'valve-binary'       // 2-position valve
  | 'vfd'                // variable frequency drive (fan / pump speed)
  | 'contactor'          // binary motor starter (fan on/off)
  | 'pump-relay';        // primary/secondary loop pump starter

/** Signal type the actuator EXPECTS from the controller. Pair this with
 *  the controller's terminal kind during wire validation. */
export type ActuatorSignal =
  | 'analog-0-10v'
  | 'analog-2-10v'
  | 'analog-4-20ma'
  | 'binary-dry'         // dry-contact / 24VAC pulse / relay
  | 'three-point'        // 24VAC, two contacts (open + close)
  | 'bacnet-mstp';       // networked actuator (Belimo MFT)

export type FailSafePosition = 'open' | 'closed' | 'last' | 'min-ventilation';

export interface ActuatorModel {
  readonly id: string;
  readonly vendor: string;
  readonly model: string;
  readonly kind: ActuatorKind;
  readonly signal: ActuatorSignal;
  /** Stroke / response time from 0% to 100% command in seconds.
   *  Damper actuators are slow (60-150s typical); VFDs ramp faster
   *  (10-30s); contactors latch instantly (~0.05s). */
  readonly strokeSeconds: number;
  /** What the actuator does when control power is lost. Spring-return
   *  actuators go to their fail-safe position; non-spring-return hold
   *  their last commanded position. */
  readonly failSafe: FailSafePosition;
  /** True if this actuator reports its actual position back via a
   *  separate analog signal (typically 2-10V or 4-20mA). Lets the
   *  controller close the loop and detect "actuator commanded but
   *  hasn't moved" faults. */
  readonly hasPositionFeedback: boolean;
  /** Native current draw at full stroke — informs panel sizing in real
   *  installations. Not used by the sim but shown in the catalog. */
  readonly currentDraw: string;
  readonly notes: string;
}

export const ACTUATOR_CATALOG: readonly ActuatorModel[] = [
  // ── Damper actuators — modulating ─────────────────────────────────────
  {
    id: 'belimo-af24-mft',
    vendor: 'Belimo',
    model: 'AF24-MFT',
    kind: 'damper-modulating',
    signal: 'analog-2-10v',
    strokeSeconds: 95,
    failSafe: 'closed',
    hasPositionFeedback: true,
    currentDraw: '3 VA holding, 4.5 VA running',
    notes: 'Spring-return modulating damper actuator, 180 in-lb torque. Universal — MFT lets you reconfigure signal type in the field. Standard on commercial OA / RA dampers.',
  },
  {
    id: 'belimo-amb24-3-sr',
    vendor: 'Belimo',
    model: 'AMB24-3-SR',
    kind: 'damper-modulating',
    signal: 'analog-2-10v',
    strokeSeconds: 90,
    failSafe: 'closed',
    hasPositionFeedback: true,
    currentDraw: '4 VA',
    notes: 'Non fail-safe — holds last position on power loss. 90 in-lb. Cheaper than spring-return AF for non-critical zones.',
  },
  {
    id: 'honeywell-ml6161',
    vendor: 'Honeywell',
    model: 'ML6161B',
    kind: 'damper-modulating',
    signal: 'analog-0-10v',
    strokeSeconds: 75,
    failSafe: 'last',
    hasPositionFeedback: false,
    currentDraw: '6 VA',
    notes: 'Legacy 0-10V damper drive, no position feedback. Common on older AHU retrofits — watch for ground-loop noise on long signal runs.',
  },

  // ── Damper actuators — 2-position binary ──────────────────────────────
  {
    id: 'belimo-tf24-s',
    vendor: 'Belimo',
    model: 'TF24-S',
    kind: 'damper-binary',
    signal: 'binary-dry',
    strokeSeconds: 75,
    failSafe: 'closed',
    hasPositionFeedback: true,
    currentDraw: '2.5 VA',
    notes: 'Spring-return 2-position damper. Pulled in to open, releases to close on power loss or BO de-energize. Built-in aux switch for end-of-travel feedback.',
  },

  // ── Valve actuators — modulating ──────────────────────────────────────
  {
    id: 'belimo-lr24-3',
    vendor: 'Belimo',
    model: 'LR24-3',
    kind: 'valve-modulating',
    signal: 'analog-2-10v',
    strokeSeconds: 95,
    failSafe: 'closed',
    hasPositionFeedback: true,
    currentDraw: '1 VA',
    notes: 'Non-spring-return rotary valve actuator. Pair with characterized ball valve. 45 in-lb. Standard for VAV reheat coils, 2-way or 3-way.',
  },
  {
    id: 'belimo-b2-fr',
    vendor: 'Belimo',
    model: 'B2-Series w/ AFRB24-SR',
    kind: 'valve-modulating',
    signal: 'analog-2-10v',
    strokeSeconds: 150,
    failSafe: 'closed',
    hasPositionFeedback: true,
    currentDraw: '6 VA',
    notes: 'Fail-safe modulating valve actuator (spring closes on power loss). Use on hot-water coils to prevent freeze damage if AHU loses power.',
  },
  {
    id: 'honeywell-vc6013',
    vendor: 'Honeywell',
    model: 'VC6013',
    kind: 'valve-modulating',
    signal: 'analog-0-10v',
    strokeSeconds: 90,
    failSafe: 'last',
    hasPositionFeedback: false,
    currentDraw: '5 VA',
    notes: 'Direct-coupled 2-way / 3-way valve actuator. Common on FCU coils. No feedback — controller has to infer position from process variable.',
  },

  // ── Valve actuators — floating point ──────────────────────────────────
  {
    id: 'belimo-arx24-mft-floating',
    vendor: 'Belimo',
    model: 'ARX24-MFT (floating)',
    kind: 'valve-floating',
    signal: 'three-point',
    strokeSeconds: 110,
    failSafe: 'last',
    hasPositionFeedback: false,
    currentDraw: '3.5 VA',
    notes: '3-point floating: one BO opens, another BO closes, neither energized = hold. Older sequence still common on retrofits. Modulation precision is limited.',
  },

  // ── 2-position valves (FCU isolation, etc.) ───────────────────────────
  {
    id: 'honeywell-v8043',
    vendor: 'Honeywell',
    model: 'V8043',
    kind: 'valve-binary',
    signal: 'binary-dry',
    strokeSeconds: 12,
    failSafe: 'closed',
    hasPositionFeedback: false,
    currentDraw: '24 VAC, 0.3 A',
    notes: 'Spring-return 2-position zone valve. Common on hydronic baseboard / FCU. End-switch confirms position once stroked.',
  },

  // ── VFDs (variable frequency drives) ──────────────────────────────────
  {
    id: 'abb-acs320',
    vendor: 'ABB',
    model: 'ACS320',
    kind: 'vfd',
    signal: 'analog-0-10v',
    strokeSeconds: 25,
    failSafe: 'closed',
    hasPositionFeedback: true,
    currentDraw: '3-phase, motor-dependent',
    notes: 'Commercial HVAC VFD for supply/return fans and circulator pumps. Takes 0-10V speed reference, returns actual Hz + amp feedback. Default ramp 20 s/Hz on a 60 Hz motor.',
  },
  {
    id: 'danfoss-fc101',
    vendor: 'Danfoss',
    model: 'FC-101 HVAC',
    kind: 'vfd',
    signal: 'analog-4-20ma',
    strokeSeconds: 30,
    failSafe: 'closed',
    hasPositionFeedback: true,
    currentDraw: '3-phase, motor-dependent',
    notes: 'Compact HVAC VFD with built-in BACnet/IP. 4-20mA speed reference (more noise-immune over long control runs than 0-10V).',
  },

  // ── Contactors / motor starters ───────────────────────────────────────
  {
    id: 'square-d-classII-contactor',
    vendor: 'Square D / Schneider',
    model: 'Class II 8536 (NEMA Size 0-3)',
    kind: 'contactor',
    signal: 'binary-dry',
    strokeSeconds: 0.05,
    failSafe: 'closed',
    hasPositionFeedback: true,
    currentDraw: '120 VAC coil',
    notes: 'Standard motor starter for fixed-speed fans / pumps. Aux contact wires back to a BI for run-proven feedback ("did the motor actually start?").',
  },
];

export function findActuatorModel(id: string): ActuatorModel | undefined {
  return ACTUATOR_CATALOG.find((a) => a.id === id);
}

export function actuatorCatalogByKind(): Map<ActuatorKind, ActuatorModel[]> {
  const map = new Map<ActuatorKind, ActuatorModel[]>();
  for (const a of ACTUATOR_CATALOG) {
    const arr = map.get(a.kind) ?? [];
    arr.push(a);
    map.set(a.kind, arr);
  }
  return map;
}
