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
type NodeKind = 'supervisor' | 'controller' | 'sensor' | 'safety' | 'subnet-zone' | 'router' | 'virtual-controller' | 'vahu';

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
            // Larger τ for a building envelope losing heat to cold OAT.
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
              volume_ft3: 18000,
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
              volume_ft3: 18000,
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
];
