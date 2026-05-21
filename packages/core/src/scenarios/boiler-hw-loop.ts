// Hydronic heating plant — single boiler + circulating pump + reset.
//
// Maps to ASHRAE Guideline 36 §6.3 (Hot-Water Plant). The dramatic
// scenario in this set: real boilers have a code-mandated safety chain
// (high-limit, low-water cutoff, flow proving) that drops the burner
// immediately when any link fails. Programming this wrong has actual
// life-safety consequences in the field.

import type { ScenarioDefinition } from './types.js';

export const BOILER_HW_LOOP: ScenarioDefinition = {
  id: 'boiler-hw-loop',
  title: 'Boiler + Hot-Water Loop',
  tagline:
    'Single-boiler hydronic heating plant with outdoor reset, pump VFD, and the full code-required safety chain.',
  difficulty: 'commissioning-agent',
  estimatedMinutes: 45,
  reference: 'ASHRAE Guideline 36 §6.3 (Hot-Water Plant)',

  context: `You are commissioning a single-boiler hydronic heating plant
serving a small office building. The boiler is a fire-tube unit with a
modulating burner; the pump is a base-mounted centrifugal with a VFD for
variable-primary flow. Three code-required safeties live in the boiler
room: a manual-reset high-limit aquastat (200°F), a probe-style
low-water cutoff (McDonnell Miller PSE-800), and an air-flow proving
switch on the burner draft fan.

You'll set up the controller to: maintain a hot-water supply temp via
outdoor-reset (supply setpoint slides with OAT), modulate the pump VFD
to maintain differential pressure across the loop, and SHUT THE BURNER
DOWN IMMEDIATELY on any safety trip. Getting the safety logic wrong here
is a real life-safety problem in the field — boilers without functional
safeties have caused fatal incidents.`,

  equipment: [
    {
      tag: 'BLR-1',
      role: 'Plant controller (BACnet/IP, 12+ points)',
      preferredModelId: 'jci-nce25',
      kind: 'controller',
      hints: { minPoints: 12, protocols: ['BACnet/IP'] },
      rationale:
        'JCI NCE25 — plant-room duty, MS/TP + IP, 18 onboard points cover the boiler safety chain + pump VFD + OAT/supply/return sensing.',
    },
    {
      tag: 'HWS-T',
      role: 'Hot-water supply temp (immersion well)',
      preferredModelId: 'jci-te-6361-immersion',
      kind: 'sensor',
      hints: { sensorSubject: 'temp' },
      rationale: 'Immersion-well Pt1000 in the supply header. Drives the boiler reset loop.',
    },
    {
      tag: 'HWR-T',
      role: 'Hot-water return temp (immersion well)',
      preferredModelId: 'jci-te-6361-immersion',
      kind: 'sensor',
      hints: { sensorSubject: 'temp' },
      rationale: 'Return-side immersion sensor. Used for ΔT diagnostics and pump-flow inference.',
    },
    {
      tag: 'OAT-1',
      role: 'Outdoor-air temp',
      preferredModelId: 'greystone-te200',
      kind: 'sensor',
      hints: { sensorSubject: 'temp' },
      rationale: 'Outdoor reset reference — supply setpoint slides upward as OAT drops.',
    },
    {
      tag: 'LOOP-DP',
      role: 'Loop differential pressure',
      preferredModelId: 'veris-pxdlx-005',
      kind: 'sensor',
      hints: { sensorSubject: 'pressure-differential' },
      rationale: 'Across the farthest pair of risers. Drives the pump VFD speed loop.',
    },
    {
      tag: 'HI-LIMIT',
      role: 'High-limit aquastat (manual reset)',
      preferredModelId: 'honeywell-l4006a',
      kind: 'safety',
      hints: { safetyKind: 'high-limit' },
      rationale: 'Manual-reset high-limit at 200°F. NC contact wired into the burner enable chain — opens on trip, kills the burner.',
    },
    {
      tag: 'LWCO',
      role: 'Low-water cutoff (probe-style)',
      preferredModelId: 'mcdonnell-miller-pse-800',
      kind: 'safety',
      hints: { safetyKind: 'low-water-cutoff' },
      rationale: 'Code-required low-water cutoff. Opens on insufficient water — drops the burner instantly. Manual reset by code.',
    },
    {
      tag: 'AFS-1',
      role: 'Burner air-flow proving switch',
      preferredModelId: 'cleveland-controls-afs-222',
      kind: 'safety',
      hints: { safetyKind: 'flow-switch' },
      rationale: 'Auto-reset NO contact closes when draft fan is proving. Used as a burner permissive — if the fan stops, the contact opens.',
    },
  ],

  wires: [
    { fromTag: 'BLR-1', toTag: 'HWS-T',    wireKind: 'hardwired', note: 'HWS-T → UI-1 (Pt1000 RTD, immersion)' },
    { fromTag: 'BLR-1', toTag: 'HWR-T',    wireKind: 'hardwired', note: 'HWR-T → UI-2 (Pt1000 RTD, immersion)' },
    { fromTag: 'BLR-1', toTag: 'OAT-1',    wireKind: 'hardwired', note: 'OAT → UI-3 (Pt1000 RTD)' },
    { fromTag: 'BLR-1', toTag: 'LOOP-DP',  wireKind: 'hardwired', note: 'LOOP-DP → AI-1 (4-20 mA, 0-1 in WC)' },
    { fromTag: 'BLR-1', toTag: 'HI-LIMIT', wireKind: 'hardwired', note: 'HI-LIMIT → BI-1 (NC, 1 = healthy / 0 = tripped)' },
    { fromTag: 'BLR-1', toTag: 'LWCO',     wireKind: 'hardwired', note: 'LWCO → BI-2 (NC, 1 = water present / 0 = low water trip)' },
    { fromTag: 'BLR-1', toTag: 'AFS-1',    wireKind: 'hardwired', note: 'AFS-1 → BI-3 (NO, 1 = airflow proven / 0 = burner permissive lost)' },
  ],

  program: {
    language: 'fbd',
    requiredBlocks: ['INPUT', 'OUTPUT', 'CONST', 'PID', 'SUB', 'AND', 'NOT', 'SEL'],
    sequence: [
      '1. Safety chain (master enable)',
      '   chain_ok = hi_limit AND lwco AND afs   (all NC closed; AFS is NO=closed when proving)',
      '   When chain_ok = 0, FORCE burner = 0 (off). No exceptions.',
      '',
      '2. Outdoor-reset supply setpoint',
      '   When OAT = 60°F → setpoint = 120°F (mild day, mild supply)',
      '   When OAT = 0°F → setpoint = 180°F (design day, hot supply)',
      '   Linear interpolation between. We simplify to: setpoint = 180 - 2 * OAT (when OAT > 0).',
      '',
      '3. Burner modulation (PID on supply temp)',
      '   Error = supply_setpoint - HWS-T. PID output 0-100% modulates the burner valve.',
      '   Output is gated by chain_ok — multiplied by 0 when any safety opens.',
      '',
      '4. Pump VFD speed control',
      '   PID on (loop_dp_setpoint - LOOP-DP). Setpoint typically 0.5 in WC.',
      '   Pump runs whenever the building is calling for heat (simplified: any time burner > 0%).',
    ],
    starterGraph: {
      nodes: [
        // Inputs
        { id: 'in_hws',    blockType: 'INPUT',  params: { source: 'sensed' } },     // HWS-T as primary sensed
        { id: 'in_oat',    blockType: 'INPUT',  params: { source: 'oat' } },
        { id: 'in_hilim',  blockType: 'INPUT',  params: { source: 'hi_limit' } },
        { id: 'in_lwco',   blockType: 'INPUT',  params: { source: 'lwco' } },
        { id: 'in_afs',    blockType: 'INPUT',  params: { source: 'afs' } },

        // Outdoor-reset setpoint: 180 - 2 * OAT (when warmer, smaller setpoint)
        { id: 'k_2',       blockType: 'CONST',  params: { value: 2 } },
        { id: 'oat_x2',    blockType: 'MUL' },
        { id: 'k_180',     blockType: 'CONST',  params: { value: 180 } },
        { id: 'reset_sp',  blockType: 'SUB' },

        // Error and PID
        { id: 'err',       blockType: 'SUB' },                                     // reset_sp - hws
        { id: 'pid',       blockType: 'PID',    params: { Kp: 0.05, Ki: 0.002, Kd: 0 } },

        // Safety chain (all NC + AFS NO-when-proving → all "1" when healthy)
        { id: 'chain_a',   blockType: 'AND' },                                    // hilim AND lwco
        { id: 'chain_ok',  blockType: 'AND' },                                    // chain_a AND afs

        // Burner = chain_ok * pid
        { id: 'burner',    blockType: 'MUL' },
        { id: 'out_burner', blockType: 'OUTPUT', params: { target: 'actuator' } },

        // Pump cmd: simplified to 1 when burner > 0, else 0. Approximate via SEL.
        { id: 'k_0',       blockType: 'CONST',  params: { value: 0 } },
        { id: 'pump_thresh', blockType: 'GT' },                                   // burner > 0
        { id: 'k_1',       blockType: 'CONST',  params: { value: 1 } },
        { id: 'pump_sel',  blockType: 'SEL' },
        { id: 'out_pump',  blockType: 'OUTPUT', params: { target: 'pump_cmd' } },
      ],
      edges: [
        // reset_sp = 180 - 2 * oat
        { from: { nodeId: 'in_oat',    port: 'q' }, to: { nodeId: 'oat_x2', port: 'a' } },
        { from: { nodeId: 'k_2',       port: 'q' }, to: { nodeId: 'oat_x2', port: 'b' } },
        { from: { nodeId: 'k_180',     port: 'q' }, to: { nodeId: 'reset_sp', port: 'a' } },
        { from: { nodeId: 'oat_x2',    port: 'q' }, to: { nodeId: 'reset_sp', port: 'b' } },

        // err = reset_sp - hws
        { from: { nodeId: 'reset_sp',  port: 'q' }, to: { nodeId: 'err', port: 'a' } },
        { from: { nodeId: 'in_hws',    port: 'q' }, to: { nodeId: 'err', port: 'b' } },
        // pid
        { from: { nodeId: 'err',       port: 'q' }, to: { nodeId: 'pid', port: 'error' } },

        // chain_a = hi_limit AND lwco
        { from: { nodeId: 'in_hilim',  port: 'q' }, to: { nodeId: 'chain_a', port: 'a' } },
        { from: { nodeId: 'in_lwco',   port: 'q' }, to: { nodeId: 'chain_a', port: 'b' } },
        // chain_ok = chain_a AND afs
        { from: { nodeId: 'chain_a',   port: 'q' }, to: { nodeId: 'chain_ok', port: 'a' } },
        { from: { nodeId: 'in_afs',    port: 'q' }, to: { nodeId: 'chain_ok', port: 'b' } },

        // burner = chain_ok * pid (gate)
        { from: { nodeId: 'chain_ok',  port: 'q' }, to: { nodeId: 'burner', port: 'a' } },
        { from: { nodeId: 'pid',       port: 'q' }, to: { nodeId: 'burner', port: 'b' } },
        { from: { nodeId: 'burner',    port: 'q' }, to: { nodeId: 'out_burner', port: 'in' } },

        // pump_thresh = burner > 0
        { from: { nodeId: 'burner',    port: 'q' }, to: { nodeId: 'pump_thresh', port: 'a' } },
        { from: { nodeId: 'k_0',       port: 'q' }, to: { nodeId: 'pump_thresh', port: 'b' } },
        // pump = SEL(thresh, 1, 0)
        { from: { nodeId: 'pump_thresh', port: 'q' }, to: { nodeId: 'pump_sel', port: 'sel' } },
        { from: { nodeId: 'k_1',       port: 'q' }, to: { nodeId: 'pump_sel', port: 'a' } },
        { from: { nodeId: 'k_0',       port: 'q' }, to: { nodeId: 'pump_sel', port: 'b' } },
        { from: { nodeId: 'pump_sel',  port: 'q' }, to: { nodeId: 'out_pump', port: 'in' } },
      ],
    },
  },

  runtimeChecks: [
    {
      id: 'burner-modulates-cold-day',
      description: 'Burner output > 0 on a cold morning with supply temp below reset setpoint.',
      // OAT 20°F → setpoint 180-40=140°F. HWS 100°F → big error → burner full mod.
      // Safety chain all healthy (1).
      inputs: { sensed: 100, oat: 20, hi_limit: 1, lwco: 1, afs: 1 },
      expects: [
        { output: 'actuator', min: 0.5, max: 1.0 },
        { output: 'pump_cmd', approx: 1, tolerance: 0.01 },
      ],
    },
    {
      id: 'burner-modulates-down-mild-day',
      description: 'Burner output drops on a mild day with HWS at reset setpoint.',
      // OAT 60°F → setpoint 60°F. HWS 60°F → err 0 → burner 0.
      inputs: { sensed: 60, oat: 60, hi_limit: 1, lwco: 1, afs: 1 },
      expects: [
        { output: 'actuator', min: 0, max: 0.2 },
      ],
    },
    {
      id: 'lwco-trip-kills-burner',
      description: 'Low-water cutoff trip immediately drops the burner regardless of demand.',
      // Cold day with big heat call, but LWCO tripped → burner 0.
      inputs: { sensed: 100, oat: 20, hi_limit: 1, lwco: 0, afs: 1 },
      expects: [
        { output: 'actuator', approx: 0, tolerance: 0.01 },
        { output: 'pump_cmd', approx: 0, tolerance: 0.01 },
      ],
    },
    {
      id: 'hi-limit-trip-kills-burner',
      description: 'High-limit aquastat trip immediately drops the burner.',
      inputs: { sensed: 100, oat: 20, hi_limit: 0, lwco: 1, afs: 1 },
      expects: [
        { output: 'actuator', approx: 0, tolerance: 0.01 },
      ],
    },
    {
      id: 'afs-loss-kills-burner',
      description: 'Loss of air-flow proving drops the burner (combustion air permissive).',
      inputs: { sensed: 100, oat: 20, hi_limit: 1, lwco: 1, afs: 0 },
      expects: [
        { output: 'actuator', approx: 0, tolerance: 0.01 },
      ],
    },
  ],
};
