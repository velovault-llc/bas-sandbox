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
    { fromTag: 'AHU-1', toTag: 'MA-T', wireKind: 'hardwired', note: 'MA-T → UI-1 (Pt1000 RTD)' },
    { fromTag: 'AHU-1', toTag: 'DA-T', wireKind: 'hardwired', note: 'DA-T → UI-2 (Pt1000 RTD)' },
    { fromTag: 'AHU-1', toTag: 'OA-T', wireKind: 'hardwired', note: 'OA-T → UI-3 (Pt1000 RTD)' },
    { fromTag: 'AHU-1', toTag: 'RA-T', wireKind: 'hardwired', note: 'RA-T → UI-4 (Pt1000 RTD)' },
    { fromTag: 'AHU-1', toTag: 'DS-P', wireKind: 'hardwired', note: 'DS-P → UI-5 (0–10V)' },
    { fromTag: 'AHU-1', toTag: 'FREEZE', wireKind: 'hardwired', note: 'Freezestat → BO-3 in series with fan-start contactor (NC, fail-safe by wire break). For the sandbox: wire to a BI input that monitors the safety chain.' },
    { fromTag: 'AHU-1', toTag: 'SMOKE', wireKind: 'hardwired', note: 'Smoke detector aux contact → another BI; trip drops fan + dampers in code AND breaks the hardware safety chain.' },
  ],

  program: {
    language: 'fbd',
    requiredBlocks: ['INPUT', 'OUTPUT', 'CONST', 'PID', 'SUB', 'AND', 'GT', 'LT', 'SEL', 'NOT'],
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
      inputs: { sensed: 78, setpoint: 55, oat: 90 },
      expects: [{ output: 'actuator', min: 0.7, max: 1.0 }],
    },
    {
      id: 'cooling-disengages-met',
      description: 'Cooling-coil valve closes when discharge temp drops to setpoint.',
      inputs: { sensed: 55, setpoint: 55, oat: 90 },
      expects: [{ output: 'actuator', min: 0, max: 0.15 }],
    },
    {
      id: 'economizer-enables-cool-out',
      description: 'Economizer enable goes true when OA-T < 65°F AND OA-T < RA-T - 2°F.',
      inputs: { sensed: 55, setpoint: 55, oat: 50 },
      expects: [{ output: 'econ_enable', approx: 1, tolerance: 0.01 }],
    },
    {
      id: 'freeze-trip-shuts-fan',
      description: 'Freezestat trip (BI low) drops fan and closes OA damper.',
      inputs: { sensed: 33, setpoint: 55, oat: 28, freeze: 0 },
      expects: [
        { output: 'fan_cmd', approx: 0, tolerance: 0.01 },
        { output: 'oa_damper', approx: 0, tolerance: 0.05 },
      ],
    },
  ],
};
