// Pre-built scenarios bundled with bas-sandbox. They show up in the left
// sidebar's DEMOS section so a first-time visitor (or a commercial contact
// landing on bas-sandbox.netlify.app) can one-click load something
// interesting instead of staring at an empty canvas.
//
// Each scenario is constructed via `buildScenario()` from a compact spec so
// the data here stays readable. The output is a full BasScenarioV1 — the
// same shape produced by saving the canvas state to disk.

import type { Edge, Node } from '@xyflow/svelte';
import { DEFAULT_CONFIG, type SingleZoneConfig } from './sim/thermal';
import type { BasScenarioV1, WiredTargetSpec } from './scenario';

type WireKind = 'mstp' | 'n2' | 'bacnet-ip' | 'lon' | 'hardwired';
type NodeKind = 'supervisor' | 'controller' | 'sensor' | 'safety' | 'subnet-zone' | 'router' | 'virtual-controller' | 'vahu' | 'zone' | 'actuator' | 'equipment' | 'switch';

type SpecNode = {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  /** Force a specific MS/TP MAC on this device (overrides auto-assignment).
   *  Use this to bake in a deliberate duplicate-MAC fault, or to mirror
   *  the dip-switch settings of a real-world FEC. */
  forcedMac?: number;
  /** Extra fields slipped onto data (fault, signal, alarm thresholds, etc.). */
  data?: Record<string, unknown>;
  /** Subnet-zone only: rendered rectangle width/height in canvas coords. */
  width?: number;
  height?: number;
};

type SpecEdge = {
  source: string;
  target: string;
  wireKind: WireKind;
  /** Optional MS/TP-style baud rate, displayed on the trunk panel. */
  baud?: number;
  /** Specific terminal id on the target node (e.g., "UI-2"). Lets a demo
   *  wire a sensor into a particular controller input so the signal-
   *  fidelity layer + Terminals inspector can identify the terminal. */
  sourceHandle?: string;
  targetHandle?: string;
};

type SpecWire = {
  controllerId: string;
  sensorId: string;
  /** Overrides on top of DEFAULT_CONFIG for that target's PI loop / mode / schedule. */
  config?: Partial<SingleZoneConfig>;
};

type SpecProgram = {
  controllerId: string;
  /** Raw ST source applied on load. Controller must also be a wired
   *  physics target (wires[]) for the program to actually run. */
  source: string;
};

type ScenarioSpec = {
  nodes: SpecNode[];
  edges: SpecEdge[];
  wires?: SpecWire[];
  programs?: SpecProgram[];
  focused?: string;
};

