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
type NodeKind = 'supervisor' | 'controller' | 'sensor' | 'safety';

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
};

type SpecEdge = {
  source: string;
  target: string;
  wireKind: WireKind;
  /** Optional MS/TP-style baud rate, displayed on the trunk panel. */
  baud?: number;
};

type SpecWire = {
  controllerId: string;
  sensorId: string;
  /** Overrides on top of DEFAULT_CONFIG for that target's PI loop / mode / schedule. */
  config?: Partial<SingleZoneConfig>;
};

type ScenarioSpec = {
  nodes: SpecNode[];
  edges: SpecEdge[];
  wires?: SpecWire[];
  focused?: string;
};

function buildScenario(spec: ScenarioSpec): BasScenarioV1 {
  const nodes: Node[] = spec.nodes.map((n) => ({
    id: n.id,
    type: 'bas',
    position: { x: n.x, y: n.y },
    data: {
      kind: n.kind,
      label: n.label,
      ...(n.forcedMac !== undefined ? { forcedMac: n.forcedMac } : {}),
      ...(n.data ?? {}),
    },
  }));
  const edges: Edge[] = spec.edges.map((e, idx) => ({
    id: `de-${idx}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
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
    id: 'quickstart',
    name: 'Quick start: 1 VAV',
    blurb: 'Single VAV + zone temp sensor on BACnet/IP. Hit Run to watch a PI cool from 76→72°F.',
    scenario: buildScenario({
      nodes: [
        { id: 'sup', kind: 'supervisor', label: 'NAE-1', x: 240, y: 60 },
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
        { source: 'sup', target: 'vav', wireKind: 'bacnet-ip' },
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
        { id: 'fec', kind: 'controller', label: 'FEC-MAIN', x: 420, y: 180 },
        { id: 'vav1', kind: 'controller', label: 'VAV-101', x: 200, y: 360 },
        { id: 'vav2', kind: 'controller', label: 'VAV-102', x: 420, y: 360 },
        { id: 'vav3', kind: 'controller', label: 'VAV-103', x: 640, y: 360 },
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
        { source: 'fec', target: 'vav1', wireKind: 'mstp', baud: 38400 },
        { source: 'fec', target: 'vav2', wireKind: 'mstp', baud: 38400 },
        { source: 'fec', target: 'vav3', wireKind: 'mstp', baud: 38400 },
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
            // Larger τ for a building envelope losing heat to cold OAT.
            tau: 900,
          },
        },
      ],
      focused: 'ahu',
    }),
  },
];
