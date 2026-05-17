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
    data: { kind: n.kind, label: n.label, ...(n.data ?? {}) },
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