function buildScenario(spec: ScenarioSpec): BasScenarioV1 {
  const nodes: Node[] = spec.nodes.map((n) => {
    // Subnet-zone nodes use the dedicated 'subnet' SvelteFlow node type
    // and render behind regular nodes (negative zIndex).
    if (n.kind === 'subnet-zone') {
      return {
        id: n.id,
        type: 'subnet',
        position: { x: n.x, y: n.y },
        width: n.width ?? 360,
        height: n.height ?? 240,
        zIndex: -1,
        data: {
          kind: 'subnet-zone',
          label: n.label,
          // Zone-specific data (cidr, color) comes in via n.data.
          ...(n.data ?? {}),
        },
      };
    }
    return {
      id: n.id,
      type: 'bas',
      position: { x: n.x, y: n.y },
      data: {
        kind: n.kind,
        label: n.label,
        ...(n.forcedMac !== undefined ? { forcedMac: n.forcedMac } : {}),
        ...(n.data ?? {}),
      },
    };
  });
  const edges: Edge[] = spec.edges.map((e, idx) => ({
    id: `de-${idx}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle !== undefined ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle !== undefined ? { targetHandle: e.targetHandle } : {}),
    data: {
      wireKind: e.wireKind,
      ...(e.baud !== undefined ? { baud: e.baud } : {}),
    },
  }));
  const wiredTargets: WiredTargetSpec[] = (spec.wires ?? []).map((w) => ({
    controllerId: w.controllerId,
    sensorId: w.sensorId,
    config: { ...DEFAULT_CONFIG, ...(w.config ?? {}) },
  }));
  const focusedTargetId = spec.focused ?? wiredTargets[0]?.controllerId ?? null;
  // Counters are a presentational concern (used for autonaming) — seed them
  // empty so user drops after loading get fresh n1, n2, … names.
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    topology: { nodes, edges },
    selection: { controllerId: focusedTargetId },
    config: wiredTargets[0]?.config ?? { ...DEFAULT_CONFIG },
    wiredTargets,
    ...(spec.programs ? { programs: spec.programs } : {}),
    focusedTargetId,
    counters: {},
    nextId: spec.nodes.length + 100,
  };
}

export type Demo = {
  id: string;
  name: string;
  blurb: string;
  scenario: BasScenarioV1;
};

export const DEMOS: readonly Demo[] = [
  {
    id: 'signal-fidelity',
    name: 'Signal fidelity (ðŸ“ Terminals)',
    blurb:
      'VAV-1 with a primary Pt1000 zone-temp sensor (drives the thermal loop) PLUS a secondary 4-20mA CO₂ sensor and a 2-10V damper-feedback sensor wired into UI-2 and UI-3. Hit Run, click VAV-1, then click ðŸ“ Terminals — you\'ll see the raw signal at each terminal (~11.2 mA at 900 ppm, ~6 V at 50% damper) and the engineering value the controller decoded. Change a terminal\'s input type to the wrong kind and watch the MISMATCH badge appear with a wrong-but-plausible reading. Inject \'open\' fault on a sensor and watch the OPEN badge with the controller pegged at the fault rail.',
    scenario: buildScenario({
      nodes: [
        { id: 'sup', kind: 'supervisor', label: 'NAE-SF', x: 240, y: 40 },
        {
          id: 'vav',
          kind: 'controller',
          label: 'VAV-SF',
          x: 240,
          y: 220,
          // Distech ECY-VAV — 5 UI / 2 AO / 3 BO. Per-terminal handles
          // become real (UI-1, UI-2, UI-3, …) so the wires below land on
          // specific terminals and the Terminals inspector can label them.
          data: { vendorModelId: 'distech-ecy-vav' },
        },
        // Primary zone-temp sensor — drives the thermal sim. Pt1000 RTD.
        {
          id: 'zn',
          kind: 'sensor',
          label: 'ZN-T',
          x: 100,
          y: 400,
          data: { signal: 'rtd-pt1000' },
        },
        // Secondary: CO₂ sensor, 4-20mA. At 900 ppm reads ~11.2 mA.
        {
          id: 'co2',
          kind: 'sensor',
          label: 'CO2-1',
          x: 240,
          y: 400,
          data: { signal: 'analog-4-20ma', sensorModelId: 'veris-cwe' },
        },
        // Secondary: damper-position feedback, 2-10V live-zero.
        {
          id: 'dmp',
          kind: 'sensor',
          label: 'DMP-FB',
          x: 380,
          y: 400,
          data: { signal: 'analog-2-10v', sensorModelId: 'belimo-nf24a' },
        },
      ],
      edges: [
        { source: 'sup', target: 'vav', wireKind: 'mstp', baud: 38400 },
        { source: 'zn', target: 'vav', wireKind: 'hardwired', targetHandle: 'UI-1' },
        { source: 'co2', target: 'vav', wireKind: 'hardwired', targetHandle: 'UI-2' },
        { source: 'dmp', target: 'vav', wireKind: 'hardwired', targetHandle: 'UI-3' },
      ],
      wires: [{ controllerId: 'vav', sensorId: 'zn' }],
      focused: 'vav',
    }),
  },

  {
    id: 'quickstart',
    name: 'Quick start: 1 VAV',
    blurb:
      'Single VAV + zone temp sensor on a BACnet MS/TP trunk under an NAE-1 supervisor. Hit Run to watch a PI cool from 76→72°F. Also fires Who-Is / I-Am broadcasts so the BACnet packet log + conformance panel populate.',
    scenario: buildScenario({
      nodes: [
        {
          id: 'sup',
          kind: 'supervisor',
          label: 'NAE-1',
          x: 240,
          y: 60,
          data: {
            // Static IP so the Net.5 broadcast-routing trace fires
            // Who-Is broadcasts every 30s, populating the packet log
            // and the conformance panel.
            ipAddress: '10.0.1.10',
            subnetMask: '255.255.255.0',
            gateway: '10.0.1.1',
          },
        },
        { id: 'vav', kind: 'controller', label: 'VAV-1', x: 240, y: 230 },
        {
          id: 'snr',
          kind: 'sensor',
          label: 'ZN-T-1',
          x: 240,
          y: 400,
          data: { signal: 'rtd-pt1000' },
        },
      ],
      edges: [
        // MS/TP trunk (was bacnet-ip) so token-pass packets fire and
        // the supervisor polls the VAV via ReadProperty + COV.
        { source: 'sup', target: 'vav', wireKind: 'mstp', baud: 38400 },
        { source: 'vav', target: 'snr', wireKind: 'hardwired' },
      ],
      wires: [{ controllerId: 'vav', sensorId: 'snr' }],
      focused: 'vav',
    }),
  },

  {
    id: 'sensor-drift',
    name: 'Sensor drift fault',
    blurb:
      'Zone temp sensor drifting +1°F per 10 sim-min. Controller chases a phantom, real zone overcools.',
    scenario: buildScenario({
      nodes: [
        { id: 'sup', kind: 'supervisor', label: 'NAE-2', x: 240, y: 60 },
        { id: 'vav', kind: 'controller', label: 'VAV-A', x: 240, y: 230 },
        {
          id: 'snr',
          kind: 'sensor',
          label: 'ZN-T-A',
          x: 240,
          y: 400,
          data: { signal: 'thermistor-10k-t2', fault: 'drift' },
        },
      ],
      edges: [
        { source: 'sup', target: 'vav', wireKind: 'bacnet-ip' },
        { source: 'vav', target: 'snr', wireKind: 'hardwired' },
      ],
      wires: [
        {
          controllerId: 'vav',
          sensorId: 'snr',
          config: { initialZone: 74, setpoint: 72, outdoorAir: 88 },
        },
      ],
      focused: 'vav',
    }),
  },

  {
    id: 'multi-zone',
    name: '3 coupled VAVs',
    blurb:
      'AHU + 3 VAVs on one FC bus. 30% neighbor pull on each — start them at different temps to see them average.',
    scenario: buildScenario({
      nodes: [
        { id: 'sup', kind: 'supervisor', label: 'NAE-3', x: 420, y: 40 },
        // FEC + chain ends carry the RS-485 EOL termination switch — the
        // FC bus is a real daisy-chain now (fec → vav1 → vav2 → vav3), so
        // the two physical ends (fec, vav3) terminate.
        { id: 'fec', kind: 'controller', label: 'FEC-MAIN', x: 420, y: 180, data: { eolTerminated: true } },
        { id: 'vav1', kind: 'controller', label: 'VAV-101', x: 200, y: 360, data: { eolTerminated: false } },
        { id: 'vav2', kind: 'controller', label: 'VAV-102', x: 420, y: 360, data: { eolTerminated: false } },
        { id: 'vav3', kind: 'controller', label: 'VAV-103', x: 640, y: 360, data: { eolTerminated: true } },
        {
          id: 's1',
          kind: 'sensor',
          label: 'ZN-101',
          x: 200,
          y: 520,
          data: { signal: 'rtd-pt1000' },
        },
        {
          id: 's2',
          kind: 'sensor',
          label: 'ZN-102',
          x: 420,
          y: 520,
          data: { signal: 'rtd-pt1000' },
        },
        {
          id: 's3',
          kind: 'sensor',
          label: 'ZN-103',
          x: 640,
          y: 520,
          data: { signal: 'rtd-pt1000' },
        },
      ],
      edges: [
        { source: 'sup', target: 'fec', wireKind: 'bacnet-ip' },
        // Daisy-chained FC bus (was hub-spoke off the FEC — a T-tap/star,
        // which the topology validator now flags as the real-world RS-485
        // mistake it is).
        { source: 'fec', target: 'vav1', wireKind: 'mstp', baud: 38400 },
        { source: 'vav1', target: 'vav2', wireKind: 'mstp', baud: 38400 },
        { source: 'vav2', target: 'vav3', wireKind: 'mstp', baud: 38400 },
        { source: 'vav1', target: 's1', wireKind: 'hardwired' },
        { source: 'vav2', target: 's2', wireKind: 'hardwired' },
        { source: 'vav3', target: 's3', wireKind: 'hardwired' },
      ],
      wires: [
        {
          controllerId: 'vav1',
          sensorId: 's1',
          config: { initialZone: 78, setpoint: 72, couplingFactor: 0.3 },
        },
        {
          controllerId: 'vav2',
          sensorId: 's2',
          config: { initialZone: 72, setpoint: 72, couplingFactor: 0.3 },
        },
        {
          controllerId: 'vav3',
          sensorId: 's3',
          config: { initialZone: 68, setpoint: 72, couplingFactor: 0.3 },
        },
      ],
      focused: 'vav1',
    }),
  },

  {
    id: 'trunk-break',
    name: 'MS/TP trunk break',
    blurb:
      'Engine → FEC → VAV. Click the MS/TP wire and hit "✂ Break trunk" to watch the VAV go offline.',
    scenario: buildScenario({
      nodes: [
        { id: 'sup', kind: 'supervisor', label: 'NAE-4', x: 320, y: 60 },
        { id: 'fec', kind: 'controller', label: 'FEC-2', x: 320, y: 220 },
        { id: 'vav', kind: 'controller', label: 'VAV-201', x: 320, y: 400 },
        {
          id: 'snr',
          kind: 'sensor',
          label: 'ZN-201',
          x: 320,
          y: 560,
          data: { signal: 'rtd-pt1000' },
        },
      ],
      edges: [
        { source: 'sup', target: 'fec', wireKind: 'bacnet-ip' },
        { source: 'fec', target: 'vav', wireKind: 'mstp', baud: 38400 },
        { source: 'vav', target: 'snr', wireKind: 'hardwired' },
      ],
      wires: [
        {
          controllerId: 'vav',
          sensorId: 'snr',
          config: { initialZone: 75, setpoint: 72, outdoorAir: 90 },
        },
      ],
      focused: 'vav',
    }),
  },

  {
    id: 'night-setback',
    name: 'Occupancy schedule',
    blurb:
      'Schedule 6:00–22:00 occupied (72°F) / unocc 78°F. Set Sim Clock start = 21:55, hit Run, watch the transition.',
    scenario: buildScenario({
      nodes: [
        { id: 'sup', kind: 'supervisor', label: 'NAE-5', x: 240, y: 60 },
        { id: 'vav', kind: 'controller', label: 'VAV-OFFICE', x: 240, y: 230 },
        {
          id: 'snr',
          kind: 'sensor',
          label: 'ZN-OFFICE',
          x: 240,
          y: 400,
          data: { signal: 'rtd-pt1000' },
        },
      ],
      edges: [
        { source: 'sup', target: 'vav', wireKind: 'bacnet-ip' },
        { source: 'vav', target: 'snr', wireKind: 'hardwired' },
      ],
      wires: [
        {
          controllerId: 'vav',
          sensorId: 'snr',
          config: {
            setpoint: 72,
            initialZone: 73,
            outdoorAir: 88,
            schedule: {
              enabled: true,
              occupiedSetpoint: 72,
              unoccupiedSetpoint: 78,
              occStartHour: 6,
              occEndHour: 22,
            },
          },
        },
      ],
      focused: 'vav',
    }),
  },

  {
    id: 'subnet-misconfig',
    name: 'BACnet/IP subnet mismatch',
    blurb:
      'Two NAEs supposed to talk over BACnet/IP — one configured for 192.168.1.x, the other for 192.168.2.x. Watch the validator flag the subnet mismatch and the bad gateway.',
    scenario: buildScenario({
      nodes: [
        {
          id: 'nae1',
          kind: 'supervisor',
          label: 'NAE-A',
          x: 200,
          y: 120,
          // Healthy config, sits in 192.168.1.0/24.
          data: {
            ipAddress: '192.168.1.10',
            subnetMask: '255.255.255.0',
            gateway: '192.168.1.1',
          },
        },
        {
          id: 'nae2',
          kind: 'supervisor',
          label: 'NAE-B',
          x: 600,
          y: 120,
          // Different subnet (someone typed 1 vs 2 on the IP), AND
          // gateway points back to the OTHER subnet — classic
          // "I copied the config from the other NAE but only changed
          // the host octet" mistake.
          data: {
            ipAddress: '192.168.2.20',
            subnetMask: '255.255.255.0',
            gateway: '192.168.1.1',
          },
        },
        {
          id: 'vav',
          kind: 'controller',
          label: 'VAV-201',
          x: 400,
          y: 320,
        },
        {
          id: 'snr',
          kind: 'sensor',
          label: 'ZN-201',
          x: 400,
          y: 480,
          data: { signal: 'rtd-pt1000' },
        },
      ],
      edges: [
        // The bad link — NAE-A ↔ NAE-B over BACnet/IP, but they're in
        // different subnets per their masks. Validator should fire
        // ipv4.subnet-mismatch + ipv4.gateway-not-in-subnet.
        { source: 'nae1', target: 'nae2', wireKind: 'bacnet-ip' },
        // One NAE drives a VAV so the canvas has something to run.
        { source: 'nae1', target: 'vav', wireKind: 'bacnet-ip' },
        { source: 'vav', target: 'snr', wireKind: 'hardwired' },
      ],
      wires: [
        {
          controllerId: 'vav',
          sensorId: 'snr',
          config: { initialZone: 76, setpoint: 72, outdoorAir: 88 },
        },
      ],
      focused: 'vav',
    }),
  },

  {
    id: 'mstp-commissioning',
    name: 'MS/TP commissioning fault',
    blurb:
      '1 NAE + 4 FECs on one BACnet MS/TP trunk — but VAV-103 and VAV-104 ship with dip switches both set to MAC 5. Open the trunk inspector to spot the duplicate.',
    scenario: buildScenario({
      nodes: [
        { id: 'sup', kind: 'supervisor', label: 'NAE-X', x: 420, y: 40 },
        // FECs daisy-chained off the supervisor on one MS/TP trunk.
        // First three get clean MACs; last two share MAC 5 — the bug
        // a tech would otherwise spend an hour chasing in the field.
        { id: 'fec1', kind: 'controller', label: 'VAV-101', x: 140, y: 220, forcedMac: 1 },
        { id: 'fec2', kind: 'controller', label: 'VAV-102', x: 280, y: 220, forcedMac: 2 },
        { id: 'fec3', kind: 'controller', label: 'VAV-103', x: 420, y: 220, forcedMac: 5 },
        { id: 'fec4', kind: 'controller', label: 'VAV-104', x: 560, y: 220, forcedMac: 5 },
        { id: 'fec5', kind: 'controller', label: 'VAV-105', x: 700, y: 220, forcedMac: 7 },
        {
          id: 's1',
          kind: 'sensor',
          label: 'ZN-101',
          x: 140,
          y: 400,
          data: { signal: 'rtd-pt1000' },
        },
      ],
      edges: [
        // Bus topology: NAE → FEC1 → FEC2 → … last FEC, modeled as a
        // chain of MS/TP edges (BFS will collapse them into one trunk).
        { source: 'sup', target: 'fec1', wireKind: 'mstp', baud: 38400 },
        { source: 'fec1', target: 'fec2', wireKind: 'mstp', baud: 38400 },
        { source: 'fec2', target: 'fec3', wireKind: 'mstp', baud: 38400 },
        { source: 'fec3', target: 'fec4', wireKind: 'mstp', baud: 38400 },
        { source: 'fec4', target: 'fec5', wireKind: 'mstp', baud: 38400 },
        // One sensor wired to one VAV so the canvas has at least one
        // closed-loop target the sim can run.
        { source: 'fec1', target: 's1', wireKind: 'hardwired' },
      ],
      wires: [
        {
          controllerId: 'fec1',
          sensorId: 's1',
          config: { initialZone: 75, setpoint: 72, outdoorAir: 88 },
        },
      ],
      focused: 'fec1',
    }),
  },

  {
    id: 'bbmd-bridged',
    name: 'BBMD bridge: cross-subnet done right',
    blurb:
      'Two NAEs on different /24s, but both configured as BBMDs with each other in their BDT. Validator should mark this as info-only — healthy cross-subnet BACnet.',
    scenario: buildScenario({
      nodes: [
        {
          id: 'nae-a',
          kind: 'supervisor',
          label: 'NAE-A',
          x: 200,
          y: 120,
          data: {
            ipAddress: '192.168.1.10',
            subnetMask: '255.255.255.0',
            gateway: '192.168.1.1',
            isBBMD: true,
            bdtPeers: ['192.168.2.10'],
          },
        },
        {
          id: 'nae-b',
          kind: 'supervisor',
          label: 'NAE-B',
          x: 600,
          y: 120,
          data: {
            ipAddress: '192.168.2.10',
            subnetMask: '255.255.255.0',
            gateway: '192.168.2.1',
            isBBMD: true,
            bdtPeers: ['192.168.1.10'],
          },
        },
      ],
      edges: [
        // Cross-subnet BACnet/IP. Would normally fire subnet-mismatch
        // but the BBMD-on-both-sides config legitimizes it.
        { source: 'nae-a', target: 'nae-b', wireKind: 'bacnet-ip' },
      ],
    }),
  },

  {
    id: 'bbmd-asymmetric',
    name: 'BBMD: asymmetric BDT (broadcasts one direction only)',
    blurb:
      `Both NAEs are BBMDs, but only NAE-A lists NAE-B in its BDT. NAE-A I-Ams reach NAE-B; NAE-B's broadcasts never reach NAE-A. Classic "half-working" misconfig.`,
    scenario: buildScenario({
      nodes: [
        {
          id: 'nae-a',
          kind: 'supervisor',
          label: 'NAE-A',
          x: 200,
          y: 120,
          data: {
            ipAddress: '192.168.1.10',
            subnetMask: '255.255.255.0',
            gateway: '192.168.1.1',
            isBBMD: true,
            bdtPeers: ['192.168.2.10'],
          },
        },
        {
          id: 'nae-b',
          kind: 'supervisor',
          label: 'NAE-B',
          x: 600,
          y: 120,
          data: {
            ipAddress: '192.168.2.10',
            subnetMask: '255.255.255.0',
            gateway: '192.168.2.1',
            isBBMD: true,
            // Empty BDT — the integrator forgot to populate this side.
            bdtPeers: [],
          },
        },
      ],
      edges: [
        { source: 'nae-a', target: 'nae-b', wireKind: 'bacnet-ip' },
      ],
    }),
  },

  {
    id: 'bbmd-foreign-device',
    name: 'BACnet/IP: BBMD bridge + foreign device',
    blurb:
      'Two NAEs run BBMD on different /24s and bridge broadcasts to each other. A laptop tool on a THIRD subnet registers as a foreign device with NAE-A. Hit Run and open the BACnet packet log to watch the full Annex-J dance: Register-Foreign-Device → BVLC-Result → Distribute-Broadcast → Forwarded-NPDU across the BDT. Every packet carries real wire bytes (click one to inspect).',
    scenario: buildScenario({
      nodes: [
        {
          id: 'nae-a',
          kind: 'supervisor',
          label: 'NAE-A',
          x: 200,
          y: 140,
          data: {
            ipAddress: '192.168.1.10',
            subnetMask: '255.255.255.0',
            gateway: '192.168.1.1',
            isBBMD: true,
            bdtPeers: ['192.168.2.10'],
            subtitle: 'BBMD · subnet 192.168.1.0/24',
          },
        },
        {
          id: 'nae-b',
          kind: 'supervisor',
          label: 'NAE-B',
          x: 640,
          y: 140,
          data: {
            ipAddress: '192.168.2.10',
            subnetMask: '255.255.255.0',
            gateway: '192.168.2.1',
            isBBMD: true,
            bdtPeers: ['192.168.1.10'],
            subtitle: 'BBMD · subnet 192.168.2.0/24',
          },
        },
        {
          id: 'laptop',
          kind: 'controller',
          label: 'YABE-Laptop',
          x: 200,
          y: 360,
          data: {
            ipAddress: '192.168.3.50',
            subnetMask: '255.255.255.0',
            gateway: '192.168.3.1',
            subtitle: 'Foreign device · subnet 192.168.3.0/24',
          },
        },
      ],
      edges: [
        // The two BBMDs bridge across subnets via their BDTs.
        { source: 'nae-a', target: 'nae-b', wireKind: 'bacnet-ip' },
        // The laptop is on a remote subnet — it can't broadcast across the
        // routers, so it registers as a foreign device with NAE-A.
        { source: 'laptop', target: 'nae-a', wireKind: 'bacnet-ip' },
      ],
    }),
  },

  {
    id: 'soft-controllers',
    name: 'JACE hosts 5 virtual VAVs',
    blurb:
      'One Tridium JACE hosts five soft VAV controllers — no dedicated hardware. Power-off the JACE and watch ALL FIVE go offline together: the "all eggs in one basket" lesson of soft controllers.',
    scenario: buildScenario({
      nodes: [
        {
          id: 'jace',
          kind: 'supervisor',
          label: 'JACE-MAIN',
          x: 400,
          y: 80,
          data: {
            ipAddress: '10.0.1.10',
            subnetMask: '255.255.255.0',
            gateway: '10.0.1.1',
            vendorModelId: 'tridium-jace-8000',
            subtitle: 'Tridium · Niagara · BACnet/IP + Niagara Fox',
          },
        },
        {
          id: 'vvav1',
          kind: 'virtual-controller',
          label: 'vVAV-101',
          x: 120,
          y: 260,
          data: { hostId: 'jace', hostLabel: 'JACE-MAIN' },
        },
        {
          id: 'vvav2',
          kind: 'virtual-controller',
          label: 'vVAV-102',
          x: 260,
          y: 260,
          data: { hostId: 'jace', hostLabel: 'JACE-MAIN' },
        },
        {
          id: 'vvav3',
          kind: 'virtual-controller',
          label: 'vVAV-103',
          x: 400,
          y: 260,
          data: { hostId: 'jace', hostLabel: 'JACE-MAIN' },
        },
        {
          id: 'vvav4',
          kind: 'virtual-controller',
          label: 'vVAV-104',
          x: 540,
          y: 260,
          data: { hostId: 'jace', hostLabel: 'JACE-MAIN' },
        },
        {
          id: 'vvav5',
          kind: 'virtual-controller',
          label: 'vVAV-105',
          x: 680,
          y: 260,
          data: { hostId: 'jace', hostLabel: 'JACE-MAIN' },
        },
      ],
      edges: [],
    }),
  },

  {
    id: 'router-bridge',
    name: 'L3 router bridging two subnets',
    blurb:
      'Two NAEs on different /24s wired to each other, plus a virtual router with interfaces on BOTH subnets. Validator reports the cross-subnet path as routed (info) — unicast works without BBMDs.',
    scenario: buildScenario({
      nodes: [
        {
          id: 'nae-a',
          kind: 'supervisor',
          label: 'NAE-A',
          x: 120,
          y: 120,
          data: {
            ipAddress: '10.0.1.10',
            subnetMask: '255.255.255.0',
            gateway: '10.0.1.1',
          },
        },
        {
          id: 'rtr',
          kind: 'router',
          label: 'RTR-CORE',
          x: 400,
          y: 120,
          data: {
            routerInterfaces: [
              { ip: '10.0.1.1', cidr: '10.0.1.0/24' },
              { ip: '10.0.2.1', cidr: '10.0.2.0/24' },
            ],
            subtitle: '2 interfaces · 10.0.1.0/24 + 10.0.2.0/24',
          },
        },
        {
          id: 'nae-b',
          kind: 'supervisor',
          label: 'NAE-B',
          x: 680,
          y: 120,
          data: {
            ipAddress: '10.0.2.10',
            subnetMask: '255.255.255.0',
            gateway: '10.0.2.1',
          },
        },
      ],
      edges: [
        // Cross-subnet edge, but the router covers both subnets so the
        // validator reports info (routed via RTR-CORE) instead of error.
        { source: 'nae-a', target: 'nae-b', wireKind: 'bacnet-ip' },
      ],
    }),
  },

  {
    id: 'subnet-zones-walkthrough',
    name: 'Subnet zones — IP vs VLAN visibility',
    blurb:
      `Two subnet-zone containers (BMS VLAN 10.0.1.0/24 + Corp 10.0.2.0/24) with NAE-Corp dropped in the wrong zone — its IP doesn't match the VLAN it's drawn in. Net.1 zone validator flags it.`,
    scenario: buildScenario({
      nodes: [
        // Two zones side by side.
        {
          id: 'zone-bms',
          kind: 'subnet-zone',
          label: 'BMS VLAN',
          x: 80,
          y: 80,
          width: 360,
          height: 240,
          data: { cidr: '10.0.1.0/24', color: '#4a9eff' },
        },
        {
          id: 'zone-corp',
          kind: 'subnet-zone',
          label: 'Corp',
          x: 520,
          y: 80,
          width: 360,
          height: 240,
          data: { cidr: '10.0.2.0/24', color: '#fb923c' },
        },
        // NAE in BMS zone, properly IP'd — should be silent.
        {
          id: 'nae-bms',
          kind: 'supervisor',
          label: 'NAE-BMS',
          x: 200,
          y: 180,
          data: {
            ipAddress: '10.0.1.10',
            subnetMask: '255.255.255.0',
          },
        },
        // NAE in Corp zone, but mis-IP'd to BMS subnet — fires the
        // zone-cidr-mismatch finding.
        {
          id: 'nae-corp',
          kind: 'supervisor',
          label: 'NAE-Corp',
          x: 640,
          y: 180,
          data: {
            ipAddress: '10.0.1.50', // wrong! Inside Corp zone but on BMS subnet.
            subnetMask: '255.255.255.0',
          },
        },
      ],
      edges: [],
    }),
  },

  {
    id: 'heat-winter',
    name: 'Winter heating',
    blurb:
      'AHU in heat mode, OAT 25°F, zone starts cold at 60°F. Watch the heating actuator drive zone to 70°F setpoint.',
    scenario: buildScenario({
      nodes: [
        { id: 'sup', kind: 'supervisor', label: 'NAE-6', x: 240, y: 60 },
        { id: 'ahu', kind: 'controller', label: 'AHU-HEAT', x: 240, y: 230 },
        {
          id: 'snr',
          kind: 'sensor',
          label: 'ZN-WINTER',
          x: 240,
          y: 400,
          data: { signal: 'rtd-pt1000' },
        },
      ],
      edges: [
        { source: 'sup', target: 'ahu', wireKind: 'bacnet-ip' },
        { source: 'ahu', target: 'snr', wireKind: 'hardwired' },
      ],
      wires: [
        {
          controllerId: 'ahu',
          sensorId: 'snr',
          config: {
            mode: 'heat',
            setpoint: 70,
            initialZone: 60,
            outdoorAir: 25,
            // Larger Ï„ for a building envelope losing heat to cold OAT.
            tau: 900,
          },
        },
      ],
      focused: 'ahu',
    }),
  },

  // ═══════════════════════════════════════════════════════════════════
  // Richer virtual-controller topologies — see "all eggs in one basket"
  // at scale, watch what happens when the basket is replicated across
  // subnets or vendors. These are the "real-building" demos.
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'cov-firehose',
    name: 'BACnet/IP traffic showcase (COV firehose)',
    blurb:
      "Watch-the-bus demo. One JACE polling four IP-attached VAVs, each with a zone sensor configured to drift, overshoot, or just settle in from a far-off start temp. Every deadband crossing fires a ConfirmedCOVNotification. Packet log (bottom-right) is the star of the show — open it, hit Run, watch the SubscribeCOV / ReadProperty / ConfirmedCOVNotification stream.",
    scenario: buildScenario({
      nodes: [
        {
          id: 'jace',
          kind: 'supervisor',
          label: 'JACE-MAIN',
          x: 460,
          y: 40,
          data: {
            ipAddress: '10.0.1.10',
            subnetMask: '255.255.255.0',
            gateway: '10.0.1.1',
            vendorModelId: 'tridium-jace-8000',
            subtitle: 'Polls all 4 VAVs over BACnet/IP',
          },
        },
        // VAV-1 — cold start, heating ramps up (steady COV stream as
        // zone climbs through deadband).
        {
          id: 'vav1',
          kind: 'controller',
          label: 'VAV-101',
          x: 100,
          y: 240,
          data: { ipAddress: '10.0.1.21', subnetMask: '255.255.255.0' },
        },
        {
          id: 's1',
          kind: 'sensor',
          label: 'ZN-101',
          x: 100,
          y: 400,
          data: { signal: 'rtd-pt1000' },
        },
        // VAV-2 — hot start, cooling ramps down.
        {
          id: 'vav2',
          kind: 'controller',
          label: 'VAV-102',
          x: 340,
          y: 240,
          data: { ipAddress: '10.0.1.22', subnetMask: '255.255.255.0' },
        },
        {
          id: 's2',
          kind: 'sensor',
          label: 'ZN-102',
          x: 340,
          y: 400,
          data: { signal: 'rtd-pt1000' },
        },
        // VAV-3 — sensor DRIFT fault: walks ~1°F per 10 sim-min so it
        // crosses the 0.5°F deadband every ~5 sim-min reliably even
        // after the loop settles.
        {
          id: 'vav3',
          kind: 'controller',
          label: 'VAV-103',
          x: 580,
          y: 240,
          data: { ipAddress: '10.0.1.23', subnetMask: '255.255.255.0' },
        },
        {
          id: 's3',
          kind: 'sensor',
          label: 'ZN-103',
          x: 580,
          y: 400,
          data: { signal: 'thermistor-10k-t2', fault: 'drift' },
        },
        // VAV-4 — large coupling factor: overshoots setpoint, oscillates.
        {
          id: 'vav4',
          kind: 'controller',
          label: 'VAV-104',
          x: 820,
          y: 240,
          data: { ipAddress: '10.0.1.24', subnetMask: '255.255.255.0' },
        },
        {
          id: 's4',
          kind: 'sensor',
          label: 'ZN-104',
          x: 820,
          y: 400,
          data: { signal: 'rtd-pt1000' },
        },
      ],
      edges: [
        // Four BACnet/IP edges fan out from the JACE. Each one now
        // triggers SubscribeCOV + periodic ReadProperty via the new
        // IP-pair traffic generator in BuildCanvas.
        { source: 'jace', target: 'vav1', wireKind: 'bacnet-ip' },
        { source: 'jace', target: 'vav2', wireKind: 'bacnet-ip' },
        { source: 'jace', target: 'vav3', wireKind: 'bacnet-ip' },
        { source: 'jace', target: 'vav4', wireKind: 'bacnet-ip' },
        { source: 'vav1', target: 's1', wireKind: 'hardwired' },
        { source: 'vav2', target: 's2', wireKind: 'hardwired' },
        { source: 'vav3', target: 's3', wireKind: 'hardwired' },
        { source: 'vav4', target: 's4', wireKind: 'hardwired' },
      ],
      wires: [
        {
          controllerId: 'vav1',
          sensorId: 's1',
          // Cold start — heating loop drives zone up through deadband.
          config: { initialZone: 62, setpoint: 72, mode: 'heat', outdoorAir: 30 },
        },
        {
          controllerId: 'vav2',
          sensorId: 's2',
          // Hot start — cooling loop drives zone down through deadband.
          config: { initialZone: 85, setpoint: 72, mode: 'cool', outdoorAir: 90 },
        },
        {
          controllerId: 'vav3',
          sensorId: 's3',
          // Sensor has fault: 'drift' baked in; loop chases a phantom.
          config: { initialZone: 72, setpoint: 72 },
        },
        {
          controllerId: 'vav4',
          sensorId: 's4',
          // High coupling = overshoot = oscillation = ping-pong COVs.
          config: { initialZone: 68, setpoint: 72, couplingFactor: 0.8 },
        },
      ],
      focused: 'jace',
    }),
  },

  {
    id: 'midrise-12-vav',
    name: 'Mid-rise office: 1 JACE, 12 virtual VAVs',
    blurb:
      "Three-story building. A single Tridium JACE hosts 12 virtual VAVs grouped visually by floor (4 per floor). Same 'all eggs in one basket' lesson as the simpler soft-controller demo, but at the scale a real mid-rise gets to before the owner discovers it.",
    scenario: buildScenario({
      nodes: [
        {
          id: 'jace',
          kind: 'supervisor',
          label: 'JACE-MAIN',
          x: 580,
          y: 60,
          data: {
            ipAddress: '10.0.1.10',
            subnetMask: '255.255.255.0',
            gateway: '10.0.1.1',
            vendorModelId: 'tridium-jace-8000',
            subtitle: 'Tridium · Niagara · hosts 12 soft VAVs',
          },
        },
        // ── Floor 3 (top) ──────────────────────────────────────
        ...['vvav-301', 'vvav-302', 'vvav-303', 'vvav-304'].map((id, i) => ({
          id,
          kind: 'virtual-controller' as const,
          label: id.replace('vvav-', 'vVAV-'),
          x: 80 + i * 200,
          y: 220,
          data: { hostId: 'jace', hostLabel: 'JACE-MAIN', subtitle: 'Floor 3' },
        })),
        // ── Floor 2 (middle) ───────────────────────────────────
        ...['vvav-201', 'vvav-202', 'vvav-203', 'vvav-204'].map((id, i) => ({
          id,
          kind: 'virtual-controller' as const,
          label: id.replace('vvav-', 'vVAV-'),
          x: 80 + i * 200,
          y: 400,
          data: { hostId: 'jace', hostLabel: 'JACE-MAIN', subtitle: 'Floor 2' },
        })),
        // ── Floor 1 (ground) ───────────────────────────────────
        ...['vvav-101', 'vvav-102', 'vvav-103', 'vvav-104'].map((id, i) => ({
          id,
          kind: 'virtual-controller' as const,
          label: id.replace('vvav-', 'vVAV-'),
          x: 80 + i * 200,
          y: 580,
          data: { hostId: 'jace', hostLabel: 'JACE-MAIN', subtitle: 'Floor 1' },
        })),
      ],
      edges: [],
    }),
  },

  {
    id: 'campus-bbmd-bridge',
    name: 'Campus: 2 BBMDs bridge 2 JACEs (10 vVAVs total)',
    blurb:
      "Two-subnet campus. Operations VLAN (10.0.1.0/24) hosts JACE-OPS + 5 virtual VAVs; Tenant VLAN (10.0.2.0/24) hosts JACE-TENANT + 5 virtual VAVs. Each JACE runs BBMD service with the OTHER JACE in its BDT — cross-subnet Who-Is broadcasts get forwarded. The conformance panel + broadcast trace show the forwarded packets.",
    scenario: buildScenario({
      nodes: [
        // ── Subnet zone backgrounds ────────────────────────────
        {
          id: 'zone-ops',
          kind: 'subnet-zone',
          label: 'Operations VLAN',
          x: 40,
          y: 40,
          width: 560,
          height: 540,
          data: { cidr: '10.0.1.0/24', color: '#06b6d4' },
        },
        {
          id: 'zone-tenant',
          kind: 'subnet-zone',
          label: 'Tenant VLAN',
          x: 640,
          y: 40,
          width: 560,
          height: 540,
          data: { cidr: '10.0.2.0/24', color: '#a855f7' },
        },
        // ── Operations JACE + fleet ───────────────────────────
        {
          id: 'jace-ops',
          kind: 'supervisor',
          label: 'JACE-OPS',
          x: 240,
          y: 100,
          data: {
            ipAddress: '10.0.1.10',
            subnetMask: '255.255.255.0',
            gateway: '10.0.1.1',
            vendorModelId: 'tridium-jace-8000',
            subtitle: 'BBMD · BDT → 10.0.2.10',
            isBBMD: true,
            bdtPeers: ['10.0.2.10'],
          },
        },
        ...['vvav-o1', 'vvav-o2', 'vvav-o3', 'vvav-o4', 'vvav-o5'].map((id, i) => ({
          id,
          kind: 'virtual-controller' as const,
          label: id.replace('vvav-o', 'vVAV-OPS-'),
          x: 80 + i * 100,
          y: 280 + (i % 2) * 140,
          data: { hostId: 'jace-ops', hostLabel: 'JACE-OPS' },
        })),
        // ── Tenant JACE + fleet ───────────────────────────────
        {
          id: 'jace-tenant',
          kind: 'supervisor',
          label: 'JACE-TENANT',
          x: 840,
          y: 100,
          data: {
            ipAddress: '10.0.2.10',
            subnetMask: '255.255.255.0',
            gateway: '10.0.2.1',
            vendorModelId: 'tridium-jace-8000',
            subtitle: 'BBMD · BDT → 10.0.1.10',
            isBBMD: true,
            bdtPeers: ['10.0.1.10'],
          },
        },
        ...['vvav-t1', 'vvav-t2', 'vvav-t3', 'vvav-t4', 'vvav-t5'].map((id, i) => ({
          id,
          kind: 'virtual-controller' as const,
          label: id.replace('vvav-t', 'vVAV-TEN-'),
          x: 680 + i * 100,
          y: 280 + (i % 2) * 140,
          data: { hostId: 'jace-tenant', hostLabel: 'JACE-TENANT' },
        })),
      ],
      edges: [
        // The two JACEs are wired BACnet/IP to each other — the BBMD
        // service rides this physical link.
        { source: 'jace-ops', target: 'jace-tenant', wireKind: 'bacnet-ip' },
      ],
    }),
  },

  {
    id: 'mixed-vendor-hosts',
    name: 'Mixed vendor: Tridium + JCI side-by-side',
    blurb:
      "Tridium JACE and JCI NAE on the same subnet, each hosting their own fleet of soft controllers. Teaches the multi-vendor coexistence pattern most retrofit jobs end up with — the supervisors run different programming languages internally (Niagara wiresheet vs JCI CCT block-graph) but speak BACnet/IP to each other.",
    scenario: buildScenario({
      nodes: [
        // ── Tridium side (left) ────────────────────────────────
        {
          id: 'jace',
          kind: 'supervisor',
          label: 'JACE-MAIN',
          x: 220,
          y: 80,
          data: {
            ipAddress: '10.0.1.10',
            subnetMask: '255.255.255.0',
            gateway: '10.0.1.1',
            vendorModelId: 'tridium-jace-8000',
            subtitle: 'Tridium · Niagara wiresheet',
          },
        },
        {
          id: 'jace-vahu',
          kind: 'virtual-controller',
          label: 'vAHU-N1',
          x: 80,
          y: 280,
          data: { hostId: 'jace', hostLabel: 'JACE-MAIN', subtitle: 'AHU program' },
        },
        {
          id: 'jace-vvav1',
          kind: 'virtual-controller',
          label: 'vVAV-N1',
          x: 220,
          y: 280,
          data: { hostId: 'jace', hostLabel: 'JACE-MAIN' },
        },
        {
          id: 'jace-vvav2',
          kind: 'virtual-controller',
          label: 'vVAV-N2',
          x: 360,
          y: 280,
          data: { hostId: 'jace', hostLabel: 'JACE-MAIN' },
        },
        // ── JCI side (right) ───────────────────────────────────
        {
          id: 'nae',
          kind: 'supervisor',
          label: 'SNE-MAIN',
          x: 780,
          y: 80,
          data: {
            ipAddress: '10.0.1.20',
            subnetMask: '255.255.255.0',
            gateway: '10.0.1.1',
            vendorModelId: 'jci-sne10500',
            subtitle: 'JCI Metasys · CCT block-graph',
          },
        },
        {
          id: 'nae-vboiler',
          kind: 'virtual-controller',
          label: 'vBOILER',
          x: 640,
          y: 280,
          data: { hostId: 'nae', hostLabel: 'SNE-MAIN', subtitle: 'Hot-water plant' },
        },
        {
          id: 'nae-vvav1',
          kind: 'virtual-controller',
          label: 'vVAV-J1',
          x: 780,
          y: 280,
          data: { hostId: 'nae', hostLabel: 'SNE-MAIN' },
        },
        {
          id: 'nae-vvav2',
          kind: 'virtual-controller',
          label: 'vVAV-J2',
          x: 920,
          y: 280,
          data: { hostId: 'nae', hostLabel: 'SNE-MAIN' },
        },
      ],
      edges: [
        // The two supervisors talk BACnet/IP across the same subnet.
        { source: 'jace', target: 'nae', wireKind: 'bacnet-ip' },
      ],
    }),
  },

  // ═══════════════════════════════════════════════════════════════════
  // vAHU G36 §5.18 — live single-zone AHU sequence
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'g36-ahu-sequence',
    name: 'G36 §5.18 AHU — live sequence',
    blurb:
      'Single-zone VAV AHU running ASHRAE Guideline 36 §5.18. Cold-start: OAT 28°F, zone at 62°F — watch the AHU enter heating mode, ramp the hot-water valve, and climb toward setpoint. Open the BACnet packet log to see SubscribeCOV for DAT, ZN-T, CV-POS + periodic ReadProperty polls from the JACE.',
    scenario: buildScenario({
      nodes: [
        // Supervisor: Tridium JACE polling the AHU over BACnet/IP.
        {
          id: 'jace',
          kind: 'supervisor',
          label: 'JACE-8000',
          x: 320,
          y: 60,
          data: {
            ipAddress: '10.0.1.10',
            subnetMask: '255.255.255.0',
            gateway: '10.0.1.1',
            vendorModelId: 'tridium-jace-8000',
            subtitle: 'Polls AHU-1 over BACnet/IP',
          },
        },
        // vAHU — G36 §5.18 sequence, cold-start conditions.
        // OAT and zone temp come from the sim clock; vahuConfig
        // overrides here push the AHU into heating mode immediately.
        {
          id: 'ahu',
          kind: 'vahu',
          label: 'AHU-1',
          x: 320,
          y: 240,
          data: {
            ipAddress: '10.0.1.30',
            subnetMask: '255.255.255.0',
            subtitle: 'G36 §5.18 · heat mode on cold start',
            // Drive OAT below econ lockout and zone below setpoint so
            // the unit starts in heating mode — the most interesting
            // sequence to watch on first load.
          },
        },
        // Zone node — couples to the AHU so zone temp reflects the
        // AHU's discharge air warming the room over time.
        {
          id: 'zone',
          kind: 'zone',
          label: 'ZONE-1',
          x: 320,
          y: 430,
          data: {
            zoneConfig: {
              // Cold morning start: zone is 62°F, building lost heat
              // overnight. The AHU will heat it back to 72°F setpoint.
              T_zone_init: 62,
              // Medium thermal mass (conference room / open office).
              volume_cu_ft: 18000,
              peak_occupants: 20,
            },
            subtitle: '18 000 ft³ · cold start 62°F',
          },
        },
      ],
      edges: [
        // Supervisor ↔ AHU: BACnet/IP (triggers SubscribeCOV + polls).
        { source: 'jace', target: 'ahu', wireKind: 'bacnet-ip' },
        // AHU ↔ Zone: the AHU's supply air warms the zone each tick.
        { source: 'ahu', target: 'zone', wireKind: 'hardwired' },
      ],
    }),
  },

  {
    id: 'g36-ahu-economizer',
    name: 'G36 §5.18 AHU — economizer mode',
    blurb:
      'Same AHU, warm spring morning: OAT 58°F, zone at 76°F (too warm). Economizer kicks in — outside air damper opens above minimum ventilation, mechanical cooling stays off. Watch the packet log for OAD-POS and CV-POS COVs.',
    scenario: buildScenario({
      nodes: [
        {
          id: 'jace',
          kind: 'supervisor',
          label: 'JACE-8000',
          x: 320,
          y: 60,
          data: {
            ipAddress: '10.0.1.10',
            subnetMask: '255.255.255.0',
            vendorModelId: 'tridium-jace-8000',
            subtitle: 'Polling AHU over BACnet/IP',
          },
        },
        {
          id: 'ahu',
          kind: 'vahu',
          label: 'AHU-1',
          x: 320,
          y: 240,
          data: {
            ipAddress: '10.0.1.30',
            subnetMask: '255.255.255.0',
            subtitle: 'G36 §5.18 · economizer on warm spring day',
          },
        },
        {
          id: 'zone',
          kind: 'zone',
          label: 'ZONE-1',
          x: 320,
          y: 430,
          data: {
            zoneConfig: {
              // Warm start: afternoon sun loaded the room.
              T_zone_init: 76,
              volume_cu_ft: 18000,
              peak_occupants: 20,
            },
            subtitle: '18 000 ft³ · warm start 76°F',
          },
        },
      ],
      edges: [
        { source: 'jace', target: 'ahu', wireKind: 'bacnet-ip' },
        { source: 'ahu', target: 'zone', wireKind: 'hardwired' },
      ],
    }),
  },

  // ═══════════════════════════════════════════════════════════════════
  // THE MEGA SITE — stress-test scale. Three engines, two MS/TP trunks
  // (17 field MACs), a G36 AHU driving four real actuators, plant
  // equipment, eight thermally-coupled zones, every sensor signal type
  // in the catalog, and two deliberate faults hiding in the flurry.
  // Built 2026-06-11 to shake bugs out at scale. If something's going
  // to fall over at 40+ nodes, better here than at a customer demo.
  // ═══════════════════════════════════════════════════════════════════
  {
    id: 'mega-site',
    name: 'MEGA SITE: 3 engines, 17 MACs, full plant',
    blurb:
      "Stress-test building. JACE-AHU runs a G36 AHU (driving fan VFD + OA damper + heat/cool valve actuators) plus an 8-VAV MS/TP trunk with mixed sensor types — Pt1000, Ni1000, 10k thermistor, CO₂. NAE-EAST runs 6 more VAVs on its own trunk. SNE-PLANT's FECs ship with REAL ST programs (open >_ Programming on them): FEC-BLR runs outdoor-reset boiler firing, FEC-CHW runs chiller enable with hysteresis, and VAV-101 carries a custom cooling override — the plant actually responds to OAT. Eight zones share walls and drift together. Two faults are hiding in the noise: one drifting sensor and one zone sensor wired to the wrong-kind input. Open the packet log, hit Run at 30×, and watch the MAC flurry, COV stream, and lease renewals. Diagnose at your leisure.",
    scenario: buildScenario({
      nodes: [
        // ── IP backbone: three engines + L2 switch ─────────────────
        {
          id: 'sw-core',
          kind: 'switch',
          label: 'SW-CORE',
          x: 640,
          y: 40,
          data: { subtitle: 'Building core switch' },
        },
        {
          id: 'jace-ahu',
          kind: 'supervisor',
          label: 'JACE-AHU',
          x: 240,
          y: 130,
          data: {
            ipAddress: '10.0.1.10',
            subnetMask: '255.255.255.0',
            gateway: '10.0.1.1',
            vendorModelId: 'tridium-jace-8000',
            subtitle: 'AHU + west trunk · 8 VAVs',
            eolTerminated: true,
          },
        },
        {
          id: 'nae-east',
          kind: 'supervisor',
          label: 'NAE-EAST',
          x: 1060,
          y: 130,
          data: {
            ipAddress: '10.0.1.11',
            subnetMask: '255.255.255.0',
            gateway: '10.0.1.1',
            vendorModelId: 'jci-sne10500',
            subtitle: 'East trunk · 6 VAVs',
            eolTerminated: true,
          },
        },
        {
          id: 'sne-plant',
          kind: 'supervisor',
          label: 'SNE-PLANT',
          x: 640,
          y: 220,
          data: {
            ipAddress: '10.0.1.12',
            subnetMask: '255.255.255.0',
            gateway: '10.0.1.1',
            vendorModelId: 'jci-sne10500',
            subtitle: 'Central plant trunk',
            eolTerminated: true,
          },
        },
        // ── G36 AHU + its actuator rack ────────────────────────────
        {
          id: 'ahu1',
          kind: 'vahu',
          label: 'AHU-1',
          x: 60,
          y: 250,
          data: {
            ipAddress: '10.0.1.30',
            subnetMask: '255.255.255.0',
            subtitle: 'G36 §5.18 · serves west zones',
          },
        },
        {
          id: 'act-sf-vfd',
          kind: 'actuator',
          label: 'SF-VFD',
          x: 20,
          y: 420,
          data: { actuatorModelId: 'abb-acs320', subtitle: 'Supply fan drive' },
        },
        {
          id: 'act-oad',
          kind: 'actuator',
          label: 'OAD-ACT',
          x: 150,
          y: 420,
          data: { actuatorModelId: 'belimo-af24-mft', subtitle: 'OA damper' },
        },
        {
          id: 'act-hv',
          kind: 'actuator',
          label: 'HV-ACT',
          x: 280,
          y: 420,
          data: { actuatorModelId: 'belimo-b2-fr', subtitle: 'Heating valve' },
        },
        {
          id: 'act-cv',
          kind: 'actuator',
          label: 'CV-ACT',
          x: 410,
          y: 420,
          data: { actuatorModelId: 'belimo-lr24-3', subtitle: 'Cooling valve' },
        },
        // ── West trunk: 8 VAVs, true daisy chain, EOL at both ends ──
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `wvav-${i + 1}`,
          kind: 'controller' as const,
          label: `VAV-1${String(i + 1).padStart(2, '0')}`,
          x: 60 + i * 150,
          y: 560,
          data: {
            vendorModelId: 'distech-ecy-vav',
            subtitle: 'West wing',
            // Chain ends terminate; middles must not.
            eolTerminated: i === 7,
          },
        })),
        // West-trunk zone sensors — one of each signal type in the
        // catalog, plus two deliberate faults for the hunt:
        //   ZN-103: drift fault (reads plausible, slowly walks away)
        //   ZN-106: CO₂ on a temp role — wrong-kind teaching beat
        { id: 'ws-1', kind: 'sensor', label: 'ZN-101', x: 60, y: 700, data: { signal: 'rtd-pt1000' } },
        { id: 'ws-2', kind: 'sensor', label: 'ZN-102', x: 210, y: 700, data: { signal: 'rtd-ni1000' } },
        { id: 'ws-3', kind: 'sensor', label: 'ZN-103', x: 360, y: 700, data: { signal: 'thermistor-10k-t2', fault: 'drift' } },
        { id: 'ws-4', kind: 'sensor', label: 'ZN-104', x: 510, y: 700, data: { signal: 'rtd-pt1000' } },
        { id: 'ws-5', kind: 'sensor', label: 'ZN-105', x: 660, y: 700, data: { signal: 'rtd-ni1000' } },
        { id: 'ws-6', kind: 'sensor', label: 'CO2-106', x: 810, y: 700, data: { signal: 'analog-4-20ma', sensorModelId: 'veris-cwe' } },
        { id: 'ws-7', kind: 'sensor', label: 'ZN-107', x: 960, y: 700, data: { signal: 'thermistor-10k-t2' } },
        { id: 'ws-8', kind: 'sensor', label: 'ZN-108', x: 1110, y: 700, data: { signal: 'rtd-pt1000' } },
        // ── East trunk: 6 VAVs, chain, EOL at both ends ─────────────
        ...Array.from({ length: 6 }, (_, i) => ({
          id: `evav-${i + 1}`,
          kind: 'controller' as const,
          label: `VAV-2${String(i + 1).padStart(2, '0')}`,
          x: 700 + i * 150,
          y: 340,
          data: {
            vendorModelId: 'distech-ecy-vav',
            subtitle: 'East wing',
            eolTerminated: i === 5,
          },
        })),
        { id: 'es-1', kind: 'sensor', label: 'ZN-201', x: 700, y: 470, data: { signal: 'rtd-pt1000' } },
        { id: 'es-2', kind: 'sensor', label: 'ZN-202', x: 850, y: 470, data: { signal: 'rtd-ni1000' } },
        { id: 'es-3', kind: 'sensor', label: 'ZN-203', x: 1000, y: 470, data: { signal: 'thermistor-10k-t2' } },
        // ── Central plant: controllers + equipment + VFD w/ feedback ─
        {
          id: 'fec-blr',
          kind: 'controller',
          label: 'FEC-BLR',
          x: 460,
          y: 330,
          // Mid-chain on SNE-PLANT → FEC-BLR → FEC-CHW: NO termination.
          // (The EOL validator caught the demo author getting this wrong
          // on the first draft — exactly the mistake it exists to catch.)
          data: { subtitle: 'Boiler controller', eolTerminated: false },
        },
        {
          id: 'fec-chw',
          kind: 'controller',
          label: 'FEC-CHW',
          x: 590,
          y: 330,
          data: { subtitle: 'Chiller controller', eolTerminated: true },
        },
        {
          id: 'eq-boiler',
          kind: 'equipment',
          label: 'BLR-1',
          x: 460,
          y: 460,
          data: { equipmentModelId: 'cleaver-brooks-clearfire-h', subtitle: 'Condensing boiler' },
        },
        {
          id: 'eq-chiller',
          kind: 'equipment',
          label: 'CH-1',
          x: 590,
          y: 460,
          data: { equipmentModelId: 'carrier-30xa', subtitle: 'Air-cooled chiller' },
        },
        {
          id: 'act-hwp-vfd',
          kind: 'actuator',
          label: 'HWP-VFD',
          x: 330,
          y: 460,
          data: { actuatorModelId: 'danfoss-fc101', subtitle: 'HW pump drive' },
        },
        {
          id: 'act-ch-en',
          kind: 'actuator',
          label: 'CH-EN',
          x: 720,
          y: 460,
          data: { actuatorModelId: 'square-d-classII-contactor', subtitle: 'Chiller enable contactor' },
        },
        // Plant supply-temp sensors — make the FECs physics targets so
        // their shipped ST programs actually run each tick.
        { id: 'hws-t', kind: 'sensor', label: 'HWS-T', x: 400, y: 560, data: { signal: 'rtd-pt1000' } },
        { id: 'chws-t', kind: 'sensor', label: 'CHWS-T', x: 650, y: 560, data: { signal: 'rtd-pt1000' } },
        // ── Zones: a west row sharing walls + an east pair ──────────
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `zone-w${i + 1}`,
          kind: 'zone' as const,
          label: `WEST-${i + 1}`,
          x: 60 + i * 230,
          y: 840,
          data: {
            zoneConfig: {
              T_zone_init: [58, 65, 71, 77, 84][i],
              peak_occupants: [2, 4, 12, 2, 1][i],
              // Size rooms to their use — the 12'×14' default packs a
              // conference room's load into a closet.
              volume_cu_ft: [4000, 4000, 9000, 4000, 2000][i],
              floor_area_sqft: [440, 440, 1000, 440, 220][i],
              // Zone 5 is the server room: high plug load, no people.
              equipment_w_per_sqft: i === 4 ? 6 : 1,
            },
            subtitle: ['cold start', 'cool', 'conference', 'warm', 'server room'][i],
          },
        })),
        {
          id: 'zone-e1',
          kind: 'zone',
          label: 'EAST-1',
          x: 760,
          y: 840,
          data: { zoneConfig: { T_zone_init: 69, peak_occupants: 6, volume_cu_ft: 9000, floor_area_sqft: 1000 }, subtitle: 'open office' },
        },
        {
          id: 'zone-e2',
          kind: 'zone',
          label: 'EAST-2',
          x: 990,
          y: 840,
          data: { zoneConfig: { T_zone_init: 74, peak_occupants: 3, volume_cu_ft: 4500, floor_area_sqft: 500 }, subtitle: 'corner office' },
        },
        {
          id: 'zone-ahu',
          kind: 'zone',
          label: 'AHU-SERVED',
          x: 1220,
          y: 840,
          data: { zoneConfig: { T_zone_init: 63, peak_occupants: 20, volume_cu_ft: 18000, floor_area_sqft: 2000 }, subtitle: 'AHU-1 main zone' },
        },
      ],
      edges: [
        // IP backbone through the core switch + engines' pair traffic.
        { source: 'jace-ahu', target: 'sw-core', wireKind: 'bacnet-ip' },
        { source: 'nae-east', target: 'sw-core', wireKind: 'bacnet-ip' },
        { source: 'sne-plant', target: 'sw-core', wireKind: 'bacnet-ip' },
        // JACE ↔ AHU direct pair (SubscribeCOV + polls on the wire).
        { source: 'jace-ahu', target: 'ahu1', wireKind: 'bacnet-ip' },
        // AHU drives its actuator rack from live G36 sequence state.
        { source: 'ahu1', target: 'act-sf-vfd', wireKind: 'hardwired', sourceHandle: 'AO-1' },
        { source: 'ahu1', target: 'act-oad', wireKind: 'hardwired', sourceHandle: 'AO-2' },
        { source: 'ahu1', target: 'act-hv', wireKind: 'hardwired', sourceHandle: 'AO-3' },
        { source: 'ahu1', target: 'act-cv', wireKind: 'hardwired', sourceHandle: 'AO-4' },
        { source: 'ahu1', target: 'zone-ahu', wireKind: 'hardwired' },
        // West MS/TP trunk — TRUE daisy chain (no hub-spoke!).
        { source: 'jace-ahu', target: 'wvav-1', wireKind: 'mstp', baud: 38400 },
        ...Array.from({ length: 7 }, (_, i) => ({
          source: `wvav-${i + 1}`,
          target: `wvav-${i + 2}`,
          wireKind: 'mstp' as const,
          baud: 38400,
        })),
        // West zone sensors into their VAVs.
        ...Array.from({ length: 8 }, (_, i) => ({
          source: `wvav-${i + 1}`,
          target: `ws-${i + 1}`,
          wireKind: 'hardwired' as const,
        })),
        // East MS/TP trunk — chain at 76800 baud.
        { source: 'nae-east', target: 'evav-1', wireKind: 'mstp', baud: 76800 },
        ...Array.from({ length: 5 }, (_, i) => ({
          source: `evav-${i + 1}`,
          target: `evav-${i + 2}`,
          wireKind: 'mstp' as const,
          baud: 76800,
        })),
        { source: 'evav-1', target: 'es-1', wireKind: 'hardwired' },
        { source: 'evav-2', target: 'es-2', wireKind: 'hardwired' },
        { source: 'evav-3', target: 'es-3', wireKind: 'hardwired' },
        // Plant trunk: SNE → boiler FEC → chiller FEC (chain, EOL ends).
        { source: 'sne-plant', target: 'fec-blr', wireKind: 'mstp', baud: 38400 },
        { source: 'fec-blr', target: 'fec-chw', wireKind: 'mstp', baud: 38400 },
        // Plant equipment + the pump VFD (with position feedback into
        // the boiler FEC's UI-3 — the G26 path at plant scale).
        { source: 'fec-blr', target: 'eq-boiler', wireKind: 'hardwired' },
        { source: 'fec-chw', target: 'eq-chiller', wireKind: 'hardwired' },
        { source: 'fec-blr', target: 'act-hwp-vfd', wireKind: 'hardwired' },
        // Position feedback lands generic — G32: generic controllers
        // render no terminal handles, so a targetHandle here makes
        // xyflow drop the edge entirely (and warn every render).
        { source: 'act-hwp-vfd', target: 'fec-blr', wireKind: 'hardwired' },
        // The VFD's command reaches the boiler (unbound role routes to
        // plant command; the loop pump auto-runs with the plant). The
        // FEC-BLR shipped outdoor-reset program is what moves the VFD.
        { source: 'act-hwp-vfd', target: 'eq-boiler', wireKind: 'hardwired' },
        // Chiller enable chain: FEC-CHW program → contactor → chiller.
        { source: 'fec-chw', target: 'act-ch-en', wireKind: 'hardwired' },
        { source: 'act-ch-en', target: 'eq-chiller', wireKind: 'hardwired' },
        // Plant supply-temp sensors into their FECs (physics targets so
        // the shipped programs run).
        { source: 'fec-blr', target: 'hws-t', wireKind: 'hardwired' },
        { source: 'fec-chw', target: 'chws-t', wireKind: 'hardwired' },
        // Zones share walls along each row (zone↔zone conduction).
        ...Array.from({ length: 4 }, (_, i) => ({
          source: `zone-w${i + 1}`,
          target: `zone-w${i + 2}`,
          wireKind: 'hardwired' as const,
        })),
        { source: 'zone-e1', target: 'zone-e2', wireKind: 'hardwired' },
      ],
      // Thermal programs — every VAV does something different: modes
      // alternate heat/cool, setpoints spread 68–74, time constants vary
      // so the COV streams de-correlate.
      wires: [
        ...Array.from({ length: 8 }, (_, i) => ({
          controllerId: `wvav-${i + 1}`,
          sensorId: `ws-${i + 1}`,
          config: {
            mode: (i % 2 === 0 ? 'heat' : 'cool') as 'heat' | 'cool',
            setpoint: 68 + (i % 4) * 2,
            initialZone: 58 + i * 3,
            tau: 600 + i * 120,
          },
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          controllerId: `evav-${i + 1}`,
          sensorId: `es-${i + 1}`,
          config: {
            mode: (i % 2 === 0 ? 'cool' : 'heat') as 'heat' | 'cool',
            setpoint: 70 + i,
            initialZone: 78 - i * 4,
            tau: 800 + i * 200,
          },
        })),
        // Plant FECs become physics targets so their ST programs run.
        { controllerId: 'fec-blr', sensorId: 'hws-t', config: { mode: 'heat' as const, setpoint: 72 } },
        { controllerId: 'fec-chw', sensorId: 'chws-t', config: { mode: 'cool' as const, setpoint: 72 } },
      ],
      // Shipped controller programs (>_ Programming would show these) —
      // the plant runs real logic instead of sitting dead, and one VAV
      // carries a custom override. All single-output by design: generic
      // controllers have no terminal handles yet (G32), so each program
      // drives its one wired actuator via the primary `actuator` output.
      programs: [
        {
          controllerId: 'fec-blr',
          source: [
            '(* Boiler plant: outdoor-reset firing via the HW pump VFD. *)',
            '(* Hotter water the colder it gets; off above 65F OAT       *)',
            '(* (the loop ALSO hardware-locks-out above 65F - belt and    *)',
            '(* suspenders, like a real site).                            *)',
            'IF oat < 65.0 THEN',
            '  actuator := CLAMP((65.0 - oat) / 40.0, 0.15, 1.0);',
            'ELSE',
            '  actuator := 0.0;',
            'END_IF',
          ].join('\n'),
        },
        {
          controllerId: 'fec-chw',
          source: [
            '(* Chiller enable with hysteresis: on above 58F OAT, off    *)',
            '(* below 54F. The 4F band stops short-cycling on a mild day. *)',
            'VAR',
            '  run: REAL := 0.0;',
            'END_VAR',
            'IF oat > 58.0 THEN',
            '  run := 1.0;',
            'END_IF',
            'IF oat < 54.0 THEN',
            '  run := 0.0;',
            'END_IF',
            'actuator := run;',
          ].join('\n'),
        },
        {
          controllerId: 'wvav-1',
          source: [
            '(* Custom cooling override: proportional band, wide-open on  *)',
            '(* a 5F+ excursion. Overrides the built-in PI loop - open    *)',
            '(* >_ Programming on VAV-101 to edit this live.              *)',
            'IF sensed > setpoint + 5.0 THEN',
            '  actuator := 1.0;',
            'ELSE',
            '  actuator := CLAMP((sensed - setpoint) / 3.0, 0.0, 1.0);',
            'END_IF',
          ].join('\n'),
        },
      ],
      focused: 'jace-ahu',
    }),
  },
];
