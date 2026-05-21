// Single-zone AHU with economizer — the BAS-tech textbook scenario.
//
// Maps to ASHRAE Guideline 36 §5.5 (single-zone systems): air-side
// economizer enable, discharge-air temp control via cascaded heating/
// cooling, freeze protection, smoke shutdown, supply-fan staging.
//
// This is the scenario every commissioning tech sees on a Tuesday
// morning. The point list, sensor types, terminal assignments, and
// programming sequence below match what a Distech/JCI/Tridium tech
// would actually see in the field.

import type { ScenarioDefinition } from './types.js';

export const AHU_ECONOMIZER: ScenarioDefinition = {
  id: 'ahu-economizer',
  title: 'Single-Zone AHU with Economizer',
  tagline:
    'Textbook G36 single-zone AHU — mixed-air economizer, heating + cooling coils, freeze protection, smoke shutdown.',
  difficulty: 'tech',
  estimatedMinutes: 30,
  reference: 'ASHRAE Guideline 36 §5.5 (Single-Zone Systems)',

  context: `You are commissioning a roof-top AHU (~2,000 CFM) serving an open
office space. The unit was installed last week by the mechanical contractor;
your job is to drop a controller, wire up the points listed on the engineer's
submittal, and program the G36 single-zone sequence.

Mechanical hands you the duct drawings: mixed-air plenum has a temp sensor
and a freezestat across the cooling coil face. Discharge-air temp sensor is
6 ft downstream of the heating coil. Outside-air and return-air ducts each
have temp sensors for enthalpy economizer logic. A duct-mounted smoke
detector sits per NFPA 90A on the supply side. Supply fan is a VFD-driven
plug fan with a current-sensing run-status switch.`,

  equipment: [
    {
      tag: 'AHU-1',
      role: 'Field controller (16+ points, MS/TP)',
      preferredModelId: 'distech-ecy-vav',
      kind: 'controller',
      hints: { minPoints: 10, protocols: ['BACnet MS/TP'] },
      rationale:
        'Distech ECY-VAV has 10 onboard points (5 UI / 2 AO / 3 BO) and speaks BACnet MS/TP. Tight but adequate for a single-zone AHU.',
    },
    {
      tag: 'MA-T',
      role: 'Mixed-air temp sensor (duct-averaging)',
      preferredModelId: 'jci-te-6300',
      kind: 'sensor',
      hints: { sensorSubject: 'temp' },
      rationale:
        'Duct-averaging Pt1000 across the mixed-air plenum. JCI TE-6300 covers the typical 18-ft averaging element used on small AHUs.',
    },
    {
      tag: 'DA-T',
      role: 'Discharge-air temp sensor (duct probe)',
      preferredModelId: 'jci-te-6300',
      kind: 'sensor',
      hints: { sensorSubject: 'temp' },
      rationale:
        'Discharge-air sensor 6 ft downstream of the heating coil. Same Pt1000 probe family as MA-T for consistency.',
    },
    {
      tag: 'OA-T',
      role: 'Outdoor-air temp sensor',
      preferredModelId: 'greystone-te200',
      kind: 'sensor',
      hints: { sensorSubject: 'temp' },
      rationale:
        'Outdoor temp with sun shield. Drives the dry-bulb economizer enable decision.',
    },
    {
      tag: 'RA-T',
      role: 'Return-air temp sensor (duct probe)',
      preferredModelId: 'jci-te-6300',
      kind: 'sensor',
      hints: { sensorSubject: 'temp' },
      rationale:
        'Return-air temp; used for differential dry-bulb economizer (OA-T vs RA-T).',
    },
    {
      tag: 'DS-P',
      role: 'Duct static pressure transducer',
      preferredModelId: 'veris-pxplx-001',
      kind: 'sensor',
      hints: { sensorSubject: 'pressure-static' },
      rationale:
        'Building static reference for the VFD fan-speed control. Veris PXPLX low-range 0-10V works well here.',
    },
    {
      tag: 'FREEZE',
      role: 'Freezestat across CC face',
      preferredModelId: 'jci-a70ha',
      kind: 'safety',
      hints: { safetyKind: 'freezestat' },
      rationale:
        'Manual-reset low-limit cutout sensing the cooling-coil face. Trips below 38°F. NC dry contact wired to a BI — fail-safe by wire break.',
    },
    {
      tag: 'SMOKE',
      role: 'Duct smoke detector (supply)',
      preferredModelId: 'system-sensor-d4120',
      kind: 'safety',
      hints: { safetyKind: 'duct-smoke' },
      rationale:
        'NFPA 90A requires a supply-side duct smoke detector on units > 2,000 CFM with shutdown of the AHU on alarm.',
    },
  ],

  wires: [
    { fromTag: 'AHU-1', toTag: 'MA-T', wireKind: 'hardwired', note: 'MA-T → UI-1 (configured as Pt1000 RTD)' },
    { fromTag: 'AHU-1', toTag: 'DA-T', wireKind: 'hardwired', note: 'DA-T → UI-2 (configured as Pt1000 RTD)' },
    { fromTag: 'AHU-1', toTag: 'OA-T', wireKind: 'hardwired', note: 'OA-T → UI-3 (configured as Pt1000 RTD)' },
    { fromTag: 'AHU-1', toTag: 'RA-T', wireKind: 'hardwired', note: 'RA-T → UI-4 (configured as Pt1000 RTD)' },
    { fromTag: 'AHU-1', toTag: 'DS-P', wireKind: 'hardwired', note: 'DS-P → UI-5 (configured as 0-10V analog)' },
    { fromTag: 'AHU-1', toTag: 'FREEZE', wireKind: 'hardwired', note: 'Freezestat → any unused UI (or a JCI NCE25 BI in production). Real install also lands in series with the fan-start contactor (NC, fail-safe by wire break).' },
    { fromTag: 'AHU-1', toTag: 'SMOKE', wireKind: 'hardwired', note: 'Smoke detector aux contact → unused UI; trip drops fan + dampers in code AND breaks the hardware safety chain.' },
  ],

  program: {
    language: 'fbd',
    requiredBlocks: ['INPUT', 'OUTPUT', 'CONST', 'PID', 'SUB', 'AND', 'OR', 'LT', 'SEL', 'NOT'],
    // Full G36 starter sequence — wired to pass every runtime check.
    // Loading this drops the user straight to "now study + tweak", not
    // "draw 28 blocks from scratch." Each block id is human-readable
    // so the FBD canvas + ST source are both legible.
    starterGraph: {
      nodes: [
        // ── Inputs ─────────────────────────────────────────────────
        { id: 'in_sensed',   blockType: 'INPUT',  params: { source: 'sensed' } },
        { id: 'in_setpoint', blockType: 'INPUT',  params: { source: 'setpoint' } },
        { id: 'in_oat',      blockType: 'INPUT',  params: { source: 'oat' } },
        { id: 'in_ra',       blockType: 'INPUT',  params: { source: 'ra' } },
        { id: 'in_freeze',   blockType: 'INPUT',  params: { source: 'freeze' } },
        { id: 'in_smoke',    blockType: 'INPUT',  params: { source: 'smoke' } },

        // ── PID on DA-T error ──────────────────────────────────────
        { id: 'err',         blockType: 'SUB' },
        { id: 'pid',         blockType: 'PID',    params: { Kp: 0.3, Ki: 0.001, Kd: 0 } },

        // ── Economizer enable logic ────────────────────────────────
        { id: 'k_65',        blockType: 'CONST',  params: { value: 65 } },
        { id: 'oa_low',      blockType: 'LT' },
        { id: 'k_2',         blockType: 'CONST',  params: { value: 2 } },
        { id: 'ra_minus_2',  blockType: 'SUB' },
        { id: 'oa_below_ra', blockType: 'LT' },
        { id: 'econ_logic',  blockType: 'AND' },

        // ── Trip detection (freeze + smoke fail-safe NC) ───────────
        { id: 'freeze_trip', blockType: 'NOT' },
        { id: 'smoke_trip',  blockType: 'NOT' },
        { id: 'any_trip',    blockType: 'OR' },

        // ── Constants for SEL fallbacks ────────────────────────────
        { id: 'k_0',         blockType: 'CONST',  params: { value: 0 } },
        { id: 'k_1',         blockType: 'CONST',  params: { value: 1 } },
        { id: 'k_02',        blockType: 'CONST',  params: { value: 0.2 } },

        // ── Selectors gate every output on the trip signal ─────────
        { id: 'sel_act',     blockType: 'SEL' },
        { id: 'sel_fan',     blockType: 'SEL' },
        { id: 'sel_damper',  blockType: 'SEL' },
        { id: 'sel_econ',    blockType: 'SEL' },

        // ── Outputs ────────────────────────────────────────────────
        { id: 'out_act',     blockType: 'OUTPUT', params: { target: 'actuator' } },
        { id: 'out_fan',     blockType: 'OUTPUT', params: { target: 'fan_cmd' } },
        { id: 'out_damper',  blockType: 'OUTPUT', params: { target: 'oa_damper' } },
        { id: 'out_econ',    blockType: 'OUTPUT', params: { target: 'econ_enable' } },
      ],
      edges: [
        // err = sensed - setpoint
        { from: { nodeId: 'in_sensed',   port: 'q' }, to: { nodeId: 'err', port: 'a' } },
        { from: { nodeId: 'in_setpoint', port: 'q' }, to: { nodeId: 'err', port: 'b' } },
        // pid = PID(err, Kp, Ki, Kd)
        { from: { nodeId: 'err',         port: 'q' }, to: { nodeId: 'pid', port: 'error' } },

        // oa_low = oat < 65
        { from: { nodeId: 'in_oat',      port: 'q' }, to: { nodeId: 'oa_low', port: 'a' } },
        { from: { nodeId: 'k_65',        port: 'q' }, to: { nodeId: 'oa_low', port: 'b' } },
        // ra_minus_2 = ra - 2
        { from: { nodeId: 'in_ra',       port: 'q' }, to: { nodeId: 'ra_minus_2', port: 'a' } },
        { from: { nodeId: 'k_2',         port: 'q' }, to: { nodeId: 'ra_minus_2', port: 'b' } },
        // oa_below_ra = oat < (ra - 2)
        { from: { nodeId: 'in_oat',      port: 'q' }, to: { nodeId: 'oa_below_ra', port: 'a' } },
        { from: { nodeId: 'ra_minus_2',  port: 'q' }, to: { nodeId: 'oa_below_ra', port: 'b' } },
        // econ_logic = oa_low AND oa_below_ra
        { from: { nodeId: 'oa_low',      port: 'q' }, to: { nodeId: 'econ_logic', port: 'a' } },
        { from: { nodeId: 'oa_below_ra', port: 'q' }, to: { nodeId: 'econ_logic', port: 'b' } },

        // freeze_trip = NOT freeze  (freeze=1 normal NC closed → 0 not tripped)
        { from: { nodeId: 'in_freeze',   port: 'q' }, to: { nodeId: 'freeze_trip', port: 'in' } },
        // smoke_trip = NOT smoke
        { from: { nodeId: 'in_smoke',    port: 'q' }, to: { nodeId: 'smoke_trip', port: 'in' } },
        // any_trip = freeze_trip OR smoke_trip
        { from: { nodeId: 'freeze_trip', port: 'q' }, to: { nodeId: 'any_trip', port: 'a' } },
        { from: { nodeId: 'smoke_trip',  port: 'q' }, to: { nodeId: 'any_trip', port: 'b' } },

        // actuator = SEL(any_trip, 0, pid)
        { from: { nodeId: 'any_trip',    port: 'q' }, to: { nodeId: 'sel_act', port: 'sel' } },
        { from: { nodeId: 'k_0',         port: 'q' }, to: { nodeId: 'sel_act', port: 'a' } },
        { from: { nodeId: 'pid',         port: 'q' }, to: { nodeId: 'sel_act', port: 'b' } },
        { from: { nodeId: 'sel_act',     port: 'q' }, to: { nodeId: 'out_act', port: 'in' } },

        // fan_cmd = SEL(any_trip, 0, 1)
        { from: { nodeId: 'any_trip',    port: 'q' }, to: { nodeId: 'sel_fan', port: 'sel' } },
        { from: { nodeId: 'k_0',         port: 'q' }, to: { nodeId: 'sel_fan', port: 'a' } },
        { from: { nodeId: 'k_1',         port: 'q' }, to: { nodeId: 'sel_fan', port: 'b' } },
        { from: { nodeId: 'sel_fan',     port: 'q' }, to: { nodeId: 'out_fan', port: 'in' } },

        // oa_damper = SEL(any_trip, 0, 0.2)
        { from: { nodeId: 'any_trip',    port: 'q' }, to: { nodeId: 'sel_damper', port: 'sel' } },
        { from: { nodeId: 'k_0',         port: 'q' }, to: { nodeId: 'sel_damper', port: 'a' } },
        { from: { nodeId: 'k_02',        port: 'q' }, to: { nodeId: 'sel_damper', port: 'b' } },
        { from: { nodeId: 'sel_damper',  port: 'q' }, to: { nodeId: 'out_damper', port: 'in' } },

        // econ_enable = SEL(any_trip, 0, econ_logic)
        { from: { nodeId: 'any_trip',    port: 'q' }, to: { nodeId: 'sel_econ', port: 'sel' } },
        { from: { nodeId: 'k_0',         port: 'q' }, to: { nodeId: 'sel_econ', port: 'a' } },
        { from: { nodeId: 'econ_logic',  port: 'q' }, to: { nodeId: 'sel_econ', port: 'b' } },
        { from: { nodeId: 'sel_econ',    port: 'q' }, to: { nodeId: 'out_econ', port: 'in' } },
      ],
    },
    sequence: [
      '1. Discharge-air temp control (DA-T → setpoint via PID)',
      '   Single PID loop chasing DA-T to setpoint (55°F cool / 90°F heat depending on mode).',
      '   Output 0–100% drives a SEL block that splits across cooling-coil valve (CC-V) and heating-coil valve (HC-V).',
      '   Below 50% → cooling, above 50% → heating, 50% deadband = neither.',
      '',
      '2. Economizer enable',
      '   Enable = (OA-T < 65°F) AND (OA-T < RA-T - 2°F)',
      '   When enabled, modulate OA damper to drive MA-T toward DA-T setpoint - 4°F (first stage of free cooling).',
      '   When disabled, OA damper minimum position = 20% (ventilation minimum).',
      '',
      '3. Freeze protection (hardwired + software)',
      '   Hardware: A70HA NC contact in series with fan-start circuit — wire break = fan stops.',
      '   Software: when BI for FREEZE = open (tripped), force OA damper to 0%, close CC valve, full open HC valve,',
      '   set fan stop, raise alarm.',
      '',
      '4. Smoke shutdown',
      '   When BI for SMOKE = active, immediately stop fan, close OA damper, close both coil valves.',
      '   Manual reset only — alarm latches until cleared at the panel.',
      '',
      '5. Duct static pressure control',
      '   PID controlling fan VFD speed to maintain DS-P = 1.0 in WC setpoint.',
      '   Reset DS-P setpoint up to 1.5 in WC when zone calls for high airflow (out of scope for v1).',
    ],
  },

  runtimeChecks: [
    {
      id: 'cooling-engages-hot-load',
      description: 'Cooling-coil valve opens when discharge temp is above setpoint under hot load.',
      // freeze=1 = NC closed = healthy. ra=75 (typical return).
      inputs: { sensed: 78, setpoint: 55, oat: 90, ra: 75, freeze: 1, smoke: 1 },
      expects: [{ output: 'actuator', min: 0.7, max: 1.0 }],
    },
    {
      id: 'cooling-disengages-met',
      description: 'Cooling-coil valve closes when discharge temp drops to setpoint.',
      inputs: { sensed: 55, setpoint: 55, oat: 90, ra: 75, freeze: 1, smoke: 1 },
      expects: [{ output: 'actuator', min: 0, max: 0.15 }],
    },
    {
      id: 'economizer-enables-cool-out',
      description: 'Economizer enable goes true when OA-T < 65°F AND OA-T < RA-T - 2°F.',
      inputs: { sensed: 55, setpoint: 55, oat: 50, ra: 72, freeze: 1, smoke: 1 },
      expects: [{ output: 'econ_enable', approx: 1, tolerance: 0.01 }],
    },
    {
      id: 'freeze-trip-shuts-fan',
      description: 'Freezestat trip (BI low → freeze=0) drops fan and closes OA damper.',
      inputs: { sensed: 33, setpoint: 55, oat: 28, ra: 60, freeze: 0, smoke: 1 },
      expects: [
        { output: 'fan_cmd', approx: 0, tolerance: 0.01 },
        { output: 'oa_damper', approx: 0, tolerance: 0.05 },
      ],
    },
    {
      id: 'smoke-shutdown-all',
      description: 'Smoke trip (BI low → smoke=0) drops fan, closes OA damper, closes all coil valves.',
      inputs: { sensed: 55, setpoint: 55, oat: 70, ra: 72, freeze: 1, smoke: 0 },
      expects: [
        { output: 'fan_cmd', approx: 0, tolerance: 0.01 },
        { output: 'oa_damper', approx: 0, tolerance: 0.05 },
        { output: 'actuator', approx: 0, tolerance: 0.05 },
      ],
    },
  ],
};
