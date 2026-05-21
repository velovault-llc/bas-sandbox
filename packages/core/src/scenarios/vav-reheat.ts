// Single-duct VAV box with hot-water reheat — apprentice-tier scenario.
//
// Maps to ASHRAE Guideline 36 §5.16 (VAV with Reheat, single-duct).
// Smaller than the AHU scenario — 6 equipment items, 5 wires, simpler
// programming. Designed as the "first scenario" for someone new to BAS.
//
// The VAV box modulates a primary-air damper to maintain zone temp via
// a primary cooling sequence; when the zone calls for heat (or for
// ventilation min during occupied hours), a hot-water reheat valve
// modulates open. Real Distech / JCI VAVs follow this same sequence.

import type { ScenarioDefinition } from './types.js';

export const VAV_REHEAT: ScenarioDefinition = {
  id: 'vav-reheat',
  title: 'VAV Box with Reheat',
  tagline:
    'Single-duct VAV box with hot-water reheat — the most common BAS terminal unit. G36 single-duct sequence.',
  difficulty: 'apprentice',
  estimatedMinutes: 20,
  reference: 'ASHRAE Guideline 36 §5.16 (VAV with Reheat)',

  context: `You are commissioning a single-duct VAV box serving a private office.
Primary air is supplied from the upstream AHU at ~55°F discharge. The VAV
box modulates its damper to track zone temp via a primary cooling sequence;
when the zone calls for heat, a 2-way hot-water reheat valve modulates open.

Equipment is straightforward: a Distech VAV controller, a wall-mount zone
temp sensor, a ceiling occupancy sensor for setback, a damper position
feedback, and the reheat valve. No safeties on the VAV side — those live
upstream at the AHU.`,

  equipment: [
    {
      tag: 'VAV-1',
      role: 'VAV unitary controller (single-duct)',
      preferredModelId: 'distech-ecy-vav',
      kind: 'controller',
      hints: { minPoints: 8, protocols: ['BACnet MS/TP'] },
      rationale:
        'Distech ECY-VAV is purpose-built for single-duct VAV boxes — 5 UI + 2 AO + 3 BO covers zone temp / occupancy / damper feedback / reheat valve.',
    },
    {
      tag: 'ZN-T',
      role: 'Zone temp sensor (wall-mount)',
      preferredModelId: 'bapi-ba-1k-zone',
      kind: 'sensor',
      hints: { sensorSubject: 'temp' },
      rationale: 'Wall-mount Pt1000 in the occupied space. Drives the primary cooling + heating loops.',
    },
    {
      tag: 'OCC',
      role: 'Ceiling occupancy sensor',
      preferredModelId: 'wattstopper-ut-355',
      kind: 'sensor',
      hints: { sensorSubject: 'occupancy' },
      rationale: 'PIR occupancy sensor. When unoccupied, controller drops to setback setpoints.',
    },
    {
      tag: 'DMP-FB',
      role: 'Damper position feedback',
      preferredModelId: 'belimo-nf24a',
      kind: 'sensor',
      hints: { sensorSubject: 'damper-position' },
      rationale: 'Belimo 2-10V feedback from the spring-return damper actuator. Used to confirm command position.',
    },
  ],

  wires: [
    { fromTag: 'VAV-1', toTag: 'ZN-T',   wireKind: 'hardwired', note: 'ZN-T → UI-1 (Pt1000 RTD)' },
    { fromTag: 'VAV-1', toTag: 'OCC',    wireKind: 'hardwired', note: 'OCC → BI-1 (dry contact, 1 = occupied)' },
    { fromTag: 'VAV-1', toTag: 'DMP-FB', wireKind: 'hardwired', note: 'DMP-FB → AI-1 (2-10V)' },
  ],

  program: {
    language: 'fbd',
    requiredBlocks: ['INPUT', 'OUTPUT', 'CONST', 'PID', 'SUB', 'SEL'],
    sequence: [
      '1. Setpoint selection by occupancy',
      '   When OCC = 1 (occupied), use occupied setpoint (72°F).',
      '   When OCC = 0 (unoccupied), shift to night setback (68°F heating / 78°F cooling).',
      '',
      '2. Primary cooling sequence (damper position)',
      '   PID on (zone - cooling setpoint). Output 0-100% drives the primary-air damper position.',
      '   damper opens as zone gets warmer than setpoint.',
      '',
      '3. Reheat sequence',
      '   When damper is at minimum and zone is below heating setpoint, modulate the reheat valve.',
      '   Reheat valve PID on (heating setpoint - zone). Output 0-100% modulates the 2-way valve.',
      '',
      '4. Damper position minimum (ventilation)',
      '   During occupied periods, damper minimum = 20% (code-min ventilation).',
      '   During unoccupied, damper minimum = 0% (fully closed when no heating call).',
    ],
    // Simpler starter graph — pure primary cooling, no reheat for v1.
    // The user is expected to extend this if they want full G36 fidelity.
    starterGraph: {
      nodes: [
        { id: 'in_zone',     blockType: 'INPUT',  params: { source: 'sensed' } },
        { id: 'in_setpoint', blockType: 'INPUT',  params: { source: 'setpoint' } },
        { id: 'in_occ',      blockType: 'INPUT',  params: { source: 'occ' } },
        { id: 'err',         blockType: 'SUB' },
        { id: 'pid',         blockType: 'PID',    params: { Kp: 0.4, Ki: 0.005, Kd: 0 } },
        { id: 'k_0',         blockType: 'CONST',  params: { value: 0 } },
        { id: 'k_02',        blockType: 'CONST',  params: { value: 0.2 } },
        { id: 'min_pos',     blockType: 'SEL' },   // occ ? 0.2 : 0
        { id: 'damper_cmd',  blockType: 'MAX' },   // max(pid_out, min_pos)
        { id: 'out_damper',  blockType: 'OUTPUT', params: { target: 'actuator' } },
      ],
      edges: [
        { from: { nodeId: 'in_zone',     port: 'q' }, to: { nodeId: 'err', port: 'a' } },
        { from: { nodeId: 'in_setpoint', port: 'q' }, to: { nodeId: 'err', port: 'b' } },
        { from: { nodeId: 'err',         port: 'q' }, to: { nodeId: 'pid', port: 'error' } },
        { from: { nodeId: 'in_occ',      port: 'q' }, to: { nodeId: 'min_pos', port: 'sel' } },
        { from: { nodeId: 'k_02',        port: 'q' }, to: { nodeId: 'min_pos', port: 'a' } },
        { from: { nodeId: 'k_0',         port: 'q' }, to: { nodeId: 'min_pos', port: 'b' } },
        { from: { nodeId: 'pid',         port: 'q' }, to: { nodeId: 'damper_cmd', port: 'a' } },
        { from: { nodeId: 'min_pos',     port: 'q' }, to: { nodeId: 'damper_cmd', port: 'b' } },
        { from: { nodeId: 'damper_cmd',  port: 'q' }, to: { nodeId: 'out_damper', port: 'in' } },
      ],
    },
  },

  runtimeChecks: [
    {
      id: 'damper-opens-warm-zone',
      description: 'Damper opens when zone is above setpoint (primary cooling call).',
      inputs: { sensed: 78, setpoint: 72, occ: 1 },
      expects: [{ output: 'actuator', min: 0.7, max: 1.0 }],
    },
    {
      id: 'damper-at-min-zone-met',
      description: 'Damper drops to 20% ventilation min when zone is at setpoint and occupied.',
      inputs: { sensed: 72, setpoint: 72, occ: 1 },
      expects: [{ output: 'actuator', min: 0.18, max: 0.22 }],
    },
    {
      id: 'damper-closes-unoccupied',
      description: 'Damper fully closes when zone is at setpoint and unoccupied (no ventilation min).',
      inputs: { sensed: 72, setpoint: 72, occ: 0 },
      expects: [{ output: 'actuator', max: 0.05 }],
    },
  ],
};
