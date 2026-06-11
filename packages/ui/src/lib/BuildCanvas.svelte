<script lang="ts">
  import { setContext, untrack } from 'svelte';
  import {
    Background,
    ConnectionMode,
    MarkerType,
    Panel,
    SvelteFlow,
    SvelteFlowProvider,
    addEdge,
    type Connection,
    type Edge,
    type Node,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import BasNode from './BasNode.svelte';
  import SubnetZone from './SubnetZone.svelte';
  import MiniChart, { type ChartSeries } from './MiniChart.svelte';
  import CorpusBadge from './bacnet/CorpusBadge.svelte';
  import {
    SingleZoneSystem,
    DEFAULT_CONFIG,
    type Sample,
    type SingleZoneConfig,
    type SensorFault,
  } from './sim/thermal';
  import {
    SENSOR_TEMPLATE_BY_ID,
    DEFAULT_SENSOR_SIGNAL,
    type SensorSignal,
  } from './sim/sensorModels';
  import { importStore, canvasActions, openModelPicker, selectionStore, canvasSnapshot } from './canvasStore.svelte';
  import { log as logEvent, clearLog as clearRuntimeLog } from './runtime/runtimeLogStore.svelte';
  import { advancePlayback, currentWeatherSample, weatherStore } from './weather/weatherStore.svelte';
  import {
    openCli,
    openFbd,
    openSpecLang,
    openBacnet,
    openTerminals,
    programStore,
    setProgramSource,
  } from './cli/programStore.svelte';
  import { scenarioStore } from './scenarios/scenarioStore.svelte';
  import { validateScenario } from './scenarios/validator';
  import { registerBridge, controllerBridge, bumpTick as bumpBridgeTick, type ControllerSnapshot, type TerminalSignalSnapshot } from './cli/controllerBridge.svelte';
  import {
    logPacket as logBacnetPacket,
    clearPackets as clearBacnetPackets,
  } from './bacnet/bacnetPacketLog.svelte';
  import { openTrunkInspector, publishTrunkStates, publishMstpFindings, publishIpv4Findings, trunkInspectorStore } from './bacnet/trunkInspectorStore.svelte';
  import { guidanceStore, setGuidanceMode } from './guidanceStore.svelte';
  import {
    runProgram,
    makeEnv,
    synthesizeBacnetObjects,
    findControllerModel,
    findSensorModel,
    findSafetyDevice,
    findExpansionModule,
    findActuatorModel,
    findEquipmentModel,
    findNetworkGear,
    findTileTemplate,
    formatPointBreakdown,
    computeSensorReading,
    defaultTerminalConfig,
    signalToEng,
    engToSignal,
    type SignalFault,
    stepLoop,
    initLoopState,
    computeOaLockout,
    HW_LOOP_DEFAULTS,
    CHW_LOOP_DEFAULTS,
    CW_LOOP_DEFAULTS,
    stepZone,
    initZoneState,
    defaultOccupancySchedule,
    DEFAULT_ZONE_CONFIG,
    stepMstpToken,
    initMstpTrunkState,
    defaultDeviceInstance,
    mstpServiceLatencySeconds,
    assignMstpAddressing,
    validateMstpTrunks,
    validateMstpTopology,
    VAHU_POINTS,
    VAHU_TERMINAL_ROLES,
    validateBacnetIpNetwork,
    validateIpZones,
    parseIpv4 as parseIpv4FromUiCanvas,
    formatIpv4 as formatIpv4FromUiCanvas,
    parseCidr as parseCidrFromUiCanvas,
    isContiguousMask as isContiguousMaskUi,
    emitIAm,
    emitSubscribeCov,
    emitSubscribeCovAck,
    emitReadProperty,
    emitReadPropertyAck,
    emitCovNotification,
    emitRegisterForeignDevice,
    emitBvlcResult,
    emitForwardedWhoIs,
    emitDistributeBroadcast,
    BACNET_IP_RTT_SECONDS,
    COV_LIFETIME_DEFAULT_S,
    isCovRenewalDue,
    isCovLeaseExpired,
    covScanDelay,
    stepVAhu,
    initVAhuState,
    DEFAULT_VAHU_CONFIG,
    synthesizeVAhuObjects,
    type StEnv,
    type MstpFinding,
    type BacnetIpDevice,
    type BacnetIpEdge,
    type BacnetIpRouter,
    type PlacedBacnetIpDevice,
    type SubnetZone as SubnetZoneSpec,
    type LoopState,
    type ZoneState,
    type MstpTrunkState,
    type VAhuState,
    type VAhuConfig,
    type VAhuInputs,
  } from '@bas/core';
  import { onMount } from 'svelte';
  import type { BasScenarioV1 } from './scenario';
  import { DEMOS } from './demoScenarios';
  import {
    resolveTerminalConfig,
    clearAllTerminalConfig,
    rehydrateTerminalConfigs,
    terminalConfigStore,
  } from './terminalConfigStore.svelte';

  const nodeTypes = { bas: BasNode, subnet: SubnetZone };

  // ============ Subnet zones (Net.1) ============
  //
  // A subnet zone is a labeled, resizable rectangle behind the regular
  // nodes that names a VLAN / IP subnet. It lives in `nodes[]` as a
  // SvelteFlow node with `type: 'subnet'` and `data.kind: 'subnet-zone'`.
  // Membership is geometric — a node "belongs" iff its position lies
  // inside the rect — and the IP validator (in the per-tick loop below)
  // cross-checks each contained device's IP against the zone's CIDR.

  type SubnetZoneData = {
    kind: 'subnet-zone';
    label: string;
    cidr: string;
    color: string;
  };

  /** Color palette for new zones — cycled in order so successive zones
   *  read as visually distinct. Pulled from the existing wire-color
   *  palette so the canvas stays internally consistent. */
  const ZONE_COLORS = ['#4a9eff', '#9c8cff', '#2ecc71', '#fb923c', '#f59e0b', '#ec4899'] as const;
  let zoneColorIndex = 0;

  function isSubnetZone(n: Node): boolean {
    return (n.data as { kind?: string } | undefined)?.kind === 'subnet-zone';
  }

  /** True iff `s` is a non-empty string that doesn't parse as a CIDR.
   *  Empty / undefined treated as "no input yet" → not an error. Used
   *  by zone + router input fields to draw a red border in real time. */
  function isCidrInvalid(s: string | undefined | null): boolean {
    if (!s) return false;
    return parseCidrFromUiCanvas(s) === null;
  }

  /** Live validity state for an addressing field, driving the red/green
   *  border-as-you-type affordance. Empty → '' (neutral: no nag before the
   *  user has typed anything). Otherwise 'valid' (green) when it parses,
   *  'invalid' (red) when it doesn't — so "10.0.1" or "10.0.1.300" reads as
   *  wrong the instant it's typed, and a clean dotted-quad reads as right.
   *
   *  - ipAddrState:  the device IP field, which also accepts CIDR shorthand.
   *  - maskState:    a subnet mask must parse AND be a contiguous run of 1s.
   *  - gwState:      a plain dotted-quad. */
  function ipAddrState(s: string | undefined | null): 'valid' | 'invalid' | '' {
    if (!s) return '';
    if (parseIpv4FromUiCanvas(s) !== null) return 'valid';
    if (parseCidrFromUiCanvas(s) !== null) return 'valid';
    return 'invalid';
  }
  function maskState(s: string | undefined | null): 'valid' | 'invalid' | '' {
    if (!s) return '';
    const m = parseIpv4FromUiCanvas(s);
    if (m === null) return 'invalid';
    return isContiguousMaskUi(m) ? 'valid' : 'invalid';
  }
  function gwState(s: string | undefined | null): 'valid' | 'invalid' | '' {
    if (!s) return '';
    return parseIpv4FromUiCanvas(s) !== null ? 'valid' : 'invalid';
  }

  // ============ Net.5 — broadcast routing trace ============
  /** Sim-seconds between successive broadcast-trace emissions. Real
   *  BACnet Who-Is broadcasts go out continuously on a busy bus, but
   *  for teaching purposes we emit a snapshot every 30 sim-seconds so
   *  the packet log doesn't drown the user. */
  const BROADCAST_TRACE_PERIOD = 30;
  let lastBroadcastTraceSec = -BROADCAST_TRACE_PERIOD;

  // BACnet confirmed-service invoke IDs (ASHRAE 135 §20.1.2.4) — 8-bit
  // unsigned counter that pairs each Confirmed-REQ with its ACK. The
  // requester (supervisor MAC 0 in our model) increments per request;
  // the responder echoes the same ID in the Complex-ACK. Without this
  // ID, multiple in-flight ReadPropertys can't be matched to their
  // responses — which is why real bus traces always show it. Real
  // captures confirmed: bacpypes3 emits invokeID=0 for the first
  // ReadProperty, increments by 1 per subsequent confirmed service.
  let nextInvokeId = 0;
  function bumpInvokeId(): number {
    const v = nextInvokeId;
    nextInvokeId = (nextInvokeId + 1) & 0xff; // wrap at 256 per spec
    return v;
  }

  /** Count the 1-bits in a 32-bit unsigned integer. Used to convert a
   *  dotted-quad mask to a CIDR prefix length for trace labels. */
  function bitCount(n: number): number {
    let c = 0;
    let m = n >>> 0;
    while (m) {
      c += m & 1;
      m >>>= 1;
    }
    return c;
  }

  /** Look up the registered BACnet vendor ID for a controller model.
   *  ASHRAE maintains the official list at bacnet.org — these are the
   *  ones our catalog touches. Anything not in this map falls back to
   *  the Reliable Controls vendor ID (260) which we use as a generic
   *  placeholder — the conformance checker doesn't care about the
   *  specific value, only that the field is present per §16.10.2. */
  function vendorIdFor(vendorModelId: string | undefined): number {
    if (!vendorModelId) return 260;
    if (vendorModelId.startsWith('jci-')) return 5; // Johnson Controls
    if (vendorModelId.startsWith('tridium-')) return 37; // Tridium
    if (vendorModelId.startsWith('beckhoff-')) return 86; // Beckhoff
    if (vendorModelId.startsWith('wago-')) return 110; // Wago
    if (vendorModelId.startsWith('siemens-')) return 7; // Siemens
    if (vendorModelId.startsWith('distech-')) return 36; // Distech
    if (vendorModelId.startsWith('reliable-')) return 260; // Reliable Controls
    if (vendorModelId.startsWith('schneider-')) return 10; // Schneider Electric
    if (vendorModelId.startsWith('honeywell-')) return 17; // Honeywell
    return 260;
  }

  /** Center (in flow coords) of a node. xyflow stores top-left as
   *  `position` and rendered size on `measured.width/height`; before the
   *  first measure pass we fall back to a reasonable default so the
   *  validator doesn't go silent on a fresh drop. */
  function nodeCenter(n: Node): { x: number; y: number } {
    const w = (n as { measured?: { width?: number } }).measured?.width ?? n.width ?? 160;
    const h = (n as { measured?: { height?: number } }).measured?.height ?? n.height ?? 60;
    return { x: n.position.x + w / 2, y: n.position.y + h / 2 };
  }

  function createSubnetZone(): void {
    const color = ZONE_COLORS[zoneColorIndex % ZONE_COLORS.length];
    zoneColorIndex++;
    // Place the new zone near the center of the current viewport so the
    // user sees it land without having to pan. We measure the flow rect
    // off the .flow wrapper and back out the current transform.
    const flowEl = document.querySelector('.flow') as HTMLElement | null;
    let cx = 200;
    let cy = 200;
    if (flowEl) {
      const rect = flowEl.getBoundingClientRect();
      const viewport = flowEl.querySelector('.svelte-flow__viewport') as HTMLElement | null;
      let tx = 0,
        ty = 0,
        zoom = 1;
      if (viewport) {
        const m = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
        tx = m.e;
        ty = m.f;
        zoom = m.a || 1;
      }
      cx = (rect.width / 2 - tx) / zoom;
      cy = (rect.height / 2 - ty) / zoom;
    }
    const w = 360;
    const h = 240;
    const id = `zone-${nextId++}`;
    // Suggest a default CIDR that increments per zone so the first three
    // zones land on distinct /24s and the user has to pick the right one
    // rather than every zone fighting over 10.0.1.0/24.
    const defaultCidr = `10.0.${zoneColorIndex}.0/24`;
    const newZone: Node = {
      id,
      type: 'subnet',
      position: { x: cx - w / 2, y: cy - h / 2 },
      width: w,
      height: h,
      // SvelteFlow renders nodes in DOM order. Put zones first by setting
      // a negative zIndex so regular nodes always draw on top.
      zIndex: -1,
      // Don't pull a zone into the selection set when the user is just
      // trying to click through to a device behind it; selection is via
      // the label chip on the zone itself.
      selectable: true,
      draggable: true,
      data: {
        kind: 'subnet-zone',
        label: `VLAN ${zoneColorIndex}`,
        cidr: defaultCidr,
        color,
      } satisfies SubnetZoneData,
    };
    nodes = [newZone, ...nodes];
    logEvent(
      simSecondsElapsed,
      'info',
      'subnet',
      `Added subnet zone "${defaultCidr}" — drop devices inside it to model the VLAN they live on.`,
    );
  }

  function updateZoneField(zoneId: string, field: keyof SubnetZoneData, value: string): void {
    nodes = nodes.map((n) => {
      if (n.id !== zoneId) return n;
      const d = n.data as SubnetZoneData;
      return { ...n, data: { ...d, [field]: value } };
    });
  }

  function deleteZone(zoneId: string): void {
    nodes = nodes.filter((n) => n.id !== zoneId);
  }

  type Kind = 'supervisor' | 'controller' | 'sensor' | 'safety' | 'expansion' | 'actuator' | 'equipment' | 'zone' | 'router' | 'bbmd' | 'switch' | 'virtual-controller' | 'vahu';

  /** One port on a switch node (Net.L2). Mirrors core's SwitchPort; kept
   *  local so the canvas doesn't import the type just for authoring. */
  type SwitchPortUi = {
    id: string;
    label?: string;
    mode: 'access' | 'trunk';
    accessVlan?: number;
    trunkVlans?: number[];
    nativeVlan?: number;
  };

  /** Default port table for a freshly-dropped switch: 8 access ports on
   *  VLAN 1 + one trunk uplink carrying VLAN 1. The user re-VLANs ports in
   *  the inspector. Matches a small managed access switch out of the box. */
  function defaultSwitchPorts(): SwitchPortUi[] {
    const ports: SwitchPortUi[] = [];
    for (let i = 1; i <= 8; i++) {
      ports.push({ id: `p${i}`, label: `Port ${i}`, mode: 'access', accessVlan: 1 });
    }
    ports.push({ id: 'p9', label: 'Uplink', mode: 'trunk', trunkVlans: [1], nativeVlan: 1 });
    return ports;
  }

  // ============ Wire kinds (trunk types) ============

  type WireKind = 'mstp' | 'n2' | 'bacnet-ip' | 'lon' | 'hardwired';

  /** Tooltip copy for the sensor-fault chips. Mirrors what a tech would
   *  diagnose in the field — wire break, shorted lead, frozen comm, etc. */
  const FAULT_TIPS: Record<SensorFault, string> = {
    normal: 'Sensor reading tracks zone temp normally.',
    open: 'Wire break / open circuit — sensor reads full-scale high (250°F).',
    short: 'Shorted leads — sensor reads full-scale low (-40°F).',
    stuck:
      'Sensor frozen at its last good value. Controller thinks zone is steady; reality drifts.',
    drift: 'Slow bias creep (~1°F per 10 sim-minutes). Controller chases a phantom reading.',
    calibration:
      'Persistent +5°F bias — e.g. sensor installed in direct sun, or never re-calibrated after a swap. Controller satisfies the wrong target.',
    noise:
      'High-frequency jitter (~1.5°F RMS) around the true value. Loose wiring, EMI, or shared raceway with a VFD. Output thrashes.',
    intermittent:
      'Loose terminal screw — sensor drops to a rail every few seconds and holds briefly. Comm-lost-like behavior without an actual comm fault.',
    rail:
      'Sensor pegged at one rail. ADC stuck, fully-saturated input, or shorted-to-supply. Indistinguishable from open/short until you look at the wire.',
  };

  const WIRE_KINDS: ReadonlyArray<{
    kind: WireKind;
    label: string;
    color: string;
    description: string;
  }> = [
    {
      kind: 'bacnet-ip',
      label: 'BACnet/IP',
      color: '#4a9eff',
      description: 'BACnet over Ethernet. Used between supervisors and to other engines.',
    },
    {
      kind: 'mstp',
      label: 'MS/TP',
      color: '#9c8cff',
      description: 'BACnet MS/TP — RS-485 token-passing bus. Field controllers, VAVs.',
    },
    {
      kind: 'n2',
      label: 'N2',
      color: '#fb923c',
      description: 'JCI N2 trunk — older RS-485 bus, 9600 baud.',
    },
    {
      kind: 'lon',
      label: 'LON',
      color: '#2ecc71',
      description: 'LonWorks FT-10 free-topology twisted pair.',
    },
    {
      kind: 'hardwired',
      label: 'Hardwired',
      color: '#aaa',
      description: 'Direct analog/digital I/O — sensors and safeties to controller terminals.',
    },
  ];

  const WIRE_KIND_BY_ID = new Map<WireKind, (typeof WIRE_KINDS)[number]>(
    WIRE_KINDS.map((w) => [w.kind, w]),
  );

  /**
   * Sensible default trunk kind for a new connection.
   *   Sensor / Safety ↔ Controller → hardwired
   *   Supervisor ↔ anything          → bacnet-ip
   *   Controller ↔ Controller        → mstp
   */
  function defaultWireKind(sourceKind: Kind | undefined, targetKind: Kind | undefined): WireKind {
    const involves = (k: Kind) => sourceKind === k || targetKind === k;
    // Anything touching a router, a BBMD, or a vAHU is BACnet/IP — they
    // live on the IP backbone, not on field-level RS-485.
    if (involves('router') || involves('bbmd') || involves('vahu')) return 'bacnet-ip';
    // Hardwired covers the entire physical-cable-from-terminal-block category:
    //   - sensor / safety devices land on hardwired AI / BI terminals
    //   - expansion modules clip onto their parent controller via a vendor
    //     bus (K-bus, 750-bus, XPM backplane) — abstracted to hardwired here
    //   - actuators receive 0-10V / 2-10V / dry-contact from AO/BO terminals
    //   - equipment units connect mechanically to actuators (still hardwired
    //     for our wire-kind purposes — the abstraction is "physical cable")
    if (involves('sensor') || involves('safety') || involves('expansion') ||
        involves('actuator') || involves('equipment') || involves('zone')) return 'hardwired';
    // Supervisor pairs and controller↔supervisor go BACnet/IP by default
    // (modern installs are mostly IP-backbone with MS/TP only at field tier).
    if (involves('supervisor')) return 'bacnet-ip';
    // Otherwise it's a controller↔controller trunk — MS/TP is the safe default.
    return 'mstp';
  }

  function styleForWire(kind: WireKind, animated: boolean): string {
    const color = WIRE_KIND_BY_ID.get(kind)?.color ?? '#888';
    // Hardwired stays solid even when animated (no traffic flows on a hardwired sensor).
    const width = kind === 'hardwired' ? 1.25 : 1.75;
    return `stroke: ${color}; stroke-width: ${width}px; opacity: ${animated ? 1 : 0.7};`;
  }

  /** A broken trunk renders red + dashed + never animated. */
  function styleForBrokenWire(): string {
    return 'stroke: #e74c3c; stroke-width: 2px; stroke-dasharray: 6 4; opacity: 0.95;';
  }

  /** Process links (air/water flow) are a different physical class from
   *  network/signal wires: equipment pushes INTO a zone, an actuator drives
   *  INTO equipment, an AHU supplies a zone, zones share walls. They get
   *  duct/pipe styling + a directional arrowhead — the one place an arrow
   *  MEANS something (network trunks have no direction). */
  function isProcessLink(e: Edge): boolean {
    // TDZ guard: restoreOrDefaults() styles edges during component init,
    // BEFORE the `nodes` $state below is declared — reading it there
    // throws, and the restore try/catch would silently swallow it and
    // return the EMPTY default canvas (i.e. wipe the user's work). Treat
    // pre-init as "not a process link"; the post-init restyle pass fixes
    // the arrows once nodes exist.
    let nodeList: Node[];
    try {
      nodeList = nodes;
    } catch {
      return false;
    }
    const s = nodeList.find((n) => n.id === e.source);
    const t = nodeList.find((n) => n.id === e.target);
    if (!s || !t) return false;
    const sk = nodeKind(s);
    const tk = nodeKind(t);
    return (
      (sk === 'equipment' && tk === 'zone') ||
      (sk === 'actuator' && tk === 'equipment') ||
      (sk === 'vahu' && tk === 'zone') ||
      (sk === 'zone' && tk === 'vahu') ||
      (sk === 'zone' && tk === 'zone')
    );
  }

  const PROCESS_LINK_COLOR = '#5fb8b0';

  function withStyle(e: Edge): Edge {
    const kind: WireKind = (e.data?.wireKind as WireKind) ?? 'mstp';
    const broken = (e.data?.comm as string | undefined) === 'broken';
    if (broken) {
      // Force animation off — a broken trunk doesn't carry traffic.
      return { ...e, animated: false, style: styleForBrokenWire() };
    }
    if (isProcessLink(e)) {
      return {
        ...e,
        style: `stroke: ${PROCESS_LINK_COLOR}; stroke-width: 3px; opacity: 0.75;`,
        markerEnd: { type: MarkerType.ArrowClosed, color: PROCESS_LINK_COLOR, width: 16, height: 16 },
      };
    }
    return { ...e, style: styleForWire(kind, !!e.animated) };
  }

  function setEdgeBroken(edgeId: string, broken: boolean): void {
    const e = edges.find((edge) => edge.id === edgeId);
    if (e) {
      const wasBroken = (e.data as { comm?: string } | undefined)?.comm === 'broken';
      if (wasBroken !== broken) {
        const srcNode = nodes.find((n) => n.id === e.source);
        const tgtNode = nodes.find((n) => n.id === e.target);
        const lbl = `${srcNode ? nodeLabel(srcNode) : e.source} ↔ ${tgtNode ? nodeLabel(tgtNode) : e.target}`;
        if (broken) {
          logEvent(simSecondsElapsed, 'error', lbl, 'Trunk break — devices downstream go offline; last good values freeze.');
        } else {
          logEvent(simSecondsElapsed, 'info', lbl, 'Trunk restored — downstream devices back online.');
        }
      }
    }
    edges = edges.map((edge) =>
      edge.id === edgeId
        ? withStyle({
            ...edge,
            data: { ...(edge.data ?? {}), comm: broken ? 'broken' : 'normal' },
          })
        : edge,
    );
  }

  /** Fully remove a wire from the canvas. Unlike Break (which keeps the
   *  line and flips it red-dotted to simulate a comm fault), Delete makes
   *  the line disappear and tears down any wiredTargets bookkeeping. */
  function deleteEdge(edgeId: string): void {
    const target = edges.find((edge) => edge.id === edgeId);
    if (!target) return;
    const srcNode = nodes.find((n) => n.id === target.source);
    const tgtNode = nodes.find((n) => n.id === target.target);
    const lbl = `${srcNode ? nodeLabel(srcNode) : target.source} ↔ ${tgtNode ? nodeLabel(tgtNode) : target.target}`;
    logEvent(simSecondsElapsed, 'info', lbl, 'Wire removed from canvas.');
    edges = edges.filter((edge) => edge.id !== edgeId);
    onEdgesDelete([target]);
  }

  // ============ Demo defaults + localStorage persistence ============

  const STORAGE_KEY = 'bas-sandbox:state-v1';

  type PersistedState = {
    version: 1;
    nodes: Node[];
    edges: Edge[];
    wiredTargets: WiredTarget[];
    focusedTargetId: string | null;
    counters: Record<string, number>;
    nextId: number;
    selectedWireKind: WireKind | 'auto';
    activePresetId: string;
    scenarioBaseline: SingleZoneConfig;
  };

  /** Empty canvas — user drops their own equipment. */
  function defaultsBundle(): PersistedState {
    return {
      version: 1,
      nodes: [],
      edges: [],
      wiredTargets: [],
      focusedTargetId: null,
      counters: { supervisor: 0, controller: 0, sensor: 0, safety: 0 },
      nextId: 100,
      selectedWireKind: 'auto',
      activePresetId: 'default',
      scenarioBaseline: { ...DEFAULT_CONFIG },
    };
  }

  function restoreOrDefaults(): PersistedState {
    if (typeof localStorage === 'undefined') return defaultsBundle();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultsBundle();
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (parsed.version !== 1 || !parsed.nodes || !parsed.edges) return defaultsBundle();
      return {
        version: 1,
        nodes: parsed.nodes,
        edges: (parsed.edges ?? []).map(withStyle),
        wiredTargets: (parsed.wiredTargets ?? []).map((t) => ({
          controllerId: t.controllerId,
          sensorId: t.sensorId,
          config: { ...DEFAULT_CONFIG, ...t.config },
        })),
        focusedTargetId: parsed.focusedTargetId ?? null,
        counters: { ...{ supervisor: 0, controller: 0, sensor: 0, safety: 0 }, ...parsed.counters },
        nextId: parsed.nextId ?? 100,
        selectedWireKind: parsed.selectedWireKind ?? 'auto',
        activePresetId: parsed.activePresetId ?? 'default',
        scenarioBaseline: { ...DEFAULT_CONFIG, ...(parsed.scenarioBaseline ?? {}) },
      };
    } catch {
      return defaultsBundle();
    }
  }

  const _initialState = restoreOrDefaults();

  type PaletteItem = {
    kind: Kind;
    label: string;
    defaultName: string;
    icon: string;
    description: string;
  };

  const PALETTE: PaletteItem[] = [
    {
      kind: 'supervisor',
      label: 'Engine / Supervisor',
      defaultName: 'NAE-1',
      icon: '◉',
      description:
        'Engine / supervisor (NAE/NCE/SNE). Top of the network — holds the site database and routes traffic.',
    },
    {
      kind: 'controller',
      label: 'Controller',
      defaultName: 'FEC-1',
      icon: '◈',
      description:
        'Field or zone controller (FEC/FAC/VMA/VAV). Runs equipment logic, downstream of a supervisor.',
    },
    {
      kind: 'sensor',
      label: 'Sensor',
      defaultName: 'ZN-T-1',
      icon: '◇',
      description: 'Zone temp, supply temp, pressure, flow, etc. Hardwired input to a controller.',
    },
    {
      kind: 'safety',
      label: 'Safety',
      defaultName: 'FZ-1',
      icon: '⚠',
      description: 'Freezestat, high-static cutout, smoke detector, etc. Hardwired safety device.',
    },
    {
      kind: 'actuator',
      label: 'Actuator',
      defaultName: 'ACT-1',
      icon: '⤳',
      description: 'Damper, valve, VFD, or contactor. Receives the controller AO/BO command and produces physical motion. Some return a position-feedback signal back to a UI/AI.',
    },
    {
      kind: 'equipment',
      label: 'Equipment',
      defaultName: 'EQ-1',
      icon: '☷',
      description: 'AHU, VAV box, FCU, pump, boiler, chiller, cooling tower — the actual HVAC unit the actuators move and sensors measure.',
    },
    {
      kind: 'zone',
      label: 'Zone',
      defaultName: 'ZONE-1',
      icon: '▢',
      description: 'A physical room or open area. Has thermal mass, internal loads (people / lights / equipment), and an envelope to OAT. The thing the BAS is ultimately trying to keep comfortable.',
    },
    {
      kind: 'router',
      label: 'IP Router',
      defaultName: 'RTR-1',
      icon: '◆',
      description: 'Network-layer (L3) router bridging two or more subnets. A BACnet/IP edge between devices on different subnets routes through the router for UNICAST traffic. Broadcasts (Who-Is/I-Am) still require BBMDs.',
    },
    {
      kind: 'bbmd',
      label: 'BBMD',
      defaultName: 'BBMD-1',
      icon: '◫',
      description: 'BACnet Broadcast Management Device — dedicated bridge for BACnet broadcasts (Who-Is / I-Am) across IP subnets. Drop one per subnet; populate the BDT with peer BBMD IPs. Models a Contemporary Controls BAS Router, a JACE BBMD service, or a Cimetrics Eapi.',
    },
    {
      kind: 'switch',
      label: 'Ethernet Switch',
      defaultName: 'SW-1',
      icon: '▦',
      description: 'Layer-2 Ethernet switch. Devices plug into access ports (one untagged VLAN each); switch-to-switch uplinks are trunk ports (802.1Q tagged). The VLAN a port is on decides which broadcast domain its device lands in — two devices on the same subnet but different VLANs can\'t talk. Configure ports in the inspector.',
    },
    {
      kind: 'virtual-controller',
      label: 'Virtual Controller',
      defaultName: 'vVAV-1',
      icon: '◌',
      description: 'Soft controller — exists entirely in software, hosted inside a supervisor (JACE / AS-P / NCE). Has its own BACnet Device Instance but no physical box. Common in modern installs for lighting, energy aggregation, roll-up alarms. If the host goes down, every virtual controller hosted on it goes with it.',
    },
    {
      kind: 'vahu',
      label: 'AHU — G36 §5.18',
      defaultName: 'AHU-1',
      icon: '▣',
      description: 'Virtual single-zone AHU running the ASHRAE Guideline 36 §5.18 sequence. Picks heating / cooling / economizer / unoccupied mode each tick from OAT, zone temp, and occupancy. Manages supply-air-temp setpoint, OA damper, heat/cool valve PI loops, and VFD speed. Synthesizes 15 BACnet objects (5 AI, 3 AV, 4 AO, 3 BV) and emits realistic COV notifications. Wire to a supervisor via BACnet/IP and optionally to a Zone node for live room-temp coupling.',
    },
  ];

  let nodes = $state.raw<Node[]>(_initialState.nodes);
  let edges = $state.raw<Edge[]>(_initialState.edges);
  // Restyle once now that `nodes` exists — restore-time styling can't see
  // endpoint kinds (TDZ guard in isProcessLink), so process-link arrows
  // would otherwise be missing until the first Run.
  edges = edges.map((e) => withStyle(e));

  // Per-kind counter so default names auto-increment ("VAV-1", "VAV-2", ...).
  const counters: Record<string, number> = { ..._initialState.counters };

  function nextName(kind: Kind): string {
    const item = PALETTE.find((p) => p.kind === kind);
    if (!item) return kind;
    const stem = item.defaultName.replace(/-\d+$/, '');
    counters[kind] = (counters[kind] ?? 0) + 1;
    return `${stem}-${counters[kind]}`;
  }

  let nextId = _initialState.nextId;

  function onPaletteDragStart(event: DragEvent, kind: string) {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('application/bas-node-kind', kind);
    event.dataTransfer.effectAllowed = 'move';
  }

  function onCanvasDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function onCanvasDrop(event: DragEvent) {
    event.preventDefault();

    // Scenario file drop (overrides palette drop)
    const file = event.dataTransfer?.files?.[0];
    if (file && /\.(json|bas-scenario)$/i.test(file.name)) {
      loadScenarioFile(file);
      return;
    }

    const kind = event.dataTransfer?.getData('application/bas-node-kind') as Kind | undefined;
    if (!kind) return;
    // Expansion-kind drops don't have a PALETTE entry (no dock palette item)
    // — they come only from Devices > Expansion. We synthesize the needed
    // bits inline below.
    const item = kind === 'expansion'
      ? { kind: 'expansion' as Kind, label: 'Expansion module', defaultName: 'XP', icon: '⊞', description: 'Expansion module' }
      : PALETTE.find((p) => p.kind === kind);
    if (!item) return;

    // Convert the drop's screen-space coordinates into xyflow's internal flow
    // coordinates. The previous version used the canvas DOM rect directly,
    // which silently broke once the user panned or zoomed — nodes landed
    // "where the cursor would have been if the canvas hadn't moved" instead
    // of where the cursor actually is. xyflow stores its current pan/zoom as
    // a CSS transform on `.svelte-flow__viewport`; we read it back to do the
    // inverse mapping.
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const viewport = target.querySelector('.svelte-flow__viewport') as HTMLElement | null;
    let tx = 0;
    let ty = 0;
    let zoom = 1;
    if (viewport) {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
      tx = matrix.e;
      ty = matrix.f;
      zoom = matrix.a || 1;
    }
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    // Subtract ~half the typical node size so the cursor lands near the
    // node's center rather than its top-left corner.
    const position = {
      x: (screenX - tx) / zoom - 80,
      y: (screenY - ty) / zoom - 25,
    };

    // Resolve any model-id riding on the dataTransfer (drawer-drag path).
    const vendorId = event.dataTransfer?.getData('application/bas-controller-vendor');
    const vendorModel = vendorId ? findControllerModel(vendorId) : undefined;
    const sensorModelId = event.dataTransfer?.getData('application/bas-sensor-model');
    const sensorModel = sensorModelId ? findSensorModel(sensorModelId) : undefined;
    const safetyModelId = event.dataTransfer?.getData('application/bas-safety-model');
    const safetyModel = safetyModelId ? findSafetyDevice(safetyModelId) : undefined;
    const expansionModelId = event.dataTransfer?.getData('application/bas-expansion-model');
    const expansionModel = expansionModelId ? findExpansionModule(expansionModelId) : undefined;
    const actuatorModelId = event.dataTransfer?.getData('application/bas-actuator-model');
    const actuatorModel = actuatorModelId ? findActuatorModel(actuatorModelId) : undefined;
    const equipmentModelId = event.dataTransfer?.getData('application/bas-equipment-model');
    const equipmentModel = equipmentModelId ? findEquipmentModel(equipmentModelId) : undefined;
    const networkGearModelId = event.dataTransfer?.getData('application/bas-network-gear-model');
    const networkGearModel = networkGearModelId ? findNetworkGear(networkGearModelId) : undefined;

    // Expansion drops always carry a model id (no generic expansions).
    if (kind === 'expansion' && expansionModel) {
      const id = `n${nextId++}`;
      nodes = [
        ...nodes,
        {
          id,
          type: 'bas',
          position,
          data: {
            kind: 'expansion',
            label: expansionModel.model,
            expansionModelId: expansionModel.id,
            subtitle: `${expansionModel.vendor} · ${expansionModel.family} · +${formatPointBreakdown(expansionModel.addedPoints)}`,
          },
        },
      ];
      return;
    }

    // Real-world network gear drop (BBMD or Router from the Network
    // sidebar catalog). Carries a NetworkGearModel — stamp vendor +
    // model on the dropped node so the canvas reflects the actual
    // install.
    if ((kind === 'router' || kind === 'bbmd') && networkGearModel) {
      const id = `n${nextId++}`;
      const data: Record<string, unknown> = {
        kind,
        label: networkGearModel.model,
        networkGearModelId: networkGearModel.id,
        subtitle: `${networkGearModel.vendor} · ${networkGearModel.family} · ${networkGearModel.protocols.join(' / ')}`,
      };
      if (kind === 'router') {
        data.routerInterfaces = [
          { ip: '', cidr: '' },
          { ip: '', cidr: '' },
        ];
      } else {
        // bbmd
        data.isBBMD = true;
        data.bdtPeers = [];
      }
      nodes = [...nodes, { id, type: 'bas', position, data }];
      return;
    }

    // Generic-palette drop with no model attached → force a model pick
    // before finalizing the node. The user can still escape to a "generic
    // placeholder" but the explicit choice matters: it tells them this is
    // not a real-world configuration. Supervisor is included now so
    // dropping a generic Engine prompts for JACE/NCE/SNE/AS-P/etc.
    const needsPick =
      !vendorModel && !sensorModel && !safetyModel && !actuatorModel && !equipmentModel &&
      (kind === 'controller' || kind === 'sensor' || kind === 'safety' || kind === 'supervisor' || kind === 'actuator');

    if (needsPick) {
      openModelPicker(
        kind as 'controller' | 'sensor' | 'safety' | 'supervisor' | 'actuator',
        (pickedId) => {
          finalizeDrop(item.kind, kind, position, pickedId, undefined);
        },
        () => {
          // Cancel — do nothing; user can drop again
        },
      );
      return;
    }

    finalizeDrop(item.kind, kind, position,
      vendorModel?.id ?? sensorModel?.id ?? safetyModel?.id ?? actuatorModel?.id ?? equipmentModel?.id ?? null,
      { vendorModel, sensorModel, safetyModel, actuatorModel, equipmentModel },
    );
  }

  function finalizeDrop(
    paletteKind: Kind,
    dropKind: string,
    position: { x: number; y: number },
    pickedId: string | null,
    preResolved?: {
      vendorModel?: ReturnType<typeof findControllerModel>;
      sensorModel?: ReturnType<typeof findSensorModel>;
      safetyModel?: ReturnType<typeof findSafetyDevice>;
      actuatorModel?: ReturnType<typeof findActuatorModel>;
      equipmentModel?: ReturnType<typeof findEquipmentModel>;
    },
  ): void {
    // Re-resolve the model from pickedId when called from the picker
    // (which doesn't know which catalog applies).
    let vendorModel = preResolved?.vendorModel;
    let sensorModel = preResolved?.sensorModel;
    let safetyModel = preResolved?.safetyModel;
    let actuatorModel = preResolved?.actuatorModel;
    let equipmentModel = preResolved?.equipmentModel;
    if (pickedId && !vendorModel && !sensorModel && !safetyModel && !actuatorModel && !equipmentModel) {
      // Supervisor + Controller both pull from VENDOR_CATALOG — the
      // dropKind drives the palette filter, but the resolution is the
      // same lookup.
      if (dropKind === 'controller' || dropKind === 'supervisor') vendorModel = findControllerModel(pickedId);
      else if (dropKind === 'sensor') sensorModel = findSensorModel(pickedId);
      else if (dropKind === 'safety') safetyModel = findSafetyDevice(pickedId);
      else if (dropKind === 'actuator') actuatorModel = findActuatorModel(pickedId);
      else if (dropKind === 'equipment') equipmentModel = findEquipmentModel(pickedId);
    }

    const id = `n${nextId++}`;
    // Scenario auto-name: if a scenario is active and this drop would satisfy
    // an unmatched equipment requirement, pre-label the node with the
    // scenario's expected tag (VAV-1, ZN-T, OCC, DMP-FB, …) so the user
    // doesn't have to rename by hand for the validator to recognize it.
    let scenarioTag: string | null = null;
    if (scenarioStore.active) {
      const sc = scenarioStore.active;
      const beforeResult = validateScenario(sc, nodes, edges);
      const droppedModelId = vendorModel?.id ?? sensorModel?.id ?? safetyModel?.id ?? null;
      for (const req of sc.equipment) {
        if (req.kind !== paletteKind) continue;
        // Already satisfied? skip.
        if (beforeResult.tagToNodeId.has(req.tag)) continue;
        // Preferred-model match is the strongest signal — take it first.
        if (req.preferredModelId && droppedModelId === req.preferredModelId) {
          scenarioTag = req.tag;
          break;
        }
      }
      // No preferred-model hit? fall back to first-kind-match so the user
      // still gets named correctly when they substitute equivalent models.
      if (!scenarioTag) {
        for (const req of sc.equipment) {
          if (req.kind !== paletteKind) continue;
          if (beforeResult.tagToNodeId.has(req.tag)) continue;
          scenarioTag = req.tag;
          break;
        }
      }
    }
    let baseLabel: string;
    if (scenarioTag) baseLabel = scenarioTag;
    else if (vendorModel) baseLabel = vendorModel.model;
    else if (sensorModel) baseLabel = sensorModel.model;
    else if (safetyModel) baseLabel = safetyModel.model;
    else if (actuatorModel) baseLabel = actuatorModel.model;
    else if (equipmentModel) baseLabel = equipmentModel.model;
    else baseLabel = nextName(paletteKind);
    const data: Record<string, unknown> = { kind: paletteKind, label: baseLabel };
    if (vendorModel) {
      data.vendorModelId = vendorModel.id;
      data.subtitle = `${vendorModel.vendor} · ${vendorModel.programmingLanguage}`;
    }
    if (sensorModel) {
      data.sensorModelId = sensorModel.id;
      data.subtitle = `${sensorModel.vendor} · ${sensorModel.signal} · ${sensorModel.range[0]}–${sensorModel.range[1]} ${sensorModel.units}`;
    }
    if (safetyModel) {
      data.safetyModelId = safetyModel.id;
      const trip = safetyModel.tripPoint ? ` · trip @ ${safetyModel.tripPoint.value} ${safetyModel.tripPoint.units}` : '';
      data.subtitle = `${safetyModel.vendor} · ${safetyModel.normalState} · ${safetyModel.resetBehavior}-reset${trip}`;
    }
    if (actuatorModel) {
      data.actuatorModelId = actuatorModel.id;
      const fbk = actuatorModel.hasPositionFeedback ? ' · w/ feedback' : '';
      data.subtitle = `${actuatorModel.vendor} · ${actuatorModel.signal} · ${actuatorModel.strokeSeconds}s stroke · fail-${actuatorModel.failSafe}${fbk}`;
    }
    if (equipmentModel) {
      data.equipmentModelId = equipmentModel.id;
      data.subtitle = `${equipmentModel.vendor} · ${equipmentModel.category} · ${equipmentModel.capacity}`;
    }
    // Net.3 — a fresh router lands with two empty interfaces so the
    // editor isn't blank. User fills in CIDRs to enable bridging.
    if (paletteKind === 'router') {
      data.routerInterfaces = [
        { ip: '', cidr: '' },
        { ip: '', cidr: '' },
      ];
      data.subtitle = '2 interfaces — configure CIDRs to enable routing';
    }
    // Net.4 — a fresh BBMD lands pre-flagged so the validator picks it
    // up immediately. Empty BDT so a 'bbmd-empty-bdt' warning fires
    // until the user populates peers — that's the teaching moment.
    if (paletteKind === 'bbmd') {
      data.isBBMD = true;
      data.bdtPeers = [];
      data.subtitle = 'Dedicated BBMD — set IP, mask, and BDT peers below';
    }
    // Net.L2 — a fresh switch lands with 8 access ports on VLAN 1 + a
    // trunk uplink, so the user can wire devices immediately and re-VLAN
    // ports in the inspector.
    if (paletteKind === 'switch') {
      data.ports = defaultSwitchPorts();
      data.subtitle = '8 access (VLAN 1) + 1 trunk — set port VLANs below';
    }
    nodes = [
      ...nodes,
      {
        id,
        type: 'bas',
        position,
        data,
      },
    ];
  }

  // ============ Selection & physics targets ============

  function nodeKind(n: Node): Kind | undefined {
    return (n.data as { kind?: Kind }).kind;
  }

  function nodeLabel(n: Node): string {
    return (n.data as { label?: string }).label ?? '';
  }

  /** Find a sensor directly wired to the given controller (either direction). */
  function findConnectedSensor(controllerId: string): Node | null {
    for (const e of edges) {
      const otherId =
        e.source === controllerId ? e.target : e.target === controllerId ? e.source : null;
      if (!otherId) continue;
      const other = nodes.find((n) => n.id === otherId);
      if (other && nodeKind(other) === 'sensor') return other;
    }
    return null;
  }

  /** First controller that has a sensor wired to it. Used for scenario migration. */
  function firstControlledPair(): { controller: Node; sensor: Node } | null {
    for (const n of nodes) {
      if (nodeKind(n) !== 'controller') continue;
      const s = findConnectedSensor(n.id);
      if (s) return { controller: n, sensor: s };
    }
    return null;
  }

  /** Find a controller wired *upstream* (edge.target === thisId). */
  function findParentController(controllerId: string): Node | null {
    for (const e of edges) {
      if (e.target !== controllerId) continue;
      const src = nodes.find((n) => n.id === e.source);
      if (src && nodeKind(src) === 'controller') return src;
    }
    return null;
  }

  /** A single physics-wired pair with its own config and (later) running system. */
  type WiredTarget = {
    controllerId: string;
    sensorId: string;
    config: SingleZoneConfig;
  };

  type PhysicsTarget = {
    controllerId: string;
    controllerLabel: string;
    sensorId: string;
    sensorLabel: string;
    parentId?: string;
    parentLabel?: string;
  };

  // Multi-target state. Restored from localStorage when present, else the demo
  // VAV-1 ↔ ZN-T-1 pair so the first-time experience has something to Run.
  let wiredTargets = $state<WiredTarget[]>(_initialState.wiredTargets);
  let focusedTargetId = $state<string | null>(_initialState.focusedTargetId);

  const focusedTarget = $derived.by(() => {
    if (!focusedTargetId) return null;
    return wiredTargets.find((t) => t.controllerId === focusedTargetId) ?? null;
  });

  /** The focused wired target rendered as a PhysicsTarget with looked-up labels. */
  const physicsTarget = $derived.by((): PhysicsTarget | null => {
    if (!focusedTarget) return null;
    const ctrl = nodes.find((n) => n.id === focusedTarget.controllerId);
    const sensor = nodes.find((n) => n.id === focusedTarget.sensorId);
    if (!ctrl || !sensor) return null;
    const parent = findParentController(ctrl.id);
    return {
      controllerId: ctrl.id,
      controllerLabel: nodeLabel(ctrl),
      sensorId: sensor.id,
      sensorLabel: nodeLabel(sensor),
      parentId: parent?.id,
      parentLabel: parent ? nodeLabel(parent) : undefined,
    };
  });

  // Set of all node ids that are part of *any* wired target — used by BasNode
  // to render the ⚡ marker. All wired pairs get the indicator regardless of focus.
  const wiredIds = $derived.by((): Set<string> => {
    const set = new Set<string>();
    for (const t of wiredTargets) {
      set.add(t.controllerId);
      set.add(t.sensorId);
    }
    return set;
  });
  setContext('basWiredIds', () => wiredIds);

  // ── MS/TP addressing (shared source of truth) ───────────────────────
  // One helper computes the trunk grouping + MAC / device-instance
  // assignment from topology. Both the sim tick (token-passing + packet
  // emission) and the `nodeAddressing` derived (canvas badge) call it, so
  // the address a tech reads on a node card is exactly the MAC that shows
  // up in the packet log for that device.
  /** The pure-core node/edge shapes for addressing + topology validation.
   *  One mapper so the MAC map and the T-tap/EOL validator can never see
   *  different graphs. */
  function mstpGraphInputs() {
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        label: nodeLabel(n) || n.id,
        kind: nodeKind(n) ?? '',
        forcedMac: (n.data as { forcedMac?: number } | undefined)?.forcedMac,
        deviceInstance: (n.data as { deviceInstance?: number } | undefined)?.deviceInstance,
        eolTerminated: (n.data as { eolTerminated?: boolean } | undefined)?.eolTerminated,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        wireKind: (e.data as { wireKind?: string } | undefined)?.wireKind,
        baud: (e.data as { baud?: number } | undefined)?.baud,
      })),
    };
  }

  function computeMstpAddressing() {
    const g = mstpGraphInputs();
    return assignMstpAddressing(g.nodes, g.edges);
  }

  // nodeId → { mac, deviceInstance } for every MS/TP device, derived from
  // topology so the badge is live whether or not the sim is running.
  const nodeAddressing = $derived.by((): Map<string, { mac: number; deviceInstance?: number }> => {
    const out = new Map<string, { mac: number; deviceInstance?: number }>();
    for (const [nid, d] of computeMstpAddressing().byNode) {
      out.set(nid, { mac: d.mac, deviceInstance: d.deviceInstance });
    }
    return out;
  });
  setContext('basNodeAddressing', () => nodeAddressing);

  // ============ Inline rename ============

  let renamingNodeId = $state<string | null>(null);
  setContext('basRenamingNodeId', () => renamingNodeId);
  setContext('basCommitRename', (id: string, newLabel: string) => {
    nodes = nodes.map((n) => {
      if (n.id !== id) return n;
      const data = n.data as Record<string, unknown>;
      return { ...n, data: { ...data, label: newLabel } };
    });
    renamingNodeId = null;
  });
  setContext('basCancelRename', () => {
    renamingNodeId = null;
  });

  // Expose the power-toggle so the node card itself can flip its own
  // power state without round-tripping through the inspector panel.
  setContext('basTogglePower', (id: string) => togglePower(id));

  /** Inline rename used by inspector panels — direct write-through. */
  function renameNode(id: string, newLabel: string): void {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    nodes = nodes.map((n) => {
      if (n.id !== id) return n;
      const data = n.data as Record<string, unknown>;
      return { ...n, data: { ...data, label: trimmed } };
    });
  }

  function onNodeDoubleClick({ node }: { node: Node }) {
    renamingNodeId = node.id;
  }

  /** Colors for chart series. First entry is the focused (primary) color;
   *  the rest cycle for ghosts. Picked to match the node-kind palette. */
  const SERIES_COLORS = ['#f39c12', '#2ecc71', '#9c8cff', '#e74c3c', '#fb923c', '#4a9eff'];

  function colorForTarget(id: string): string {
    const idx = wiredTargets.findIndex((t) => t.controllerId === id);
    if (idx < 0) return SERIES_COLORS[0];
    return SERIES_COLORS[idx % SERIES_COLORS.length];
  }

  // ============ Sim loop ============

  let running = $state(false);
  let tick = $state(0);
  let intervalId: ReturnType<typeof setInterval> | null = null;
  /**
   * Sim wall-clock start hour (0..23.99). Initializes every running system's
   * simSeconds when start() fires, so the occupancy schedule sees the right
   * hour-of-day from tick 0. The whole reason this exists: in CCT/SCT there's
   * no way to fast-forward the clock to test "does my 22:00 setback transition
   * actually fire?" — here you set start=21:58 and watch the schedule trip.
   */
  let simStartHour = $state(0);
  /** Sim seconds elapsed *since* the start hour, ticked alongside `tick`. */
  let simSecondsElapsed = $state(0);
  const TICK_MS = 1000;
  /** Sim time multiplier. 1× = real time (1 sim-second per real-second);
   *  5× = 5 sim-seconds per tick; 30× makes long thermal warmups bearable.
   *  Persisted to localStorage so a deep-debug session doesn't lose it. */
  let simSpeed = $state<number>(
    typeof localStorage !== 'undefined'
      ? Number(localStorage.getItem('bas-sandbox.sim-speed') ?? '1') || 1
      : 1,
  );
  /** Manual OAT override (°F) set from the Conditions panel. null = follow
   *  the Weather drive (or the 60°F fallback). When set, it wins over the
   *  weather sample for EVERY consumer — physics-wired targets and the
   *  standalone AHU/zone path — so "make it 95°F outside" is one slider. */
  let manualOat = $state<number | null>(
    typeof localStorage !== 'undefined' && localStorage.getItem('bas-sandbox.manual-oat') !== null
      ? Number(localStorage.getItem('bas-sandbox.manual-oat'))
      : null,
  );
  /** Conditions dropdown (G27) — the one box for "what's the world doing". */
  let conditionsOpen = $state(false);
  function setManualOat(v: number | null) {
    manualOat = v;
    if (typeof localStorage === 'undefined') return;
    if (v === null) localStorage.removeItem('bas-sandbox.manual-oat');
    else localStorage.setItem('bas-sandbox.manual-oat', String(v));
  }
  function setSimSpeed(v: number): void {
    simSpeed = v;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('bas-sandbox.sim-speed', String(v));
    }
  }
  const SIM_SPEED_OPTIONS = [1, 5, 30, 300] as const;

  // Per-target running state, keyed by controllerId.
  let runningSystems = $state.raw<Map<string, SingleZoneSystem>>(new Map());
  let runningSamples = $state.raw<Map<string, Sample[]>>(new Map());
  let runningSnapshot = $state.raw<WiredTarget[]>([]);
  // Stable controller→primary-sensor map. Updated via $effect from
  // wiredTargets — the $effect only sees the SETTLED value of wiredTargets
  // after svelte-flow's transient-empty bursts (click events that briefly
  // wipe + restore wiredTargets) resolve. Used by the signal-fidelity
  // bridge pass to flag the primary sensor without flickering.
  let primaryByCtrlStable = $state.raw<Map<string, string>>(new Map());
  $effect(() => {
    const next = new Map<string, string>();
    for (const wt of wiredTargets) next.set(wt.controllerId, wt.sensorId);
    primaryByCtrlStable = next;
  });
  // MS/TP trunk state by representative-edge-id. Tracks which MAC currently
  // owns the token, rotation counts, etc. Keyed by edge.id so SvelteFlow
  // edge inspectors can read it directly.
  let mstpTrunkStates = $state.raw<Map<string, MstpTrunkState>>(new Map());
  // BACnet app-layer poll scheduler — when (in sim seconds) the supervisor
  // on a given trunk should fire its next ReadProperty, plus which child
  // it will hit next (round-robin). Keyed by trunk edge id; this is a
  // *display* concern, not part of the MstpTrunkState in core.
  let bacnetPollSchedule = new Map<string, { nextSimSec: number; nextChildIdx: number }>();
  // BACnet/IP pair poll schedule — keyed by "supId|childId". IP edges
  // and host-internal virtual-controller pairs both flow through this.
  // Each pair gets its own clock so a supervisor with many children
  // sees its pollback evenly across the cadence window rather than
  // burst-polling all of them at the same simSec boundary.
  let ipPollSchedule = new Map<string, { nextSimSec: number }>();
  /** Pairs we've already announced (Who-Is + I-Am + SubscribeCOV) so
   *  re-render doesn't spam the bus with re-discoveries every tick. */
  let announcedIpPairs = new Set<string>();
  /** BBMD bridge + foreign-device registration flows already emitted, so
   *  the Annex-J broadcast-management dance fires once per network bootup
   *  rather than every tick. Keyed by flow + endpoints. */
  let announcedBbmdFlows = new Set<string>();

  // ── vAHU per-node state ────────────────────────────────────────────
  // Each canvas node of kind 'vahu' runs a full G36 §5.18 sequence.
  // State is keyed by node.id so the canvas handles any number of
  // AHU nodes without them sharing loop state. Initialized lazily on
  // first tick; reset on stop().
  let vahuStates = $state.raw<Map<string, VAhuState>>(new Map());
  /** Per-tick cache of synthesized BACnet objects for each vAHU,
   *  populated during the vAHU dynamics step and consumed by the
   *  BACnet/IP COV detection pass that follows. Avoids re-synthesizing
   *  the 15-object set multiple times per tick. */
  let vahuObjectsCache = new Map<string, import('@bas/core').BacnetObject[]>();
  /** Previous-tick vAHU inputs per node — needed by vAhuCovDeltas to
   *  know what changed since the last notification was emitted. */
  let vahuPrevInputs = $state.raw(new Map<string, VAhuInputs>());
  // Per-trunk poll cadence (sim-seconds). Real supervisors use a SLOW
  // poll as a heartbeat/redundancy on top of COV subscriptions — if a
  // value drifts without firing a CoV (e.g. the deadband never gets
  // crossed but the value gradually walks), the periodic ReadProperty
  // catches it. 30s matches a typical Niagara JACE heartbeat poll.
  const APP_LAYER_POLL_CADENCE_S = 30;
  // MS/TP validation findings keyed by trunk id. Recomputed each tick
  // from the trunk membership; we de-dup against the previous tick so the
  // runtime log only logs new fault transitions, not the same warning
  // forever. Empty array = trunk is healthy.
  let mstpFindingsByTrunk = $state<Map<string, MstpFinding[]>>(new Map());
  // Set of "trunkId:findingId" pairs we've already announced in the
  // runtime log this session — keeps re-logging quiet across ticks.
  const announcedMstpFindings = new Set<string>();
  // BACnet/IP announce-once dedup — same pattern as MS/TP. The actual
  // findings list lives in `trunkInspectorStore.ipv4Findings`; we
  // publish there and don't keep a second local copy.
  const announcedIpv4Findings = new Set<string>();
  // Broadcast-trace announce-once dedup. Keyed by "sourceNodeId|destNet"
  // (or "|local"), valued by the routing-outcome descriptor. We only
  // re-emit a Who-Is trace packet when the OUTCOME changes (a BBMD bridge
  // appears/disappears, a peer subnet comes/goes) — not every
  // BROADCAST_TRACE_PERIOD. Without this, at 30×–300× sim-speed the same
  // unchanged routing lines flood the 500-entry ring buffer in seconds
  // and bury the announce-once Annex-J bootup dance (Register-Foreign-
  // Device, BVLC-Result, Distribute-Broadcast, Forwarded-NPDU). Stale
  // keys are pruned each pass so topology edits re-fire the trace.
  const announcedBroadcastTrace = new Map<string, string>();
  // Hard cap on Token-Pass packets emitted per trunk per tick. At 300×
  // sim-speed a 32-device trunk would emit hundreds of hops per tick;
  // capping keeps the log readable and the buffer from churning.
  const MAX_TOKEN_HOPS_PER_TICK_PER_TRUNK = 8;

  // ── BACnet COV (Change-of-Value) subscription state ─────────────────
  // The production pattern: instead of polling each child every N seconds
  // for a value that rarely changes, the supervisor sends one SubscribeCOV
  // request at startup. The controller then tracks last-reported value per
  // subscribed object and pushes a ConfirmedCOVNotification ONLY when the
  // value moves past its deadband. Bus stays idle when nothing's changing.
  //
  // Subscription key: `${trunkId}|${childNodeId}|${objectId}`
  //
  // Lifecycle is ground-truthed against the lab rig captures (G47/G48/G49,
  // tools/real-bacnet-rig/): subscriptions are 120 s LEASES renewed by the
  // subscriber at exactly lifetime/2; every (re)subscribe is answered by an
  // initial notification of the current value 0.2–7 s later; and change
  // detection runs on the device's own 0.2–7 s scan cadence, not per-tick.
  type CovSubscription = {
    trunkId: string;
    trunkLabel: string;
    childNodeId: string;
    childLabel: string;
    childMac: number;
    /** Subscriber (supervisor) side — needed to emit lifetime/2 renewals
     *  and to notice the subscriber vanished (the lab7c "TTL ghost":
     *  the device notifies into the void until the lease lapses). */
    supNodeId: string;
    supLabel: string;
    supMac: number;
    /** One-way request→ACK latency for this pair (baud-derived for MS/TP,
     *  BACNET_IP_RTT_SECONDS for IP) so renewals pace like the original. */
    ackLatencyS: number;
    /** BACnet object reference, e.g. "AI:1". */
    objectId: string;
    /** Deadband in the object's native units (°F for AI, etc.). */
    deadband: number;
    /** Display units for the deadband ('°F', '%'). Binary subs ignore. */
    deadbandUnits: string;
    /** Lease state (G48): sim-time of the last (re)subscribe. */
    subscribedAtSimSec: number;
    lifetimeSeconds: number;
    /** Renewal count — log flavor + jitter de-correlation salt. */
    renewals: number;
    /** G47: when the pending initial notification fires (every
     *  (re)subscribe schedules one); null = none pending. */
    initialNotifyAtSimSec: number | null;
    /** G49: next scan instant — deltas are only evaluated then. */
    nextScanAtSimSec: number;
    /** Scan count — jitter sequence for the next scan delay. */
    scans: number;
    /** Last reported value — the controller "remembers" this so it knows
     *  when to fire the next notification. Updated on every emit. */
    lastReportedValue: number | boolean | null;
    /** Last reported reliability — when the AI's reliability changes
     *  (sensor opens, recovers, transitions) a COV fires immediately
     *  even if presentValue hasn't crossed the deadband. */
    lastReportedReliability?: import('@bas/core').BacnetReliability;
  };
  let covSubscriptions = new Map<string, CovSubscription>();
  // Default deadband: 0.5°F is the industry-standard zone-temp deadband.
  // For non-temperature objects we fall back to a relative 1% movement.
  const COV_DEADBAND_DEFAULT = 0.5;

  /** The covIncrement a supervisor configures per point: temp AIs get
   *  the 0.5°F zone deadband, percent-valued points (AO/AV commands)
   *  get 1%, binary points have NO increment — any state change
   *  notifies (§13.1: covIncrement applies to numeric PVs only). */
  function covDeadbandFor(obj: import('@bas/core').BacnetObject): number {
    if (obj.type.startsWith('binary')) return 0;
    if (obj.units === '%') return 1;
    return COV_DEADBAND_DEFAULT;
  }

  /** Pick the point set a supervisor subscribes to on a child device.
   *  Real supervisors subscribe to every MAPPED point — the sandbox
   *  picks the points that carry meaning so the log stays legible:
   *  primary AI, a second named/live AI, the first AV (PI command /
   *  setpoint readback), the first named/live AO, and the first binary
   *  point. Unprogrammed controllers naturally collapse to AI + BI —
   *  exactly what their object table actually offers a supervisor. */
  function pickCovSubscriptionSet(
    objs: import('@bas/core').BacnetObject[],
  ): import('@bas/core').BacnetObject[] {
    const picks: import('@bas/core').BacnetObject[] = [];
    const meaningful = (o: import('@bas/core').BacnetObject) =>
      !/unassigned/i.test(o.name) ||
      (typeof o.presentValue === 'number' && o.presentValue !== 0);
    const ais = objs.filter((o) => o.type === 'analog-input');
    if (ais[0]) picks.push(ais[0]);
    const secondAi = ais.slice(1).find(meaningful);
    if (secondAi) picks.push(secondAi);
    const av = objs.find((o) => o.type === 'analog-value');
    if (av) picks.push(av);
    const ao = objs.find((o) => o.type === 'analog-output' && meaningful(o));
    if (ao) picks.push(ao);
    const binary =
      objs.find((o) => o.type.startsWith('binary') && !/unassigned/i.test(o.name)) ??
      objs.find((o) => o.type === 'binary-input') ??
      // Some hardware has no BIs at all (Distech ECY-VAV: UI/AO/BO
      // only) — surface its first BO so binary traffic still exists.
      objs.find((o) => o.type === 'binary-output');
    if (binary) picks.push(binary);
    return picks.slice(0, 5);
  }

  // ── Retry-on-timeout state ──────────────────────────────────────────
  // When a confirmed service (ReadProperty / WriteProperty / CoV) goes
  // unanswered — typically because the trunk is broken or the child is
  // offline — the supervisor doesn't just give up immediately. It emits
  // a Timeout marker (BACnet apdu_timeout ≈ 3s) and retries the request.
  // After N consecutive failures it declares CommunicationLost and stops
  // hammering the bus until comm restores.
  type FailingChildState = {
    trunkId: string;
    childNodeId: string;
    childLabel: string;
    childMac: number;
    consecutiveFails: number;
    /** Have we already emitted the CommunicationLost alert? Prevents
     *  repeated alerts while the child stays offline. */
    reportedLost: boolean;
  };
  const failingChildren = new Map<string, FailingChildState>();
  // BACnet APDU timeout default — supervisors wait this long after a
  // confirmed request before declaring the attempt failed.
  const APDU_TIMEOUT_S = 3.0;
  const COMM_LOST_RETRY_THRESHOLD = 3;

  let showAdvanced = $state(false);

  // Chart + tune panels can swallow a small laptop screen. Collapse state
  // persists per panel; with no saved preference, start collapsed on short
  // viewports so the canvas wins by default.
  const CHART_COLLAPSED_KEY = 'bas-sandbox.chart-panel.collapsed.v1';
  const TUNE_COLLAPSED_KEY = 'bas-sandbox.tune-panel.collapsed.v1';
  const SHORT_VIEWPORT_PX = 900;

  function loadPanelCollapsed(key: string): boolean {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) return raw === '1';
      } catch {
        // ignore
      }
    }
    return typeof window !== 'undefined' && window.innerHeight < SHORT_VIEWPORT_PX;
  }

  function savePanelCollapsed(key: string, collapsed: boolean): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, collapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }

  let chartCollapsed = $state(loadPanelCollapsed(CHART_COLLAPSED_KEY));
  let tuneCollapsed = $state(loadPanelCollapsed(TUNE_COLLAPSED_KEY));

  function toggleChartCollapsed(): void {
    chartCollapsed = !chartCollapsed;
    savePanelCollapsed(CHART_COLLAPSED_KEY, chartCollapsed);
  }

  function toggleTuneCollapsed(): void {
    tuneCollapsed = !tuneCollapsed;
    savePanelCollapsed(TUNE_COLLAPSED_KEY, tuneCollapsed);
  }

  // Bundled demo scenarios. Picking one snaps config to its values and
  // sets it as the "baseline" — the `defaults` link in the tune panel
  // resets to this, not to DEFAULT_CONFIG. So you can pick a preset,
  // experiment with the sliders, and snap back without re-clicking.
  type Preset = {
    id: string;
    name: string;
    description: string;
    config: SingleZoneConfig;
  };

  const PRESETS: readonly Preset[] = [
    {
      id: 'default',
      name: 'Default',
      description: 'Summer cooling — SP 72°F, OAT 92°F, moderate gains. The basic demo.',
      config: { ...DEFAULT_CONFIG },
    },
    {
      id: 'hot-day',
      name: 'Hot day',
      description:
        'OAT 100°F with SP 72°F. Higher Kp = aggressive response. Expect saturation at the start.',
      config: { ...DEFAULT_CONFIG, outdoorAir: 100, Kp: 0.6 },
    },
    {
      id: 'mild-day',
      name: 'Mild day',
      description:
        'OAT 78°F. Light cooling demand, gentle Kp. Controller settles quickly with low output.',
      config: { ...DEFAULT_CONFIG, outdoorAir: 78, Kp: 0.2, initialZone: 73 },
    },
    {
      id: 'setback',
      name: 'Setback',
      description: 'Unoccupied period — SP relaxed to 80°F to save energy. Controller barely runs.',
      config: { ...DEFAULT_CONFIG, setpoint: 80, initialZone: 78 },
    },
  ];

  let scenarioBaseline = $state<SingleZoneConfig>(_initialState.scenarioBaseline);
  let activePresetId = $state<string>(_initialState.activePresetId);

  function applyPreset(preset: Preset) {
    if (!focusedTarget) return;
    activePresetId = preset.id;
    scenarioBaseline = { ...preset.config };
    focusedTarget.config = { ...preset.config };
  }

  function resetConfig() {
    // Snap back to whatever the active baseline is (preset or loaded scenario).
    if (!focusedTarget) return;
    focusedTarget.config = { ...scenarioBaseline };
  }

  /** Default schedule shape, seeded with sane office-building values. */
  const DEFAULT_SCHEDULE = {
    enabled: true,
    occupiedSetpoint: 72,
    unoccupiedSetpoint: 78,
    occStartHour: 6,
    occEndHour: 22,
  } as const;

  function toggleSchedule(on: boolean): void {
    if (!focusedTarget) return;
    if (on) {
      focusedTarget.config.schedule = { ...DEFAULT_SCHEDULE };
    } else {
      // Don't actually delete — flip enabled off so the user keeps their
      // last-edited times/setpoints when they toggle back on.
      const cur = focusedTarget.config.schedule;
      focusedTarget.config.schedule = cur
        ? { ...cur, enabled: false }
        : { ...DEFAULT_SCHEDULE, enabled: false };
    }
  }

  function updateSchedule(
    patch: Partial<{
      occupiedSetpoint: number;
      unoccupiedSetpoint: number;
      occStartHour: number;
      occEndHour: number;
    }>,
  ): void {
    if (!focusedTarget || !focusedTarget.config.schedule) return;
    focusedTarget.config.schedule = { ...focusedTarget.config.schedule, ...patch };
  }

  /** UI-only mirror of the thermal sim's effectiveSetpoint logic for the
   *  "Sim clock 14:32 — occupied" readout. Kept tiny so the canvas doesn't
   *  depend on the sim's internal helper. */
  function isOccupiedNow(
    sched: { occStartHour: number; occEndHour: number },
    hourOfDay: number,
  ): boolean {
    const { occStartHour: start, occEndHour: end } = sched;
    if (start <= end) return hourOfDay >= start && hourOfDay < end;
    return hourOfDay >= start || hourOfDay < end;
  }

  function tempReading(): string {
    return `${(65 + Math.random() * 15).toFixed(1)} °F`;
  }

  function pressureReading(): string {
    return `${(0.2 + Math.random() * 1.8).toFixed(2)} in WC`;
  }

  function controllerReading(controllerId?: string): string {
    const damper = Math.floor(Math.random() * 100);
    const label = controllerId ? controllerOutputLabel(controllerId) : 'Out';
    return `${label} ${damper}%`;
  }

  /** Pick a human label for a controller's actuator-command output
   *  based on what's actually wired downstream. "Damper" / "Valve" /
   *  "VFD" / etc. instead of generic "Out" when we can figure it out.
   *  Falls back to "Out" when there's no wired actuator yet. */
  function controllerOutputLabel(controllerId: string): string {
    for (const e of edges) {
      if (e.source !== controllerId) continue;
      const tgt = nodes.find((n) => n.id === e.target);
      if (!tgt || nodeKind(tgt) !== 'actuator') continue;
      const actId = (tgt.data as { actuatorModelId?: string } | undefined)?.actuatorModelId;
      const model = actId ? findActuatorModel(actId) : null;
      const kind = model?.kind;
      switch (kind) {
        case 'damper-modulating':
        case 'damper-binary':
          return 'Damper';
        case 'valve-modulating':
        case 'valve-floating':
        case 'valve-binary':
          return 'Valve';
        case 'vfd':
          return 'VFD';
        case 'contactor':
        case 'pump-relay':
          return 'Cmd';
        default:
          return 'Actuator';
      }
    }
    return 'Out';
  }

  function sensorValue(label: string): string {
    if (/(^|[-_ ])(p|ps|press)([-_ ]|$)/i.test(label)) return pressureReading();
    return tempReading();
  }

  function safetyValue(label: string): { value: string; status: 'idle' | 'tripped' } {
    if (Math.random() < 0.04) return { value: `⚠ ${label} TRIPPED`, status: 'tripped' };
    return { value: '✓ OK', status: 'idle' };
  }

  function tickOnce() {
    tick++;
    // Sim wall-clock advances by `dt` sim-seconds per tick. We mirror the
    // running systems' internal counter at the canvas level so the clock
    // readout works whether or not any target is wired.
    // Apply sim-speed multiplier to the effective tick step so 1× = real-time,
    // 30× compresses 30 sim-seconds into one wall-second of computation. The
    // multiplier flows through to actuator stroke, plant ramp, zone drift —
    // everything scales together.
    const baseDt = runningSnapshot[0]?.config.dt ?? DEFAULT_CONFIG.dt;
    const dtSeconds = baseDt * simSpeed;
    simSecondsElapsed += dtSeconds;

    // Weather drive: when active, advance the weather playback clock by the
    // same dt and write the interpolated OAT into every running system's
    // config.outdoorAir BEFORE stepping. Mutating `config.outdoorAir` is safe
    // because the thermal model reads it each tick — no need to touch the
    // SingleZoneSystem internals. When weather drive is off, this loop and
    // advancePlayback() are both no-ops.
    if (weatherStore.mode !== 'off' && weatherStore.status === 'ready') {
      advancePlayback(dtSeconds);
    }
    // Manual OAT (Conditions panel) beats the weather sample; weather beats
    // the scenario's static outdoorAir.
    if (manualOat !== null) {
      for (const target of runningSnapshot) {
        (target.config as { outdoorAir: number }).outdoorAir = manualOat;
      }
    } else if (weatherStore.mode !== 'off' && weatherStore.status === 'ready') {
      const sample = currentWeatherSample();
      if (sample) {
        for (const target of runningSnapshot) {
          // Mutate via Object.assign-like reassignment — `config` is a
          // structured object on the scenario; rewriting the field is fine.
          (target.config as { outdoorAir: number }).outdoorAir = sample.T_F;
        }
      }
    }

    // Step every wired system. Build a fast lookup from controllerId → latest sample
    // so the node-runtime pass below can resolve in O(1).
    const sampleByCtrl = new Map<string, Sample>();
    // Capture the full env.outputs per controller after running its program,
    // so the actuator-dynamics loop can route each actuator's commanded
    // value based on its bound role (rather than always using sample.actuator).
    const programOutputsByCtrl = new Map<string, Record<string, number>>();
    // Per-tick cache: controllerId → (terminalId → {inputKey, value}) from the
    // signal-fidelity pass. The program-gated block re-uses this to feed
    // env.inputs without re-running the encode/scale path. Only SECONDARY
    // sensors are added here; the primary physics-target sensor's value is
    // already fed by the thermal sim via env.inputs.sensed.
    const terminalScaledByCtrlThisTick = new Map<
      string,
      Map<string, { inputKey: string; value: number }>
    >();

    /**
     * Pull signal + range + subject for a sensor node from either source
     * we know about: the rich core SENSOR_CATALOG (when a specific
     * vendor/model was dragged in) or the lighter UI SENSOR_TEMPLATES
     * map (when a demo or generic drop only specified a signal type).
     * Returns null when neither lookup succeeds.
     */
    function inferSensorMeta(senNode: Node): {
      signal: import('@bas/core').SensorSignal;
      range: readonly [number, number];
      subject: import('@bas/core').SensorSubject;
    } | null {
      const data = senNode.data as
        | { sensorModelId?: string; signal?: import('@bas/core').SensorSignal }
        | undefined;
      if (data?.sensorModelId) {
        const m = findSensorModel(data.sensorModelId);
        if (m) return { signal: m.signal, range: m.range, subject: m.subject };
      }
      if (data?.signal) {
        const tpl = SENSOR_TEMPLATE_BY_ID.get(
          data.signal as Parameters<typeof SENSOR_TEMPLATE_BY_ID.get>[0],
        );
        if (tpl) {
          // UI SENSOR_TEMPLATES use a coarser 'subject' enum
          // ('temp'|'pressure'|'humidity'|'position'|'status') than the
          // core catalog. Map per-signal-type so the engineering-value
          // computation in computeSensorReading picks the right path.
          let subject: import('@bas/core').SensorSubject = 'temp';
          switch (data.signal) {
            case 'rtd-pt1000':
            case 'thermistor-10k-t2':
              subject = 'temp';
              break;
            case 'analog-0-10v':
              subject = 'damper-position';
              break;
            case 'analog-4-20ma':
              subject = 'pressure-differential';
              break;
            case 'binary-dry':
              subject = 'occupancy';
              break;
          }
          return { signal: data.signal, range: tpl.range, subject };
        }
      }
      return null;
    }

    /**
     * Signal-fidelity bridge pass for a single controller. Walks every
     * sensor wired to it (in either edge direction — svelte-flow drag
     * direction isn't physically meaningful), encodes the reading as the
     * electrical signal the sensor would emit, scales it back via the
     * controller's terminal config, and publishes per-terminal snapshots
     * to controllerBridge.terminalSignalsByCtrl for the multimeter UI.
     *
     * For secondary sensors the scaled value also lands in the env-feed
     * cache so the program block downstream can read it without re-running
     * the encode/scale pipeline. Primary sensors get a display-only entry —
     * their engineering value flows through the thermal sim's T_sensed
     * path, which has its own fault pipeline (drift, calibration, noise,
     * etc.) the signal layer doesn't model yet.
     */
    function runBridgePass(
      controllerId: string,
      primarySensorId: string | undefined,
      simHour: number,
      actuator: number,
      zoneTemp: number,
      outsideTemp: number,
    ): void {
      const sigForCtrl = new Map<string, { inputKey: string; value: number }>();
      for (const edge of edges) {
        let sensorEnd: string | null = null;
        let terminalHandle: string | null | undefined = null;
        if (edge.target === controllerId) {
          sensorEnd = edge.source;
          terminalHandle = edge.targetHandle;
        } else if (edge.source === controllerId) {
          sensorEnd = edge.target;
          terminalHandle = edge.sourceHandle;
        } else {
          continue;
        }
        const senNode = nodes.find((n) => n.id === sensorEnd);
        if (!senNode) continue;
        // G26 — actuator position feedback. An actuator wired INTO a
        // controller input (actuator → AI/UI) puts its position on the
        // wire as a 2-10V feedback signal — but only when the installed
        // model actually has feedback. The command wire (controller →
        // actuator, edge.source === controllerId) is the dynamics pass's
        // job, not a signal into this controller.
        if (nodeKind(senNode) === 'actuator') {
          if (edge.target !== controllerId) continue;
          const aData = senNode.data as {
            actuatorModelId?: string;
            actuatorState?: { commanded: number; actual: number };
            label?: string;
          };
          const aModel = aData.actuatorModelId ? findActuatorModel(aData.actuatorModelId) : undefined;
          if (!aModel?.hasPositionFeedback) continue;
          if (!terminalHandle) terminalHandle = `auto:${aData.label ?? sensorEnd}`;
          const fbPct = Math.max(0, Math.min(100, (aData.actuatorState?.actual ?? 0) * 100));
          const fbRaw = engToSignal(fbPct, 'analog-2-10v', [0, 100]);
          const fbDefaultCfg = defaultTerminalConfig('analog-2-10v', [0, 100]);
          const fbTermCfg = resolveTerminalConfig(controllerId, terminalHandle, fbDefaultCfg);
          const fbScaled = signalToEng(fbRaw, fbTermCfg);
          let perCtrlFb = controllerBridge.terminalSignalsByCtrl.get(controllerId);
          if (!perCtrlFb) {
            perCtrlFb = new Map();
            controllerBridge.terminalSignalsByCtrl.set(controllerId, perCtrlFb);
          }
          perCtrlFb.set(terminalHandle, {
            raw: fbRaw,
            config: fbTermCfg,
            scaled: fbScaled,
            sensorNodeId: senNode.id,
            isPrimary: false,
            installedSignal: 'analog-2-10v',
          });
          // Program-readable key: env.inputs.fb_<actuator label>, e.g. a
          // damper named DMP-OA reads back as fb_dmp_oa (% open).
          const fbKey = `fb_${(aData.label ?? 'actuator').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
          sigForCtrl.set(terminalHandle, { inputKey: fbKey, value: fbScaled.value });
          continue;
        }
        if (nodeKind(senNode) !== 'sensor') continue;
        // When the demo / user didn't pin the wire to a specific terminal
        // (svelte-flow handle), synthesize an id from the sensor so the
        // Terminals panel still has a row. Real wiring with discrete
        // handles (UI-1, AI-2, …) keeps its precise label.
        if (!terminalHandle) {
          const senLabel = (senNode.data as { label?: string } | undefined)?.label ?? sensorEnd;
          terminalHandle = `auto:${senLabel}`;
        }
        // Sensor metadata comes from either the rich core catalog (when
        // the user dragged a specific make/model) or the lighter UI
        // SENSOR_TEMPLATES table (when a demo just set `data.signal`).
        const senMeta = inferSensorMeta(senNode);
        if (!senMeta) continue;

        const sFault = (senNode.data as { fault?: string } | undefined)?.fault;
        const sigFault: SignalFault | undefined =
          sFault === 'open'
            ? 'open-circuit'
            : sFault === 'short'
              ? 'short-circuit'
              : undefined;
        const reading = computeSensorReading(
          senMeta.subject,
          { hour: simHour, actuator, zoneTemp, outsideTemp },
          { signal: senMeta.signal, range: senMeta.range, fault: sigFault },
        );
        const defaultCfg = defaultTerminalConfig(senMeta.signal, senMeta.range);
        const termCfg = resolveTerminalConfig(controllerId, terminalHandle, defaultCfg);
        const scaled = reading.raw
          ? signalToEng(reading.raw, termCfg)
          : { value: reading.value };

        const isPrimary = sensorEnd === primarySensorId;
        let perCtrl = controllerBridge.terminalSignalsByCtrl.get(controllerId);
        if (!perCtrl) {
          perCtrl = new Map();
          controllerBridge.terminalSignalsByCtrl.set(controllerId, perCtrl);
        }
        if (reading.raw) {
          perCtrl.set(terminalHandle, {
            raw: reading.raw,
            config: termCfg,
            scaled,
            sensorNodeId: senNode.id,
            isPrimary,
            installedSignal: senMeta.signal,
          });
        }
        // Only SECONDARY sensors feed the program env. Primary is owned
        // by the thermal sim's T_sensed path (which has its own faults).
        if (!isPrimary) {
          sigForCtrl.set(terminalHandle, { inputKey: reading.inputKey, value: scaled.value });
        }
      }
      terminalScaledByCtrlThisTick.set(controllerId, sigForCtrl);
    }
    const samples = runningSamples;
    const systems = runningSystems;
    // Recompute offline status each tick. If a target's controller OR sensor
    // can't reach a supervisor, the system reads as offline → senseZone()
    // returns the last good value, so the trace flatlines until the wire
    // is restored.
    const offline = offlineNodes;

    // Pre-compute sibling-group neighbor temps for thermal coupling. Two
    // wired targets are "siblings" when they share the same parent
    // controller — i.e. they hang off the same FEC / AHU in the topology.
    // Each system reads the average of its siblings' T_zone as a neighbor
    // pull. This is the "two adjacent VAVs bleed heat through the return
    // air plenum" effect — small in practice (couplingFactor defaults to 0)
    // but visible when enabled.
    const siblingNeighborByTarget = new Map<string, number | null>();
    if (runningSnapshot.length > 1) {
      const groups = new Map<string, string[]>(); // parentId|none → [controllerId]
      for (const t of runningSnapshot) {
        const parent = findParentController(t.controllerId);
        const key = parent?.id ?? '__orphans__';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(t.controllerId);
      }
      for (const ids of groups.values()) {
        if (ids.length < 2) continue;
        for (const id of ids) {
          const others = ids.filter((x) => x !== id);
          let sum = 0;
          let count = 0;
          for (const otherId of others) {
            const otherSys = systems.get(otherId);
            if (otherSys) {
              sum += otherSys.T_zone;
              count++;
            }
          }
          siblingNeighborByTarget.set(id, count > 0 ? sum / count : null);
        }
      }
    }

    for (const target of runningSnapshot) {
      const sys = systems.get(target.controllerId);
      if (!sys) continue;
      // Power-off gate: a controller that's been ⏻ Powered Off should
      // stop ALL execution — PI loop, ST program, actuator commands.
      // Treat it like offline (frozen output, last good reading) so
      // the user sees "Out" stop changing, then jump back when power
      // restores. Sim time still ticks globally; this controller just
      // doesn't participate.
      const powerCtrlNode = nodes.find((n) => n.id === target.controllerId);
      const ctrlPoweredOff = (powerCtrlNode?.data as { poweredOff?: boolean } | undefined)?.poweredOff === true;
      if (ctrlPoweredOff) {
        // Synthesize a "no-op" sample so the trace flatlines but the
        // chart keeps a data point per tick. Actuator + setpoint hold.
        const sample = {
          t: sys.simSeconds,
          T_sensed: sys.sensor.lastReading,
          T_zone: sys.T_zone,
          setpoint: (sys as unknown as { setpoint: number }).setpoint ?? 72,
          actuator: 0, // power-off pulls outputs to 0 by default
          error: 0,
          integral: 0,
          mode: 'cool' as const,
        };
        const series = samples.get(target.controllerId) ?? [];
        series.push(sample as unknown as Sample);
        if (series.length > sys.config.historyLength) series.shift();
        samples.set(target.controllerId, series);
        // Surface on the node card as a frozen "0%" output. Down-
        // stream sensor reads will use the same lastReading. The node
        // card's runtime display falls through to the fallback render
        // block, which detects data.poweredOff and shows "⏻ POWER OFF"
        // explicitly rather than the random idle reading.
        sampleByCtrl.set(target.controllerId, sample as unknown as Sample);
        continue;
      }
      sys.offline = offline.has(target.controllerId) || offline.has(target.sensorId);
      sys.couplingNeighborTemp = siblingNeighborByTarget.get(target.controllerId) ?? null;
      const sample = sys.step();

      // ST program post-step. If the user has compiled an ST program for
      // this controller, run it with the latest sensed/setpoint/oat as
      // inputs. Outputs that match known fields override the PI step:
      //   - `actuator` (0..1): replaces sys.actuator, mirroring a manual
      //     override but driven by the user's program.
      //   - `setpoint`: replaces the controller's setpoint this tick (and
      //     persists into config so subsequent ticks see it).
      // Anything else stays in the program's output map / VAR state.
      const userProgram = programStore.byId[target.controllerId];
      // Gate ST execution to IEC-portable controllers — for everything else
      // (JCI CCT, Distech EC-gfx, Niagara Wiresheet, PPCL, etc.), the sandbox
      // doesn't pretend to run their native text language. BUT: programs
      // authored in the FBD block diagram are vendor-neutral by design — the
      // sim interprets our own block library regardless of what the real
      // panel speaks. So we allow FBD-derived programs on every controller,
      // and only restrict hand-typed ST text to IEC-portable gear.
      const ctrlNode = nodes.find((n) => n.id === target.controllerId);
      const vendorModelId = (ctrlNode?.data as { vendorModelId?: string } | undefined)?.vendorModelId;
      const stAllowed = !vendorModelId || (findControllerModel(vendorModelId)?.stPortable ?? true);
      const fbdAuthored = !!userProgram?.fbdGraph;

      if (userProgram?.compiled && (stAllowed || fbdAuthored)) {
        // Collect inputs from every sensor wired to this controller. The
        // primary thermal sensor still drives `sensed`, but secondary
        // sensors (occupancy, damper feedback, CO2, humidity, etc.) get
        // their own per-subject canonical keys via computeSensorReading.
        const simHour = ((simStartHour * 3600 + simSecondsElapsed) / 3600) % 24;
        const secondaryInputs: Record<string, number> = {};
        for (const edge of edges) {
          // Only sensor→controller wires count as inputs to this controller.
          if (edge.target !== target.controllerId) continue;
          if (edge.source === target.sensorId) continue; // primary, handled below
          const senNode = nodes.find((n) => n.id === edge.source);
          if (!senNode) continue;
          if (nodeKind(senNode) !== 'sensor') continue;
          const senModelId = (senNode.data as { sensorModelId?: string } | undefined)?.sensorModelId;
          const senModel = senModelId ? findSensorModel(senModelId) : undefined;
          if (!senModel) continue;

          // Plant-sensor override: if the controller binds this sensor's
          // target terminal to a plant-temp role (hw-supply-temp etc.),
          // AND the sensor is wired upstream from a boiler/chiller/tower,
          // read the actual loop temp directly. This is how an immersion
          // sensor stuck in the boiler header reports HWS to the program.
          const ctrlProg = programStore.byId[target.controllerId];
          const tgtBinding = edge.targetHandle
            ? ctrlProg?.bindings?.bindings.find((b) => b.terminalId === edge.targetHandle)
            : undefined;
          let plantTempValue: number | null = null;
          if (tgtBinding) {
            // Find equipment → sensor edge feeding THIS sensor.
            for (const upstream of edges) {
              if (upstream.target !== senNode.id) continue;
              const eq = nodes.find((n) => n.id === upstream.source);
              if (!eq || nodeKind(eq) !== 'equipment') continue;
              const loopState = (eq.data as { loopState?: { T_supply: number; T_return: number } })?.loopState;
              if (!loopState) continue;
              if (tgtBinding.role === 'hw-supply-temp' || tgtBinding.role === 'chw-supply-temp') {
                plantTempValue = loopState.T_supply;
              } else if (tgtBinding.role === 'hw-return-temp' || tgtBinding.role === 'chw-return-temp') {
                plantTempValue = loopState.T_return;
              }
            }
          }
          if (plantTempValue !== null && tgtBinding) {
            const roleTpl = findTileTemplate(tgtBinding.role);
            if (roleTpl?.envKey) {
              secondaryInputs[roleTpl.envKey] = plantTempValue;
              continue; // skip the generic per-subject reading
            }
          }

          // The bridge pass above already encoded + scaled the signal for
          // every sensor wired to this controller. Pull the engineering
          // value out of that cache and inject into env.inputs — no need
          // to repeat the math here.
          const cachedScaled = edge.targetHandle
            ? terminalScaledByCtrlThisTick.get(target.controllerId)?.get(edge.targetHandle)
            : undefined;
          if (cachedScaled) {
            secondaryInputs[cachedScaled.inputKey] = cachedScaled.value;
          } else {
            // Fall back to the pre-signal-fidelity behavior for sensors the
            // bridge pass didn't reach (e.g., no targetHandle on the edge).
            const reading = computeSensorReading(senModel.subject, {
              hour: simHour,
              actuator: sample.actuator,
              zoneTemp: sample.T_zone,
              outsideTemp: sample.T_OA,
            });
            secondaryInputs[reading.inputKey] = reading.value;
          }
        }

        // Seasonal flags — derived from OAT vs changeover (65°F default).
        // Programs can gate plant-side rules on these.
        const CHANGEOVER = 65;
        secondaryInputs['heating_season'] = sample.T_OA < CHANGEOVER ? 1 : 0;
        secondaryInputs['cooling_season'] = sample.T_OA > CHANGEOVER ? 1 : 0;

        // Position feedback: walk actuator → controller edges. When an
        // actuator with hasPositionFeedback wires its output (net-out)
        // back to a controller UI/AI input, the controller's bound role
        // for that target terminal receives the actuator's *actual*
        // position (lagged by stroke time). This closes the control loop
        // — programs that read "damper position" get the post-stroke
        // value, not the just-commanded value.
        for (const edge of edges) {
          if (edge.target !== target.controllerId) continue;
          const upstream = nodes.find((n) => n.id === edge.source);
          if (!upstream || nodeKind(upstream) !== 'actuator') continue;
          const actState = (upstream.data as { actuatorState?: { actual: number } } | undefined)
            ?.actuatorState;
          if (!actState) continue;
          // Look up the role bound to the target terminal (controller's UI/AI).
          const tgtCtrlProgram = programStore.byId[target.controllerId];
          const fbBinding = edge.targetHandle
            ? tgtCtrlProgram?.bindings?.bindings.find((b) => b.terminalId === edge.targetHandle)
            : undefined;
          const fbRoleTpl = fbBinding ? findTileTemplate(fbBinding.role) : undefined;
          const fbKey = fbRoleTpl?.envKey;
          if (!fbKey) continue;
          // Damper/valve feedback comes in as percent (0-100) to match the
          // damper-position SUBJECT tile's convention; the actuator state
          // is 0-1, so scale.
          secondaryInputs[fbKey] = actState.actual * 100;
        }
        // Inputs are read-only from the program's perspective. `actuator`
        // is exposed via the separate read-only name `pi_out` so users can
        // see what PI commanded this tick without colliding with the
        // assignment target. `actuator` itself goes through outputs.
        const env: StEnv = makeEnv({
          inputs: {
            sensed: sample.T_sensed,
            setpoint: sample.setpoint,
            oat: sample.T_OA,
            zone: sample.T_zone,
            pi_out: sample.actuator,
            dt: target.config.dt,
            ...secondaryInputs,
          },
          // Seed `actuator` in outputs with the current PI value so a
          // program that only sometimes assigns it (e.g. conditional
          // override) still has a sane default.
          outputs: { actuator: sample.actuator },
          state: userProgram.state,
          dt: target.config.dt,
        });
        try {
          runProgram(userProgram.compiled, env);
          if (typeof env.outputs.actuator === 'number' && Number.isFinite(env.outputs.actuator)) {
            sys.actuator = Math.max(0, Math.min(1, env.outputs.actuator));
            // Reflect the program's override in the sample so the chart shows what's commanded.
            (sample as { actuator: number }).actuator = sys.actuator;
          }
          if (typeof env.outputs.setpoint === 'number' && Number.isFinite(env.outputs.setpoint)) {
            (target.config as { setpoint: number }).setpoint = env.outputs.setpoint;
            (sample as { setpoint: number }).setpoint = env.outputs.setpoint;
          }
          // Snapshot env.outputs so the actuator-dynamics loop can pull
          // the right value per role (reheat / fan / cool_valve / etc).
          const snap: Record<string, number> = {};
          for (const [k, v] of Object.entries(env.outputs)) {
            if (typeof v === 'number' && Number.isFinite(v)) snap[k] = v;
          }
          programOutputsByCtrl.set(target.controllerId, snap);
          // Publish env snapshots into the controllerBridge so the BACnet
          // inspector (and any other consumer) can read live values.
          controllerBridge.envOutputsByCtrl.set(target.controllerId, snap);
          const inSnap: Record<string, number | boolean> = {};
          for (const [k, v] of Object.entries(env.inputs)) {
            if (typeof v === 'number' && Number.isFinite(v)) inSnap[k] = v;
            else if (typeof v === 'boolean') inSnap[k] = v;
          }
          controllerBridge.envInputsByCtrl.set(target.controllerId, inSnap);
          // Clear any prior runtime error
          userProgram.error = null;
        } catch (err) {
          userProgram.error = err instanceof Error ? err.message : String(err);
        }
      }

      sampleByCtrl.set(target.controllerId, sample);
      let hist = samples.get(target.controllerId) ?? [];
      hist = [...hist, sample];
      if (hist.length > target.config.historyLength) {
        hist = hist.slice(hist.length - target.config.historyLength);
      }
      samples.set(target.controllerId, hist);
    }
    // Trigger reactivity on the samples map for the chart.
    runningSamples = new Map(samples);

    // ── Helper: compute fallback AI present-values for a controller ──
    // When a controller has no user program (no bindings, no envInputs),
    // synthesizeBacnetObjects normally fills every AI with 0. That made the
    // COV firehose demo's packet log show "AI:1 = 0" forever even when the
    // wired thermal sim was producing rich data. This helper pulls the
    // running sample's T_sensed (and a few more fields) so AI:1..4 carry
    // the values a real device would actually report. Sensor.1 fix.
    function defaultAiSeed(childNodeId: string): {
      values: readonly number[];
      units?: string;
      name?: string;
    } {
      const sample = sampleByCtrl.get(childNodeId);
      if (sample) {
        // AI:1 = zone-temp from the wired sensor; AI:2 = OAT; AI:3 = current
        // setpoint; AI:4 = PI command (0-100% scale). Matches the kind of
        // object map a real VAV controller publishes for upstream readback.
        return {
          values: [
            sample.T_sensed,
            sample.T_OA,
            sample.setpoint,
            sample.actuator * 100,
          ],
          units: '°F',
          name: 'Zone Temp',
        };
      }
      return { values: [] };
    }

    /** Pull the per-terminal fault map for a given controller out of the
     *  signal-fidelity bridge. The synthesize call uses this to flip the
     *  matching AI / BI object's reliability + Status_Flags FAULT bit so
     *  a supervisor's ReadProperty-ACK reflects the broken wire the way
     *  a real Metasys/Niagara device would. */
    function terminalFaultsFor(controllerId: string):
      | ReadonlyMap<string, import('@bas/core').SignalFault>
      | undefined {
      const snapshots = controllerBridge.terminalSignalsByCtrl.get(controllerId);
      if (!snapshots) return undefined;
      const out = new Map<string, import('@bas/core').SignalFault>();
      for (const [terminalId, snap] of snapshots) {
        const f = snap.scaled.fault;
        if (f) out.set(terminalId, f);
      }
      return out.size > 0 ? out : undefined;
    }

    // Build a node-id → physics-driven-value lookup so the runtime pass is direct.
    const physicsValueByNode = new Map<
      string,
      { value: string; status: 'polling' | 'responded' }
    >();
    for (const target of runningSnapshot) {
      const sample = sampleByCtrl.get(target.controllerId);
      if (!sample) continue;
      // Powered-off check: the main sim loop above sets `actuator: 0`
      // when a controller is poweredOff so the trace flatlines. Here
      // we also surface that state explicitly on the node card so the
      // user sees a distinct "⏻ POWER OFF" label rather than a frozen
      // "Damper 0%" that looks the same as a satisfied control loop.
      const ctrlNodeForView = nodes.find((n) => n.id === target.controllerId);
      const ctrlPoweredOffView =
        (ctrlNodeForView?.data as { poweredOff?: boolean } | undefined)?.poweredOff === true;
      if (ctrlPoweredOffView) {
        physicsValueByNode.set(target.controllerId, {
          value: `⏻ POWER OFF · ${controllerOutputLabel(target.controllerId)} 0%`,
          status: 'responded',
        });
        continue;
      }
      // Label the controller output with the active program source so the
      // user can tell at a glance whether they're watching the default PI
      // loop or the program they just downloaded. "(PI)" used to be
      // hardcoded — misleading once any user program took over.
      const userProgramAtCtrl = programStore.byId[target.controllerId];
      let progSource = 'PI';
      if (userProgramAtCtrl?.compiled) {
        if (userProgramAtCtrl.specProgram) progSource = 'SpecLang';
        else if (userProgramAtCtrl.fbdGraph) progSource = 'FBD';
        else if (userProgramAtCtrl.source) progSource = 'ST';
      }
      physicsValueByNode.set(target.controllerId, {
        value: `${controllerOutputLabel(target.controllerId)} ${Math.round(sample.actuator * 100)}% (${progSource})`,
        status: 'polling',
      });
      // Sensor node displays what the SENSOR reports — not the true zone.
      // Under fault this can diverge from T_zone (stuck reading, drift bias,
      // open/short to rail values). That's the whole point: the controller
      // and the sensor reading agree; reality goes its own way.
      physicsValueByNode.set(target.sensorId, {
        value: `${sample.T_sensed.toFixed(1)} °F`,
        status: 'responded',
      });
      // Secondary sensors on the same controller render their subject value
      // (occ 0/1, damper %, CO2 ppm, RH %, …) instead of falling back to
      // the thermal sample. This is what makes the VAV scenario's OCC and
      // DMP-FB nodes report meaningful values during a live run.
      const simHourDisp = ((simStartHour * 3600 + simSecondsElapsed) / 3600) % 24;
      for (const edge of edges) {
        if (edge.target !== target.controllerId) continue;
        if (edge.source === target.sensorId) continue;
        const senNode = nodes.find((n) => n.id === edge.source);
        if (!senNode || nodeKind(senNode) !== 'sensor') continue;
        if (physicsValueByNode.has(senNode.id)) continue;
        const senModelId = (senNode.data as { sensorModelId?: string } | undefined)?.sensorModelId;
        const senModel = senModelId ? findSensorModel(senModelId) : undefined;
        if (!senModel) continue;
        const reading = computeSensorReading(senModel.subject, {
          hour: simHourDisp,
          actuator: sample.actuator,
          zoneTemp: sample.T_zone,
          outsideTemp: sample.T_OA,
        });
        physicsValueByNode.set(senNode.id, {
          value: reading.display,
          status: 'responded',
        });
      }
    }
    // Parent SP/OAT readout: only emit for the *focused* target's parent.
    // Without this, when two wired VAVs share a single FEC parent the
    // SP/OAT display flickers between targets every tick — easy to misread
    // as "both setpoints changed."
    if (focusedTargetId) {
      const focused = runningSnapshot.find((t) => t.controllerId === focusedTargetId);
      const focusedSample = focused ? sampleByCtrl.get(focused.controllerId) : null;
      if (focused && focusedSample) {
        const parent = findParentController(focused.controllerId);
        if (parent && !physicsValueByNode.has(parent.id)) {
          physicsValueByNode.set(parent.id, {
            value: `SP ${focusedSample.setpoint.toFixed(0)}°F · OAT ${focusedSample.T_OA.toFixed(0)}°F`,
            status: 'polling',
          });
        }
      }
    }

    // Look up which wired-target sensor each controller pairs with, so we can
    // evaluate high/low alarm thresholds against the *real* zone temp (T_zone,
    // not T_sensed — alarms should fire on what the room actually is, not on
    // a possibly-frozen sensor read).
    const sampleByCtrlForAlarm = sampleByCtrl;

    // ── Actuator dynamics ─────────────────────────────────────────────
    // For each controller → actuator edge, advance the actuator's actual
    // position toward the controller's commanded value at the actuator's
    // own stroke rate (Belimo AF24-MFT takes ~95s end-to-end; a contactor
    // latches in ~0.05s). This produces the slow-ramp realism techs see in
    // the field: command 100%, watch the damper crawl open over 90 seconds.
    const actuatorStateUpdates = new Map<string, { commanded: number; actual: number }>();
    for (const edge of edges) {
      const srcN = nodes.find((n) => n.id === edge.source);
      const tgtN = nodes.find((n) => n.id === edge.target);
      if (!srcN || !tgtN) continue;
      const srcKindAct = nodeKind(srcN);
      if ((srcKindAct !== 'controller' && srcKindAct !== 'vahu') || nodeKind(tgtN) !== 'actuator') continue;

      // Multi-actuator routing: look up the binding for the source terminal
      // (the controller's AO-N / BO-N). If bound to a role, use that role's
      // envKey to pull the commanded value from the program's outputs.
      // Falls back to sample.actuator (the primary command) when no binding
      // exists — so a generic single-output controller still works.
      // A packaged AHU drives its actuators straight from the G36 sequence
      // state, routed by terminal: AO-1 fan VFD, AO-2 OA damper, AO-3
      // heating valve, AO-4 cooling valve, BO-1 fan start/stop. (Uses last
      // tick's state — the vAHU steps later in this tick; 1-tick lag is
      // invisible next to a 90s actuator stroke.)
      let commanded: number;
      let srcRoleTpl: ReturnType<typeof findTileTemplate> | undefined;
      let vahuRole: string | null = null;
      if (srcKindAct === 'vahu') {
        const vst = vahuStates.get(srcN.id);
        if (!vst) continue;
        const h = edge.sourceHandle ?? '';
        const cmd =
          h === 'AO-1' ? vst.fanSpeed
          : h === 'AO-2' ? vst.oaDamperPct / 100
          : h === 'AO-3' ? vst.heatValvePct / 100
          : h === 'AO-4' ? vst.coolValvePct / 100
          : h === 'BO-1' ? (vst.fanSpeed > 0.01 ? 1 : 0)
          : null;
        if (cmd === null) continue;
        commanded = Math.max(0, Math.min(1, cmd));
        vahuRole = (VAHU_TERMINAL_ROLES[h] ?? '').split(' ')[0] || null;
      } else {
        const sample = sampleByCtrl.get(srcN.id);
        if (!sample) continue;
        const srcCtrlProgram = programStore.byId[srcN.id];
        const srcOutputs = programOutputsByCtrl.get(srcN.id) ?? {};
        const srcBinding = edge.sourceHandle
          ? srcCtrlProgram?.bindings?.bindings.find((b) => b.terminalId === edge.sourceHandle)
          : undefined;
        srcRoleTpl = srcBinding ? findTileTemplate(srcBinding.role) : undefined;
        const routedKey = srcRoleTpl?.envKey;
        const routedValue = routedKey && routedKey in srcOutputs ? srcOutputs[routedKey] : undefined;
        commanded = Math.max(0, Math.min(1, routedValue ?? sample.actuator));
      }

      const tgtData = tgtN.data as {
        actuatorState?: { actual: number };
        actuatorModelId?: string;
        fault?: string;
      };
      const prevActual = tgtData.actuatorState?.actual ?? 0;

      const actuatorModelId = tgtData.actuatorModelId;
      const actuatorModel = actuatorModelId ? findActuatorModel(actuatorModelId) : undefined;
      const strokeSec = actuatorModel?.strokeSeconds ?? 60;

      // Linear stroke (good enough for v1). Real actuators are slightly
      // S-curve (acceleration + deceleration); we can refine later.
      // A 'stuck' fault (jammed damper, lost linkage) freezes the actual
      // position regardless of command — the controller keeps commanding,
      // nothing moves. With position feedback wired, the program can see
      // the divergence; without it, the only tell is the zone misbehaving.
      const isStuck = tgtData.fault === 'stuck';
      const maxStep = dtSeconds / strokeSec;
      const diff = commanded - prevActual;
      const actual = isStuck
        ? prevActual
        : Math.abs(diff) <= maxStep
          ? commanded
          : prevActual + Math.sign(diff) * maxStep;

      actuatorStateUpdates.set(tgtN.id, { commanded, actual });

      // Show the actuator's live state on its canvas node. Include the
      // source terminal (AO-1, BO-2, etc.) and any role binding from the
      // controller's Point Assignments — that's what answers the user's
      // "which actuator IS this?" question without making them re-trace
      // the wire visually.
      const pct = Math.round(actual * 100);
      const cmdPct = Math.round(commanded * 100);
      const slewing = actual < commanded - 0.001 || actual > commanded + 0.001;
      const srcTerminal = edge.sourceHandle && edge.sourceHandle !== 'net-in' && edge.sourceHandle !== 'net-out'
        ? edge.sourceHandle
        : null;
      const roleSuffix = srcTerminal
        ? ` · ${srcTerminal}${
            vahuRole
              ? ` → ${vahuRole}`
              : srcRoleTpl
                ? ` → ${srcRoleTpl.display}`
                : ' → (unbound role)'
          }`
        : '';
      // Easy mode names the stuck fault outright (omniscient hint);
      // Realistic just shows the symptom — commanded ≠ position, forever.
      const positionStr =
        isStuck && slewing && guidanceMode === 'easy'
          ? `⚠ stuck at ${pct}% (cmd ${cmdPct}%)`
          : slewing
            ? `${pct}% (cmd ${cmdPct}% ↑)`
            : `${pct}%`;
      physicsValueByNode.set(tgtN.id, {
        value: positionStr + roleSuffix,
        status: 'responded',
      });
    }

    // ── Hydronic load demand ─────────────────────────────────────────
    // Before stepping plant equipment, compute aggregate load demand on
    // each loop based on actual coil positions. A reheat valve at 80%
    // means 80% of its design BTU is being drawn from the HW loop.
    // Multiple coils sum (clamped to 1.0 so over-design doesn't blow up).
    // This replaces the old "loadCommand = 0.85 × plantCommand" proxy —
    // now plant demand and plant supply are independent, which is what
    // makes outdoor-reset / staging sequences actually meaningful.
    let hwLoadDemand = 0;
    let chwLoadDemand = 0;
    for (const actNode of nodes) {
      if (nodeKind(actNode) !== 'actuator') continue;
      const actState = (actNode.data as { actuatorState?: { actual: number } })?.actuatorState;
      if (!actState) continue;
      // Find the controller→actuator edge to read the binding role.
      const upstream = edges.find((e) => e.target === actNode.id);
      if (!upstream) continue;
      const ctrlProg = programStore.byId[upstream.source];
      const binding = upstream.sourceHandle
        ? ctrlProg?.bindings?.bindings.find((b) => b.terminalId === upstream.sourceHandle)
        : undefined;
      const role = binding?.role;
      if (role === 'reheat-valve' || role === 'heating-valve-actuator') {
        hwLoadDemand += actState.actual;
      } else if (role === 'cooling-valve' || role === 'cooling-valve-actuator') {
        chwLoadDemand += actState.actual;
      }
    }
    hwLoadDemand = Math.min(1.0, hwLoadDemand);
    chwLoadDemand = Math.min(1.0, chwLoadDemand);

    // ── Hydronic plant dynamics ──────────────────────────────────────
    // For each boiler / chiller / cooling-tower equipment unit, advance
    // its loop state based on the actuator(s) wired INTO this specific
    // equipment. Routing is by upstream controller-terminal binding:
    //   burner-modulation actuator → plant fire/stage command
    //   circulator-pump actuator   → pump speed command
    // Anything else wired into the equipment counts as generic load.
    const loopStateUpdates = new Map<string, LoopState>();
    for (const node of nodes) {
      if (nodeKind(node) !== 'equipment') continue;
      const eqData = node.data as { equipmentModelId?: string; loopState?: LoopState };
      const eqId = eqData.equipmentModelId;
      const eqModel = eqId ? findEquipmentModel(eqId) : undefined;
      if (!eqModel) continue;
      const isHotPlant = eqModel.kind === 'boiler';
      const isCoolPlant = eqModel.kind === 'chiller';
      const isTower = eqModel.kind === 'cooling-tower';
      if (!isHotPlant && !isCoolPlant && !isTower) continue;

      // Per-plant loop physics: towers got CHW defaults before
      // CW_LOOP_DEFAULTS existed, which "refrigerated" the condenser
      // loop to the 36 °F chiller floor (found in the mega site).
      const cfg = isHotPlant ? HW_LOOP_DEFAULTS : isTower ? CW_LOOP_DEFAULTS : CHW_LOOP_DEFAULTS;
      const prev = eqData.loopState ?? initLoopState(cfg, 70);

      // Walk actuator → THIS equipment edges. Each actuator's command
      // arrives via its upstream controller AO/BO terminal — which has
      // a Point Assignment role. We use that role to route the actuator's
      // actual position to the right equipment-input slot.
      let plantCommand = 0;
      let pumpCommand = 0;
      let extraLoad = 0;
      const incomingActuatorRoles: string[] = []; // for the node label

      for (const inEdge of edges) {
        if (inEdge.target !== node.id) continue;
        const actNode = nodes.find((n) => n.id === inEdge.source);
        if (!actNode || nodeKind(actNode) !== 'actuator') continue;
        const actState = (actNode.data as { actuatorState?: { actual: number } })?.actuatorState;
        if (!actState) continue;

        // Find the controller→actuator edge to get the source terminal,
        // then look up that terminal's role binding on the controller.
        const upstreamEdge = edges.find((e) => e.target === actNode.id);
        if (!upstreamEdge) continue;
        const ctrlProgram = programStore.byId[upstreamEdge.source];
        const binding = upstreamEdge.sourceHandle
          ? ctrlProgram?.bindings?.bindings.find((b) => b.terminalId === upstreamEdge.sourceHandle)
          : undefined;
        const role = binding?.role;

        // Route by role. Unknown / unbound roles count as plant command
        // (lets a generic single-actuator setup still work).
        if (role === 'burner-mod' || role === 'chiller-stage') {
          plantCommand = Math.max(plantCommand, actState.actual);
          incomingActuatorRoles.push(role === 'burner-mod' ? 'burner' : 'stage');
        } else if (role === 'chiller-enable') {
          // Enable is binary — when on, treat as full stage command;
          // when off, plant is off regardless of stage signal.
          plantCommand = actState.actual > 0.5 ? Math.max(plantCommand, 1) : plantCommand;
          incomingActuatorRoles.push('enable');
        } else if (role === 'circulator-pump') {
          pumpCommand = Math.max(pumpCommand, actState.actual);
          incomingActuatorRoles.push('pump');
        } else if (role === 'tower-fan') {
          // Tower fan modulates condenser-water cooling, which we model
          // as plant capacity for the tower.
          plantCommand = Math.max(plantCommand, actState.actual);
          incomingActuatorRoles.push('fan');
        } else {
          // Unknown / unbound — treat as a generic command nudge.
          plantCommand = Math.max(plantCommand, actState.actual);
          incomingActuatorRoles.push('unbound');
        }
        void extraLoad; // reserved for downstream load coupling (Session A.3)
      }

      // If the user wired a plant but didn't wire a pump actuator, run
      // the pump at design flow whenever there IS plant activity —
      // matches the real-world convention "pump always runs with plant."
      if (pumpCommand === 0 && plantCommand > 0.05) pumpCommand = 1;

      // Load command now comes from actual coil demand on the matching
      // loop type. Plant supply and load are independent — this is what
      // makes "supply temp drops when loads open while plant is idle"
      // visible, and what makes outdoor-reset sequences meaningful.
      // Fall back to a small dummy load when no coils are wired so the
      // loop demo still shows ΔT for a stand-alone plant test.
      const detectedLoad = isHotPlant ? hwLoadDemand : (isCoolPlant ? chwLoadDemand : 0);
      const loadCommand = detectedLoad > 0
        ? detectedLoad
        : (plantCommand > 0.05 ? 0.15 : 0); // small idle load when no coils wired

      // Weather-sim's OAT drives drift when idle.
      const oat = runningSnapshot[0]
        ? (sampleByCtrl.get(runningSnapshot[0].controllerId)?.T_OA ?? 60)
        : 60;

      const next = stepLoop(prev, cfg, {
        plantCommand,
        pumpCommand,
        loadCommand,
        outsideTemp: oat,
      }, dtSeconds);
      loopStateUpdates.set(node.id, next);

      // Surface the live loop state + which actuators are driving it.
      const supply = next.T_supply.toFixed(1);
      const ret = next.T_return.toFixed(1);
      const dT = (next.T_supply - next.T_return).toFixed(1);
      const flow = next.flow_gpm.toFixed(0);
      const drivers = incomingActuatorRoles.length > 0
        ? ` · drivers: ${Array.from(new Set(incomingActuatorRoles)).join(', ')}`
        : ' · no actuators wired';
      const loadPct = Math.round(loadCommand * 100);
      const loadTag = detectedLoad > 0
        ? ` · load ${loadPct}% (coils)`
        : (loadCommand > 0 ? ` · load ${loadPct}% (idle)` : '');
      // OA lockout: when active, the plant won't fire regardless of
      // command. Surface this state up-front so the user can see WHY
      // their boiler isn't running in July.
      const loopKind = isHotPlant ? 'hot-water' as const
        : isCoolPlant ? 'chilled-water' as const
        : 'condenser-water' as const;
      const lockout = computeOaLockout(loopKind, oat);
      const lockoutTag = lockout?.active
        ? ` · ⚠ LOCKOUT (OAT ${oat.toFixed(0)}°F ${lockout.direction} ${lockout.threshold}°F)`
        : '';
      const prefix = isHotPlant ? 'HWS/HWR' : isCoolPlant ? 'CHWS/CHWR' : 'CWS/CWR';
      physicsValueByNode.set(node.id, {
        value: `${prefix} ${supply}/${ret}°F · ΔT ${dT}°F · ${flow} GPM${lockoutTag}${loadTag}${drivers}`,
        status: 'responded',
      });
    }

    // ── Zone (room) thermal dynamics ─────────────────────────────────
    // Each zone node on the canvas runs its own envelope + load model
    // and (B.3) receives conditioned air heat from any equipment wired
    // into it. Coupling chain:
    //   Zone ← Equipment ← Actuator ← Controller
    // The actuator's role binding (e.g., reheat-valve) determines whether
    // its command produces heating or cooling on the served zone.
    const zoneStateUpdates = new Map<string, ZoneState>();
    // OAT for standalone nodes (AHU/zone) that aren't physics-wired targets.
    // The weather drive only writes into runningSnapshot targets' config, so
    // without this an AHU on an otherwise-empty canvas was stuck at the 60°F
    // fallback and ignored the Weather drive. Prefer the live weather OAT when
    // the drive is active, then any physics target's OAT, then 60°F.
    const weatherOat =
      weatherStore.mode !== 'off' && weatherStore.status === 'ready'
        ? (currentWeatherSample()?.T_F ?? null)
        : null;
    const oatForZones =
      manualOat ??
      weatherOat ??
      (runningSnapshot[0] ? (sampleByCtrl.get(runningSnapshot[0].controllerId)?.T_OA ?? 60) : 60);
    const simHourForZones = ((simStartHour * 3600 + simSecondsElapsed) / 3600) % 24;

    // Build current zone-temp map for neighbor heat-exchange calc.
    const zoneTempByNode = new Map<string, number>();
    for (const node of nodes) {
      if (nodeKind(node) !== 'zone') continue;
      const zData = node.data as { zoneState?: ZoneState };
      zoneTempByNode.set(node.id, zData.zoneState?.T_zone ?? oatForZones);
    }

    // Find the warmest HW supply + coldest CHW supply from any plant on
    // canvas. Coils derate based on these — a boiler at 80°F can't
    // deliver design heating capacity. Default 180/44 when no plant
    // exists (treats coil as standalone for the demo).
    let hwSupplyTemp = 180;
    let chwSupplyTemp = 44;
    for (const node of nodes) {
      if (nodeKind(node) !== 'equipment') continue;
      const eqId = (node.data as { equipmentModelId?: string }).equipmentModelId;
      const eqModel = eqId ? findEquipmentModel(eqId) : undefined;
      if (!eqModel) continue;
      const lst = (node.data as { loopState?: { T_supply: number } }).loopState;
      if (!lst) continue;
      if (eqModel.kind === 'boiler') hwSupplyTemp = lst.T_supply;
      if (eqModel.kind === 'chiller') chwSupplyTemp = lst.T_supply;
    }
    // Capacity scaling: at full HWS (180°F) heating delivers 100%;
    // at 70°F (no plant heat above room temp) it delivers 0%.
    const hwCapacityScale = Math.max(0, Math.min(1, (hwSupplyTemp - 70) / 110));
    const chwCapacityScale = Math.max(0, Math.min(1, (70 - chwSupplyTemp) / 26));

    // Helper: compute coil heat delivered to a zone, summed across all
    // equipment wired to it. Returns positive BTU/hr for net heating,
    // negative for net cooling.
    function computeCoilHeatForZone(zoneNode: Node): { btu: number; sources: string[] } {
      let totalBtu = 0;
      const sources: string[] = [];
      for (const eqEdge of edges) {
        // equipment → zone edge (eqEdge.target = zone)
        if (eqEdge.target !== zoneNode.id) continue;
        const eq = nodes.find((n) => n.id === eqEdge.source);
        if (!eq || nodeKind(eq) !== 'equipment') continue;

        // Walk actuator → equipment edges. Sum heating and cooling
        // valve commands by binding role.
        let heatingCmd = 0;
        let coolingCmd = 0;
        for (const aEdge of edges) {
          if (aEdge.target !== eq.id) continue;
          const act = nodes.find((n) => n.id === aEdge.source);
          if (!act || nodeKind(act) !== 'actuator') continue;
          const actState = (act.data as { actuatorState?: { actual: number } })?.actuatorState;
          if (!actState) continue;
          // Find the upstream controller → actuator edge to read its role.
          const cEdge = edges.find((e) => e.target === act.id);
          if (!cEdge) continue;
          const ctrlProg = programStore.byId[cEdge.source];
          const binding = cEdge.sourceHandle
            ? ctrlProg?.bindings?.bindings.find((b) => b.terminalId === cEdge.sourceHandle)
            : undefined;
          const role = binding?.role;
          if (role === 'reheat-valve' || role === 'heating-valve-actuator') {
            heatingCmd = Math.max(heatingCmd, actState.actual);
          } else if (role === 'cooling-valve' || role === 'cooling-valve-actuator') {
            coolingCmd = Math.max(coolingCmd, actState.actual);
          }
        }

        // Convert to BTU/hr. Typical small VAV reheat coil ~12 MBH design;
        // typical AHU/FCU cooling coil ~12 MBH per zone served.
        const heating_btu = heatingCmd * 12000 * hwCapacityScale;
        const cooling_btu = -coolingCmd * 12000 * chwCapacityScale;
        totalBtu += heating_btu + cooling_btu;

        const label = (eq.data as { label?: string }).label ?? eq.id;
        if (heatingCmd > 0.02) sources.push(`${label} heating ${Math.round(heatingCmd * 100)}%`);
        if (coolingCmd > 0.02) sources.push(`${label} cooling ${Math.round(coolingCmd * 100)}%`);
      }
      return { btu: totalBtu, sources };
    }

    // Default partition wall: ~9' tall × 12' shared = ~108 sqft, gyp+
    // stud U-value 0.3 BTU/hr·ft²·°F. Heat flows from warmer to cooler
    // each tick — that's how a server room cooks the adjacent conf room.
    const WALL_U = 0.3;
    const WALL_AREA = 108;

    for (const node of nodes) {
      if (nodeKind(node) !== 'zone') continue;
      const zData = node.data as {
        zoneState?: ZoneState;
        zoneConfig?: Partial<typeof DEFAULT_ZONE_CONFIG>;
      };
      // Per-zone config — overrides default field-by-field so the
      // inspector can edit just peak_occupants without touching volume.
      const zoneConfig = { ...DEFAULT_ZONE_CONFIG, ...(zData.zoneConfig ?? {}) };
      // A scenario-pinned start temp (T_zone_init) wins over the ambient
      // fallback — the G36 demos' "cold start 62°F" / "zone at 76°F"
      // premises depend on it.
      const zoneInitT = (zData.zoneConfig as { T_zone_init?: number } | undefined)?.T_zone_init;
      const prev = zData.zoneState ?? initZoneState(zoneConfig, zoneInitT ?? oatForZones);

      // Sum heat from neighboring zones via shared-wall edges (zone↔zone).
      // ΔT is clamped so a temporarily-explosive neighbor temp can't
      // propagate the instability — walls in real buildings can only
      // carry so much heat per square foot before the surface temp itself
      // limits the gradient.
      let neighborHeat_btu = 0;
      const neighborTags: string[] = [];
      for (const edge of edges) {
        const otherId = edge.source === node.id ? edge.target
          : edge.target === node.id ? edge.source
          : null;
        if (!otherId) continue;
        const otherTemp = zoneTempByNode.get(otherId);
        if (otherTemp === undefined) continue;
        const dT = Math.max(-40, Math.min(40, otherTemp - prev.T_zone));
        const q = WALL_U * WALL_AREA * dT;
        neighborHeat_btu += q;
        const otherNode = nodes.find((n) => n.id === otherId);
        if (otherNode) {
          neighborTags.push((otherNode.data as { label?: string }).label ?? otherId);
        }
      }

      // Sum coil heat from equipment wired to this zone (B.3 main event).
      const coil = computeCoilHeatForZone(node);

      const totalSupplyHeat = neighborHeat_btu + coil.btu;
      const next = stepZone(prev, zoneConfig, {
        outsideTemp: oatForZones,
        hour: simHourForZones,
        occupancy_frac: defaultOccupancySchedule(simHourForZones),
        supplyAir_btu_per_hr: totalSupplyHeat,
      }, dtSeconds);
      zoneStateUpdates.set(node.id, next);

      const occPct = Math.round(defaultOccupancySchedule(simHourForZones) * 100);
      const neighborTag = neighborTags.length > 0
        ? ` · neighbors: ${neighborTags.join(', ')} (${neighborHeat_btu >= 0 ? '+' : ''}${neighborHeat_btu.toFixed(0)})`
        : '';
      const coilTag = coil.sources.length > 0
        ? ` · ${coil.sources.join(', ')} (${coil.btu >= 0 ? '+' : ''}${coil.btu.toFixed(0)} BTU/hr)`
        : '';
      physicsValueByNode.set(node.id, {
        value: `${next.T_zone.toFixed(1)}°F · OAT ${oatForZones.toFixed(0)}°F · occ ${occPct}%${coilTag}${neighborTag}`,
        status: 'responded',
      });
    }

    // ── Virtual AHU (G36 §5.18) state machine ────────────────────────
    // Each canvas node of kind 'vahu' runs the full G36 §5.18 sequence
    // every tick. Inputs:
    //   OAT  — weather sim (or OAT from first running system)
    //   RAT  — zone temp of any Zone node wired to this AHU
    //   Occ  — simulated schedule (defaultOccupancySchedule)
    // Outputs: 15 BACnet objects (5 AI, 3 AV, 4 AO, 3 BV) available to
    // the BACnet/IP emission pass that follows in the MS/TP block.
    {
      vahuObjectsCache = new Map();  // refresh each tick
      const vahuStateNext = new Map<string, VAhuState>(vahuStates);
      for (const node of nodes) {
        if (nodeKind(node) !== 'vahu') continue;
        const vahuData = node.data as {
          label?: string;
          poweredOff?: boolean;
          vahuConfig?: Partial<VAhuConfig>;
        };
        if (vahuData.poweredOff) continue;
        const cfg: VAhuConfig = { ...DEFAULT_VAHU_CONFIG, ...(vahuData.vahuConfig ?? {}) };

        // OAT: prefer weather sim; fall back to first running system's T_OA.
        const oat = oatForZones;

        // Occupancy: derived from the same office-hours schedule zones use.
        const occupied = defaultOccupancySchedule(simHourForZones) > 0.5;

        // Zone (return air) temp: use the T_zone of any Zone node wired to
        // this AHU. Falls back to the configured setpoint — no zone wired
        // means the AHU runs against a "perfectly comfortable room".
        let zoneTemp = cfg.zoneSetpoint;
        for (const e of edges) {
          const otherId =
            e.source === node.id ? e.target
            : e.target === node.id ? e.source
            : null;
          if (!otherId) continue;
          const otherNode = nodes.find((n) => n.id === otherId);
          if (!otherNode || nodeKind(otherNode) !== 'zone') continue;
          const zst = (otherNode.data as { zoneState?: ZoneState } | undefined)?.zoneState;
          if (zst) { zoneTemp = zst.T_zone; break; }
        }

        // Terminal block (slice 4): run the signal bridge over this AHU's
        // wired terminals — sensors wired to AI-1 (OAT) / AI-4 (ZN-T)
        // OVERRIDE the synthetic sources, raw+scaled included, so a wrong
        // curve or an injected fault flows into the sequence exactly like
        // it would on a real packaged unit. Unwired terminals keep the
        // synthetic fallbacks (weather OAT, wired-Zone temp).
        runBridgePass(node.id, undefined, simHourForZones, 0, zoneTemp, oat);
        const vTerm = terminalScaledByCtrlThisTick.get(node.id);
        const oatEff = vTerm?.get('AI-1')?.value ?? oat;
        const znEff = vTerm?.get('AI-4')?.value ?? zoneTemp;

        const inputs: VAhuInputs = { oat: oatEff, rat: znEff, zoneTemp: znEff, occupied };
        const prev = vahuStates.get(node.id) ?? initVAhuState(0, cfg);
        const next = stepVAhu(prev, inputs, simSecondsElapsed, cfg);
        vahuStateNext.set(node.id, next);

        // Synthesize BACnet objects now; cache them for the COV pass.
        const objects = synthesizeVAhuObjects(next, cfg, inputs);
        vahuObjectsCache.set(node.id, objects);
        vahuPrevInputs.set(node.id, inputs);

        // Node card display.
        const modeDisp =
          next.mode === 'heating'    ? 'Heating'
          : next.mode === 'cooling'    ? 'Cooling'
          : next.mode === 'economizer' ? 'Economizer'
          : next.mode === 'unoccupied' ? 'Unoccupied'
          : 'Off';
        let actuatorStr = '';
        if (next.mode === 'heating')
          actuatorStr = ` · HV ${next.heatValvePct.toFixed(0)}% · Fan ${Math.round(next.fanSpeed * 100)}%`;
        else if (next.mode === 'cooling')
          actuatorStr = ` · CV ${next.coolValvePct.toFixed(0)}% · Fan ${Math.round(next.fanSpeed * 100)}%`;
        else if (next.mode === 'economizer')
          actuatorStr = ` · OAD ${next.oaDamperPct.toFixed(0)}% · Fan ${Math.round(next.fanSpeed * 100)}%`;
        physicsValueByNode.set(node.id, {
          value: `${modeDisp} · OAT ${oat.toFixed(0)}°F → DAT ${next.dat.toFixed(1)}°F${actuatorStr}`,
          status: 'responded',
        });
      }
      vahuStates = vahuStateNext;
    }

    // ── MS/TP token-passing simulation ───────────────────────────────
    // Group every MS/TP edge into trunks (connected components via the
    // shared MS/TP wireKind), assign each device a MAC, and advance
    // the token-holder index by dtSeconds. The result drives node-level
    // "I'm holding the token" highlights and per-trunk inspector panels.
    {
      // Group MS/TP edges into trunks + assign MACs deterministically via
      // the shared core helper. The same call backs the `nodeAddressing`
      // derived below, so the canvas node badge, inspector, and packet log
      // all read ONE address map and can never drift.
      const mstpAddressing = computeMstpAddressing();
      const nextStates = new Map<string, MstpTrunkState>();
      const nextPollSchedule = new Map<string, { nextSimSec: number; nextChildIdx: number }>();
      // Each trunk's devices are already MAC-sorted (token-ring order);
      // `trunkEdgeId` is the representative edge id we tag packets with.
      for (const { trunkKey: trunkEdgeId, baud, devices } of mstpAddressing.trunks) {
        const prev = mstpTrunkStates.get(trunkEdgeId);
        const seed = prev && prev.devices.length === devices.length
          ? prev
          : initMstpTrunkState(devices, baud);
        // If membership changed (different node ids), re-init.
        const sameMembers = prev && prev.devices.every((d, i) => d.nodeId === devices[i]?.nodeId);
        const start = sameMembers ? seed : initMstpTrunkState(devices, baud);
        const stepped = stepMstpToken(start, dtSeconds);
        nextStates.set(trunkEdgeId, stepped);

        const trunkLabelStr = devices.length > 0
          ? `${devices[0].label} → ${devices[devices.length - 1].label} @ ${baud}`
          : `trunk @ ${baud}`;
        // Latency for paired packets on this trunk — every ACK is shifted
        // by this much from the matching request. At 38400 that's ~66ms;
        // at 9600 it's ~112ms; on BACnet/IP segments the bus type drives
        // a flat ~15ms. The packet log's fractional-second formatter
        // surfaces the gap so the user can SEE that slower baud = slower
        // bus, the way a real sniffer would show it.
        const trunkLatencyS = mstpServiceLatencySeconds(baud);

        // ── Trunk-up / membership-change discovery: when the trunk is
        // fresh (no prior state) OR the device list changed, emit the
        // bootup discovery sequence — Who-Is broadcast from the
        // supervisor (or, if no supervisor present, from the lowest MAC)
        // followed by an I-Am from every other device carrying its
        // Device Instance. This is what a tech sees on the bus the
        // moment they power up a new FEC or plug into a fresh trunk.
        if (!sameMembers && devices.length > 0) {
          const initiator = devices.find((d) => d.mac === 0) ?? devices[0];
          logBacnetPacket({
            simSec: simSecondsElapsed,
            trunkId: trunkEdgeId,
            trunkLabel: trunkLabelStr,
            srcMac: initiator.mac,
            // Broadcast — no specific dst.
            dstMac: undefined,
            service: 'Who-Is',
            // BVLC function 0x0b = Original-Broadcast-NPDU. Real BACnet
            // wire trace shows this byte distinguishing local-broadcast
            // (0x0b) from unicast (0x0a) from BBMD-forwarded (0x04).
            summary: `${initiator.label} (MAC ${initiator.mac}) Who-Is broadcast (discover devices on this trunk) · BVLC fn 0x0b Original-Broadcast-NPDU`,
            layer: 'app',
          });
          // I-Am responses are STAGGERED on a real bus — each device
          // replies when it gets the token, so they cascade out over a
          // few hundred ms rather than landing simultaneously. Index-
          // based offset captures the staircase pattern.
          let iAmOffsetS = trunkLatencyS;
          const iAmStaggerS = Math.max(trunkLatencyS * 0.4, 0.02);
          for (const d of devices) {
            if (d.nodeId === initiator.nodeId) continue;
            const inst = d.deviceInstance ?? defaultDeviceInstance(d.mac);
            // Carry the four fields ASHRAE 135 §16.10.2 requires:
            // Device Instance, Max APDU Length Accepted, Segmentation
            // Supported, Vendor ID. The sandbox synthesizes plausible
            // defaults: 1024 max APDU (matches a small JCI / Tridium
            // FEC), segmentedBoth (most modern devices), and a vendor
            // id pulled from the device's known vendor model when
            // available, else a generic 260 (Reliable Controls — used
            // here as the "unspecified" sentinel).
            const node = nodes.find((n) => n.id === d.nodeId);
            const vendorModelId = (node?.data as { vendorModelId?: string } | undefined)
              ?.vendorModelId;
            const vendorId = vendorIdFor(vendorModelId);
            const maxApdu = 1024;
            // ASHRAE 135 segmentation-supported enum uses kebab-case on
            // the wire: "segmented-both", "segmented-transmit",
            // "segmented-receive", "no-segmentation". Verified against
            // bacpypes3's I-Am output (segmented-both). Was camelCase
            // here previously which is a sandbox-internal stylistic
            // choice — switched to match the spec.
            // Single source of truth for I-Am wire format lives in
            // @bas/core/bacnet/emit (verified against bacpypes3 in
            // tools/bacnet-reference/bbmd-lab/BBMD_LAB.md). Calling
            // the pure builder here means the UI, the experiment
            // catalog, and the future BACnet bridge all share one
            // string format — no drift.
            const iAmPacket = emitIAm({
              simSec: simSecondsElapsed + iAmOffsetS,
              trunkId: trunkEdgeId,
              srcMac: d.mac,
              srcLabel: d.label,
              dstMac: initiator.mac,
              deviceInstance: inst,
              maxApdu,
              vendorId,
            });
            logBacnetPacket({ ...iAmPacket, trunkLabel: trunkLabelStr });
            iAmOffsetS += iAmStaggerS;
          }
          // After discovery, the supervisor subscribes to each child's
          // representative point set (primary AI, live AV/AO, first
          // binary) — one SubscribeCOV + ACK per point, the way a real
          // supervisor subscribes to every mapped point.
          for (const d of devices) {
            if (d.nodeId === initiator.nodeId) continue;
            const childNode = nodes.find((n) => n.id === d.nodeId);
            const vendorModelId = (childNode?.data as { vendorModelId?: string } | undefined)?.vendorModelId;
            const childProg = programStore.byId[d.nodeId];
            const aiSeed = defaultAiSeed(d.nodeId);
            const childObjects = synthesizeBacnetObjects({
              vendorModelId,
              bindings: childProg?.bindings,
              defaultAiValues: aiSeed.values,
              defaultAiUnits: aiSeed.units,
              defaultAi1Name: aiSeed.name,
              envInputs: controllerBridge.envInputsByCtrl.get(d.nodeId),
              envOutputs: controllerBridge.envOutputsByCtrl.get(d.nodeId),
              terminalFaults: terminalFaultsFor(d.nodeId),
            });
            const subObjs = pickCovSubscriptionSet(childObjects);
            let subOffsetS = 0;
            for (const subObj of subObjs) {
              const db = covDeadbandFor(subObj);
              const trigger = subObj.type.startsWith('binary')
                ? 'on change'
                : `deadband ${db}${subObj.units === '%' ? '%' : '°F'}`;
              // Subscribe-COV request. Pairs stagger slightly so the log
              // reads as a burst of distinct exchanges, not one instant.
              logBacnetPacket({
                simSec: simSecondsElapsed + subOffsetS,
                trunkId: trunkEdgeId,
                trunkLabel: trunkLabelStr,
                srcMac: initiator.mac,
                dstMac: d.mac,
                service: 'SubscribeCOV',
                objectId: subObj.id,
                summary: `${initiator.label} → ${d.label}: SubscribeCOV ${subObj.id} '${subObj.name}' (${trigger}, lifetime ${COV_LIFETIME_DEFAULT_S}s)`,
                layer: 'app',
              });
              // ACK from the controller — confirms it'll start pushing.
              // Delayed by one round-trip from the matching request.
              logBacnetPacket({
                simSec: simSecondsElapsed + subOffsetS + trunkLatencyS,
                trunkId: trunkEdgeId,
                trunkLabel: trunkLabelStr,
                srcMac: d.mac,
                dstMac: initiator.mac,
                service: 'SubscribeCOV-ACK',
                objectId: subObj.id,
                summary: `${d.label} → ${initiator.label}: SubscribeCOV-ACK ${subObj.id} accepted`,
                layer: 'app',
              });
              // Seed the subscription with the current value so the next
              // tick doesn't fire a spurious notification. The subscriber
              // still learns the starting value on the wire: every
              // (re)subscribe schedules an initial notification 0.2–7 s
              // out (G47, lab3 ground truth).
              const subKey = `${trunkEdgeId}|${d.nodeId}|${subObj.id}`;
              covSubscriptions.set(subKey, {
                trunkId: trunkEdgeId,
                trunkLabel: trunkLabelStr,
                childNodeId: d.nodeId,
                childLabel: d.label,
                childMac: d.mac,
                supNodeId: initiator.nodeId,
                supLabel: initiator.label,
                supMac: initiator.mac,
                ackLatencyS: trunkLatencyS,
                objectId: subObj.id,
                deadband: db,
                deadbandUnits: subObj.units === '%' ? '%' : '°F',
                subscribedAtSimSec: simSecondsElapsed,
                lifetimeSeconds: COV_LIFETIME_DEFAULT_S,
                renewals: 0,
                initialNotifyAtSimSec:
                  simSecondsElapsed + subOffsetS + trunkLatencyS + covScanDelay(subKey, 0),
                nextScanAtSimSec: simSecondsElapsed + covScanDelay(`${subKey}|scan`, 0),
                scans: 0,
                lastReportedValue: subObj.presentValue,
              });
              subOffsetS += trunkLatencyS * 2;
            }
          }
        }

        // ── Emit Token-Pass packets for each hop the token made this tick.
        // Hop count = rotationsDelta * N + (newIdx - oldIdx). At very fast
        // sim speeds we cap emission to MAX_TOKEN_HOPS_PER_TICK_PER_TRUNK
        // and append a single "+K more" summary packet — keeps the log
        // useful at 1× while not exploding at 300×.
        const N = stepped.devices.length;
        if (N > 1 && sameMembers) {
          const rotationsDelta = stepped.rotations - start.rotations;
          const hopCount = rotationsDelta * N + (stepped.tokenIndex - start.tokenIndex);
          const trunkLabel = trunkLabelStr;
          const emit = Math.min(hopCount, MAX_TOKEN_HOPS_PER_TICK_PER_TRUNK);
          for (let i = 0; i < emit; i++) {
            const srcIdx = (start.tokenIndex + i) % N;
            const dstIdx = (start.tokenIndex + i + 1) % N;
            const src = devices[srcIdx];
            const dst = devices[dstIdx];
            logBacnetPacket({
              simSec: simSecondsElapsed,
              trunkId: trunkEdgeId,
              trunkLabel,
              srcMac: src.mac,
              dstMac: dst.mac,
              service: 'Token-Pass',
              summary: `${src.label} (MAC ${src.mac}) → ${dst.label} (MAC ${dst.mac})`,
              layer: 'link',
            });
          }
          if (hopCount > emit) {
            logBacnetPacket({
              simSec: simSecondsElapsed,
              trunkId: trunkEdgeId,
              trunkLabel,
              srcMac: 0,
              service: 'Token-Pass',
              summary: `+${hopCount - emit} more token hops compressed (sim ${simSpeed}×)`,
              layer: 'link',
            });
          }
        }

        // ── BACnet app-layer poll: supervisor (MAC 0) issues a ReadProperty
        // on a child controller's first AI object every APP_LAYER_POLL_CADENCE_S.
        // Round-robins through the children so each one sees attention.
        const supervisor = devices.find((d) => d.mac === 0);
        const children = devices.filter((d) => d.mac !== 0);
        if (supervisor && children.length > 0) {
          const prevSched = bacnetPollSchedule.get(trunkEdgeId) ?? {
            nextSimSec: simSecondsElapsed + APP_LAYER_POLL_CADENCE_S,
            nextChildIdx: 0,
          };
          let { nextSimSec, nextChildIdx } = prevSched;
          // Fire as many polls as fit in this tick — at fast sim speeds
          // we might emit a couple at once, but cap at 3 per tick to keep
          // the buffer breathable.
          let firedThisTick = 0;
          while (simSecondsElapsed >= nextSimSec && firedThisTick < 3) {
            const child = children[nextChildIdx % children.length];
            // Synthesize the child's BACnet objects so we can name a real
            // AI to read. With Sensor.1 in place, unprogrammed children fall
            // back to the wired sensor's reading (T_sensed) for AI:1 — the
            // packet log now shows real zone temps instead of 0.
            const childNode = nodes.find((n) => n.id === child.nodeId);
            const vendorModelId = (childNode?.data as { vendorModelId?: string } | undefined)?.vendorModelId;
            const childProg = programStore.byId[child.nodeId];
            const aiSeed = defaultAiSeed(child.nodeId);
            const childObjects = synthesizeBacnetObjects({
              vendorModelId,
              bindings: childProg?.bindings,
              defaultAiValues: aiSeed.values,
              defaultAiUnits: aiSeed.units,
              defaultAi1Name: aiSeed.name,
              envInputs: controllerBridge.envInputsByCtrl.get(child.nodeId),
              envOutputs: controllerBridge.envOutputsByCtrl.get(child.nodeId),
              terminalFaults: terminalFaultsFor(child.nodeId),
            });
            const targetObj = childObjects.find((o) => o.type === 'analog-input') ?? childObjects[0];
            const objectId = targetObj?.id ?? 'AI:1';
            const value = targetObj
              ? (typeof targetObj.presentValue === 'boolean'
                  ? (targetObj.presentValue ? 1 : 0)
                  : targetObj.presentValue)
              : 0;
            const trunkLabel = trunkLabelStr;
            // Always emit the request — supervisor doesn't know the
            // child is gone until the timeout expires.
            // ReadProperty IS a confirmed service per ASHRAE 135 §15.5
            // so it carries an invoke ID. We also surface the BACnet
            // property identifier ("present-value (85)") since that's
            // what every wire trace shows. Right now the sandbox only
            // ever reads presentValue; if we extend to status-flags
            // / units / etc. this needs a per-property mapping.
            const invokeId = bumpInvokeId();
            logBacnetPacket({
              simSec: simSecondsElapsed,
              trunkId: trunkEdgeId,
              trunkLabel,
              srcMac: 0,
              dstMac: child.mac,
              service: 'ReadProperty',
              objectId,
              summary: `MAC 0 → ${child.label}: ReadProperty ${objectId} present-value (85) · invokeId ${invokeId} · NPDU Expecting-Reply`,
              layer: 'app',
            });
            const failKey = `${trunkEdgeId}|${child.nodeId}`;
            if (offline.has(child.nodeId)) {
              // No ACK comes back. After APDU_TIMEOUT_S, supervisor
              // emits a Timeout marker. Track consecutive fails.
              const fail = failingChildren.get(failKey) ?? {
                trunkId: trunkEdgeId,
                childNodeId: child.nodeId,
                childLabel: child.label,
                childMac: child.mac,
                consecutiveFails: 0,
                reportedLost: false,
              };
              fail.consecutiveFails += 1;
              const attempt = fail.consecutiveFails;
              logBacnetPacket({
                simSec: simSecondsElapsed + APDU_TIMEOUT_S,
                trunkId: trunkEdgeId,
                trunkLabel,
                srcMac: 0,
                dstMac: child.mac,
                service: 'Timeout',
                objectId,
                summary: `MAC 0 ✗ ${child.label}: no response to invokeId ${invokeId} (attempt ${attempt}/${COMM_LOST_RETRY_THRESHOLD})`,
                layer: 'app',
              });
              if (attempt >= COMM_LOST_RETRY_THRESHOLD && !fail.reportedLost) {
                fail.reportedLost = true;
                logBacnetPacket({
                  simSec: simSecondsElapsed + APDU_TIMEOUT_S + 0.001,
                  trunkId: trunkEdgeId,
                  trunkLabel,
                  srcMac: 0,
                  dstMac: child.mac,
                  service: 'CommunicationLost',
                  summary: `${child.label} (MAC ${child.mac}) declared COMM-LOST after ${COMM_LOST_RETRY_THRESHOLD} failed attempts`,
                  layer: 'app',
                });
                logEvent(simSecondsElapsed + APDU_TIMEOUT_S, 'error', 'bacnet', `${child.label}: communication lost after ${COMM_LOST_RETRY_THRESHOLD} failed polls — check trunk continuity, MAC config, power.`);
              }
              failingChildren.set(failKey, fail);
            } else {
              // Healthy round-trip — emit the ACK and clear any prior
              // failure state.
              logBacnetPacket({
                simSec: simSecondsElapsed + trunkLatencyS,
                trunkId: trunkEdgeId,
                trunkLabel,
                srcMac: child.mac,
                dstMac: 0,
                service: 'ReadProperty-ACK',
                objectId,
                value,
                // Echo the request's invoke ID (that's how the supervisor
                // pairs ACK to request). APDU type = Complex-ACK (3).
                // Value carried inside opening/closing context-tag 3
                // per ASHRAE 135 §15.5.1.
                summary: `${child.label} → MAC 0: ReadProperty-ACK ${objectId} present-value = ${typeof value === 'number' ? value.toFixed(2) : String(value)} · invokeId ${invokeId}`,
                layer: 'app',
              });
              const fail = failingChildren.get(failKey);
              if (fail && fail.reportedLost) {
                // Child came back. Announce + clear.
                logBacnetPacket({
                  simSec: simSecondsElapsed + trunkLatencyS + 0.001,
                  trunkId: trunkEdgeId,
                  trunkLabel,
                  srcMac: child.mac,
                  dstMac: 0,
                  service: 'CommunicationRestored',
                  summary: `${child.label} (MAC ${child.mac}) back online — ${fail.consecutiveFails} attempt${fail.consecutiveFails === 1 ? '' : 's'} failed before restoration`,
                  layer: 'app',
                });
                logEvent(simSecondsElapsed, 'info', 'bacnet', `${child.label}: communication restored.`);
              }
              if (fail) failingChildren.delete(failKey);
            }
            nextChildIdx = (nextChildIdx + 1) % children.length;
            nextSimSec += APP_LAYER_POLL_CADENCE_S;
            firedThisTick += 1;
          }
          // If we still owe polls but ran out of budget, snap forward so we
          // don't accumulate debt that explodes the buffer later.
          if (simSecondsElapsed >= nextSimSec) {
            nextSimSec = simSecondsElapsed + APP_LAYER_POLL_CADENCE_S;
          }
          nextPollSchedule.set(trunkEdgeId, { nextSimSec, nextChildIdx });
        }
      }
      mstpTrunkStates = nextStates;
      bacnetPollSchedule = nextPollSchedule;
      // Mirror the trunk-state map into the inspector store so the modal
      // can re-render against live values without reaching back into
      // BuildCanvas. Cheap — both maps share the same MstpTrunkState objs.
      publishTrunkStates(nextStates);

      // ── BACnet/IP + host-internal pair traffic ──────────────────────
      // Until this block existed, COV + ReadProperty traffic only fired
      // on MS/TP trunks — meaning every IP-only demo (campus, mixed-
      // vendor, midrise with hosted vVAVs) sat silent on the wire log.
      // Now we sweep every supervisor's IP-edge controllers AND its
      // hosted virtual controllers, doing the same Subscribe-Once /
      // Poll-Periodically dance the MS/TP path does. Output packets
      // carry BVLC fn 0x0a Original-Unicast-NPDU so a sniffer sees
      // proper IP framing.
      type IpChild = {
        readonly nodeId: string;
        readonly label: string;
        /** Sentinel "trunk" id so the COV-emit pass can group + the
         *  packet log can filter. ip-edge:<edgeId> for wired pairs,
         *  ip-host:<supId> for hosted virtual controllers. */
        readonly trunkId: string;
        readonly trunkLabel: string;
      };
      for (const sup of nodes) {
        const supKind = (sup.data as { kind?: string } | undefined)?.kind;
        if (supKind !== 'supervisor') continue;
        if (offline.has(sup.id)) continue;
        const supLabel = (sup.data as { label?: string } | undefined)?.label ?? sup.id;

        const ipChildren: IpChild[] = [];
        // 1. Explicit BACnet/IP edges to a controller.
        for (const e of edges) {
          const touches = e.source === sup.id || e.target === sup.id;
          if (!touches) continue;
          const wireKind = (e.data as { wireKind?: string } | undefined)?.wireKind;
          if (wireKind !== 'bacnet-ip') continue;
          const otherId = e.source === sup.id ? e.target : e.source;
          const other = nodes.find((n) => n.id === otherId);
          if (!other) continue;
          const otherKind = (other.data as { kind?: string } | undefined)?.kind;
          // Only chase controller children. Supervisor↔supervisor IP
          // links exist (inter-engine inter-AS read/write) but the sandbox
          // doesn't model the upper supervisor as a "child" today.
          if (otherKind !== 'controller') continue;
          if (offline.has(other.id)) continue;
          ipChildren.push({
            nodeId: other.id,
            label: (other.data as { label?: string } | undefined)?.label ?? other.id,
            trunkId: `ip-edge:${e.id}`,
            trunkLabel: `BACnet/IP · ${supLabel} ↔ ${(other.data as { label?: string } | undefined)?.label ?? 'child'}`,
          });
        }
        // 2. Hosted virtual controllers (data.hostId points to this sup).
        for (const n of nodes) {
          const d = n.data as { kind?: string; hostId?: string; label?: string } | undefined;
          if (d?.kind !== 'virtual-controller') continue;
          if (d.hostId !== sup.id) continue;
          if (offline.has(n.id)) continue;
          ipChildren.push({
            nodeId: n.id,
            label: d.label ?? n.id,
            trunkId: `ip-host:${sup.id}`,
            trunkLabel: `${supLabel} · host-internal`,
          });
        }
        // 3. Virtual AHU (G36 §5.18) nodes wired via BACnet/IP to this supervisor.
        for (const e of edges) {
          const touches = e.source === sup.id || e.target === sup.id;
          if (!touches) continue;
          const wireKind2 = (e.data as { wireKind?: string } | undefined)?.wireKind;
          if (wireKind2 !== 'bacnet-ip') continue;
          const otherId2 = e.source === sup.id ? e.target : e.source;
          const other2 = nodes.find((n) => n.id === otherId2);
          if (!other2 || nodeKind(other2) !== 'vahu') continue;
          if (offline.has(other2.id)) continue;
          const vahuLabel2 = (other2.data as { label?: string } | undefined)?.label ?? 'AHU';
          ipChildren.push({
            nodeId: other2.id,
            label: vahuLabel2,
            trunkId: `ip-edge:${e.id}`,
            trunkLabel: `BACnet/IP · ${supLabel} ↔ ${vahuLabel2}`,
          });
        }
        if (ipChildren.length === 0) continue;

        for (const child of ipChildren) {
          const pairKey = `${sup.id}|${child.nodeId}`;
          // Resolve the child's BACnet objects. For vAHU nodes use the
          // pre-synthesized cache from the vAHU dynamics step; for all
          // other node types fall back to synthesizeBacnetObjects().
          const childNode = nodes.find((n) => n.id === child.nodeId);
          if (!childNode) continue;
          let childObjects: import('@bas/core').BacnetObject[];
          if (nodeKind(childNode) === 'vahu') {
            childObjects = vahuObjectsCache.get(child.nodeId) ?? [];
          } else {
            const vendorModelId = (childNode.data as { vendorModelId?: string } | undefined)?.vendorModelId;
            const childProg = programStore.byId[child.nodeId];
            const aiSeed = defaultAiSeed(child.nodeId);
            childObjects = synthesizeBacnetObjects({
              vendorModelId,
              bindings: childProg?.bindings,
              defaultAiValues: aiSeed.values,
              defaultAiUnits: aiSeed.units,
              defaultAi1Name: aiSeed.name,
              envInputs: controllerBridge.envInputsByCtrl.get(child.nodeId),
              envOutputs: controllerBridge.envOutputsByCtrl.get(child.nodeId),
              terminalFaults: terminalFaultsFor(child.nodeId),
            });
          }
          const aiObj = childObjects.find((o) => o.type === 'analog-input');
          if (!aiObj) continue;

          // ── One-time pair announcement: SubscribeCOV + ACK per
          // point in the representative set ────────────────────────
          if (!announcedIpPairs.has(pairKey)) {
            announcedIpPairs.add(pairKey);
            const ipSubObjs = pickCovSubscriptionSet(childObjects);
            let ipSubOffsetS = 0;
            for (const subObj of ipSubObjs) {
              const db = covDeadbandFor(subObj);
              const subReq = emitSubscribeCov({
                simSec: simSecondsElapsed + ipSubOffsetS,
                trunkId: child.trunkId,
                srcLabel: supLabel,
                dstLabel: child.label,
                objectId: subObj.id,
                deadband: db,
                deadbandUnits: subObj.units === '%' ? '%' : '°F',
                lifetimeSeconds: COV_LIFETIME_DEFAULT_S,
              });
              logBacnetPacket({ ...subReq, trunkLabel: child.trunkLabel });
              const subAck = emitSubscribeCovAck({
                simSec: simSecondsElapsed + ipSubOffsetS + BACNET_IP_RTT_SECONDS,
                trunkId: child.trunkId,
                srcLabel: child.label,
                dstLabel: supLabel,
                objectId: subObj.id,
              });
              logBacnetPacket({ ...subAck, trunkLabel: child.trunkLabel });
              const ipSubKey = `${child.trunkId}|${child.nodeId}|${subObj.id}`;
              covSubscriptions.set(ipSubKey, {
                trunkId: child.trunkId,
                trunkLabel: child.trunkLabel,
                childNodeId: child.nodeId,
                childLabel: child.label,
                // IP doesn't use MS/TP MACs. Use 0 for the supervisor /
                // 1 for the child as a display sentinel; the conformance
                // checker doesn't rely on MAC for COV packets.
                childMac: 1,
                supNodeId: sup.id,
                supLabel,
                supMac: 0,
                ackLatencyS: BACNET_IP_RTT_SECONDS,
                objectId: subObj.id,
                deadband: db,
                deadbandUnits: subObj.units === '%' ? '%' : '°F',
                subscribedAtSimSec: simSecondsElapsed,
                lifetimeSeconds: COV_LIFETIME_DEFAULT_S,
                renewals: 0,
                initialNotifyAtSimSec:
                  simSecondsElapsed + ipSubOffsetS + BACNET_IP_RTT_SECONDS + covScanDelay(ipSubKey, 0),
                nextScanAtSimSec: simSecondsElapsed + covScanDelay(`${ipSubKey}|scan`, 0),
                scans: 0,
                lastReportedValue: subObj.presentValue,
              });
              ipSubOffsetS += BACNET_IP_RTT_SECONDS * 2;
            }
          }

          // ── Periodic ReadProperty poll ──────────────────────────
          const sched = ipPollSchedule.get(pairKey) ?? {
            nextSimSec: simSecondsElapsed + APP_LAYER_POLL_CADENCE_S,
          };
          if (simSecondsElapsed >= sched.nextSimSec) {
            const invokeId = bumpInvokeId();
            const req = emitReadProperty({
              simSec: simSecondsElapsed,
              trunkId: child.trunkId,
              srcLabel: supLabel,
              dstLabel: child.label,
              objectId: aiObj.id,
              propertyName: 'present-value',
              propertyId: 85,
              invokeId,
            });
            logBacnetPacket({ ...req, trunkLabel: child.trunkLabel });
            const value = typeof aiObj.presentValue === 'boolean'
              ? (aiObj.presentValue ? 1 : 0)
              : aiObj.presentValue;
            const ack = emitReadPropertyAck({
              simSec: simSecondsElapsed + BACNET_IP_RTT_SECONDS,
              trunkId: child.trunkId,
              srcLabel: child.label,
              dstLabel: supLabel,
              objectId: aiObj.id,
              propertyName: 'present-value',
              invokeId,
              value,
              // Fault propagation: when the wire is open / shorted /
              // out-of-range, the controller answers ReadProperty with
              // the matching reliability code + FAULT bit set. Real
              // supervisors alarm on this; the packet log surfaces the
              // teaching moment.
              reliability: aiObj.reliability,
              statusFlags: aiObj.statusFlags,
            });
            logBacnetPacket({ ...ack, trunkLabel: child.trunkLabel });
            sched.nextSimSec = simSecondsElapsed + APP_LAYER_POLL_CADENCE_S;
          }
          ipPollSchedule.set(pairKey, sched);
        }
      }

      // ── BACnet/IP broadcast management: BBMD bridge + foreign device ──
      // The Annex-J dance that lets broadcasts cross IP subnets. Fires
      // once per network bootup (announcedBbmdFlows dedup):
      //   1. A foreign device (non-BBMD wired to a BBMD on a *different*
      //      /24) registers with that BBMD → Register-Foreign-Device,
      //      answered by a BVLC-Result.
      //   2. The FD asks the BBMD to redistribute its Who-Is →
      //      Distribute-Broadcast-To-Network.
      //   3. Each BBMD relays Who-Is to every BDT peer → Forwarded-NPDU.
      // Every packet carries real Annex-J wire bytes (see emit.ts).
      {
        const FD_TTL_SECONDS = 600;
        const ipRtt = BACNET_IP_RTT_SECONDS;
        const subnet24 = (ip: string): string => ip.split('.').slice(0, 3).join('.');
        type IpNode = { id: string; label: string; ip: string; isBBMD: boolean; bdtPeers: string[] };
        const ipNodes: IpNode[] = nodes
          .filter((n) => !offline.has(n.id))
          .map((n) => {
            const d = n.data as
              | { label?: string; ipAddress?: string; isBBMD?: boolean; bdtPeers?: string[] }
              | undefined;
            return d?.ipAddress
              ? {
                  id: n.id,
                  label: d.label ?? n.id,
                  ip: d.ipAddress,
                  isBBMD: !!d.isBBMD,
                  bdtPeers: d.bdtPeers ?? [],
                }
              : null;
          })
          .filter((n): n is IpNode => n !== null);
        const bbmds = ipNodes.filter((n) => n.isBBMD);
        const bbmdByIp = new Map(bbmds.map((b) => [b.ip, b] as const));
        const ipNodeByIp = new Map(ipNodes.map((n) => [n.ip, n] as const));
        const hasIpEdge = (a: string, b: string): boolean =>
          edges.some(
            (e) =>
              (e.data as { wireKind?: string } | undefined)?.wireKind === 'bacnet-ip' &&
              ((e.source === a && e.target === b) || (e.source === b && e.target === a)),
          );

        // (3) BBMD → BDT peers: relay a local Who-Is across the bridge.
        for (const bbmd of bbmds) {
          for (const peerIp of bbmd.bdtPeers) {
            const key = `fwd|${bbmd.id}|${peerIp}`;
            if (announcedBbmdFlows.has(key)) continue;
            announcedBbmdFlows.add(key);
            const peer = bbmdByIp.get(peerIp) ?? ipNodeByIp.get(peerIp);
            logBacnetPacket(
              emitForwardedWhoIs({
                simSec: simSecondsElapsed,
                trunkId: `ip-bbmd:${bbmd.id}`,
                bbmdLabel: bbmd.label,
                bbmdIp: bbmd.ip,
                originatorLabel: bbmd.label,
                originatorIp: bbmd.ip,
                dstLabel: peer?.label ?? peerIp,
                dstIp: peerIp,
                context: '(BDT bridge — local Who-Is to peer subnet)',
              }),
            );
          }
        }

        // (1)+(2) Foreign-device registration + redistribute.
        for (const fd of ipNodes) {
          if (fd.isBBMD) continue;
          const bbmd = bbmds.find((b) => hasIpEdge(fd.id, b.id) && subnet24(fd.ip) !== subnet24(b.ip));
          if (!bbmd) continue;
          const key = `fdreg|${fd.id}|${bbmd.id}`;
          if (announcedBbmdFlows.has(key)) continue;
          announcedBbmdFlows.add(key);
          const trunkId = `ip-bbmd:${bbmd.id}`;
          logBacnetPacket(
            emitRegisterForeignDevice({
              simSec: simSecondsElapsed,
              trunkId,
              srcLabel: fd.label,
              srcIp: fd.ip,
              dstLabel: bbmd.label,
              dstIp: bbmd.ip,
              ttlSeconds: FD_TTL_SECONDS,
              context: '(remote subnet — joining BBMD’s FDT)',
            }),
          );
          logBacnetPacket(
            emitBvlcResult({
              simSec: simSecondsElapsed + ipRtt,
              trunkId,
              srcLabel: bbmd.label,
              srcIp: bbmd.ip,
              dstLabel: fd.label,
              dstIp: fd.ip,
              context: '(added to Foreign Device Table)',
            }),
          );
          logBacnetPacket(
            emitDistributeBroadcast({
              simSec: simSecondsElapsed + 2 * ipRtt,
              trunkId,
              srcLabel: fd.label,
              srcIp: fd.ip,
              dstLabel: bbmd.label,
              dstIp: bbmd.ip,
              context: '(reach devices on every subnet)',
            }),
          );
          // The BBMD then forwards the FD's Who-Is to each BDT peer.
          let fwdOffset = 3 * ipRtt;
          for (const peerIp of bbmd.bdtPeers) {
            const peer = bbmdByIp.get(peerIp) ?? ipNodeByIp.get(peerIp);
            logBacnetPacket(
              emitForwardedWhoIs({
                simSec: simSecondsElapsed + fwdOffset,
                trunkId,
                bbmdLabel: bbmd.label,
                bbmdIp: bbmd.ip,
                originatorLabel: fd.label,
                originatorIp: fd.ip,
                dstLabel: peer?.label ?? peerIp,
                dstIp: peerIp,
                context: '(on behalf of foreign device)',
              }),
            );
            fwdOffset += ipRtt;
          }
        }
      }

      // ── COV change-detection pass ────────────────────────────────────
      // Walk every active subscription, resolve its current value via the
      // controller's synthesized objects, and emit a notification when the
      // delta exceeds the deadband. Cap notifications per tick so a
      // 300×-speed run doesn't flood the log.
      let covEmitsThisTick = 0;
      const MAX_COV_EMITS_PER_TICK = 12;
      // Membership index: every "trunkId|childNodeId" still on a trunk.
      const liveChildKeys = new Set<string>();
      for (const [trunkId, ts] of nextStates) {
        for (const child of ts.devices) {
          if (child.mac === 0) continue;
          liveChildKeys.add(`${trunkId}|${child.nodeId}`);
        }
      }
      // Drop subscriptions whose child has been removed (offline / membership change).
      // liveChildKeys only knows MS/TP trunk members — IP-pair subscriptions
      // (trunkId "ip-edge:…" / "ip-host:…") are NOT in it, and running them
      // through the trunk-membership check deleted every IP sub one tick
      // after it was created. That silently killed ConfirmedCOVNotification
      // for ALL BACnet/IP children (the "COV firehose" demo streamed zero
      // notifications). IP subs live as long as their child node exists;
      // applyScenario() clears the whole map on topology swaps.
      for (const [subKey, sub] of covSubscriptions) {
        const isIpSub = sub.trunkId.startsWith('ip-edge:') || sub.trunkId.startsWith('ip-host:');
        const alive = isIpSub
          ? nodes.some((n) => n.id === sub.childNodeId)
          : liveChildKeys.has(`${sub.trunkId}|${sub.childNodeId}`);
        if (!alive) covSubscriptions.delete(subKey);
      }
      // ── COV lease maintenance (G48) ──────────────────────────────────
      // Real subscriptions are leases (YABE default 120 s), renewed by the
      // SUBSCRIBER at exactly lifetime/2 — a periodic SubscribeCOV+ACK
      // heartbeat on the wire (lab4 capture). If the subscriber vanishes,
      // the device keeps notifying into the void until the lease lapses,
      // then goes silent (lab7c "TTL ghost": quiet by lease+115 s of 120).
      // Every (re)subscribe also schedules a fresh initial notification
      // (G47) — real devices re-announce the current value on renewal.
      let covRenewalsThisTick = 0;
      const MAX_COV_RENEWALS_PER_TICK = 12;
      // Snapshot: renewed subscriptions move to the map tail (below) so
      // the per-tick cap round-robins across the population instead of
      // letting the first N insertion-order subs hog every tick at high
      // sim speed. Iterating the live map while re-inserting would
      // revisit moved entries.
      for (const [subKey, sub] of [...covSubscriptions]) {
        const lease = {
          subscribedAtSimSec: sub.subscribedAtSimSec,
          lifetimeSeconds: sub.lifetimeSeconds,
        };
        const supAlive =
          nodes.some((n) => n.id === sub.supNodeId) && !offline.has(sub.supNodeId);
        if (supAlive && isCovRenewalDue(lease, simSecondsElapsed)) {
          if (covRenewalsThisTick >= MAX_COV_RENEWALS_PER_TICK) continue;
          covRenewalsThisTick += 1;
          const isIpSub =
            sub.trunkId.startsWith('ip-edge:') || sub.trunkId.startsWith('ip-host:');
          if (isIpSub) {
            const renewReq = emitSubscribeCov({
              simSec: simSecondsElapsed,
              trunkId: sub.trunkId,
              srcLabel: sub.supLabel,
              dstLabel: sub.childLabel,
              objectId: sub.objectId,
              deadband: sub.deadband,
              deadbandUnits: sub.deadbandUnits,
              lifetimeSeconds: sub.lifetimeSeconds,
              renewal: true,
            });
            logBacnetPacket({ ...renewReq, trunkLabel: sub.trunkLabel });
            const renewAck = emitSubscribeCovAck({
              simSec: simSecondsElapsed + sub.ackLatencyS,
              trunkId: sub.trunkId,
              srcLabel: sub.childLabel,
              dstLabel: sub.supLabel,
              objectId: sub.objectId,
            });
            logBacnetPacket({ ...renewAck, trunkLabel: sub.trunkLabel });
          } else {
            const renewTrigger = /^b[iov][,:]/i.test(sub.objectId)
              ? 'on change'
              : `deadband ${sub.deadband}${sub.deadbandUnits}`;
            logBacnetPacket({
              simSec: simSecondsElapsed,
              trunkId: sub.trunkId,
              trunkLabel: sub.trunkLabel,
              srcMac: sub.supMac,
              dstMac: sub.childMac,
              service: 'SubscribeCOV',
              objectId: sub.objectId,
              summary: `${sub.supLabel} → ${sub.childLabel}: SubscribeCOV ${sub.objectId} (${renewTrigger}, lifetime ${sub.lifetimeSeconds}s · renewal)`,
              layer: 'app',
            });
            logBacnetPacket({
              simSec: simSecondsElapsed + sub.ackLatencyS,
              trunkId: sub.trunkId,
              trunkLabel: sub.trunkLabel,
              srcMac: sub.childMac,
              dstMac: sub.supMac,
              service: 'SubscribeCOV-ACK',
              objectId: sub.objectId,
              summary: `${sub.childLabel} → ${sub.supLabel}: SubscribeCOV-ACK ${sub.objectId} accepted`,
              layer: 'app',
            });
          }
          sub.subscribedAtSimSec = simSecondsElapsed;
          sub.renewals += 1;
          // Keep an already-pending initial notification rather than
          // rescheduling it: at high sim speeds a renewal lands on EVERY
          // tick, and pushing the due-time forward each pass would starve
          // the initial forever (it must outlive the renewal that armed it).
          sub.initialNotifyAtSimSec =
            sub.initialNotifyAtSimSec ??
            (simSecondsElapsed + sub.ackLatencyS + covScanDelay(subKey, sub.renewals));
          // Move to map tail — next tick's capped pass starts elsewhere.
          covSubscriptions.delete(subKey);
          covSubscriptions.set(subKey, sub);
        } else if (!supAlive && isCovLeaseExpired(lease, simSecondsElapsed)) {
          // Un-renewed lease lapsed — the device drops the subscription and
          // goes silent. Nothing errors on the wire; updates just stop.
          // That silence is the teachable bit: a supervisor that died (or a
          // stale client row) keeps showing confident last-known values.
          logEvent(
            simSecondsElapsed,
            'warn',
            'bacnet',
            `${sub.childLabel}: COV lease for ${sub.objectId} expired un-renewed (subscriber ${sub.supLabel} gone) — notifications stop. No error on the wire; stale values just sit wherever they were last delivered.`,
          );
          covSubscriptions.delete(subKey);
          // Let the pair re-announce if the supervisor comes back.
          announcedIpPairs.delete(`${sub.supNodeId}|${sub.childNodeId}`);
        }
      }
      // Now evaluate each live subscription. Snapshot for the same
      // round-robin reason as the lease pass: emitting subs move to the
      // map tail so the per-tick emit cap rotates across the population.
      for (const [subKeyEval, sub] of [...covSubscriptions]) {
        void subKeyEval;
        if (covEmitsThisTick >= MAX_COV_EMITS_PER_TICK) break;
        // Offline children physically can't push to the supervisor —
        // suppress notifications. The heartbeat-poll path is the one
        // that surfaces comm-lost via timeout/retry tracking.
        if (offline.has(sub.childNodeId)) continue;
        const subKey = `${sub.trunkId}|${sub.childNodeId}|${sub.objectId}`;
        const initialDue =
          sub.initialNotifyAtSimSec !== null &&
          simSecondsElapsed >= sub.initialNotifyAtSimSec;
        // G49: scan-based detection. Real stacks evaluate Δ on their own
        // 0.2–7 s scan cadence (lab3: bacserv), not continuously — rapid
        // intermediate writes never hit the wire. Skip this subscription
        // until its next scan instant (a due initial notification still
        // goes out; that path is event-driven, not scan-driven).
        if (!initialDue && simSecondsElapsed < sub.nextScanAtSimSec) continue;
        if (!initialDue) {
          sub.scans += 1;
          sub.nextScanAtSimSec =
            simSecondsElapsed + covScanDelay(`${subKey}|scan`, sub.scans);
        }
        const childNode = nodes.find((n) => n.id === sub.childNodeId);
        if (!childNode) continue;
        // vAHU nodes expose their BACnet objects via the cache populated
        // this tick; all other node types use synthesizeBacnetObjects.
        let childObjectsCov: import('@bas/core').BacnetObject[];
        if (nodeKind(childNode) === 'vahu') {
          childObjectsCov = vahuObjectsCache.get(sub.childNodeId) ?? [];
        } else {
          const vendorModelId = (childNode.data as { vendorModelId?: string } | undefined)?.vendorModelId;
          const childProg = programStore.byId[sub.childNodeId];
          const aiSeed = defaultAiSeed(sub.childNodeId);
          childObjectsCov = synthesizeBacnetObjects({
            vendorModelId,
            bindings: childProg?.bindings,
            defaultAiValues: aiSeed.values,
            defaultAiUnits: aiSeed.units,
            defaultAi1Name: aiSeed.name,
            envInputs: controllerBridge.envInputsByCtrl.get(sub.childNodeId),
            envOutputs: controllerBridge.envOutputsByCtrl.get(sub.childNodeId),
            terminalFaults: terminalFaultsFor(sub.childNodeId),
          });
        }
        const obj = childObjectsCov.find((o) => o.id === sub.objectId);
        if (!obj) continue;
        const cur = obj.presentValue;
        const last = sub.lastReportedValue;
        // Fault-transition trigger — fire a COV whenever the AI object's
        // reliability changes (sensor opens, recovers, transitions to a
        // different fault). Supervisors subscribe expecting this so they
        // can light an alarm immediately instead of waiting for the next
        // periodic poll. Tracks per-subscription so the same fault only
        // emits once per transition.
        const curReliability = obj.reliability ?? 'no-fault-detected';
        const lastReliability = sub.lastReportedReliability ?? 'no-fault-detected';
        // ASHRAE 135 §13.10 requires statusFlags in the listOfValues
        // of a COV notification. Pull straight from the AI object —
        // synthesizeBacnetObjects already merged the signal-layer fault
        // state into both reliability and statusFlags.
        const sf = obj.statusFlags;
        const statusFlags =
          `${sf?.inAlarm ? 'T' : 'F'},${sf?.fault ? 'T' : 'F'},` +
          `${sf?.overridden ? 'T' : 'F'},${sf?.outOfService ? 'T' : 'F'}`;
        // IP pairs use trunkId "ip-edge:..." or "ip-host:..." — the
        // supervisor label is built from the trunkLabel which already
        // names both endpoints. For MS/TP, fall back to "MAC 0" so the
        // existing logs read the same.
        const isIpPair =
          sub.trunkId.startsWith('ip-edge:') || sub.trunkId.startsWith('ip-host:');
        const supervisorLabel = isIpPair
          ? sub.trunkLabel.split(' ↔ ')[0]?.replace(/^BACnet\/IP · /, '') ?? 'supervisor'
          : 'MAC 0';
        // G47: a due initial notification announces the CURRENT value —
        // real devices answer every (re)subscribe with one 0.2–7 s later
        // (lab3: 12/12 observed), so the subscriber never has to poll for
        // its starting value. Event-driven; bypasses deadband math.
        if (initialDue) {
          const initialBuilt = emitCovNotification({
            simSec: simSecondsElapsed,
            trunkId: sub.trunkId,
            srcMac: isIpPair ? undefined : sub.childMac,
            srcLabel: sub.childLabel,
            dstMac: isIpPair ? undefined : 0,
            dstLabel: supervisorLabel,
            objectId: sub.objectId,
            value: typeof cur === 'boolean' ? (cur ? 1 : 0) : cur,
            statusFlags,
          });
          logBacnetPacket({
            ...initialBuilt,
            summary:
              initialBuilt.summary +
              (sub.renewals > 0 ? ' · initial notification (renewal)' : ' · initial notification (subscribe)'),
            trunkLabel: sub.trunkLabel,
          });
          sub.initialNotifyAtSimSec = null;
          sub.lastReportedValue = cur;
          sub.lastReportedReliability = curReliability;
          covEmitsThisTick += 1;
          covSubscriptions.delete(subKey);
          covSubscriptions.set(subKey, sub);
          continue;
        }
        const reliabilityChanged = curReliability !== lastReliability;
        let crossedDeadband = false;
        if (typeof cur === 'boolean' || typeof last === 'boolean') {
          // Binary: any state change is a notification.
          crossedDeadband = cur !== last;
        } else if (last === null) {
          // First sample after subscription seeded — never fire on
          // first comparison; let the next tick do real delta math.
          crossedDeadband = false;
        } else {
          crossedDeadband = Math.abs(cur - last) >= sub.deadband;
        }
        // Either a deadband crossing OR a fault transition wins.
        if (!crossedDeadband && !reliabilityChanged) continue;
        const delta =
          typeof last === 'number' && typeof cur === 'number'
            ? ` (Δ ${cur - last >= 0 ? '+' : ''}${(cur - last).toFixed(2)})`
            : '';
        const built = emitCovNotification({
          simSec: simSecondsElapsed,
          trunkId: sub.trunkId,
          srcMac: isIpPair ? undefined : sub.childMac,
          srcLabel: sub.childLabel,
          dstMac: isIpPair ? undefined : 0,
          dstLabel: supervisorLabel,
          objectId: sub.objectId,
          value: typeof cur === 'boolean' ? (cur ? 1 : 0) : cur,
          statusFlags,
        });
        // Append the sandbox-specific Δ + a fault-transition tag so the
        // tech can tell at a glance whether this COV fired for a value
        // crossing or for a reliability change.
        const transitionTag = reliabilityChanged
          ? ` · reliability ${lastReliability}→${curReliability}`
          : '';
        logBacnetPacket({
          ...built,
          summary: built.summary + delta + transitionTag,
          trunkLabel: sub.trunkLabel,
        });
        sub.lastReportedValue = cur;
        sub.lastReportedReliability = curReliability;
        covEmitsThisTick += 1;
        covSubscriptions.delete(subKey);
        covSubscriptions.set(subKey, sub);
      }
      void covEmitsThisTick;

      // ── MS/TP config validation. Run every tick (cheap — pure
      // function over a small device list), but only log NEW findings to
      // the runtime log to avoid flooding.
      const findingsByTrunk = new Map<string, MstpFinding[]>();
      const snapshots = [...nextStates.entries()].map(([trunkId, st]) => ({
        trunkId,
        devices: st.devices,
      }));
      // Config checks (MAC hygiene) + physical topology checks (T-tap /
      // star, EOL termination) — both keyed by the same trunk ids.
      const topoGraph = mstpGraphInputs();
      const allFindings = [
        ...validateMstpTrunks(snapshots),
        ...validateMstpTopology(topoGraph.nodes, topoGraph.edges),
      ];
      for (const f of allFindings) {
        const list = findingsByTrunk.get(f.trunkId) ?? [];
        list.push(f);
        findingsByTrunk.set(f.trunkId, list);
        const key = `${f.trunkId}:${f.id}`;
        if (!announcedMstpFindings.has(key)) {
          announcedMstpFindings.add(key);
          const level = f.severity === 'error' ? 'error' : 'warn';
          logEvent(simSecondsElapsed, level, 'mstp', `${f.title} — ${f.description}`);
        }
      }
      // Drop announced flags for trunks/findings that have cleared, so
      // re-introducing the fault later re-announces it.
      for (const key of [...announcedMstpFindings]) {
        const [trunkId, fid] = key.split(':');
        const stillPresent = findingsByTrunk.get(trunkId)?.some((f) => f.id === fid);
        if (!stillPresent) announcedMstpFindings.delete(key);
      }
      mstpFindingsByTrunk = findingsByTrunk;
      publishMstpFindings(findingsByTrunk);
    }

    // ── BACnet/IP network validation (sibling to MS/TP above) ────────
    // Collect every node that carries an IP config (ipAddress / subnetMask /
    // gateway on its data) and every bacnet-ip edge, then run the IPv4
    // validator. Findings stream into a flat list; we de-dup runtime-log
    // announcements the same way we do for MS/TP.
    {
      const ipDevices: BacnetIpDevice[] = nodes
        .filter((n) => !isSubnetZone(n))
        .filter((n) => !((n.data as { poweredOff?: boolean }).poweredOff))
        .filter((n) => {
          const d = n.data as {
            ipAddress?: string;
            subnetMask?: string;
            gateway?: string;
            isBBMD?: boolean;
          };
          // Include any device with IP config OR a BBMD flag — empty-BDT
          // and unknown-peer findings should still fire on a BBMD that
          // hasn't been given an IP yet.
          return !!d.ipAddress || !!d.subnetMask || !!d.gateway || !!d.isBBMD;
        })
        .map((n) => {
          const d = n.data as {
            ipAddress?: string;
            subnetMask?: string;
            gateway?: string;
            isBBMD?: boolean;
            bdtPeers?: string[];
          };
          return {
            nodeId: n.id,
            label: nodeLabel(n) || n.id,
            ipAddress: d.ipAddress,
            subnetMask: d.subnetMask,
            gateway: d.gateway,
            isBBMD: d.isBBMD,
            bdtPeers: d.bdtPeers,
          };
        });
      const ipEdges: BacnetIpEdge[] = edges
        .filter((e) => (e.data?.wireKind as string) === 'bacnet-ip')
        .map((e) => ({ edgeId: e.id, aNodeId: e.source, bNodeId: e.target }));
      // Net.3 — collect routers from the canvas. Each router-kind node
      // contributes its interface list to the validator's L3 bridging
      // check (cross-subnet edges are reported as info when a router
      // covers both subnets).
      const routers: BacnetIpRouter[] = nodes
        .filter((n) => !isSubnetZone(n))
        .filter((n) => !((n.data as { poweredOff?: boolean }).poweredOff))
        .filter((n) => nodeKind(n) === 'router')
        .map((n) => {
          const d = n.data as { routerInterfaces?: Array<{ ip?: string; cidr: string }> };
          return {
            nodeId: n.id,
            label: nodeLabel(n) || n.id,
            interfaces: d.routerInterfaces ?? [],
          };
        });
      const findings = validateBacnetIpNetwork(ipDevices, ipEdges, routers);

      // Net.1 — subnet-zone validator: cross-check each placed device's
      // IP against the CIDR of the zone it geometrically sits inside.
      // Builds on the same finding shape so the network-health pill and
      // runtime-log de-dupe paths below pick it up for free.
      const zoneNodes = nodes.filter(isSubnetZone);
      if (zoneNodes.length > 0) {
        const zones: SubnetZoneSpec[] = zoneNodes.map((zn) => {
          const d = zn.data as SubnetZoneData;
          return {
            zoneId: zn.id,
            label: d.label,
            cidr: d.cidr,
            x: zn.position.x,
            y: zn.position.y,
            w: (zn.width as number | undefined) ?? 360,
            h: (zn.height as number | undefined) ?? 240,
          };
        });
        const placed: PlacedBacnetIpDevice[] = nodes
          .filter((n) => !isSubnetZone(n))
          .map((n) => {
            const d = n.data as { ipAddress?: string; subnetMask?: string; gateway?: string };
            const c = nodeCenter(n);
            return {
              nodeId: n.id,
              label: nodeLabel(n) || n.id,
              ipAddress: d.ipAddress,
              subnetMask: d.subnetMask,
              gateway: d.gateway,
              x: c.x,
              y: c.y,
            };
          });
        for (const zf of validateIpZones(placed, zones)) findings.push(zf);
      }
      // Announce-once for the runtime log; finding key combines id +
      // the nodes/edges it touches so re-emerging faults re-fire.
      const liveKeys = new Set<string>();
      for (const f of findings) {
        const key = `${f.id}|${(f.nodeIds ?? []).join(',')}|${(f.edgeIds ?? []).join(',')}`;
        liveKeys.add(key);
        if (!announcedIpv4Findings.has(key)) {
          announcedIpv4Findings.add(key);
          const level =
            f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warn' : 'info';
          logEvent(simSecondsElapsed, level, 'bacnet-ip', `${f.title} — ${f.description}`);
        }
      }
      for (const k of [...announcedIpv4Findings]) {
        if (!liveKeys.has(k)) announcedIpv4Findings.delete(k);
      }
      publishIpv4Findings(findings);

      // ── Net.5 — broadcast routing trace ──────────────────────────
      // Every BROADCAST_TRACE_PERIOD sim-seconds, synthesize a Who-Is
      // broadcast from each supervisor (or BBMD) and log one packet
      // per (source → destination subnet) pair showing the routing
      // outcome: "reaches via BBMD-A/BBMD-B" or "DROPPED at boundary."
      // Teaches the IT/OT split: routers carry unicast, BBMDs carry
      // broadcast, and missing either one is a silent failure mode.
      if (
        ipDevices.length >= 2 &&
        simSecondsElapsed - lastBroadcastTraceSec >= BROADCAST_TRACE_PERIOD
      ) {
        lastBroadcastTraceSec = simSecondsElapsed;
        // Index devices by subnet (network address). Also pull BBMD info.
        type IpInfo = {
          dev: BacnetIpDevice;
          ip: number;
          net: number;
          maskBits: number;
        };
        const parsedDevs: IpInfo[] = [];
        const subnetSet = new Set<number>();
        for (const d of ipDevices) {
          const ip = d.ipAddress ? parseIpv4FromUiCanvas(d.ipAddress) : null;
          const mask = d.subnetMask ? parseIpv4FromUiCanvas(d.subnetMask) : null;
          if (ip === null || mask === null) continue;
          const net = (ip & mask) >>> 0;
          parsedDevs.push({ dev: d, ip, net, maskBits: bitCount(mask) });
          subnetSet.add(net);
        }
        // Build BBMD adjacency: subnet A reaches subnet B iff there's a
        // BBMD on each side AND each has the other in its BDT.
        function subnetsAreBridged(netA: number, netB: number): { via: string[] } | null {
          if (netA === netB) return { via: [] }; // local broadcast — trivially reachable
          const bbmdsA = parsedDevs.filter((p) => p.net === netA && p.dev.isBBMD);
          const bbmdsB = parsedDevs.filter((p) => p.net === netB && p.dev.isBBMD);
          if (bbmdsA.length === 0 || bbmdsB.length === 0) return null;
          // For each pair (a, b), check that a has b's IP in its BDT and vice versa.
          for (const a of bbmdsA) {
            const aPeerIps = (a.dev.bdtPeers ?? [])
              .map(parseIpv4FromUiCanvas)
              .filter((v): v is number => v !== null);
            for (const b of bbmdsB) {
              if (!aPeerIps.includes(b.ip)) continue;
              const bPeerIps = (b.dev.bdtPeers ?? [])
                .map(parseIpv4FromUiCanvas)
                .filter((v): v is number => v !== null);
              if (!bPeerIps.includes(a.ip)) continue;
              return { via: [a.dev.label, b.dev.label] };
            }
          }
          return null;
        }
        // Announce-once gate: only emit a trace line when the routing
        // outcome for a (source, dest) pair changes. `liveTraceKeys`
        // collects every pair we evaluate this pass so we can prune
        // outcomes for pairs that no longer exist (device/subnet removed).
        const liveTraceKeys = new Set<string>();
        function emitTraceOnce(key: string, outcome: string, summary: string, trunkId: string, trunkLabel: string) {
          liveTraceKeys.add(key);
          if (announcedBroadcastTrace.get(key) === outcome) return; // unchanged — stay quiet
          announcedBroadcastTrace.set(key, outcome);
          logBacnetPacket({
            simSec: simSecondsElapsed,
            trunkId,
            trunkLabel,
            srcMac: 0,
            dstMac: undefined,
            service: 'Who-Is',
            summary,
            layer: 'app',
          });
        }
        // Emit one trace per source supervisor/bbmd (skip controllers; in
        // the field, Who-Is is the supervisor's job not a leaf VAV's).
        // We use the underlying canvas node to find the wire that anchors
        // the broadcast (best-guess: the first bacnet-ip edge the device
        // is on). If none, synthesize a virtual trunk id by subnet.
        for (const p of parsedDevs) {
          const nodeKindHere = (nodes.find((n) => n.id === p.dev.nodeId)?.data as { kind?: string } | undefined)?.kind;
          if (nodeKindHere !== 'supervisor' && nodeKindHere !== 'bbmd') continue;
          const trunkEdge = edges.find(
            (e) =>
              (e.data?.wireKind as string) === 'bacnet-ip' &&
              (e.source === p.dev.nodeId || e.target === p.dev.nodeId),
          );
          const trunkId = trunkEdge?.id ?? `bcast:${formatIpv4FromUiCanvas(p.net)}/${p.maskBits}`;
          const trunkLabel = `IP broadcast · ${formatIpv4FromUiCanvas(p.net)}/${p.maskBits}`;
          for (const otherNet of subnetSet) {
            // Skip same-subnet (already implicit local broadcast — emit
            // once, summarized, to avoid spam).
            if (otherNet === p.net) continue;
            const peerLabel = `${formatIpv4FromUiCanvas(otherNet)}/${p.maskBits}`;
            const bridge = subnetsAreBridged(p.net, otherNet);
            const pairKey = `${p.dev.nodeId}|${otherNet}`;
            if (bridge) {
              // Cross-subnet bridged path = BVLC function 0x04
              // (Forwarded-NPDU) — that's the BACnet annex-J way a
              // BBMD relays a broadcast onto its peer's subnet. Real
              // wire trace shows 0x04 on the receiving side.
              emitTraceOnce(
                pairKey,
                `reaches:${bridge.via.join('>')}`,
                `${p.dev.label} (${p.dev.ipAddress}) Who-Is broadcast → reaches ${peerLabel} via ${bridge.via.join(' → ')} · BVLC fn 0x04 Forwarded-NPDU`,
                trunkId,
                trunkLabel,
              );
            } else {
              emitTraceOnce(
                pairKey,
                'dropped',
                `${p.dev.label} (${p.dev.ipAddress}) Who-Is broadcast → DROPPED at ${peerLabel} boundary (no BBMD bridge) · no BVLC fn 0x04 forwarder available`,
                trunkId,
                trunkLabel,
              );
            }
          }
          // One "local broadcast" line so the user sees the source side
          // too. BVLC fn 0x0b = Original-Broadcast-NPDU — what an
          // unbridged broadcast looks like on its own subnet.
          emitTraceOnce(
            `${p.dev.nodeId}|local`,
            `local:${p.net}/${p.maskBits}`,
            `${p.dev.label} (${p.dev.ipAddress}) Who-Is broadcast → local on ${formatIpv4FromUiCanvas(p.net)}/${p.maskBits} · BVLC fn 0x0b Original-Broadcast-NPDU`,
            trunkId,
            trunkLabel,
          );
        }
        // Prune outcomes for pairs that no longer exist so a later
        // topology change (device removed then re-added, subnet renumbered)
        // re-fires the trace instead of staying silent on a stale key.
        for (const k of [...announcedBroadcastTrace.keys()]) {
          if (!liveTraceKeys.has(k)) announcedBroadcastTrace.delete(k);
        }
      }
    }

    // ── Yoke sensor T_sensed to the linked zone ───────────────────────
    // When a sensor is wired to a controller whose actuators feed
    // equipment that serves a zone, the sensor PHYSICALLY sits IN that
    // zone and should read its T_zone. Without this, the controller-paired
    // SingleZoneSystem runs its own thermal model in isolation — leaving
    // ZN-T at setpoint while ZONE-1 keeps drifting because the same
    // actuator command means "cooling" in the old sim and "heating" via
    // the role binding in the zone sim. Override T_sensed each tick so
    // the controller program reacts to actual zone reality.
    for (const target of runningSnapshot) {
      const sample = sampleByCtrl.get(target.controllerId);
      if (!sample) continue;
      // Walk controller → actuator → equipment → zone to find the linked zone.
      let linkedZoneId: string | null = null;
      for (const e1 of edges) {
        if (e1.source !== target.controllerId) continue;
        const actN = nodes.find((n) => n.id === e1.target);
        if (!actN || nodeKind(actN) !== 'actuator') continue;
        for (const e2 of edges) {
          if (e2.source !== actN.id) continue;
          const eqN = nodes.find((n) => n.id === e2.target);
          if (!eqN || nodeKind(eqN) !== 'equipment') continue;
          for (const e3 of edges) {
            if (e3.source !== eqN.id) continue;
            const zN = nodes.find((n) => n.id === e3.target);
            if (!zN || nodeKind(zN) !== 'zone') continue;
            linkedZoneId = zN.id;
            break;
          }
          if (linkedZoneId) break;
        }
        if (linkedZoneId) break;
      }
      if (!linkedZoneId) continue;
      const zState = zoneStateUpdates.get(linkedZoneId);
      if (!zState) continue;
      // Override sample for display this tick, AND sys.T_sensed so the
      // next program run sees the corrected value.
      const sys = systems.get(target.controllerId);
      (sample as { T_sensed: number; T_zone: number }).T_sensed = zState.T_zone;
      (sample as { T_zone: number }).T_zone = zState.T_zone;
      if (sys) {
        (sys as unknown as { T_sensed: number; T_zone: number }).T_sensed = zState.T_zone;
        (sys as unknown as { T_zone: number }).T_zone = zState.T_zone;
      }
    }

    nodes = nodes.map((n) => {
      const data = n.data as {
        kind: Kind;
        label: string;
        runtime?: unknown;
        highAlarm?: number;
        lowAlarm?: number;
        staleSec?: number;
        signal?: SensorSignal;
        ageSinceLastPollSec?: number;
      };

      // 1) Bump stale-age counter on offline nodes; clear when they come back.
      let staleNext = data.staleSec;
      if (offline.has(n.id)) {
        staleNext = (data.staleSec ?? 0) + 1;
      } else if (data.staleSec !== undefined) {
        staleNext = undefined;
      }

      // 1b) Poll-cadence age — only meaningful for online wired sensors.
      // Different signal types have different supervisor poll rates: a Pt1000
      // RTD typically polls every 5s, a 4-20mA loop every 10s. Showing the
      // tick-modulo-cadence makes the polling rhythm visible on the canvas.
      let ageNext = data.ageSinceLastPollSec;
      if (data.kind === 'sensor' && !offline.has(n.id) && wiredIds.has(n.id)) {
        const tpl = data.signal ? SENSOR_TEMPLATE_BY_ID.get(data.signal) : undefined;
        const pollSec = tpl?.pollSec ?? 5;
        ageNext = tick % pollSec;
      } else if (data.ageSinceLastPollSec !== undefined) {
        ageNext = undefined;
      }

      // 2) Evaluate controller alarms against the live sample (if any).
      let alarmNext: 'normal' | 'high' | 'low' | undefined = undefined;
      if (data.kind === 'controller') {
        const sample = sampleByCtrlForAlarm.get(n.id);
        if (sample) {
          if (data.highAlarm !== undefined && sample.T_zone >= data.highAlarm) {
            alarmNext = 'high';
          } else if (data.lowAlarm !== undefined && sample.T_zone <= data.lowAlarm) {
            alarmNext = 'low';
          } else {
            alarmNext = 'normal';
          }
          // Detect transitions for the alarm log.
          const prev = prevAlarmByController.get(n.id) ?? 'normal';
          if (prev !== alarmNext) {
            logAlarmTransition(n.id, data.label, prev, alarmNext, sample.T_zone);
            prevAlarmByController.set(n.id, alarmNext);
          }
        }
      }

      const physVal = physicsValueByNode.get(n.id);
      const actuatorUpdate = actuatorStateUpdates.get(n.id);
      const loopUpdate = loopStateUpdates.get(n.id);
      const zoneUpdate = zoneStateUpdates.get(n.id);
      // Is this node holding the MS/TP token right now?
      let holdsToken = false;
      let tokenMac: number | undefined;
      for (const [, ts] of mstpTrunkStates) {
        const dev = ts.devices[ts.tokenIndex];
        if (dev && dev.nodeId === n.id) {
          holdsToken = true;
          tokenMac = dev.mac;
          break;
        }
      }
      if (physVal) {
        return {
          ...n,
          data: {
            ...data,
            runtime: physVal,
            staleSec: staleNext,
            ageSinceLastPollSec: ageNext,
            ...(alarmNext !== undefined ? { alarm: alarmNext } : {}),
            ...(actuatorUpdate ? { actuatorState: actuatorUpdate } : {}),
            ...(loopUpdate ? { loopState: loopUpdate } : {}),
            ...(zoneUpdate ? { zoneState: zoneUpdate } : {}),
            holdsToken,
            tokenMac,
          },
        };
      }
      let value: string;
      let status: 'idle' | 'polling' | 'responded' | 'tripped' = 'responded';
      // Powered-off devices always render a distinct OFF state
      // regardless of kind, so the user never sees a "running" output
      // on a device they just cut power to.
      if ((data as { poweredOff?: boolean }).poweredOff) {
        return {
          ...n,
          data: {
            ...data,
            runtime: { value: '⏻ POWER OFF', status: 'idle' as const },
            staleSec: staleNext,
            ageSinceLastPollSec: ageNext,
            ...(actuatorUpdate ? { actuatorState: actuatorUpdate } : {}),
            ...(loopUpdate ? { loopState: loopUpdate } : {}),
            ...(zoneUpdate ? { zoneState: zoneUpdate } : {}),
            holdsToken,
            tokenMac,
          },
        };
      }
      switch (data.kind) {
        case 'supervisor':
          value = `uptime t=${tick}s`;
          status = 'idle';
          break;
        case 'controller':
          value = controllerReading(n.id);
          status = 'polling';
          break;
        case 'sensor':
          value = sensorValue(data.label);
          break;
        case 'safety': {
          const s = safetyValue(data.label);
          value = s.value;
          status = s.status;
          break;
        }
        case 'vahu': {
          // Show idle hint before sim is running.
          value = 'G36 §5.18 — hit Run to start';
          status = 'idle';
          break;
        }
        default:
          value = 'idle';
      }
      return {
        ...n,
        data: {
          ...data,
          runtime: { value, status },
          staleSec: staleNext,
          ageSinceLastPollSec: ageNext,
          ...(alarmNext !== undefined ? { alarm: alarmNext } : {}),
        },
      };
    });

    // Single signal-fidelity bridge pass — walks every controller on the
    // canvas. Primary sensor comes from primaryByCtrlStable (an $effect-
    // tracked snapshot of wiredTargets that ignores svelte-flow's
    // transient empty bursts). Live thermal data is pulled from
    // sampleByCtrl when the controller is physics-wired, else neutral
    // defaults so the multimeter still has something to display on
    // bare-wire setups.
    {
      const simHourNow = ((simStartHour * 3600 + simSecondsElapsed) / 3600) % 24;
      for (const node of nodes) {
        if (nodeKind(node) !== 'controller') continue;
        const primary = primaryByCtrlStable.get(node.id);
        const s = sampleByCtrl.get(node.id);
        runBridgePass(
          node.id,
          primary,
          simHourNow,
          s?.actuator ?? 0.5,
          s?.T_zone ?? 70,
          s?.T_OA ?? 65,
        );
      }
    }

    // Tick-end: bump the controller-bridge tick counter so any reactive
    // consumer (BACnet inspector, Terminals inspector, etc.) re-derives
    // off the freshly-published env / signal snapshots.
    bumpBridgeTick();
  }

  /**
   * Walk upstream from the controller, then add the controller↔sensor edge.
   * The polling path is what should animate during a run — supervisor sends
   * a request, it traverses the trunk down to the controller, the controller
   * reads its sensor. Other wires (safety branches, sibling controllers)
   * stay quiet.
   */
  function pollingPathEdgeIds(target: PhysicsTarget): Set<string> {
    const out = new Set<string>();

    // controller ↔ sensor
    for (const e of edges) {
      if (
        (e.source === target.controllerId && e.target === target.sensorId) ||
        (e.source === target.sensorId && e.target === target.controllerId)
      ) {
        out.add(e.id);
        break;
      }
    }

    // Walk upstream from controller toward the root supervisor.
    let current = target.controllerId;
    const visited = new Set<string>([current]);
    for (let i = 0; i < 16; i++) {
      const up = edges.find((e) => e.target === current && !visited.has(e.source));
      if (!up) break;
      out.add(up.id);
      current = up.source;
      visited.add(current);
    }

    return out;
  }

  function start() {
    if (running) return;

    // Auto-bind (G41): anything wired sensibly just works when you Run.
    // A controller with a sensor wired gets its thermal sim automatically —
    // "physics target" is sandbox plumbing, not a concept a tech should
    // need. Runs BEFORE the snapshot below so new bindings join this run.
    for (const n of nodes) {
      if (nodeKind(n) !== 'controller') continue;
      if ((n.data as { poweredOff?: boolean } | undefined)?.poweredOff) continue;
      if (wiredTargets.some((t) => t.controllerId === n.id)) continue;
      if (!findConnectedSensor(n.id)) continue;
      wireAsPhysicsTarget(n.id);
    }

    running = true;

    // Snapshot the current wired targets so config/topology edits during a run
    // don't yank the chart or restart a system mid-trajectory.
    runningSnapshot = wiredTargets.slice();
    // Seed the sim clock from the user-set start hour. Each system's
    // internal simSeconds starts here too so occupancy schedules see the
    // right hour-of-day from tick 0.
    simSecondsElapsed = 0;
    // Reset broadcast trace clock so a fresh run fires the first trace
    // immediately rather than waiting for BROADCAST_TRACE_PERIOD. Also
    // clear the announce-once dedup so the full routing snapshot re-emits
    // on a fresh run rather than being suppressed by last run's outcomes.
    lastBroadcastTraceSec = -BROADCAST_TRACE_PERIOD;
    announcedBroadcastTrace.clear();
    // Reset BACnet invoke-ID counter so each run starts from 0 — makes
    // the packet log deterministic and matches what a freshly-booted
    // supervisor would emit on the wire.
    nextInvokeId = 0;
    const startSeconds = simStartHour * 3600;
    const systems = new Map<string, SingleZoneSystem>();
    const samples = new Map<string, Sample[]>();
    for (const t of runningSnapshot) {
      const sys = new SingleZoneSystem(t.config);
      sys.simSeconds = startSeconds;
      // Restore any persisted sensor fault so the run picks up where the
      // user left it (e.g. they injected a fault, stopped, hit Run again).
      const sensor = nodes.find((n) => n.id === t.sensorId);
      const persistedFault = (sensor?.data as { fault?: SensorFault } | undefined)?.fault;
      if (persistedFault && persistedFault !== 'normal') sys.setFault(persistedFault);
      // Restore manual override the same way — operator command persists
      // across sim stop/start.
      const ctrl = nodes.find((n) => n.id === t.controllerId);
      const persistedOverride = (ctrl?.data as { manualOverride?: number } | undefined)
        ?.manualOverride;
      if (typeof persistedOverride === 'number') sys.manualOverride = persistedOverride;
      systems.set(t.controllerId, sys);
      samples.set(t.controllerId, []);
    }
    runningSystems = systems;
    runningSamples = samples;

    if (runningSnapshot.length > 0) {
      // Animate the union of all polling paths.
      const pathIds = new Set<string>();
      for (const t of runningSnapshot) {
        const target: PhysicsTarget = {
          controllerId: t.controllerId,
          sensorId: t.sensorId,
          controllerLabel: '',
          sensorLabel: '',
        };
        for (const id of pollingPathEdgeIds(target)) pathIds.add(id);
      }
      edges = edges.map((e) => withStyle({ ...e, animated: pathIds.has(e.id) }));
    } else {
      // No physics target → no real traffic — animate all wires lightly so
      // the canvas isn't completely static while the synthetic ticker runs.
      edges = edges.map((e) => withStyle({ ...e, animated: true }));
    }

    logEvent(0, 'info', 'sim', `Run started with ${runningSnapshot.length} physics target${runningSnapshot.length === 1 ? '' : 's'} (sim start hour ${simStartHour}).`);

    // Safety polarity audit — emit a warning for any NO-state safeties on
    // the canvas. Most BAS code paths assume NC fail-safe (wire break =
    // chain opens = trip). A NO device wired without explicit handling
    // produces a fail-DANGEROUS condition: the chain stays closed even
    // when the device fires. The user has to acknowledge this by writing
    // logic that interprets the input correctly.
    for (const n of nodes) {
      if ((n.data as { kind?: string } | undefined)?.kind !== 'safety') continue;
      const safetyId = (n.data as { safetyModelId?: string } | undefined)?.safetyModelId;
      if (!safetyId) continue;
      const m = findSafetyDevice(safetyId);
      if (!m) continue;
      if (m.normalState === 'NO') {
        logEvent(
          0,
          'warn',
          nodeLabel(n),
          `${m.vendor} ${m.model} is NORMALLY OPEN. Most BAS code treats safety inputs as NC (fail-safe by wire break). If your program doesn't explicitly invert this input, the safety chain becomes fail-DANGEROUS — won't trip when the device fires.`,
          n.id,
        );
      }
    }

    // Sensor signal-type vs terminal-type audit. Each sensor signal has a
    // set of compatible terminal types it can land on without garbage
    // readings. Examples:
    //   4-20 mA on BI       → reads binary high/low based on a threshold,
    //                         throws away the proportional info
    //   RTD Pt1000 on BI    → resistance circuit driven into a binary
    //                         input — controller reports nonsense
    //   Binary-dry on AI    → reads ~0 / 5 V depending on pull-up, still
    //                         binary but treated as analog by code
    // Universal Inputs (UI) accept anything — they auto-detect per-channel.
    const signalAcceptsTerminal: Record<string, Set<'UI' | 'AI' | 'BI'>> = {
      'rtd-pt1000':        new Set(['UI', 'AI']),
      'rtd-pt100':         new Set(['UI', 'AI']),
      'thermistor-10k-t2': new Set(['UI', 'AI']),
      'thermistor-10k-t3': new Set(['UI', 'AI']),
      'thermistor-20k':    new Set(['UI', 'AI']),
      'analog-0-10v':      new Set(['UI', 'AI']),
      'analog-2-10v':      new Set(['UI', 'AI']),
      'analog-4-20ma':     new Set(['UI', 'AI']),
      'analog-0-5v':       new Set(['UI', 'AI']),
      'binary-dry':        new Set(['UI', 'BI']),
    };
    for (const e of edges) {
      const targetHandle = e.targetHandle ?? '';
      if (!targetHandle || targetHandle === 'net-in' || targetHandle === 'net-out') continue;
      const termKind = targetHandle.split('-')[0] as 'UI' | 'AI' | 'BI' | 'UO' | 'AO' | 'BO';
      if (termKind !== 'UI' && termKind !== 'AI' && termKind !== 'BI') continue;
      const srcNode = nodes.find((n) => n.id === e.source);
      const tgtNode = nodes.find((n) => n.id === e.target);
      const sensorNode = (srcNode?.data as { kind?: string } | undefined)?.kind === 'sensor'
        ? srcNode
        : (tgtNode?.data as { kind?: string } | undefined)?.kind === 'sensor'
          ? tgtNode
          : null;
      if (!sensorNode) continue;
      const sensorModelId = (sensorNode.data as { sensorModelId?: string } | undefined)?.sensorModelId;
      if (!sensorModelId) continue;
      const sensorModel = findSensorModel(sensorModelId);
      if (!sensorModel) continue;
      const accepted = signalAcceptsTerminal[sensorModel.signal];
      if (!accepted) continue;
      if (!accepted.has(termKind)) {
        logEvent(
          0,
          'error',
          nodeLabel(sensorNode),
          `Signal/terminal mismatch — ${sensorModel.signal} sensor wired to ${termKind} terminal (${targetHandle}). ` +
            (termKind === 'BI'
              ? 'Binary input throws away the proportional reading; controller reports unstable on/off.'
              : termKind === 'AI'
                ? 'Analog input reads the dry-contact as a fixed voltage, missing the open/close transitions.'
                : 'Reading will be garbage. Rewire to a UI terminal or use a matching sensor.'),
          sensorNode.id,
        );
      }
    }

    tickOnce();
    intervalId = setInterval(tickOnce, TICK_MS);
  }

  function stop() {
    running = false;
    logEvent(simSecondsElapsed, 'info', 'sim', `Run stopped at t=${Math.round(simSecondsElapsed)}s.`);
    runningSnapshot = [];
    runningSystems = new Map();
    // Reset vAHU state so the next Run() starts fresh (cold-start sequence).
    vahuStates = new Map();
    vahuObjectsCache = new Map();
    vahuPrevInputs = new Map();
    announcedIpPairs = new Set();
    announcedBbmdFlows = new Set();
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    edges = edges.map((e) => withStyle({ ...e, animated: false }));
  }

  function resetSim() {
    stop();
    tick = 0;
    simSecondsElapsed = 0;
    runningSamples = new Map();
    nodes = nodes.map((n) => {
      const data = n.data as Record<string, unknown>;
      const { runtime: _runtime, ...rest } = data;
      return { ...n, data: rest };
    });
  }

  function clearAll() {
    if (!confirm('Clear all nodes and connections?')) return;
    stop();
    tick = 0;
    runningSamples = new Map();
    wiredTargets = [];
    focusedTargetId = null;
    nodes = [];
    edges = [];
    for (const k of Object.keys(counters)) counters[k] = 0;
  }

  // ============ Scenario save / load ============
  //
  // BasScenarioV1 type lives in ./scenario.ts so demoScenarios.ts can
  // construct scenarios without circular-importing through this file.

  // Used by the (removed) in-dock Save button — kept for compatibility with
  // the saveScenario fn's UX timer, even though the header button doesn't
  // render this label today.
  let _saveButtonText = $state('Save scenario');
  void _saveButtonText;
  let saveButtonTimer: ReturnType<typeof setTimeout> | null = null;
  let loadMessage = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // ============ Named in-browser scenario slots ============
  //
  // The Save/Load buttons download / upload JSON files (good for sharing),
  // but a tech iterating on a setup wants quick access to "the boiler-trip
  // demo" or "weekend test" without a download. Slots live in localStorage
  // under SLOTS_KEY as { name → BasScenarioV1 }, with the slot list kept in
  // memory as `slotNames` for the UI.

  const SLOTS_KEY = 'bas-sandbox:slots-v1';
  type SlotMap = Record<string, BasScenarioV1>;

  function readSlots(): SlotMap {
    try {
      const raw = localStorage.getItem(SLOTS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === 'object' && parsed !== null ? (parsed as SlotMap) : {};
    } catch {
      return {};
    }
  }

  function writeSlots(slots: SlotMap): void {
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
    } catch (e) {
      flashLoad('err', `localStorage full? ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let slotNames = $state<string[]>(Object.keys(readSlots()).sort());

  function buildCurrentScenario(): BasScenarioV1 {
    const cleanNodes = nodes.map((n) => {
      const data = n.data as Record<string, unknown>;
      const { runtime: _runtime, ...rest } = data;
      return { ...n, data: rest };
    });
    const focused = focusedTarget;
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      topology: { nodes: cleanNodes, edges: edges.map((e) => ({ ...e, animated: false })) },
      selection: { controllerId: focusedTargetId },
      config: focused ? { ...focused.config } : { ...DEFAULT_CONFIG },
      wiredTargets: wiredTargets.map((t) => ({ ...t, config: { ...t.config } })),
      focusedTargetId,
      counters: { ...counters },
      nextId,
    };
  }

  function saveSlot(): void {
    const name = prompt('Name this scenario (e.g. "morning ramp", "boiler trip demo"):');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const slots = readSlots();
    if (slots[trimmed] && !confirm(`Overwrite existing "${trimmed}" slot?`)) return;
    slots[trimmed] = buildCurrentScenario();
    writeSlots(slots);
    slotNames = Object.keys(slots).sort();
    flashLoad('ok', `Saved "${trimmed}"`);
  }

  function loadSlot(name: string): void {
    const slots = readSlots();
    const scenario = slots[name];
    if (!scenario) {
      flashLoad('err', `Slot "${name}" missing`);
      return;
    }
    applyScenario(scenario);
    flashLoad('ok', `Loaded "${name}"`);
  }

  function deleteSlot(name: string): void {
    if (!confirm(`Delete slot "${name}"? This can't be undone.`)) return;
    const slots = readSlots();
    delete slots[name];
    writeSlots(slots);
    slotNames = Object.keys(slots).sort();
    flashLoad('ok', `Deleted "${name}"`);
  }

  /**
   * Load a bundled demo scenario into the canvas. Uses the same path as
   * file/slot loading so any future scenario-shape changes flow through
   * a single applyScenario(). Deep-clones the scenario first because
   * applyScenario mutates the node/edge arrays in place.
   */
  function loadDemo(demo: (typeof DEMOS)[number]): void {
    const cloned = JSON.parse(JSON.stringify(demo.scenario)) as BasScenarioV1;
    applyScenario(cloned);
    flashLoad('ok', `Loaded demo: ${demo.name}`);
  }

  function flashSave(text: string) {
    _saveButtonText = text;
    if (saveButtonTimer) clearTimeout(saveButtonTimer);
    saveButtonTimer = setTimeout(() => {
      _saveButtonText = 'Save scenario';
      saveButtonTimer = null;
    }, 2000);
  }

  function flashLoad(kind: 'ok' | 'err', text: string) {
    loadMessage = { kind, text };
    setTimeout(() => {
      loadMessage = null;
    }, 4000);
  }

  /**
   * Dump every running target's sample history as a CSV "trend log" — same
   * column layout a JCI trend export gives you (controller, tick, sensed
   * temp, real temp, setpoint, actuator, OAT). Skipped when nothing has
   * run yet.
   */
  function exportSamplesCsv(): void {
    if (runningSamples.size === 0) {
      flashLoad('err', 'Nothing to export — run the sim first');
      return;
    }
    const lines: string[] = [
      'controller,label,tick,T_zone_F,T_sensed_F,T_OA_F,setpoint_F,actuator_pct',
    ];
    for (const target of wiredTargets) {
      const hist = runningSamples.get(target.controllerId);
      if (!hist || hist.length === 0) continue;
      const ctrl = nodes.find((n) => n.id === target.controllerId);
      const label = ctrl ? nodeLabel(ctrl) : target.controllerId;
      for (const s of hist) {
        // CSV-escape just the label in case someone renamed a node with a comma.
        const safeLabel = label.includes(',') ? `"${label.replace(/"/g, '""')}"` : label;
        lines.push(
          [
            target.controllerId,
            safeLabel,
            s.t,
            s.T_zone.toFixed(3),
            s.T_sensed.toFixed(3),
            s.T_OA.toFixed(2),
            s.setpoint.toFixed(2),
            (s.actuator * 100).toFixed(2),
          ].join(','),
        );
      }
    }
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    a.download = `bas-trend-${stamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    flashLoad('ok', `Exported ${lines.length - 1} sample rows`);
  }

  function saveScenario() {
    // Strip per-tick runtime values so we don't ship a frozen "Out N%" with the topology.
    const cleanNodes = nodes.map((n) => {
      const data = n.data as Record<string, unknown>;
      const { runtime: _runtime, ...rest } = data;
      return { ...n, data: rest };
    });
    const focused = focusedTarget;
    const scenario: BasScenarioV1 = {
      version: 1,
      savedAt: new Date().toISOString(),
      topology: { nodes: cleanNodes, edges: edges.map((e) => ({ ...e, animated: false })) },
      selection: { controllerId: focusedTargetId },
      // Back-compat: a single `config` field at top level mirrors the focused
      // target so older readers still get something sensible.
      config: focused ? { ...focused.config } : { ...DEFAULT_CONFIG },
      wiredTargets: wiredTargets.map((t) => ({ ...t, config: { ...t.config } })),
      focusedTargetId,
      counters: { ...counters },
      nextId,
    };
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    a.download = `bas-scenario-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    flashSave('✓ Saved');
  }

  function applyScenario(parsed: BasScenarioV1) {
    stop();
    // Each demo/scenario starts with a clean BACnet capture — the packet
    // log is a live sniffer view, so carrying packets across a topology
    // swap would mix two unrelated networks. Fresh instance per demo.
    clearBacnetPackets();
    // A topology swap is a DIFFERENT network — every protocol-state map
    // keyed by node/edge ids must go too. Demos reuse generic ids ('sup',
    // 'vav1', …), so a stale COV subscription from the previous demo can
    // pass the per-tick liveness check and keep emitting notifications
    // under its cached old label (ghost "VAV-SF" packets in the next
    // demo's capture). Same hazard for trunk state, poll schedules, and
    // retry/comm-lost tracking.
    covSubscriptions = new Map();
    mstpTrunkStates = new Map();
    bacnetPollSchedule = new Map();
    ipPollSchedule = new Map();
    failingChildren.clear();
    // The runtime log too — sim timestamps restart at 00:00 per run, so
    // entries from the previous demo interleave confusingly with the new
    // one's (stale "gateway off-subnet" errors showing up under a healthy
    // BBMD demo). Fresh log per topology, same rationale as the capture.
    clearRuntimeLog();
    // …and the sim start hour: a demo that says "OAT 28°F cold start" should
    // not inherit hour 21.5 from whatever the user tried previously.
    simStartHour = 0;
    tick = 0;
    simSecondsElapsed = 0;
    runningSamples = new Map();
    nodes = parsed.topology.nodes;
    // Style on load (nodes are assigned above, so process-link detection
    // sees endpoint kinds) — wire colors + duct/pipe arrows render
    // immediately instead of waiting for the first Run restyle.
    edges = parsed.topology.edges.map((e) => withStyle(e));

    // v1.2+ scenarios carry an explicit wiredTargets array.
    if (parsed.wiredTargets && parsed.wiredTargets.length >= 0) {
      wiredTargets = parsed.wiredTargets.map((t) => ({
        controllerId: t.controllerId,
        sensorId: t.sensorId,
        config: { ...DEFAULT_CONFIG, ...t.config },
      }));
      focusedTargetId = parsed.focusedTargetId ?? wiredTargets[0]?.controllerId ?? null;
    } else {
      // v1.0/1.1 back-compat: synthesize a single target from `selection` +
      // the top-level `config`. If selection is null, fall back to first pair.
      const merged = { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) };
      const ctrlId = parsed.selection?.controllerId ?? null;
      const ctrl = ctrlId ? (nodes.find((n) => n.id === ctrlId) ?? null) : null;
      const sensor = ctrl ? findConnectedSensor(ctrl.id) : null;
      if (ctrl && sensor) {
        wiredTargets = [{ controllerId: ctrl.id, sensorId: sensor.id, config: merged }];
        focusedTargetId = ctrl.id;
      } else {
        const pair = firstControlledPair();
        if (pair) {
          wiredTargets = [
            { controllerId: pair.controller.id, sensorId: pair.sensor.id, config: merged },
          ];
          focusedTargetId = pair.controller.id;
        } else {
          wiredTargets = [];
          focusedTargetId = null;
        }
      }
    }

    // Scenario-shipped controller programs (mirrors a site backup carrying
    // the controller database, not just the network layout). Applied AFTER
    // wiredTargets so the program runner finds its physics target on the
    // first tick. setProgramSource compiles + persists; a scenario program
    // intentionally REPLACES whatever localStorage had for that id —
    // loading a demo means loading ITS controllers' logic.
    for (const p of parsed.programs ?? []) {
      setProgramSource(p.controllerId, p.source);
    }

    // "defaults" link snaps to whatever the focused target loaded.
    const baseline = focusedTarget?.config ?? { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) };
    scenarioBaseline = { ...baseline };
    activePresetId = 'custom';

    for (const k of Object.keys(counters)) delete counters[k];
    for (const [k, v] of Object.entries(parsed.counters ?? {})) counters[k] = v;
    nextId = parsed.nextId ?? 100;
    flashLoad('ok', `Loaded ${parsed.topology.nodes.length} nodes`);
  }

  function loadScenarioFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (!data || data.version !== 1 || !data.topology) {
          throw new Error('Not a valid bas-scenario file (missing version or topology)');
        }
        applyScenario(data as BasScenarioV1);
      } catch (e) {
        flashLoad('err', e instanceof Error ? e.message : String(e));
      }
    };
    reader.onerror = () => flashLoad('err', 'Could not read file');
    reader.readAsText(file);
  }

  function onLoadInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) loadScenarioFile(file);
    input.value = ''; // reset so picking the same file twice re-fires
  }

  /**
   * Keep the running sim state aligned with wiredTargets. When a target is
   * added mid-run we spin up its SingleZoneSystem from scratch (with the
   * current slider config). When one is removed mid-run we drop its system
   * and sample history. Off-path edges flip back to quiet, on-path to animated.
   */
  function syncRunningState() {
    if (!running) return;
    const desired = new Set(wiredTargets.map((t) => t.controllerId));
    const current = new Set(runningSnapshot.map((t) => t.controllerId));

    const systems = runningSystems;
    const samples = runningSamples;

    // Additions
    for (const t of wiredTargets) {
      if (!current.has(t.controllerId)) {
        const sys = new SingleZoneSystem(t.config);
        // Late-added targets join the sim at the current clock time, not
        // back at the run's start hour — feels right (they "exist now").
        sys.simSeconds = simStartHour * 3600 + simSecondsElapsed;
        const sensor = nodes.find((n) => n.id === t.sensorId);
        const persistedFault = (sensor?.data as { fault?: SensorFault } | undefined)?.fault;
        if (persistedFault && persistedFault !== 'normal') sys.setFault(persistedFault);
        const ctrl = nodes.find((n) => n.id === t.controllerId);
        const persistedOverride = (ctrl?.data as { manualOverride?: number } | undefined)
          ?.manualOverride;
        if (typeof persistedOverride === 'number') sys.manualOverride = persistedOverride;
        systems.set(t.controllerId, sys);
        samples.set(t.controllerId, []);
      }
    }
    // Removals
    for (const id of Array.from(current)) {
      if (!desired.has(id)) {
        systems.delete(id);
        samples.delete(id);
      }
    }

    runningSnapshot = wiredTargets.slice();
    runningSystems = new Map(systems);
    runningSamples = new Map(samples);

    // Refresh polling-path animation
    const pathIds = new Set<string>();
    for (const t of runningSnapshot) {
      const target: PhysicsTarget = {
        controllerId: t.controllerId,
        sensorId: t.sensorId,
        controllerLabel: '',
        sensorLabel: '',
      };
      for (const id of pollingPathEdgeIds(target)) pathIds.add(id);
    }
    edges = edges.map((e) => withStyle({ ...e, animated: pathIds.has(e.id) }));
  }

  /**
   * Wire-palette selection: 'auto' = pick a sensible kind based on what's
   * being connected; otherwise force this specific trunk kind on every new
   * wire until the user picks a different one (Packet-Tracer-style).
   */
  let selectedWireKind = $state<WireKind | 'auto'>(_initialState.selectedWireKind);

  /** Latest wire-compatibility refusal so the UI can show a banner. */
  let wireRefusal = $state<{ reason: string; ts: number } | null>(null);
  let wireRefusalTimer: ReturnType<typeof setTimeout> | null = null;

  function flashWireRefusal(reason: string): void {
    wireRefusal = { reason, ts: Date.now() };
    if (wireRefusalTimer) clearTimeout(wireRefusalTimer);
    wireRefusalTimer = setTimeout(() => {
      wireRefusal = null;
      wireRefusalTimer = null;
    }, 6000);
  }

  // ── Guidance mode ───────────────────────────────────────────────────
  // 'easy'   — training wheels: an incompatible wire is blocked outright,
  //            same as before. The tool won't let you make the mistake.
  // 'realistic' — like the field: the incompatible wire is allowed and you
  //            get ZERO automatic warning. The device just won't work and
  //            you have to notice. Ask the local AI, or hit "Check my work,"
  //            to reveal what's wrong.
  // Topology-impossible connections (a terminal already wired, a controller
  // getting a second supervisor) are ALWAYS blocked in both modes — those
  // aren't teachable field mistakes, they can't physically exist.
  //
  // State lives in a shared store so the Terminals inspector can gate its
  // omniscient "installed vs programmed" hints on the same mode.
  const guidanceMode = $derived(guidanceStore.mode);

  // The "Auto" wire option is a training wheel — it infers the trunk
  // protocol for you. The field has no such thing: you have to know whether
  // you're on MS/TP or BACnet/IP. So Auto only shows in Easy mode, and we
  // make sure the selection never sits on 'auto' while Realistic (otherwise
  // onConnect would still silently auto-infer). Defaults to MS/TP — the most
  // common field bus — which the user then consciously changes if wrong.
  $effect(() => {
    if (guidanceMode === 'realistic' && selectedWireKind === 'auto') {
      selectedWireKind = 'mstp';
    }
  });

  // ── "Check my work" — on-demand error reveal ────────────────────────
  // The no-AI fallback for a stuck learner. Aggregates the mistakes the
  // tool would otherwise stay quiet about in realistic mode: miswired
  // edges (tagged on the edge when allowed-through), plus whatever the
  // network validators last surfaced. Available in both modes.
  type CheckItem = { severity: 'error' | 'warning' | 'info'; title: string; detail: string };
  let checkModalOpen = $state(false);
  let checkResults = $state<CheckItem[]>([]);

  function runCheckMyWork(): void {
    const results: CheckItem[] = [];
    // 1. Miswired edges — the protocol/compat mistakes allowed through in
    //    realistic mode. Read straight off the edge; no sim run needed.
    for (const e of edges) {
      const mis = (e.data as { miswire?: string } | undefined)?.miswire;
      if (!mis) continue;
      const s = nodes.find((n) => n.id === e.source);
      const t = nodes.find((n) => n.id === e.target);
      results.push({
        severity: 'error',
        title: `Bad wire: ${s ? nodeLabel(s) : e.source} ↔ ${t ? nodeLabel(t) : e.target}`,
        detail: mis,
      });
    }
    // 1b. Actuators commanded but not moving (G26). Check-my-work is the
    //     sandbox-omniscient reveal, so it names the stuck fault directly —
    //     in the field you'd find this via the feedback line (or the zone
    //     never recovering, if the model has no feedback).
    for (const n of nodes) {
      if (nodeKind(n) !== 'actuator') continue;
      const aData = n.data as {
        actuatorState?: { commanded: number; actual: number };
        actuatorModelId?: string;
        fault?: string;
      };
      const st = aData.actuatorState;
      if (aData.fault !== 'stuck' || !st || Math.abs(st.commanded - st.actual) <= 0.05) continue;
      const aModel = aData.actuatorModelId ? findActuatorModel(aData.actuatorModelId) : undefined;
      results.push({
        severity: 'error',
        title: `${nodeLabel(n)} commanded but didn't move`,
        detail:
          `Commanded to ${Math.round(st.commanded * 100)}% but sitting at ${Math.round(st.actual * 100)}% — ` +
          `jammed damper/valve, lost linkage, or a failed motor. ` +
          (aModel?.hasPositionFeedback
            ? `This model has position feedback: wire the actuator to a controller AI/UI and the program can alarm on command-vs-feedback divergence.`
            : `This model has no position feedback, so a real controller can't see it — the symptom is the zone never reaching setpoint.`),
      });
    }
    // 2. BACnet/IP findings the validator last computed (populated while the
    //    sim ticks). Skip info-level so the reveal stays signal, not noise.
    for (const f of trunkInspectorStore.ipv4Findings) {
      if (f.severity === 'info') continue;
      results.push({ severity: f.severity, title: f.title, detail: f.description });
    }
    // 3. MS/TP link-layer findings, same source.
    for (const arr of trunkInspectorStore.findingsByTrunkId.values()) {
      for (const f of arr) {
        if (f.severity === 'info') continue;
        results.push({ severity: f.severity, title: f.title, detail: f.description });
      }
    }
    checkResults = results;
    checkModalOpen = true;
  }

  /**
   * Validate that a proposed wire is realistic given both endpoints' real-
   * world capabilities. Returns null when OK, or a human-readable reason
   * string when the connection should be refused.
   *
   * Rules (kept conservative for now):
   *  - Sensor / safety endpoints only accept "hardwired" (or no-vendor
   *    sensor implies hardwired). Network protocols (BACnet/IP, MS/TP,
   *    N2, LON) require both endpoints to advertise that protocol.
   *  - Controllers must support the chosen network protocol per their
   *    vendor catalog `protocols[]` list. Generic (no-vendor) controllers
   *    are assumed to support anything.
   */
  /** A wire problem. `block` = physically/topologically impossible, always
   *  refused. `fault` = a real-world misconfiguration: refused in easy mode,
   *  but allowed-through (and tagged on the edge) in realistic mode so the
   *  learner can make the mistake and diagnose it. */
  type WireCompat = { severity: 'block' | 'fault'; reason: string };

  function validateWireCompat(srcN: Node, tgtN: Node, kind: WireKind): WireCompat | null {
    const srcKind = nodeKind(srcN);
    const tgtKind = nodeKind(tgtN);

    // 1-supervisor-per-controller rule. In real installs a field equipment
    // controller is hosted by ONE engine; N+1 redundancy (JCI Metasys
    // redundancy, Tridium supervisor pairs) is enterprise-tier and operates
    // through dedicated mechanisms not modeled here. Refuse wires that
    // would give a controller a second supervisor parent.
    if (
      (srcKind === 'supervisor' && tgtKind === 'controller') ||
      (srcKind === 'controller' && tgtKind === 'supervisor')
    ) {
      const ctrlNode = srcKind === 'controller' ? srcN : tgtN;
      const existing = edges.find((e) => {
        // Find an existing supervisor parent on the controller's other end.
        const a = nodes.find((n) => n.id === e.source);
        const b = nodes.find((n) => n.id === e.target);
        if (!a || !b) return false;
        const aIsSup = nodeKind(a) === 'supervisor';
        const bIsSup = nodeKind(b) === 'supervisor';
        const aIsCtrl = a.id === ctrlNode.id;
        const bIsCtrl = b.id === ctrlNode.id;
        return (aIsSup && bIsCtrl) || (bIsSup && aIsCtrl);
      });
      if (existing) {
        const supId = existing.source === ctrlNode.id ? existing.target : existing.source;
        const supNode = nodes.find((n) => n.id === supId);
        const supLabel = supNode ? nodeLabel(supNode) : 'another engine';
        return {
          severity: 'block',
          reason: `${nodeLabel(ctrlNode)} is already hosted by ${supLabel}. Disconnect the existing trunk first — a controller has one upstream engine in real installs (N+1 redundancy is enterprise-tier and isn't modeled here).`,
        };
      }
    }

    // Field-device endpoints (sensor / safety / actuator): only hardwired
    // makes physical sense. A dumb sensor, a dry-contact safety, and a
    // damper/valve actuator all lack an RS-485 / Ethernet transceiver —
    // they land on a hardwired controller terminal (UI/AI/BI for inputs,
    // AO/BO for an actuator command, UI/AI for actuator feedback).
    // Intelligent BACnet sensors/actuators exist in the real world but the
    // sandbox doesn't model them yet.
    const fieldKinds = new Set(['sensor', 'safety', 'actuator']);
    if (fieldKinds.has(srcKind ?? '') || fieldKinds.has(tgtKind ?? '')) {
      if (kind !== 'hardwired') {
        const fieldKind = fieldKinds.has(srcKind ?? '') ? srcKind : tgtKind;
        const noun =
          fieldKind === 'sensor' ? 'sensor'
          : fieldKind === 'safety' ? 'safety device'
          : 'damper/valve actuator';
        const where =
          fieldKind === 'actuator'
            ? 'it’s driven by a hardwired controller AO/BO (and any feedback wires to a UI/AI)'
            : 'it lands on a hardwired UI/AI/BI terminal';
        return {
          severity: 'fault',
          reason: `${kind} can't connect to a ${noun} — it has no network port; ${where}. Use "Hardwired."`,
        };
      }
      return null;
    }

    // One engine per MS/TP field bus. The proposed wire would merge the
    // two endpoints' trunks — if the merged segment ends up with 2+
    // supervisors, that's the "two engines fighting over one field bus"
    // mistake (conflicting polls, overlapping databases, one engine
    // silently demoted to a child MAC). Physically possible → fault, not
    // block: Easy explains and refuses, Realistic lets you live it.
    if (kind === 'mstp') {
      const isMstpEdge = (e: Edge) =>
        (e.data as { wireKind?: string } | undefined)?.wireKind === 'mstp';
      const reach = (startId: string): Set<string> => {
        const seen = new Set<string>([startId]);
        const stack = [startId];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          for (const e of edges) {
            if (!isMstpEdge(e)) continue;
            const other = e.source === cur ? e.target : e.target === cur ? e.source : null;
            if (other && !seen.has(other)) {
              seen.add(other);
              stack.push(other);
            }
          }
        }
        return seen;
      };
      // Closing the chain into a ring: if the two endpoints are ALREADY on
      // the same trunk, this wire creates a loop — two parallel signal
      // paths and no ends to terminate. (RS-485 is a line, not a ring.)
      const srcReach = reach(srcN.id);
      if (srcReach.has(tgtN.id)) {
        return {
          severity: 'fault',
          reason: `${nodeLabel(srcN)} and ${nodeLabel(tgtN)} are already on the same MS/TP trunk — this wire would close the chain into a RING. RS-485 is a line: a loop gives the signal two parallel paths (reflections, phantom echoes) and leaves no ends to terminate. Run the bus end to end instead.`,
        };
      }
      const merged = new Set([...srcReach, ...reach(tgtN.id)]);
      const engines = [...merged]
        .map((id) => nodes.find((n) => n.id === id))
        .filter((n): n is Node => !!n && nodeKind(n) === 'supervisor');
      if (engines.length > 1) {
        return {
          severity: 'fault',
          reason: `This wire puts ${engines.map((n) => nodeLabel(n)).join(' and ')} on the SAME MS/TP trunk. One engine owns a field bus — two supervisors fight over the same devices with conflicting polls, and only one gets MAC 0 (the other is silently demoted to a child). Give each engine its own trunk, or connect them over BACnet/IP.`,
        };
      }
    }

    // MS/TP is a daisy-chain: a third wire landing on a device T-taps the
    // RS-485 bus into a star — reflections corrupt frames at speed. A real
    // mistake a tech can absolutely make (and should get to diagnose in
    // Realistic), so it's a fault, not a block. Repeaters legitimately
    // branch a segment.
    if (kind === 'mstp') {
      for (const n of [srcN, tgtN]) {
        // 'repeater' isn't in the Kind union yet (arrives with the network
        // gear catalog entry later in slice 2) — compare as string.
        const k = nodeKind(n) as string | undefined;
        if (k === 'repeater') continue;
        const deg = edges.filter(
          (e) =>
            (e.data as { wireKind?: string } | undefined)?.wireKind === 'mstp' &&
            (e.source === n.id || e.target === n.id),
        ).length;
        if (deg >= 2) {
          return {
            severity: 'fault',
            reason: `${nodeLabel(n)} already has ${deg} MS/TP wires — a third T-taps the RS-485 bus into a star. Reflections off the unterminated stubs corrupt frames (works at 9600 baud, dies at 38400). Daisy-chain the cable through each device instead, or branch through a repeater.`,
          };
        }
      }
    }

    // Network-protocol wires (BACnet/IP, MS/TP, N2, LON) require the
    // matching protocol on both endpoint controllers.
    const protocolForKind: Record<WireKind, string | null> = {
      'bacnet-ip': 'BACnet/IP',
      'mstp': 'BACnet MS/TP',
      'n2': 'N2',
      'lon': 'LON',
      'hardwired': null,
    };
    const need = protocolForKind[kind];
    if (!need) return null;

    const srcVendorId = (srcN.data as { vendorModelId?: string } | undefined)?.vendorModelId;
    const tgtVendorId = (tgtN.data as { vendorModelId?: string } | undefined)?.vendorModelId;
    const srcModel = srcVendorId ? findControllerModel(srcVendorId) : null;
    const tgtModel = tgtVendorId ? findControllerModel(tgtVendorId) : null;

    // When the wire kind is wrong but the two boxes DO share a protocol,
    // say so — "FEC2611 doesn't speak BACnet/IP" alone reads as "these
    // devices can't talk," when the real fix is usually just a different
    // wire (an SNE reaches its FECs over MS/TP, not IP).
    const WIRE_FOR_PROTOCOL: Record<string, string> = {
      'BACnet/IP': 'BACnet/IP',
      'BACnet MS/TP': 'MS/TP',
      'N2': 'N2',
      'LON': 'LON',
    };
    const sharedWireTip = (): string => {
      const a = srcModel?.protocols as readonly string[] | undefined;
      const b = tgtModel?.protocols as readonly string[] | undefined;
      // A generic (no-model) end speaks anything → the constraint is the
      // modeled end's protocol list.
      const common = a && b ? a.filter((p) => b.includes(p)) : (a ?? b ?? []);
      const usable = common.find((p) => WIRE_FOR_PROTOCOL[p]);
      return usable
        ? ` These two CAN talk — both speak ${usable}. Switch WIRES to ${WIRE_FOR_PROTOCOL[usable]} and re-draw.`
        : '';
    };
    if (srcModel && !srcModel.protocols.includes(need as never)) {
      return {
        severity: 'fault',
        reason: `${srcModel.vendor} ${srcModel.model} doesn't speak ${need} (it supports: ${srcModel.protocols.join(', ')}). On a ${need} trunk it has no matching port, so it'll never communicate.${sharedWireTip()}`,
      };
    }
    if (tgtModel && !tgtModel.protocols.includes(need as never)) {
      return {
        severity: 'fault',
        reason: `${tgtModel.vendor} ${tgtModel.model} doesn't speak ${need} (it supports: ${tgtModel.protocols.join(', ')}). On a ${need} trunk it has no matching port, so it'll never communicate.${sharedWireTip()}`,
      };
    }
    return null;
  }

  /** New wires drawn between handles use the currently-pinned trunk kind. */
  function onConnect(connection: Connection) {
    // SvelteFlow's `bind:edges` auto-adds an edge with the raw drop handles
    // BEFORE this handler runs. Strip that auto-added edge so our own
    // validation + auto-shift logic ends up with exactly one edge using
    // the resolved handles + correct wire kind. Without this, every drag
    // creates two edges — the auto-added one with the raw target handle,
    // and our own with the (possibly auto-shifted) resolved handle.
    edges = edges.filter(
      (e) =>
        !(
          e.source === connection.source &&
          e.target === connection.target &&
          e.sourceHandle === connection.sourceHandle &&
          e.targetHandle === connection.targetHandle
        ),
    );

    const src = nodes.find((n) => n.id === connection.source);
    const tgt = nodes.find((n) => n.id === connection.target);
    if (!src || !tgt) return;

    // Self-loop guard — a device can't wire to itself. Topology-impossible
    // in BOTH modes (not a teachable field mistake — there's no such cable),
    // so it's always refused even in realistic mode.
    if (connection.source === connection.target) {
      flashWireRefusal(`Can't wire ${nodeLabel(src)} to itself — pick two different devices.`);
      return;
    }

    const isTerminal = (h: string | null | undefined) =>
      !!h && h !== 'net-in' && h !== 'net-out';

    function termKindOf(handle: string | null | undefined): 'UI' | 'AI' | 'BI' | 'UO' | 'AO' | 'BO' | null {
      if (!handle || !isTerminal(handle)) return null;
      const prefix = handle.split('-')[0];
      if (prefix === 'UI' || prefix === 'AI' || prefix === 'BI' ||
          prefix === 'UO' || prefix === 'AO' || prefix === 'BO') {
        return prefix;
      }
      return null;
    }
    const OUTPUTS = new Set(['UO', 'AO', 'BO'] as const);

    /** Real BAS controllers expose terminals as IEC 61131-3 channels. UI is
     *  a "universal" channel that can be configured AI or BI per-channel —
     *  so a Pt1000 sensor lands on UI configured as RTD, a dry-contact lands
     *  on UI configured as binary, etc. We treat UI as the universal home
     *  for any input device when a more-specific terminal isn't free. */
    function preferredInputKinds(role: 'sensor' | 'safety' | null): readonly ('UI' | 'AI' | 'BI')[] {
      // Safeties are dry-contact → prefer BI, fall through UI.
      if (role === 'safety') return ['BI', 'UI'];
      // Sensors are analog by default → AI, then UI as fallback. (Binary
      // sensors like OCC still work on UI because UI configures as BI.)
      return ['AI', 'UI', 'BI'];
    }

    /** Find the first un-wired terminal on `node` matching one of `kinds`.
     *  Returns the handle id (e.g. 'UI-3') or null if everything is taken. */
    function nextFreeTerminal(
      node: Node,
      kinds: readonly ('UI' | 'AI' | 'BI' | 'UO' | 'AO' | 'BO')[],
      direction: 'target' | 'source',
    ): string | null {
      const used = new Set<string>();
      for (const e of edges) {
        if (direction === 'target' && e.target === node.id && e.targetHandle) used.add(e.targetHandle);
        if (direction === 'source' && e.source === node.id && e.sourceHandle) used.add(e.sourceHandle);
      }
      // Point counts live on the vendor catalog (looked up by vendorModelId),
      // not on the node data itself. The packaged AHU has a FIXED terminal
      // block (its G36 sequence I/O). For a generic controller with no model
      // picked, fall back to a permissive 16-channel default so the user can
      // still wire things up.
      const data = node.data as { vendorModelId?: string } | undefined;
      const model = data?.vendorModelId ? findControllerModel(data.vendorModelId) : undefined;
      const points: Record<string, number> = model?.points
        ? { ...model.points }
        : nodeKind(node) === 'vahu'
          ? { ...VAHU_POINTS }
          : { UI: 16, AI: 8, BI: 8, UO: 8, AO: 4, BO: 4 };
      for (const kind of kinds) {
        const count = points[kind] ?? 0;
        for (let i = 1; i <= count; i++) {
          const h = `${kind}-${i}`;
          if (!used.has(h)) return h;
        }
      }
      return null;
    }

    const srcKind = nodeKind(src);
    const tgtKind = nodeKind(tgt);

    // ── Wiring revamp slice 1: undirected network gestures ────────────
    // With ConnectionMode.Loose a wire can start/end on ANY handle, in
    // either direction — a trunk has no in/out, so supervisor→AHU and
    // AHU→supervisor are the same cable. Normalize pure net↔net gestures:
    //  · canonical handle fields (source renders from net-out, target into
    //    net-in) so anchors stay tidy regardless of which dots were grabbed
    //  · one cable per device pair — a second net wire between the same two
    //    boxes is a duplicate, not a topology (parallel/ring paths arrive
    //    with the L2 loop work in slice 3)
    const isNetHandle = (h: string | null | undefined): boolean =>
      !h || h === 'net-in' || h === 'net-out';
    const isNetGesture = isNetHandle(connection.sourceHandle) && isNetHandle(connection.targetHandle);
    if (isNetGesture) {
      const dup = edges.find(
        (e) =>
          isNetHandle(e.sourceHandle) &&
          isNetHandle(e.targetHandle) &&
          ((e.source === src.id && e.target === tgt.id) ||
            (e.source === tgt.id && e.target === src.id)),
      );
      if (dup) {
        flashWireRefusal(
          `${nodeLabel(src)} and ${nodeLabel(tgt)} are already wired — one cable per device pair. Delete the existing wire first.`,
        );
        return;
      }
    }
    // Loose mode also lets two terminal handles meet directly. Two OUTPUTS
    // fighting each other (AO→AO) or two INPUTS with no source (AI→AI) are
    // topology-impossible — refuse in both modes (no such cable exists).
    {
      const sKind = termKindOf(connection.sourceHandle);
      const tKindH = termKindOf(connection.targetHandle);
      if (sKind && tKindH) {
        const bothOut = OUTPUTS.has(sKind as 'UO' | 'AO' | 'BO') && OUTPUTS.has(tKindH as 'UO' | 'AO' | 'BO');
        const bothIn = !OUTPUTS.has(sKind as 'UO' | 'AO' | 'BO') && !OUTPUTS.has(tKindH as 'UO' | 'AO' | 'BO');
        if (bothOut || bothIn) {
          flashWireRefusal(
            bothOut
              ? `Can't wire two outputs together (${connection.sourceHandle} ↔ ${connection.targetHandle}) — two driven signals fight each other.`
              : `Can't wire two inputs together (${connection.sourceHandle} ↔ ${connection.targetHandle}) — neither side drives the signal.`,
          );
          return;
        }
      }
    }

    // Auto-shift logic: if the user's wire landed on a controller terminal
    // that's already wired (because handles snap by proximity and a busy
    // controller has lots of taken terminals), find the next free terminal
    // of an appropriate kind and quietly route there instead of refusing.
    // We only auto-shift on the *controller* side — sensors/safeties have a
    // single "q" port so their handle is correct by construction.
    let resolvedSourceHandle = connection.sourceHandle ?? undefined;
    let resolvedTargetHandle = connection.targetHandle ?? undefined;

    // Case: sensor/safety/actuator → controller. Target is the controller's
    // input terminal. Sensor / safety are pure inputs. Actuator → controller
    // is the position-feedback path (an AF24-MFT's 2-10V feedback line wires
    // from the actuator back to a UI/AI on the controller) — same auto-shift
    // semantics as sensors.
    if (
      (srcKind === 'sensor' || srcKind === 'safety' || srcKind === 'actuator') &&
      (tgtKind === 'controller' || tgtKind === 'vahu')
    ) {
      const tgtTermKind = termKindOf(resolvedTargetHandle);
      const targetIsOutput = !!tgtTermKind && OUTPUTS.has(tgtTermKind as 'UO' | 'AO' | 'BO');
      const targetIsTaken = !!resolvedTargetHandle && edges.some(
        (e) => e.target === tgt.id && e.targetHandle === resolvedTargetHandle,
      );
      if (targetIsOutput || targetIsTaken || !isTerminal(resolvedTargetHandle)) {
        // For actuator feedback we want analog inputs first (AI/UI) since
        // position feedback is typically 2-10V or 4-20mA.
        const prefKinds = srcKind === 'actuator' ? (['AI', 'UI'] as const) : preferredInputKinds(srcKind);
        const next = nextFreeTerminal(tgt, prefKinds, 'target');
        if (next) {
          resolvedTargetHandle = next;
        } else {
          flashWireRefusal(
            `${nodeLabel(tgt)} has no free input terminals left. All UI/AI/BI channels are used — disconnect a sensor or add an expansion module.`,
          );
          return;
        }
      }
    }

    // Case: controller → actuator. Source is a controller AO/BO/UO; target
    // is the actuator's net-in. Validate signal type (AO can't drive a
    // binary contactor; BO can't drive a modulating valve) and auto-shift
    // to a free output terminal of the right kind when needed.
    // In REALISTIC mode a deliberate aim at a free wrong-kind output is a
    // teachable field mistake (G25): the wire lands, tagged as a miswire,
    // with zero warning — Check-my-work / the AI reveal it on demand.
    let outputMiswire: string | null = null;
    if ((srcKind === 'controller' || srcKind === 'vahu') && tgtKind === 'actuator') {
      const actuatorModelId = (tgt.data as { actuatorModelId?: string } | undefined)?.actuatorModelId;
      const actuatorModel = actuatorModelId ? findActuatorModel(actuatorModelId) : undefined;
      const wantsAnalog = actuatorModel?.signal === 'analog-0-10v' ||
                          actuatorModel?.signal === 'analog-2-10v' ||
                          actuatorModel?.signal === 'analog-4-20ma';
      const wantsBinary = actuatorModel?.signal === 'binary-dry' ||
                          actuatorModel?.signal === 'three-point';
      // Allowed terminal kinds on the controller side. UO is universal so
      // it's always acceptable. For unknown actuator signals (generic, no
      // model picked) we accept any output terminal.
      const preferredOutputs: readonly ('AO' | 'BO' | 'UO')[] = wantsAnalog
        ? ['AO', 'UO']
        : wantsBinary
          ? ['BO', 'UO']
          : ['AO', 'BO', 'UO'];

      const srcTermKind = termKindOf(resolvedSourceHandle);
      const sourceIsAllowed = !!srcTermKind && (preferredOutputs as readonly string[]).includes(srcTermKind);
      const sourceIsTaken = !!resolvedSourceHandle && edges.some(
        (e) => e.source === src.id && e.sourceHandle === resolvedSourceHandle,
      );
      // Deliberate wrong-kind aim: the handle IS a free output terminal,
      // just not one this actuator's signal can use. Realistic lets the
      // mistake through; Easy keeps the helpful auto-shift below.
      const aimedWrongKind =
        !sourceIsAllowed &&
        !sourceIsTaken &&
        !!srcTermKind &&
        OUTPUTS.has(srcTermKind as 'UO' | 'AO' | 'BO') &&
        !!actuatorModel;
      if (aimedWrongKind && guidanceMode === 'realistic' && actuatorModel) {
        outputMiswire = wantsAnalog
          ? `${actuatorModel.vendor} ${actuatorModel.model} is a modulating actuator (${actuatorModel.signal}) wired to ${resolvedSourceHandle}, a binary output — it will never modulate (at best it slams full open/closed).`
          : `${actuatorModel.vendor} ${actuatorModel.model} is a ${actuatorModel.signal} actuator wired to ${resolvedSourceHandle}, an analog output — a binary device on a modulating signal chatters or never picks up.`;
      } else if (!sourceIsAllowed || sourceIsTaken || !isTerminal(resolvedSourceHandle)) {
        const next = nextFreeTerminal(src, preferredOutputs, 'source');
        if (next) {
          resolvedSourceHandle = next;
        } else if (actuatorModel) {
          // Hard fail with a clear signal-mismatch explanation.
          const need = wantsAnalog ? 'an AO (0-10V / 2-10V / 4-20mA) or UO' :
                       wantsBinary ? 'a BO (dry-contact / 24VAC) or UO' :
                       'an output (AO / BO / UO)';
          flashWireRefusal(
            `${nodeLabel(src)} has no free ${need} for ${actuatorModel.vendor} ${actuatorModel.model} (needs ${actuatorModel.signal}).`,
          );
          return;
        } else {
          flashWireRefusal(
            `${nodeLabel(src)} has no free output terminals. Pick a different actuator or add an expansion module.`,
          );
          return;
        }
      }
    }

    // Mirror case: controller → sensor/safety (user dragged backwards).
    if ((srcKind === 'controller' || srcKind === 'vahu') && (tgtKind === 'sensor' || tgtKind === 'safety')) {
      const srcTermKind = termKindOf(resolvedSourceHandle);
      const sourceIsOutput = !!srcTermKind && OUTPUTS.has(srcTermKind as 'UO' | 'AO' | 'BO');
      const sourceIsTaken = !!resolvedSourceHandle && edges.some(
        (e) => e.source === src.id && e.sourceHandle === resolvedSourceHandle,
      );
      // For a backwards-drag, target the input side: pick a free UI/AI/BI on the controller.
      if (sourceIsOutput || sourceIsTaken || !isTerminal(resolvedSourceHandle)) {
        const next = nextFreeTerminal(src, preferredInputKinds(tgtKind), 'target');
        if (next) {
          resolvedSourceHandle = next;
        } else {
          flashWireRefusal(
            `${nodeLabel(src)} has no free input terminals left. All UI/AI/BI channels are used — disconnect a sensor or add an expansion module.`,
          );
          return;
        }
      }
    }

    // One-wire-per-terminal: real terminal blocks are single-input and
    // single-source. After auto-shift above, the picked terminal is free —
    // but we still need to refuse if the user *deliberately* aimed at a
    // taken terminal in a non-shiftable scenario (e.g., wiring between two
    // controllers, or actuator→controller).
    if (resolvedSourceHandle && isTerminal(resolvedSourceHandle)) {
      const exists = edges.find(
        (e) => e.source === connection.source && e.sourceHandle === resolvedSourceHandle,
      );
      if (exists) {
        flashWireRefusal(
          `Source terminal ${resolvedSourceHandle} on ${nodeLabel(src)} is already wired. Disconnect that wire first — real terminals are single-source.`,
        );
        return;
      }
    }
    if (resolvedTargetHandle && isTerminal(resolvedTargetHandle)) {
      const exists = edges.find(
        (e) => e.target === connection.target && e.targetHandle === resolvedTargetHandle,
      );
      if (exists) {
        flashWireRefusal(
          `Target terminal ${resolvedTargetHandle} on ${nodeLabel(tgt)} is already wired. Disconnect that wire first — real terminals are single-input.`,
        );
        return;
      }
    }

    const kind: WireKind =
      selectedWireKind === 'auto'
        ? defaultWireKind(nodeKind(src), nodeKind(tgt))
        : selectedWireKind;
    const refusal = validateWireCompat(src, tgt, kind);
    // Block always when topology-impossible, or for any fault in easy mode.
    // In realistic mode a 'fault' is allowed through silently — tagged on the
    // edge so "Check my work" / the AI can surface it, but no warning here.
    if (refusal && (refusal.severity === 'block' || guidanceMode === 'easy')) {
      flashWireRefusal(refusal.reason);
      return;
    }
    // ── Direction normalization ───────────────────────────────────────
    // Process links are DIRECTED (flow semantics): equipment pushes air/heat
    // INTO a zone, an actuator drives INTO equipment. A backwards gesture
    // used to create an edge the thermal pass silently ignored — fix the
    // direction instead of punishing the gesture. Network wires get
    // canonical handle anchors (out-bottom → in-top) regardless of which
    // dots were grabbed, since a trunk has no in/out.
    let finalSource = connection.source!;
    let finalTarget = connection.target!;
    let finalSourceHandle = resolvedSourceHandle;
    let finalTargetHandle = resolvedTargetHandle;
    const flowSwap =
      (srcKind === 'zone' && tgtKind === 'equipment') || // canonical: equipment → zone
      (srcKind === 'equipment' && tgtKind === 'actuator'); // canonical: actuator → equipment
    if (flowSwap) {
      [finalSource, finalTarget] = [finalTarget, finalSource];
      [finalSourceHandle, finalTargetHandle] = [finalTargetHandle, finalSourceHandle];
    }
    if (isNetGesture) {
      finalSourceHandle = 'net-out';
      finalTargetHandle = 'net-in';
    }
    const newEdge: Edge = {
      id: `e-${finalSource}-${finalTarget}-${Date.now()}`,
      source: finalSource,
      target: finalTarget,
      sourceHandle: finalSourceHandle,
      targetHandle: finalTargetHandle,
      data: {
        wireKind: kind,
        ...(refusal?.severity === 'fault'
          ? { miswire: refusal.reason }
          : outputMiswire
            ? { miswire: outputMiswire }
            : {}),
      },
    };
    edges = addEdge(withStyle(newEdge), edges);

    // Auto-bind (G41): a sensor landing on a controller immediately gets a
    // thermal zone behind it — no separate "wire as physics target" step.
    // (Idempotent; the Run-start sweep covers loaded/imported canvases.)
    const autoBindCtrl =
      srcKind === 'sensor' && tgtKind === 'controller' ? tgt.id
      : srcKind === 'controller' && tgtKind === 'sensor' ? src.id
      : null;
    if (autoBindCtrl) wireAsPhysicsTarget(autoBindCtrl);
  }

  /**
   * Imperatively delete a node by id. Used by the inspector panel's Delete
   * button. Drops the node + every edge that touched it, then runs the same
   * cascade as keyboard-driven deletion (clean up wired targets, etc.).
   */
  function deleteNodeById(id: string): void {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const removedEdges = edges.filter((e) => e.source === id || e.target === id);
    nodes = nodes.filter((n) => n.id !== id);
    edges = edges.filter((e) => e.source !== id && e.target !== id);
    onNodesDelete([node]);
    if (removedEdges.length > 0) onEdgesDelete(removedEdges);
  }

  /**
   * When nodes get deleted, any wired physics target that referenced them
   * loses its meaning — drop it and unfocus if it was the focus.
   */
  function onNodesDelete(deleted: Node[]) {
    const deletedIds = new Set(deleted.map((n) => n.id));
    // Drop any persisted terminal-config overrides for deleted controllers
    // so the localStorage map doesn't grow unbounded over time.
    for (const node of deleted) {
      if (nodeKind(node) === 'controller') clearAllTerminalConfig(node.id);
    }
    const survivors = wiredTargets.filter(
      (t) => !deletedIds.has(t.controllerId) && !deletedIds.has(t.sensorId),
    );
    if (survivors.length !== wiredTargets.length) {
      wiredTargets = survivors;
      if (focusedTargetId && deletedIds.has(focusedTargetId)) {
        focusedTargetId = wiredTargets[0]?.controllerId ?? null;
      }
      syncRunningState();
    }
  }

  /**
   * When edges get deleted, any wired target whose controller-sensor edge
   * just got removed isn't a valid pair anymore — drop the target.
   */
  function onEdgesDelete(deleted: Edge[]) {
    const deletedIds = new Set(deleted.map((e) => e.id));
    const survivingEdges = edges.filter((e) => !deletedIds.has(e.id));
    const survivors = wiredTargets.filter((t) => {
      return survivingEdges.some(
        (e) =>
          (e.source === t.controllerId && e.target === t.sensorId) ||
          (e.source === t.sensorId && e.target === t.controllerId),
      );
    });
    if (survivors.length !== wiredTargets.length) {
      wiredTargets = survivors;
      if (focusedTargetId && !survivors.find((t) => t.controllerId === focusedTargetId)) {
        focusedTargetId = wiredTargets[0]?.controllerId ?? null;
      }
      syncRunningState();
    }
  }

  /** Standard BACnet MS/TP / N2 baud rate options. 'auto' = use the default
   *  for the wire kind (38400 for MS/TP, 9600 for N2). */
  const BAUD_RATES: readonly (number | 'auto')[] = ['auto', 9600, 19200, 38400, 76800, 115200];

  function defaultBaudForKind(kind: WireKind): number | undefined {
    if (kind === 'mstp') return 38400;
    if (kind === 'n2') return 9600;
    return undefined;
  }

  function setEdgeBaud(edgeId: string, baud: number | 'auto'): void {
    edges = edges.map((e) => {
      if (e.id !== edgeId) return e;
      const data = { ...((e.data as Record<string, unknown>) ?? {}) };
      if (baud === 'auto') {
        delete data.baud;
        data.baudAuto = true;
      } else {
        data.baud = baud;
        delete data.baudAuto;
      }
      return { ...e, data };
    });
  }

  function setEdgeKind(edgeId: string, kind: WireKind) {
    edges = edges.map((e) =>
      e.id === edgeId ? withStyle({ ...e, data: { ...(e.data ?? {}), wireKind: kind } }) : e,
    );
  }

  const selectedEdge = $derived.by(() => {
    const sels = edges.filter((e) => e.selected);
    return sels.length === 1 ? sels[0] : null;
  });

  /**
   * Set of node ids that are "offline" — unreachable from any supervisor over
   * the *healthy* portion of the graph. A broken trunk severs everything past
   * it. If there are no supervisors on the canvas, nothing goes offline
   * (free-floating equipment behaves as if standalone, which is fine for a
   * sandbox where users may build bottom-up).
   */
  const offlineNodes = $derived.by((): Set<string> => {
    // Roots = every supervisor on the canvas (ADX + every engine). They are
    // the source of authority; reachability radiates outward from them.
    const supervisors = nodes.filter((n) => nodeKind(n) === 'supervisor');
    if (supervisors.length === 0) return new Set();

    // Build an adjacency list across non-broken edges only.
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if ((e.data?.comm as string | undefined) === 'broken') continue;
      if (!adj.has(e.source)) adj.set(e.source, []);
      if (!adj.has(e.target)) adj.set(e.target, []);
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }

    const reached = new Set<string>();
    const queue: string[] = [];
    for (const s of supervisors) {
      reached.add(s.id);
      queue.push(s.id);
    }
    while (queue.length > 0) {
      const id = queue.shift()!;
      const neighbors = adj.get(id);
      if (!neighbors) continue;
      for (const n of neighbors) {
        if (!reached.has(n)) {
          reached.add(n);
          queue.push(n);
        }
      }
    }

    const offline = new Set<string>();
    // First pass: virtual controllers inherit their host's reachability
    // + power state. If the host is unreachable or powered off (or
    // missing), the child goes with it — that's the "all eggs in one
    // basket" failure mode of soft controllers.
    for (const n of nodes) {
      if (nodeKind(n) !== 'virtual-controller') continue;
      const d = n.data as { hostId?: string; poweredOff?: boolean };
      if (d.poweredOff) continue; // tracked separately
      if (!d.hostId) {
        // No host — virtual controller has nowhere to live. Treat as offline.
        offline.add(n.id);
        continue;
      }
      const host = nodes.find((h) => h.id === d.hostId);
      if (!host) {
        // Host was deleted — orphaned virtual child.
        offline.add(n.id);
        continue;
      }
      const hostData = host.data as { poweredOff?: boolean };
      if (hostData.poweredOff) {
        offline.add(n.id);
        continue;
      }
      if (!reached.has(host.id)) {
        // Host is unreachable from any supervisor (which would only
        // happen if the host itself is unwired or partitioned). Mirror.
        // Note: hosts are themselves supervisors, so they auto-pass the
        // BFS root check above. This branch is defensive.
        offline.add(n.id);
      }
    }

    for (const n of nodes) {
      // Powered-off devices are deliberately off — that's distinct from
      // "comm-lost", so the stale/offline badges shouldn't fire.
      if ((n.data as { poweredOff?: boolean }).poweredOff) continue;
      // Supervisors themselves never count as "offline" — they're the root.
      if (nodeKind(n) === 'supervisor') continue;
      // Subnet zones are visual containers, not devices — never offline.
      if (isSubnetZone(n)) continue;
      // Thermal zones are physical SPACES, not network devices. A room
      // with no BAS path to a supervisor is unmonitored, not "offline" —
      // its physics keeps running and no stale-comm badge applies.
      // (Found 2026-06-11: mega-site demo's wall-coupled zone row all
      // wore ⌀ OFFLINE because reachability radiates over every edge.)
      if (nodeKind(n) === 'zone') continue;
      // Virtual controllers: handled in the first pass above (host-
      // driven). Skip the wire-based reachability check; they live
      // inside their host, not on a wire.
      if (nodeKind(n) === 'virtual-controller') continue;
      // Routers + BBMD appliances are independent network gear. A
      // freshly-dropped router/BBMD that hasn't been wired yet
      // shouldn't be flagged as "stale comm" — it's just not deployed
      // into the topology yet. They only go offline when they sit
      // BEHIND a broken trunk.
      const k = nodeKind(n);
      if (k === 'router' || k === 'bbmd') {
        // Only mark offline if the node has wires but a broken-trunk
        // partition cuts it off. A completely unwired router/BBMD is
        // simply "not yet deployed."
        const hasAnyEdge = edges.some((e) => e.source === n.id || e.target === n.id);
        if (!hasAnyEdge) continue;
      }
      if (!reached.has(n.id)) offline.add(n.id);
    }
    return offline;
  });
  setContext('basOfflineIds', () => offlineNodes);

  /** Single-selection node — drives the sensor inspector. */
  const selectedNode = $derived.by(() => {
    const sels = nodes.filter((n) => n.selected);
    return sels.length === 1 ? sels[0] : null;
  });

  const selectedSensor = $derived.by(() => {
    if (!selectedNode) return null;
    if (nodeKind(selectedNode) !== 'sensor') return null;
    return selectedNode;
  });

  const selectedController = $derived.by(() => {
    if (!selectedNode) return null;
    if (nodeKind(selectedNode) !== 'controller') return null;
    return selectedNode;
  });

  const selectedZone = $derived.by(() => {
    if (!selectedNode) return null;
    if (nodeKind(selectedNode) !== 'zone') return null;
    return selectedNode;
  });

  const selectedActuator = $derived.by(() => {
    if (!selectedNode) return null;
    if (nodeKind(selectedNode) !== 'actuator') return null;
    return selectedNode;
  });

  const selectedVahu = $derived.by(() => {
    if (!selectedNode) return null;
    if (nodeKind(selectedNode) !== 'vahu') return null;
    return selectedNode;
  });

  /** Single-selection subnet zone — drives the CIDR / label edit panel. */
  const selectedSubnetZone = $derived.by(() => {
    if (!selectedNode) return null;
    if (!isSubnetZone(selectedNode)) return null;
    return selectedNode;
  });

  /** Single-selection BACnet/IP-capable device (supervisor or controller) —
   *  drives the Net.2 IP / BBMD config panel. */
  const selectedIpDevice = $derived.by(() => {
    if (!selectedNode) return null;
    const k = nodeKind(selectedNode);
    if (k !== 'supervisor' && k !== 'controller' && k !== 'bbmd') return null;
    return selectedNode;
  });

  /** Single-selection IP router — drives the Net.3 router-interfaces
   *  config panel. */
  const selectedRouter = $derived.by(() => {
    if (!selectedNode) return null;
    if (nodeKind(selectedNode) !== 'router') return null;
    return selectedNode;
  });

  /** Single-selection virtual controller — drives the host picker. */
  const selectedVirtualController = $derived.by(() => {
    if (!selectedNode) return null;
    if (nodeKind(selectedNode) !== 'virtual-controller') return null;
    return selectedNode;
  });

  /** Set the host supervisor for a virtual controller. */
  function setVirtualHost(virtualId: string, hostId: string | null): void {
    nodes = nodes.map((n) => {
      if (n.id !== virtualId) return n;
      const d = n.data as Record<string, unknown>;
      if (!hostId) {
        const { hostId: _h, hostLabel: _l, ...rest } = d;
        void _h;
        void _l;
        return { ...n, data: rest };
      }
      const hostNode = nodes.find((nn) => nn.id === hostId);
      const hostLabel = hostNode ? (hostNode.data as { label?: string }).label : hostId;
      return { ...n, data: { ...d, hostId, hostLabel } };
    });
  }

  /** Every supervisor on the canvas — used as host candidates for
   *  virtual controllers. Excludes the virtual controller itself in
   *  case the user accidentally tries to self-host. */
  function hostCandidates(_excludeId: string): Array<{ id: string; label: string }> {
    const out: Array<{ id: string; label: string }> = [];
    for (const n of nodes) {
      if (nodeKind(n) !== 'supervisor') continue;
      out.push({ id: n.id, label: (n.data as { label?: string }).label ?? n.id });
    }
    return out;
  }

  /** Update one interface on a router. */
  function updateRouterInterface(
    routerId: string,
    index: number,
    field: 'ip' | 'cidr',
    value: string,
  ): void {
    nodes = nodes.map((n) => {
      if (n.id !== routerId) return n;
      const d = n.data as { routerInterfaces?: Array<{ ip?: string; cidr: string }> };
      const ifs = [...(d.routerInterfaces ?? [])];
      const cur = ifs[index] ?? { ip: '', cidr: '' };
      ifs[index] = { ...cur, [field]: value };
      return { ...n, data: { ...d, routerInterfaces: ifs } };
    });
  }

  function addRouterInterface(routerId: string): void {
    nodes = nodes.map((n) => {
      if (n.id !== routerId) return n;
      const d = n.data as { routerInterfaces?: Array<{ ip?: string; cidr: string }> };
      const ifs = [...(d.routerInterfaces ?? []), { ip: '', cidr: '' }];
      return { ...n, data: { ...d, routerInterfaces: ifs } };
    });
  }

  function removeRouterInterface(routerId: string, index: number): void {
    nodes = nodes.map((n) => {
      if (n.id !== routerId) return n;
      const d = n.data as { routerInterfaces?: Array<{ ip?: string; cidr: string }> };
      const ifs = (d.routerInterfaces ?? []).filter((_, i) => i !== index);
      return { ...n, data: { ...d, routerInterfaces: ifs } };
    });
  }

  /** Set the IP address field, accepting either a plain dotted-quad
   *  ("10.0.1.10") OR a CIDR notation ("10.0.1.10/24"). If a slash is
   *  present and the prefix parses, we auto-populate the subnet mask
   *  too. This is the form a network engineer naturally types, so
   *  rejecting it as "Invalid IP" is a UX footgun. */
  function setIpAddressOrCidr(nodeId: string, raw: string): void {
    const trimmed = raw.trim();
    const slash = trimmed.indexOf('/');
    if (slash > 0) {
      const ipPart = trimmed.slice(0, slash);
      const prefixPart = trimmed.slice(slash + 1);
      const prefix = Number(prefixPart);
      if (
        Number.isInteger(prefix) &&
        prefix >= 0 &&
        prefix <= 32 &&
        /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(ipPart)
      ) {
        const maskBits = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
        const mask = [
          (maskBits >>> 24) & 0xff,
          (maskBits >>> 16) & 0xff,
          (maskBits >>> 8) & 0xff,
          maskBits & 0xff,
        ].join('.');
        nodes = nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const d = n.data as Record<string, unknown>;
          return { ...n, data: { ...d, ipAddress: ipPart, subnetMask: mask } };
        });
        return;
      }
    }
    // Plain IP path — defer to the generic field updater.
    updateNodeField(nodeId, 'ipAddress', raw);
  }

  /** Mutate a single field on a node's data, immutably. Used by the
   *  Net.2 IP / BBMD config panel and the subnet-zone edit panel. */
  function updateNodeField(nodeId: string, field: string, value: unknown): void {
    nodes = nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const d = n.data as Record<string, unknown>;
      // Treat empty strings as "unset" so the validator's
      // "skip devices without IP" path engages.
      if (typeof value === 'string' && value === '') {
        const { [field]: _drop, ...rest } = d;
        void _drop;
        return { ...n, data: rest };
      }
      return { ...n, data: { ...d, [field]: value } };
    });
  }

  /** Toggle the device's power state. A powered-off device is excluded
   *  from network validation, broadcast tracing, and offline-detection
   *  (since "deliberately off" is not the same as "comm-lost"). Sim
   *  programs still tick — that wiring lands in a follow-up. */
  function togglePower(nodeId: string): void {
    nodes = nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const d = n.data as { poweredOff?: boolean } & Record<string, unknown>;
      const next = !d.poweredOff;
      return { ...n, data: { ...d, poweredOff: next } };
    });
  }

  /** Toggle BBMD on/off for a node. When turning OFF, also drop the BDT. */
  function toggleBbmd(nodeId: string, on: boolean): void {
    nodes = nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const d = n.data as Record<string, unknown>;
      if (on) {
        return { ...n, data: { ...d, isBBMD: true, bdtPeers: d.bdtPeers ?? [] } };
      }
      const { isBBMD: _ib, bdtPeers: _bp, ...rest } = d;
      void _ib;
      void _bp;
      return { ...n, data: rest };
    });
  }

  /** Append a single peer IP to a BBMD's BDT (no-op if already present). */
  function addBdtPeer(nodeId: string, peerIp: string): void {
    const trimmed = peerIp.trim();
    if (!trimmed) return;
    nodes = nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const d = n.data as { bdtPeers?: string[] } & Record<string, unknown>;
      const existing = d.bdtPeers ?? [];
      if (existing.includes(trimmed)) return n;
      return { ...n, data: { ...d, bdtPeers: [...existing, trimmed] } };
    });
  }

  /** Remove a peer IP from a BBMD's BDT. */
  function removeBdtPeer(nodeId: string, peerIp: string): void {
    nodes = nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const d = n.data as { bdtPeers?: string[] } & Record<string, unknown>;
      const filtered = (d.bdtPeers ?? []).filter((p) => p !== peerIp);
      return { ...n, data: { ...d, bdtPeers: filtered } };
    });
  }

  /** Visible to the BDT picker: every other device on the canvas that
   *  could legitimately be a BDT peer (dedicated BBMD appliance, OR a
   *  supervisor/controller running BBMD service) with a known IP. */
  function bbmdCandidatesFor(currentNodeId: string): Array<{ id: string; label: string; ip: string; kind: string }> {
    const out: Array<{ id: string; label: string; ip: string; kind: string }> = [];
    for (const n of nodes) {
      if (n.id === currentNodeId) continue;
      const d = n.data as { kind?: string; isBBMD?: boolean; ipAddress?: string; label?: string };
      const isBbmdCapable = d.kind === 'bbmd' || d.isBBMD === true;
      if (!isBbmdCapable) continue;
      if (!d.ipAddress) continue;
      out.push({ id: n.id, label: d.label ?? n.id, ip: d.ipAddress, kind: d.kind ?? '' });
    }
    return out;
  }

  /** Local UI state for the BDT picker popover — which node it's open
   *  for (null = closed) + the manual-entry text. */
  let bdtPickerOpenFor = $state<string | null>(null);
  let bdtPickerManualText = $state('');

  function openBdtPicker(nodeId: string): void {
    bdtPickerOpenFor = nodeId;
    bdtPickerManualText = '';
  }
  function closeBdtPicker(): void {
    bdtPickerOpenFor = null;
    bdtPickerManualText = '';
  }
  function commitBdtManual(nodeId: string): void {
    const v = bdtPickerManualText.trim();
    if (v) addBdtPeer(nodeId, v);
    bdtPickerManualText = '';
  }

  /** Update a single zoneConfig field on the selected zone. Live — the
   *  next sim tick picks it up. */
  function updateZoneConfig(zoneId: string, field: string, value: number): void {
    nodes = nodes.map((n) => {
      if (n.id !== zoneId) return n;
      const data = n.data as { zoneConfig?: Record<string, number>; label?: string };
      const cfg = { ...(data.zoneConfig ?? {}) };
      cfg[field] = value;
      return { ...n, data: { ...data, zoneConfig: cfg } };
    });
  }

  // Broadcast the selected controller's vendor to the Devices drawer so the
  // Expansions sub-tab can grey out incompatible modules.
  $effect(() => {
    if (selectedController) {
      const vendorId = (selectedController.data as { vendorModelId?: string } | undefined)?.vendorModelId;
      const model = vendorId ? findControllerModel(vendorId) : null;
      selectionStore.selectedControllerVendor = model?.vendor ?? null;
    } else {
      selectionStore.selectedControllerVendor = null;
    }
  });

  // Publish nodes + edges so the scenario walkthrough can validate against
  // canvas state without prop-drilling.
  $effect(() => {
    canvasSnapshot.nodes = nodes;
    canvasSnapshot.edges = edges;
  });

  /** Rolling log of alarm transitions — each entry captures a fire or clear
   *  event so the user can scroll back through what happened. */
  type AlarmLogEntry = {
    id: number;
    tick: number;
    controllerId: string;
    controllerLabel: string;
    kind: 'high' | 'low';
    action: 'fire' | 'clear';
    zoneTemp: number;
  };
  let alarmLog = $state.raw<AlarmLogEntry[]>([]);
  let nextAlarmLogId = 0;
  /** Previous-tick alarm state per controller — used to detect transitions. */
  const prevAlarmByController = new Map<string, 'normal' | 'high' | 'low'>();
  const ALARM_LOG_MAX = 50;

  function logAlarmTransition(
    controllerId: string,
    label: string,
    prev: 'normal' | 'high' | 'low',
    next: 'normal' | 'high' | 'low',
    zoneTemp: number,
  ): void {
    if (prev === next) return;
    // Fire: anything → high/low. Clear: high/low → normal.
    if (next !== 'normal') {
      alarmLog = [
        {
          id: nextAlarmLogId++,
          tick,
          controllerId,
          controllerLabel: label,
          kind: next,
          action: 'fire' as const,
          zoneTemp,
        },
        ...alarmLog,
      ].slice(0, ALARM_LOG_MAX);
      logEvent(
        simSecondsElapsed,
        next === 'high' ? 'error' : 'warn',
        label,
        `${next === 'high' ? '▲ HIGH' : '▼ LOW'} TEMP alarm fired at ${zoneTemp.toFixed(1)}°F.`,
        controllerId,
      );
    } else if (prev !== 'normal') {
      alarmLog = [
        {
          id: nextAlarmLogId++,
          tick,
          controllerId,
          controllerLabel: label,
          kind: prev,
          action: 'clear' as const,
          zoneTemp,
        },
        ...alarmLog,
      ].slice(0, ALARM_LOG_MAX);
      logEvent(
        simSecondsElapsed,
        'info',
        label,
        `Alarm cleared — zone back in band (${zoneTemp.toFixed(1)}°F).`,
        controllerId,
      );
    }
  }

  /** Live counts for the status bar — meant to read like a NOC summary. */
  const liveCounts = $derived.by(() => {
    let online = 0;
    let offline = 0;
    let faults = 0;
    let alarms = 0;
    for (const n of nodes) {
      const k = nodeKind(n);
      if (k === 'supervisor') continue;
      if (offlineNodes.has(n.id)) offline++;
      else online++;
      const d = n.data as { fault?: SensorFault; alarm?: 'normal' | 'high' | 'low' } | undefined;
      if (k === 'sensor' && d?.fault && d.fault !== 'normal') faults++;
      if (k === 'controller' && d?.alarm && d.alarm !== 'normal') alarms++;
    }
    return { online, offline, faults, alarms };
  });

  /** Human label for any element/signal — covers the full core SensorSignal set
   *  (model-backed sensors can carry Pt100 / Type III / 20k / nickel, which the
   *  UI SENSOR_TEMPLATES subset doesn't). Used by the sensor inspector's
   *  read-only "Installed element" display. */
  const SIGNAL_LABEL: Record<string, string> = {
    'rtd-pt1000': 'Pt1000 RTD (platinum)',
    'rtd-pt100': 'Pt100 RTD (platinum)',
    'rtd-ni1000': 'Ni1000 RTD (nickel)',
    'thermistor-10k-t2': '10 kΩ Type II thermistor',
    'thermistor-10k-t3': '10 kΩ Type III thermistor',
    'thermistor-20k': '20 kΩ thermistor',
    'analog-0-10v': '0–10 V transmitter',
    'analog-2-10v': '2–10 V transmitter',
    'analog-0-5v': '0–5 V transmitter',
    'analog-4-20ma': '4–20 mA transmitter',
    'binary-dry': 'Dry contact',
    'bacnet-mstp': 'BACnet MS/TP (smart)',
  };
  function signalLabel(s: string | undefined): string {
    if (!s) return '—';
    return SIGNAL_LABEL[s] ?? s;
  }

  /** Command-signal label for an actuator (it RECEIVES a command, so no
   *  "transmitter" suffix like the sensor side). */
  function actuatorSignalLabel(s: string | undefined): string {
    switch (s) {
      case 'analog-0-10v': return '0–10 V';
      case 'analog-2-10v': return '2–10 V';
      case 'analog-4-20ma': return '4–20 mA';
      case 'binary-dry': return 'binary (dry contact)';
      case 'three-point': return '3-point floating';
      case 'bacnet-mstp': return 'BACnet MS/TP';
      default: return s ?? '—';
    }
  }

  /** Generic-sensor element picker, grouped by category so the user picks a real
   *  device class instead of a flat list that mixes resistive elements with
   *  transmitter outputs. (Model-backed sensors skip this — their element is
   *  fixed by the product.) Ids are the UI SENSOR_TEMPLATES subset. */
  const SIGNAL_GROUPS: ReadonlyArray<{ label: string; ids: readonly SensorSignal[] }> = [
    { label: 'Temperature element (resistive — controller reads Ω)', ids: ['rtd-pt1000', 'rtd-ni1000', 'thermistor-10k-t2'] },
    { label: 'Transmitter output (analog — measures, then outputs a standard signal)', ids: ['analog-0-10v', 'analog-4-20ma'] },
    { label: 'Binary (dry contact)', ids: ['binary-dry'] },
  ];

  /** Update a sensor's signal template. UI-only change today — the template
   *  feeds the subtitle and (future) poll-cadence sim, but the thermal model
   *  treats every sensor as a generic zone-temp source. */
  function setSensorSignal(sensorId: string, signal: SensorSignal): void {
    nodes = nodes.map((n) =>
      n.id === sensorId ? { ...n, data: { ...(n.data as Record<string, unknown>), signal } } : n,
    );
  }

  // ── Static (pre-run) terminal-signal pass ───────────────────────────
  // The sim loop owns controllerBridge.terminalSignalsByCtrl while running.
  // But the Terminals panel needs to show wired terminals — and let you set
  // each one's input type — BEFORE you hit Run (programming, then verify).
  // This pass builds the same per-terminal snapshots at a NOMINAL operating
  // point so the panel populates the instant a sensor is wired.

  /** Pull signal + range + subject for a sensor node — shared by the live
   *  sim pass and this static pass. Pure (only reads the node + catalogs). */
  function sensorMetaOf(senNode: Node): {
    signal: import('@bas/core').SensorSignal;
    range: readonly [number, number];
    subject: import('@bas/core').SensorSubject;
  } | null {
    const data = senNode.data as
      | { sensorModelId?: string; signal?: import('@bas/core').SensorSignal }
      | undefined;
    if (data?.sensorModelId) {
      const m = findSensorModel(data.sensorModelId);
      if (m) return { signal: m.signal, range: m.range, subject: m.subject };
    }
    if (data?.signal) {
      const tpl = SENSOR_TEMPLATE_BY_ID.get(
        data.signal as Parameters<typeof SENSOR_TEMPLATE_BY_ID.get>[0],
      );
      if (tpl) {
        let subject: import('@bas/core').SensorSubject = 'temp';
        switch (data.signal) {
          case 'analog-0-10v': subject = 'damper-position'; break;
          case 'analog-4-20ma': subject = 'pressure-differential'; break;
          case 'binary-dry': subject = 'occupancy'; break;
          default: subject = 'temp';
        }
        return { signal: data.signal, range: tpl.range, subject };
      }
    }
    return null;
  }

  /** Rebuild terminal snapshots for every controller from the current wiring,
   *  at a nominal operating point. Only used while the sim is stopped. */
  function runStaticBridgePass(): void {
    const NOMINAL = { hour: 12, actuator: 0, zoneTemp: 72, outsideTemp: 72 };
    for (const ctrl of nodes) {
      if (nodeKind(ctrl) !== 'controller') continue;
      const perCtrl = new Map<string, TerminalSignalSnapshot>();
      for (const edge of edges) {
        let sensorEnd: string | null = null;
        let terminalHandle: string | null | undefined = null;
        if (edge.target === ctrl.id) {
          sensorEnd = edge.source;
          terminalHandle = edge.targetHandle;
        } else if (edge.source === ctrl.id) {
          sensorEnd = edge.target;
          terminalHandle = edge.sourceHandle;
        } else {
          continue;
        }
        const senNode = nodes.find((n) => n.id === sensorEnd);
        if (!senNode) continue;
        // Actuator feedback rows show pre-run too (position 0% → 2V), so
        // the terminal + its programmed type are visible BEFORE ▶ Run.
        if (nodeKind(senNode) === 'actuator') {
          if (edge.target !== ctrl.id) continue;
          const aData = senNode.data as {
            actuatorModelId?: string;
            actuatorState?: { actual: number };
            label?: string;
          };
          const aModel = aData.actuatorModelId ? findActuatorModel(aData.actuatorModelId) : undefined;
          if (!aModel?.hasPositionFeedback) continue;
          if (!terminalHandle) terminalHandle = `auto:${aData.label ?? sensorEnd}`;
          const fbPct = Math.max(0, Math.min(100, (aData.actuatorState?.actual ?? 0) * 100));
          const fbRaw = engToSignal(fbPct, 'analog-2-10v', [0, 100]);
          const fbDefaultCfg = defaultTerminalConfig('analog-2-10v', [0, 100]);
          const fbTermCfg = resolveTerminalConfig(ctrl.id, terminalHandle, fbDefaultCfg);
          perCtrl.set(terminalHandle, {
            raw: fbRaw,
            config: fbTermCfg,
            scaled: signalToEng(fbRaw, fbTermCfg),
            sensorNodeId: senNode.id,
            isPrimary: false,
            installedSignal: 'analog-2-10v',
          });
          continue;
        }
        if (nodeKind(senNode) !== 'sensor') continue;
        if (!terminalHandle) {
          const senLabel = (senNode.data as { label?: string } | undefined)?.label ?? sensorEnd;
          terminalHandle = `auto:${senLabel}`;
        }
        const meta = sensorMetaOf(senNode);
        if (!meta) continue;
        const sFault = (senNode.data as { fault?: string } | undefined)?.fault;
        const sigFault: SignalFault | undefined =
          sFault === 'open' ? 'open-circuit' : sFault === 'short' ? 'short-circuit' : undefined;
        const reading = computeSensorReading(meta.subject, NOMINAL, {
          signal: meta.signal,
          range: meta.range,
          fault: sigFault,
        });
        if (!reading.raw) continue;
        const defaultCfg = defaultTerminalConfig(meta.signal, meta.range);
        const termCfg = resolveTerminalConfig(ctrl.id, terminalHandle, defaultCfg);
        const scaled = signalToEng(reading.raw, termCfg);
        perCtrl.set(terminalHandle, {
          raw: reading.raw,
          config: termCfg,
          scaled,
          sensorNodeId: senNode.id,
          isPrimary: false,
          installedSignal: meta.signal,
        });
      }
      if (perCtrl.size > 0) controllerBridge.terminalSignalsByCtrl.set(ctrl.id, perCtrl);
      else controllerBridge.terminalSignalsByCtrl.delete(ctrl.id);
    }
    bumpBridgeTick();
  }

  // Keep the Terminals panel live while STOPPED: rebuild snapshots whenever the
  // wiring or a terminal's configured input type changes. While running, the
  // sim loop owns the bridge, so this stands down. The write to the (shared)
  // controllerBridge state is wrapped in untrack() — we subscribe to the inputs
  // below, but the bridge mutation must not feed back into this effect.
  $effect(() => {
    // Touch deps so the effect re-runs on topology / config changes.
    void edges;
    void nodes;
    void terminalConfigStore.rev;
    const isRunning = running;
    if (isRunning) return;
    untrack(() => runStaticBridgePass());
  });

  /** Set or clear a controller's high/low alarm threshold from the inspector. */
  function setControllerAlarm(controllerId: string, which: 'high' | 'low', raw: string): void {
    const parsed = raw === '' ? undefined : Number(raw);
    const value = parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
    const key = which === 'high' ? 'highAlarm' : 'lowAlarm';
    nodes = nodes.map((n) =>
      n.id === controllerId
        ? { ...n, data: { ...(n.data as Record<string, unknown>), [key]: value } }
        : n,
    );
  }

  /** Flip a device's RS-485 EOL termination switch (G-topology / slice 2).
   *  Stored on node data so it persists + serializes with scenarios; the
   *  topology validator checks placement against the physical chain ends. */
  function setNodeEol(nodeId: string, on: boolean): void {
    nodes = nodes.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...(n.data as Record<string, unknown>), eolTerminated: on } }
        : n,
    );
  }

  /** Set the MS/TP MAC address (forcedMac) for a controller. Empty
   *  string clears the override, returning the controller to
   *  auto-assignment. Out-of-range values are ignored. */
  function setControllerMac(controllerId: string, raw: string): void {
    if (raw === '') {
      nodes = nodes.map((n) => {
        if (n.id !== controllerId) return n;
        const { forcedMac: _f, ...rest } = n.data as Record<string, unknown>;
        void _f;
        return { ...n, data: rest };
      });
      return;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 127) return;
    nodes = nodes.map((n) =>
      n.id === controllerId
        ? { ...n, data: { ...(n.data as Record<string, unknown>), forcedMac: parsed } }
        : n,
    );
  }

  /** Set the BACnet Device Instance override for a controller. Empty
   *  string clears the override and falls back to the default
   *  (1000 + mac) scheme. Out-of-range values are ignored. */
  function setControllerDeviceInstance(controllerId: string, raw: string): void {
    if (raw === '') {
      nodes = nodes.map((n) => {
        if (n.id !== controllerId) return n;
        const { deviceInstance: _di, ...rest } = n.data as Record<string, unknown>;
        void _di;
        return { ...n, data: rest };
      });
      return;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 4194302) return;
    nodes = nodes.map((n) =>
      n.id === controllerId
        ? { ...n, data: { ...(n.data as Record<string, unknown>), deviceInstance: parsed } }
        : n,
    );
  }

  /** Look up the live MAC address a controller currently holds on its
   *  trunk. Returns null if the controller isn't on an MS/TP trunk yet
   *  (or the sim has never ticked). Read from mstpTrunkStates which
   *  BuildCanvas already maintains per-tick. */
  function mstpDeviceLookup(nodeId: string): number | null {
    for (const trunk of mstpTrunkStates.values()) {
      for (const d of trunk.devices) {
        if (d.nodeId === nodeId) return d.mac;
      }
    }
    return null;
  }

  /** Engage / release manual override on the actuator. Engaging captures the
   *  current PI output as the starting override value so the actuator doesn't
   *  jump on engage. Releasing clears the override and PI takes back over. */
  function toggleOverride(controllerId: string, on: boolean): void {
    const sys = runningSystems.get(controllerId);
    if (on) {
      const initial = sys ? sys.actuator : 0;
      nodes = nodes.map((n) =>
        n.id === controllerId
          ? {
              ...n,
              data: { ...(n.data as Record<string, unknown>), manualOverride: initial },
            }
          : n,
      );
      if (sys) sys.manualOverride = initial;
    } else {
      nodes = nodes.map((n) => {
        if (n.id !== controllerId) return n;
        const { manualOverride: _drop, ...rest } = n.data as Record<string, unknown>;
        return { ...n, data: rest };
      });
      if (sys) sys.manualOverride = null;
    }
  }

  function setOverrideValue(controllerId: string, value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    nodes = nodes.map((n) =>
      n.id === controllerId
        ? {
            ...n,
            data: { ...(n.data as Record<string, unknown>), manualOverride: clamped },
          }
        : n,
    );
    const sys = runningSystems.get(controllerId);
    if (sys) sys.manualOverride = clamped;
  }

  /** Inject / clear the actuator 'stuck' fault (G26). The dynamics pass
   *  freezes `actual` while stuck — with position feedback wired, the
   *  command-vs-feedback divergence is the diagnosable symptom. */
  function setActuatorFault(actuatorId: string, fault: 'stuck' | undefined): void {
    const actNode = nodes.find((n) => n.id === actuatorId);
    const prev = (actNode?.data as { fault?: string } | undefined)?.fault;
    nodes = nodes.map((n) =>
      n.id === actuatorId ? { ...n, data: { ...(n.data as Record<string, unknown>), fault } } : n,
    );
    if (prev !== fault && actNode) {
      logEvent(
        tick,
        'info',
        'sim',
        fault === 'stuck'
          ? `Fault injected: ${nodeLabel(actNode)} is stuck — commands will no longer move it.`
          : `Fault cleared: ${nodeLabel(actNode)} moves freely again.`,
      );
    }
  }

  /** Inject a fault on the sensor. Updates the node's data so it persists into
   *  localStorage / scenario save, AND mutates the running thermal sim (if any)
   *  so the change is visible on the next tick. */
  function setSensorFault(sensorId: string, fault: SensorFault): void {
    const sensorNode = nodes.find((n) => n.id === sensorId);
    const prev = (sensorNode?.data as { fault?: SensorFault } | undefined)?.fault ?? 'normal';
    nodes = nodes.map((n) =>
      n.id === sensorId ? { ...n, data: { ...(n.data as Record<string, unknown>), fault } } : n,
    );
    // Find the wired target this sensor belongs to and push the fault into
    // its live SingleZoneSystem so the trace reacts immediately.
    const target = wiredTargets.find((t) => t.sensorId === sensorId);
    if (target) {
      const sys = runningSystems.get(target.controllerId);
      if (sys) sys.setFault(fault);
    }
    // Emit a runtime log entry when fault actually changes
    if (prev !== fault) {
      const label = sensorNode ? nodeLabel(sensorNode) : sensorId;
      if (fault === 'normal') {
        logEvent(simSecondsElapsed, 'info', label, `Sensor fault cleared (was ${prev}); reading back in range.`);
      } else {
        const msg: Record<Exclude<SensorFault, 'normal'>, string> = {
          open: 'Sensor open-circuit detected — reading pinned at +250°F (full-scale high). Check wire continuity.',
          short: 'Sensor shorted leads detected — reading pinned at -40°F (full-scale low). Check wiring.',
          stuck: 'Sensor frozen at last good value — possible firmware lockup or comm fault upstream.',
          drift: 'Sensor reading drifting ~1°F per 10 sim-min. Field calibration recommended.',
          calibration: 'Sensor reads with a persistent +5°F bias — needs field calibration or relocation out of direct sun.',
          noise: 'Sensor reading shows high-frequency jitter (~1.5°F RMS). Check shielding / EMI / VFD cable separation.',
          intermittent: 'Sensor drops to a rail intermittently — likely a loose terminal screw or marginal connector.',
          rail: 'Sensor pegged at one rail of the scale. ADC saturated, fully-failed signal, or shorted-to-supply.',
        };
        const severe = new Set<SensorFault>(['open', 'short', 'rail']);
        const level: 'warn' | 'error' = severe.has(fault) ? 'error' : 'warn';
        logEvent(simSecondsElapsed, level, label, msg[fault]);
      }
    }
  }

  // ============ Topology validation (live, build-mode checks) ============

  type TopoFinding = {
    level: 'error' | 'warning' | 'info';
    ruleId: string;
    message: string;
    subjectId?: string;
  };

  /** MS/TP and N2 device-count limits we surface as warnings/errors. */
  const TRUNK_LIMITS: Partial<
    Record<WireKind, { recommended: number; max: number; label: string }>
  > = {
    mstp: { recommended: 30, max: 127, label: 'MS/TP' },
    n2: { recommended: 50, max: 100, label: 'N2' },
  };

  const topologyFindings = $derived.by((): TopoFinding[] => {
    const findings: TopoFinding[] = [];
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const labelOf = (id: string): string => {
      const n = nodeById.get(id);
      return n ? nodeLabel(n) : id;
    };

    // 1. Trunk device count per (parent, wireKind) pair
    type TrunkKey = `${string}|${string}`;
    const trunkChildren = new Map<TrunkKey, string[]>();
    for (const e of edges) {
      const wk = (e.data?.wireKind as WireKind) ?? undefined;
      if (!wk || !TRUNK_LIMITS[wk]) continue;
      const key: TrunkKey = `${e.source}|${wk}`;
      const arr = trunkChildren.get(key) ?? [];
      arr.push(e.target);
      trunkChildren.set(key, arr);
    }
    for (const [key, children] of trunkChildren) {
      const [parentId, wk] = key.split('|') as [string, WireKind];
      const limits = TRUNK_LIMITS[wk]!;
      if (children.length > limits.max) {
        findings.push({
          level: 'error',
          ruleId: `${wk}-over-max`,
          message: `${labelOf(parentId)}: ${limits.label} trunk has ${children.length} devices (hard max ${limits.max})`,
          subjectId: parentId,
        });
      } else if (children.length > limits.recommended) {
        findings.push({
          level: 'warning',
          ruleId: `${wk}-over-recommended`,
          message: `${labelOf(parentId)}: ${limits.label} trunk has ${children.length} devices (recommended max ${limits.recommended})`,
          subjectId: parentId,
        });
      }
    }

    // 2. Hardwired wires should terminate at a field device. The leaf
    // set grew as the sim did: sensors/safeties (original), then
    // actuators + equipment + zones (process chain: controller → actuator
    // → equipment → zone, plus zone↔zone shared walls and actuator
    // position-feedback wired back into a controller). Found stale
    // 2026-06-11 when the mega-site demo lit 14 false warnings on
    // perfectly legitimate process wiring.
    const HARDWIRED_LEAF_KINDS = new Set(['sensor', 'safety', 'actuator', 'equipment', 'zone', 'vahu']);
    for (const e of edges) {
      const wk = (e.data?.wireKind as WireKind) ?? undefined;
      if (wk !== 'hardwired') continue;
      const sk = nodeKind(nodeById.get(e.source)!);
      const tk = nodeKind(nodeById.get(e.target)!);
      const leaf = HARDWIRED_LEAF_KINDS.has(sk ?? '') || HARDWIRED_LEAF_KINDS.has(tk ?? '');
      if (!leaf) {
        findings.push({
          level: 'warning',
          ruleId: 'hardwired-no-leaf',
          message: `Hardwired wire ${labelOf(e.source)} → ${labelOf(e.target)} doesn't end at a field device (sensor, safety, actuator, equipment, or zone)`,
          subjectId: e.id,
        });
      }
    }

    // 3. Sensor / Safety connected via non-hardwired wire
    for (const e of edges) {
      const wk = (e.data?.wireKind as WireKind) ?? undefined;
      if (!wk || wk === 'hardwired') continue;
      const sk = nodeKind(nodeById.get(e.source)!);
      const tk = nodeKind(nodeById.get(e.target)!);
      const leafKind =
        sk === 'sensor' || sk === 'safety' ? sk : tk === 'sensor' || tk === 'safety' ? tk : null;
      if (leafKind) {
        findings.push({
          level: 'warning',
          ruleId: 'leaf-not-hardwired',
          message: `${labelOf(e.source)} ↔ ${labelOf(e.target)}: ${leafKind} should connect via Hardwired, not ${WIRE_KIND_BY_ID.get(wk)?.label ?? wk}`,
          subjectId: e.id,
        });
      }
    }

    // 4. Supervisor downstream — supervisors should be roots.
    // EXCEPT supervisor↔supervisor BACnet/IP links: that's how real
    // sites peer engines (BBMD BDT partners, site-director ↔ engine).
    // The campus/BBMD demos and the mega site all carry one — was a
    // standing false warning until 2026-06-11.
    for (const e of edges) {
      const tgt = nodeById.get(e.target);
      if (!tgt || nodeKind(tgt) !== 'supervisor') continue;
      const src = nodeById.get(e.source);
      const wk = (e.data?.wireKind as WireKind) ?? undefined;
      if (src && nodeKind(src) === 'supervisor' && wk === 'bacnet-ip') continue;
      findings.push({
        level: 'warning',
        ruleId: 'supervisor-downstream',
        message: `${labelOf(e.target)} is a Supervisor wired downstream of ${labelOf(e.source)} — supervisors are usually roots`,
        subjectId: e.id,
      });
    }

    // 5. Orphan nodes
    const referenced = new Set<string>();
    for (const e of edges) {
      referenced.add(e.source);
      referenced.add(e.target);
    }
    for (const n of nodes) {
      // Subnet-zone containers are drawn around devices, never wired —
      // "not connected" is their natural state, not a finding.
      if (isSubnetZone(n)) continue;
      if (!referenced.has(n.id)) {
        findings.push({
          level: 'info',
          ruleId: 'orphan-node',
          message: `${nodeLabel(n)} (${nodeKind(n)}) is not connected to anything`,
          subjectId: n.id,
        });
      }
    }

    return findings;
  });

  const findingsByLevel = $derived.by(() => {
    let errors = 0,
      warnings = 0,
      infos = 0;
    for (const f of topologyFindings) {
      if (f.level === 'error') errors++;
      else if (f.level === 'warning') warnings++;
      else infos++;
    }
    return { errors, warnings, infos };
  });

  let showFindings = $state(false);

  /** Currently-expanded imported engine, if any. At most one at a time. */
  let focusedEngineId = $state<string | null>(null);

  /**
   * Engine-focus mode for imported topologies.
   * - Default (focusedEngineId === null): all imported engines visible,
   *   no imported controllers visible. ADX + user-added nodes always visible.
   * - Focused on engine X: only X (among imported engines) is visible, and
   *   only X's imported controllers are visible. Other imported engines and
   *   their controllers are hidden so the focused engine's children have
   *   the canvas to themselves.
   */
  function applyEngineFocus() {
    const focused = focusedEngineId;
    const hiddenNodeIds = new Set<string>();

    nodes = nodes.map((n) => {
      const data = n.data as Record<string, unknown> | undefined;
      const isImportedEngine = data?.childCount !== undefined;
      const importedFrom = data?.importedFromEngine as string | undefined;

      let hidden = false;
      if (focused) {
        if (isImportedEngine) hidden = n.id !== focused;
        else if (importedFrom !== undefined) hidden = importedFrom !== focused;
      } else {
        if (importedFrom !== undefined) hidden = true;
      }

      if (hidden) hiddenNodeIds.add(n.id);

      // Update collapsed flag on imported engines for the chevron.
      if (isImportedEngine) {
        const collapsed = focused !== n.id;
        return { ...n, hidden, data: { ...data, collapsed } };
      }
      return { ...n, hidden };
    });

    edges = edges.map((e) => {
      const hidden = hiddenNodeIds.has(e.source) || hiddenNodeIds.has(e.target);
      return { ...e, hidden };
    });
  }

  function toggleSupervisorExpand(supervisorId: string) {
    focusedEngineId = focusedEngineId === supervisorId ? null : supervisorId;
    applyEngineFocus();
  }

  function onNodeClick({ node }: { node: Node }) {
    // Imported supervisor with hidden children → toggle expand.
    if (nodeKind(node) === 'supervisor') {
      const data = node.data as Record<string, unknown>;
      const childCount = data?.childCount as number | undefined;
      if (childCount && childCount > 0) {
        toggleSupervisorExpand(node.id);
      }
      return;
    }
    if (nodeKind(node) !== 'controller') return;
    const sensor = findConnectedSensor(node.id);
    if (!sensor) return; // can't wire physics without a sensor

    // Plain node click means "show me this controller's inspector" —
    // svelte-flow handles the selection itself. We only handle the
    // focus-shift case so the tune panel follows the user's attention
    // when they're cycling through wired controllers. Explicit wire /
    // unwire is now exclusively the inspector's "→ Make this the tune
    // target" / "→ Wire as physics target" buttons (also reachable from
    // the sidebar). The old click-to-unwire toggle was footgun-y: it
    // ripped the physics target out from under anyone who clicked a
    // controller just to open its inspector.
    const existing = wiredTargets.find((t) => t.controllerId === node.id);
    if (existing) {
      if (focusedTargetId !== node.id) {
        focusedTargetId = node.id;
        syncRunningState();
      }
    }
    // No-op when the controller isn't wired yet — the inspector shows
    // a "→ Wire as physics target" button for that path.
  }

  /** Bind a sensor-wired controller to the thermal sim (creates its
   *  wiredTarget). Idempotent. Works mid-run too — syncRunningState adds
   *  the system at the current sim clock. This used to be a dead button:
   *  the inspector's "→ Wire as physics target" pointed at onNodeClick,
   *  which had lost its wiring path in a refactor and silently no-opped
   *  (found by James — "not sure if the wire as physics target works?"). */
  function wireAsPhysicsTarget(controllerId: string): boolean {
    if (wiredTargets.some((t) => t.controllerId === controllerId)) return true;
    const sensor = findConnectedSensor(controllerId);
    if (!sensor) return false;
    wiredTargets = [
      ...wiredTargets,
      { controllerId, sensorId: sensor.id, config: { ...DEFAULT_CONFIG } },
    ];
    if (!focusedTargetId) focusedTargetId = controllerId;
    const ctrl = nodes.find((n) => n.id === controllerId);
    logEvent(
      simSecondsElapsed,
      'info',
      'sim',
      `${ctrl ? nodeLabel(ctrl) : controllerId} bound as a physics target — its sensor pair now drives a thermal zone, and AI:1 publishes the live temp on the BACnet side.`,
    );
    syncRunningState();
    return true;
  }

  /** Remove the focused target. Used by the sidebar ✕ button. */
  function clearPhysicsTarget() {
    if (!focusedTargetId) return;
    wiredTargets = wiredTargets.filter((t) => t.controllerId !== focusedTargetId);
    focusedTargetId = wiredTargets[0]?.controllerId ?? null;
    syncRunningState();
  }

  // Auto-cleanup
  $effect(() => {
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  });

  /**
   * When App.svelte hands us a pending topology import (user clicked
   * "Open in Build" from the dbexport tool), swap it onto the canvas.
   * Clears all wired targets and sim state since the imported topology
   * uses fresh node ids that don't match the previous canvas.
   */
  $effect(() => {
    const pending = importStore.pending;
    if (!pending) return;
    // Clear the pending slot so we don't re-apply on every reactive recompute.
    importStore.pending = null;
    stop();
    tick = 0;
    runningSamples = new Map();
    nodes = pending.nodes;
    edges = pending.edges.map(withStyle);
    wiredTargets = [];
    focusedTargetId = null;
    focusedEngineId = null;
    // Reset name counters so future palette drops don't collide with imp-*
    // ids. nextId picks up safely past the highest imp- id.
    for (const k of Object.keys(counters)) counters[k] = 0;
    let maxImp = 100;
    for (const n of nodes) {
      const m = /^imp-(\d+)$/.exec(n.id);
      if (m) maxImp = Math.max(maxImp, parseInt(m[1], 10) + 1);
    }
    nextId = maxImp;
    // Apply the default focus state (all engines visible, controllers hidden).
    applyEngineFocus();
  });

  // ============ localStorage auto-persist ============

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    // Track the state we want to persist. (Reads create the dependencies.)
    const _deps: unknown[] = [
      nodes,
      edges,
      wiredTargets,
      focusedTargetId,
      nextId,
      selectedWireKind,
      activePresetId,
      scenarioBaseline,
      counters,
    ];
    void _deps;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      if (typeof localStorage === 'undefined') return;
      try {
        const cleanNodes = nodes.map((n) => {
          const data = n.data as Record<string, unknown>;
          const { runtime: _runtime, ...rest } = data;
          return { ...n, data: rest };
        });
        const state: PersistedState = {
          version: 1,
          nodes: cleanNodes,
          edges: edges.map((e) => ({ ...e, animated: false, selected: false })),
          wiredTargets,
          focusedTargetId,
          counters: { ...counters },
          nextId,
          selectedWireKind,
          activePresetId,
          scenarioBaseline,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Out of quota or denied — ignore; user's work is just not persistent this session.
      }
    }, 300);
  });

  // ─── CLI bridge ─────────────────────────────────────────────────────────
  // Expose snapshot + config-mutation hooks so the CLIPanel can:
  //   - render `show points` and `show config` from live sim state
  //   - apply `set setpoint 72` against the target's config (which the
  //     running SingleZoneSystem reads each tick — same object ref)
  onMount(() => {
    // Load persisted terminal-config overrides before the first sim tick
    // so user-set input types take effect from tick 1.
    rehydrateTerminalConfigs();
    // Expose canvas actions to the App header so Clear / Reset / Save
    // are reachable without scrolling through the bottom dock.
    canvasActions.clear = clearAll;
    canvasActions.reset = resetCanvas;
    canvasActions.saveScenario = saveScenario;
    canvasActions.addSubnetZone = createSubnetZone;
    registerBridge({
      getSnapshot(controllerId): ControllerSnapshot | null {
        const target = wiredTargets.find((t) => t.controllerId === controllerId);
        if (!target) return null;
        const hist = runningSamples.get(controllerId);
        const last = hist && hist.length > 0 ? hist[hist.length - 1] : null;
        const node = nodes.find((n) => n.id === controllerId);
        const vendorModelId = (node?.data as { vendorModelId?: string } | undefined)?.vendorModelId;
        return {
          sensed: last?.T_sensed ?? target.config.initialZone,
          setpoint: last?.setpoint ?? target.config.setpoint,
          oat: last?.T_OA ?? target.config.outdoorAir,
          actuator: last?.actuator ?? 0,
          mode: target.config.mode ?? 'cool',
          Kp: target.config.Kp,
          Ki: target.config.Ki,
          vendorModelId,
        };
      },
      setConfig(controllerId, key, value) {
        const target = wiredTargets.find((t) => t.controllerId === controllerId);
        if (!target) return `controller "${controllerId}" not wired to a sensor`;
        // Mutate the target's config in place — same object ref as the
        // running system's config, so changes apply immediately.
        const cfg = target.config as unknown as Record<string, unknown>;
        if (key === 'mode') {
          if (value !== 'cool' && value !== 'heat') return `mode must be cool|heat`;
          cfg.mode = value;
        } else {
          if (typeof value !== 'number') return `${key} expects a number`;
          cfg[key] = value;
        }
        // ── Emit a BACnet WriteProperty packet so the user sees the CLI
        // command land on the bus. We map the CLI keys to BACnet object
        // refs the supervisor would actually write:
        //   - setpoint → AV:1 (Cooling/Heating Setpoint)
        //   - Kp / Ki → AV:2 / AV:3 (tuning constants exposed as AVs)
        //   - mode → MSV:1 (multistate-value, 1=cool 2=heat)
        // The packet only fires if the controller sits on an MS/TP trunk
        // (otherwise there's no bus to write across — it'd be over BACnet/IP).
        const trunkForCtrl = (() => {
          for (const [tid, state] of mstpTrunkStates) {
            const dev = state.devices.find((d) => d.nodeId === controllerId);
            if (dev) return { trunkId: tid, mac: dev.mac, label: dev.label, devices: state.devices, baud: state.baud };
          }
          return null;
        })();
        if (trunkForCtrl) {
          const writeLatencyS = mstpServiceLatencySeconds(trunkForCtrl.baud);
          const trunkLabelStr = trunkForCtrl.devices.length > 0
            ? `${trunkForCtrl.devices[0].label} → ${trunkForCtrl.devices[trunkForCtrl.devices.length - 1].label}`
            : 'trunk';
          let objectId = 'AV:1';
          if (key === 'Kp') objectId = 'AV:2';
          else if (key === 'Ki') objectId = 'AV:3';
          else if (key === 'mode') objectId = 'MSV:1';
          const writeVal: number | boolean =
            key === 'mode'
              ? (value === 'heat' ? 2 : 1)
              : (typeof value === 'number' ? value : 0);
          const wpInvokeId = bumpInvokeId();
          logBacnetPacket({
            simSec: simSecondsElapsed,
            trunkId: trunkForCtrl.trunkId,
            trunkLabel: trunkLabelStr,
            srcMac: 0,
            dstMac: trunkForCtrl.mac,
            service: 'WriteProperty',
            objectId,
            value: writeVal,
            summary: `MAC 0 → ${trunkForCtrl.label}: WriteProperty ${objectId} present-value (85) = ${typeof writeVal === 'number' ? writeVal.toFixed(2) : writeVal} (CLI set ${key}) · invokeId ${wpInvokeId} · NPDU Expecting-Reply`,
            layer: 'app',
          });
          logBacnetPacket({
            simSec: simSecondsElapsed + writeLatencyS,
            trunkId: trunkForCtrl.trunkId,
            trunkLabel: trunkLabelStr,
            srcMac: trunkForCtrl.mac,
            dstMac: 0,
            service: 'WriteProperty-ACK',
            objectId,
            value: writeVal,
            summary: `${trunkForCtrl.label} → MAC 0: WriteProperty-ACK ${objectId} OK · invokeId ${wpInvokeId}`,
            layer: 'app',
          });
        }
        return null;
      },
    });
  });

  function resetCanvas() {
    if (!confirm('Reset to an empty canvas? Your current work will be lost.')) return;
    stop();
    tick = 0;
    runningSamples = new Map();
    const d = defaultsBundle();
    nodes = d.nodes;
    edges = d.edges;
    wiredTargets = d.wiredTargets;
    focusedTargetId = d.focusedTargetId;
    for (const k of Object.keys(counters)) delete counters[k];
    Object.assign(counters, d.counters);
    nextId = d.nextId;
    selectedWireKind = d.selectedWireKind;
    activePresetId = d.activePresetId;
    scenarioBaseline = d.scenarioBaseline;
  }

  // ============ Trunk summaries (subnet view) ============

  type TrunkSummary = {
    parentId: string;
    parentLabel: string;
    parentKind: Kind;
    /** wireKind → list of child node ids on that trunk */
    byKind: Map<WireKind, string[]>;
  };

  const trunkSummaries = $derived.by((): TrunkSummary[] => {
    const map = new Map<string, TrunkSummary>();
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    for (const e of edges) {
      const wk = (e.data?.wireKind as WireKind) ?? undefined;
      if (!wk) continue;
      const parent = nodeById.get(e.source);
      if (!parent) continue;
      let summary = map.get(parent.id);
      if (!summary) {
        summary = {
          parentId: parent.id,
          parentLabel: nodeLabel(parent),
          parentKind: nodeKind(parent) ?? 'controller',
          byKind: new Map(),
        };
        map.set(parent.id, summary);
      }
      const arr = summary.byKind.get(wk) ?? [];
      arr.push(e.target);
      summary.byKind.set(wk, arr);
    }
    return Array.from(map.values()).sort((a, b) => a.parentLabel.localeCompare(b.parentLabel));
  });
</script>

<div class="build">
  <SvelteFlowProvider>
    <aside class="palette">
      <div class="palette-head">
        <h3>Equipment</h3>
        <p class="hint">
          Drag onto canvas. Wire by dragging between handles. Press
          <kbd>Delete</kbd> / <kbd>Backspace</kbd> to remove selected nodes or wires.
        </p>
      </div>
      <ul class="items">
        {#each PALETTE as item (item.kind)}
          <li
            class="item kind-{item.kind}"
            draggable="true"
            ondragstart={(e) => onPaletteDragStart(e, item.kind)}
            title={item.description}
          >
            <span class="icon">{item.icon}</span>
            <div class="text">
              <strong>{item.label}</strong>
              <span class="ex">e.g. {item.defaultName}</span>
            </div>
          </li>
        {/each}
      </ul>

      <div class="wires-section">
        <h3>Wires</h3>
        <p class="hint">Pick a trunk type, then drag between handles.</p>
        <div class="wire-palette">
          {#if guidanceMode === 'easy'}
            <button
              type="button"
              class="wire-row"
              class:active={selectedWireKind === 'auto'}
              title="Pick the trunk kind automatically based on what's being connected. (Easy mode only — in the field you have to know which bus you're on.)"
              onclick={() => (selectedWireKind = 'auto')}
            >
              <span class="wire-swatch auto"></span>
              <span class="wire-row-label">Auto</span>
              <span class="wire-row-sub">smart-pick</span>
            </button>
          {/if}
          {#each WIRE_KINDS as wk (wk.kind)}
            <button
              type="button"
              class="wire-row"
              class:active={selectedWireKind === wk.kind}
              style:--c={wk.color}
              title={wk.description}
              onclick={() => (selectedWireKind = wk.kind)}
            >
              <span class="wire-swatch" style:background={wk.color}></span>
              <span class="wire-row-label">{wk.label}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Points legend — color key for the terminal dots that paint along
           the left/right of a controller node. Sits next to the WIRES list
           so the whole "what does this color mean" answer lives in one
           place at the bottom of the canvas. -->
      <div class="points-legend-section">
        <h3>Points</h3>
        <ul class="legend-table">
          <li>
            <span class="legend-dot" style:background="#4a9eff"></span>
            <span class="legend-code">UI / UO</span>
            <span class="legend-desc">Universal — configurable AI or BI per channel</span>
          </li>
          <li>
            <span class="legend-dot" style:background="#f39c12"></span>
            <span class="legend-code">AI / AO</span>
            <span class="legend-desc">Analog — fixed type (4-20mA, 0-10V, RTD…)</span>
          </li>
          <li>
            <span class="legend-dot" style:background="#2ecc71"></span>
            <span class="legend-code">BI / BO</span>
            <span class="legend-desc">Binary — dry contact in, relay/triac out</span>
          </li>
        </ul>
      </div>

      <div class="palette-foot">
        <div class="physics-info">
          {#if physicsTarget && focusedTarget}
            <div class="phys-row">
              <span class="phys-icon">⚡</span>
              <div class="phys-text">
                <span class="phys-label"
                  >Physics target{wiredTargets.length > 1
                    ? ` ${wiredTargets.findIndex((t) => t.controllerId === focusedTargetId) + 1}/${wiredTargets.length}`
                    : ''}</span
                >
                <span class="phys-pair"
                  >{physicsTarget.controllerLabel} ↔ {physicsTarget.sensorLabel}</span
                >
              </div>
              <button
                type="button"
                class="phys-clear"
                onclick={clearPhysicsTarget}
                title="Remove this physics target"
                aria-label="Remove physics target"
              >
                ✕
              </button>
            </div>
            <p class="phys-hint">
              {wiredTargets.length > 1
                ? 'Click any wired controller to focus it. Click an unwired one to add. Click the focused one to remove.'
                : 'Click another controller (wired to a sensor) to add a second target. Click this one again to remove.'}
            </p>
          {:else}
            <div class="phys-row">
              <span class="phys-icon idle">⚡</span>
              <div class="phys-text">
                <span class="phys-label">No physics target</span>
                <span class="phys-pair">Click a controller wired to a sensor</span>
              </div>
            </div>
          {/if}
        </div>
        <div class="scenario-row">
          <label class="scenario-btn load">
            Load scenario file
            <input
              type="file"
              accept=".json,.bas-scenario,application/json"
              onchange={onLoadInput}
              hidden
            />
          </label>
        </div>
        {#if loadMessage}
          <p class="load-message {loadMessage.kind}">{loadMessage.text}</p>
        {/if}

        <!-- Pre-built demo scenarios bundled with the app. One-click load
             so a first-time visitor (or a commercial contact you're showing
             this to) gets something interesting on the canvas without
             having to build it up themselves. -->
        <div class="slots-section demos-section">
          <div class="slots-head">
            <h4>Demos</h4>
            <span class="demos-sub">{DEMOS.length} samples</span>
          </div>
          <ul class="demos-list">
            {#each DEMOS as demo (demo.id)}
              <li class="demo-row">
                <button
                  type="button"
                  class="demo-load"
                  title={demo.blurb}
                  onclick={() => loadDemo(demo)}
                >
                  <span class="demo-name">{demo.name}</span>
                  <span class="demo-blurb">{demo.blurb}</span>
                </button>
              </li>
            {/each}
          </ul>
        </div>

        <!-- Named in-browser slots (localStorage). Faster than file
             round-trips when you're switching between a handful of
             test setups during a session. -->
        <div class="slots-section">
          <div class="slots-head">
            <h4>Saved slots</h4>
            <button
              type="button"
              class="slot-add"
              title="Save the current canvas + sim config under a name in localStorage"
              onclick={saveSlot}
            >
              + Save as…
            </button>
          </div>
          {#if slotNames.length === 0}
            <p class="slots-empty">No saved slots yet. Hit "+ Save as…" to add one.</p>
          {:else}
            <ul class="slots-list">
              {#each slotNames as name (name)}
                <li class="slot-row">
                  <button
                    type="button"
                    class="slot-load"
                    title="Load slot &quot;{name}&quot;"
                    onclick={() => loadSlot(name)}
                  >
                    {name}
                  </button>
                  <button
                    type="button"
                    class="slot-delete"
                    title="Delete slot &quot;{name}&quot;"
                    onclick={() => deleteSlot(name)}
                  >
                    ✕
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        {#if trunkSummaries.length > 0}
          <div class="trunks-section">
            <h3>Trunks</h3>
            <ul class="trunks-list">
              {#each trunkSummaries as t (t.parentId)}
                <li class="trunk-group">
                  <div class="trunk-parent">
                    <span class="trunk-parent-icon kind-{t.parentKind}">●</span>
                    <span class="trunk-parent-label">{t.parentLabel}</span>
                  </div>
                  {#each [...t.byKind] as [wk, ids] (wk)}
                    {@const info = WIRE_KIND_BY_ID.get(wk)}
                    <div class="trunk-line" style:--c={info?.color ?? '#888'}>
                      <span class="trunk-swatch"></span>
                      <span class="trunk-label">{info?.label ?? wk}</span>
                      <span class="trunk-count">{ids.length}</span>
                    </div>
                  {/each}
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <div class="topology-checks">
          <button
            type="button"
            class="checks-head"
            class:has-errors={findingsByLevel.errors > 0}
            class:has-warnings={findingsByLevel.warnings > 0}
            onclick={() => (showFindings = !showFindings)}
            aria-expanded={showFindings}
          >
            <span class="checks-title">Topology checks</span>
            <span class="checks-badges">
              {#if findingsByLevel.errors > 0}
                <span class="cb err">{findingsByLevel.errors}</span>
              {/if}
              {#if findingsByLevel.warnings > 0}
                <span class="cb warn">{findingsByLevel.warnings}</span>
              {/if}
              {#if findingsByLevel.infos > 0}
                <span class="cb info">{findingsByLevel.infos}</span>
              {/if}
              {#if topologyFindings.length === 0}
                <span class="cb ok">✓</span>
              {/if}
              <span class="checks-chevron">{showFindings ? '▾' : '▸'}</span>
            </span>
          </button>
          {#if showFindings}
            {#if topologyFindings.length === 0}
              <p class="checks-empty">No issues — topology checks pass.</p>
            {:else}
              <ul class="checks-list">
                {#each topologyFindings as f, i (f.ruleId + '|' + (f.subjectId ?? '') + '|' + i)}
                  <li class="check level-{f.level}">
                    <span class="check-dot"></span>
                    <span class="check-msg">{f.message}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        </div>

        <p class="meta">{nodes.length} nodes · {edges.length} wires</p>
      </div>
    </aside>

    <div
      class="flow"
      role="region"
      aria-label="Topology canvas"
      ondrop={onCanvasDrop}
      ondragover={onCanvasDragOver}
    >
      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        fitView
        connectionMode={ConnectionMode.Loose}
        onnodeclick={onNodeClick}
        onnodecontextmenu={onNodeDoubleClick}
        ondblclick={(e) => {
          // xyflow doesn't expose onnodedblclick directly in v1; fall back to
          // capturing dblclick on the SvelteFlow wrapper and resolving the
          // closest node element via its data-id attribute.
          const target = (e.target as HTMLElement | null)?.closest('.svelte-flow__node');
          if (!target) return;
          const id = target.getAttribute('data-id');
          if (!id) return;
          const node = nodes.find((n) => n.id === id);
          if (node) onNodeDoubleClick({ node });
        }}
        onconnect={onConnect}
        ondelete={({ nodes: dn, edges: de }) => {
          if (dn.length > 0) onNodesDelete(dn);
          if (de.length > 0) onEdgesDelete(de);
        }}
      >
        <Background />

        {#if selectedSubnetZone}
          {@const zoneData = selectedSubnetZone.data as SubnetZoneData}
          <Panel position="top-center">
            <div class="subnet-edit-panel">
              <span class="subnet-edit-title" style:color={zoneData.color}>Subnet zone</span>
              <label class="subnet-edit-field" title="Friendly label that appears on the zone (e.g. 'BMS VLAN', 'Corp', 'DMZ').">
                <span>label</span>
                <input
                  type="text"
                  value={zoneData.label}
                  oninput={(e) => updateZoneField(selectedSubnetZone.id, 'label', (e.currentTarget as HTMLInputElement).value)}
                  placeholder="VLAN name"
                />
              </label>
              <label class="subnet-edit-field" title="CIDR notation — e.g. 10.0.1.0/24. Devices dropped inside this zone must have IPs that fall in this range.">
                <span>CIDR</span>
                <input
                  class="cidr-input"
                  class:invalid={isCidrInvalid(zoneData.cidr)}
                  class:valid={!!zoneData.cidr && !isCidrInvalid(zoneData.cidr)}
                  type="text"
                  value={zoneData.cidr}
                  oninput={(e) => updateZoneField(selectedSubnetZone.id, 'cidr', (e.currentTarget as HTMLInputElement).value)}
                  placeholder="10.0.1.0/24"
                  title={isCidrInvalid(zoneData.cidr) ? `"${zoneData.cidr}" isn\'t a valid CIDR. Use IP/prefix, e.g. 10.0.1.0/24.` : 'CIDR notation — e.g. 10.0.1.0/24.'}
                  spellcheck="false"
                  autocapitalize="off"
                  autocorrect="off"
                />
              </label>
              <label class="subnet-edit-color" title="Border + fill color for this zone.">
                <span>color</span>
                <input
                  type="color"
                  value={zoneData.color}
                  oninput={(e) => updateZoneField(selectedSubnetZone.id, 'color', (e.currentTarget as HTMLInputElement).value)}
                />
              </label>
              <button
                type="button"
                class="subnet-edit-delete"
                onclick={() => deleteZone(selectedSubnetZone.id)}
                title="Delete this subnet zone (devices inside it stay where they are)."
              >
                ✕ Delete zone
              </button>
            </div>
          </Panel>
        {/if}

        {#if selectedVirtualController}
          {@const vcData = selectedVirtualController.data as { hostId?: string; poweredOff?: boolean }}
          {@const vcHosts = hostCandidates(selectedVirtualController.id)}
          {@const vcOff = !!vcData.poweredOff}
          <Panel position="top-center">
            <div class="vctrl-panel">
              <span class="vctrl-title">Virtual ctrl —</span>
              <input
                class="ip-rename"
                type="text"
                value={nodeLabel(selectedVirtualController)}
                onblur={(e) => renameNode(selectedVirtualController.id, (e.currentTarget as HTMLInputElement).value)}
                onkeydown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                  if (e.key === 'Escape') {
                    (e.currentTarget as HTMLInputElement).value = nodeLabel(selectedVirtualController);
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                title="Rename this virtual controller."
                aria-label="Virtual controller name"
              />
              <label class="vctrl-host-field" title="Pick the supervisor (JACE / NCE / AS-P / etc.) this virtual controller runs INSIDE. When the host goes down, every virtual controller on it goes with it.">
                <span>Host</span>
                <select
                  class="vctrl-host-select"
                  onchange={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value;
                    setVirtualHost(selectedVirtualController.id, v === '' ? null : v);
                  }}
                >
                  <option value="" selected={!vcData.hostId}>— no host —</option>
                  {#each vcHosts as h (h.id)}
                    <option value={h.id} selected={vcData.hostId === h.id}>{h.label}</option>
                  {/each}
                </select>
              </label>
              {#if vcHosts.length === 0}
                <span class="vctrl-hint">Drop a Supervisor first — virtual controllers need a host.</span>
              {/if}
              <span class="ip-divider"></span>
              <button
                type="button"
                class="power-toggle"
                class:powered-off={vcOff}
                onclick={() => togglePower(selectedVirtualController.id)}
                title={vcOff ? 'Virtual controller is powered off.' : 'Power off this virtual controller.'}
              >{vcOff ? '⏼ Power on' : '⏻ Power off'}</button>
              <button
                type="button"
                class="ip-delete"
                title="Delete this virtual controller."
                onclick={() => deleteNodeById(selectedVirtualController.id)}
              >✕ Delete</button>
            </div>
          </Panel>
        {/if}

        {#if selectedRouter}
          {@const rData = selectedRouter.data as {
            routerInterfaces?: Array<{ ip?: string; cidr: string }>;
            poweredOff?: boolean;
          }}
          {@const ifs = rData.routerInterfaces ?? []}
          {@const routerOff = rData.poweredOff === true}
          <Panel position="top-center">
            <div class="router-panel">
              <span class="router-title">Router —</span>
              <input
                class="ip-rename"
                type="text"
                value={nodeLabel(selectedRouter)}
                onblur={(e) => renameNode(selectedRouter.id, (e.currentTarget as HTMLInputElement).value)}
                onkeydown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                  if (e.key === 'Escape') {
                    (e.currentTarget as HTMLInputElement).value = nodeLabel(selectedRouter);
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                title="Rename this router — Enter to commit, Esc to cancel."
                aria-label="Router name"
              />
              <div class="router-ifaces-edit">
                {#each ifs as iface, i (i)}
                  <div class="router-iface-row">
                    <span class="iface-num">if{i}</span>
                    <input
                      class="ip-input"
                      type="text"
                      value={iface.ip ?? ''}
                      class:valid={gwState(iface.ip) === 'valid'}
                      class:invalid={gwState(iface.ip) === 'invalid'}
                      placeholder="10.0.1.1"
                      title="Router's IP on this interface (informational — what matters for routing is the CIDR)."
                      oninput={(e) => updateRouterInterface(selectedRouter.id, i, 'ip', (e.currentTarget as HTMLInputElement).value)}
                      spellcheck="false"
                      autocapitalize="off"
                    />
                    <input
                      class="ip-input"
                      class:invalid={isCidrInvalid(iface.cidr)}
                      class:valid={!!iface.cidr && !isCidrInvalid(iface.cidr)}
                      type="text"
                      value={iface.cidr}
                      placeholder="10.0.1.0/24"
                      title={isCidrInvalid(iface.cidr) ? `"${iface.cidr}" isn\'t a valid CIDR. Use IP/prefix, e.g. 10.0.1.0/24.` : 'CIDR for this interface — devices with IPs in this range are reachable via this interface.'}
                      oninput={(e) => updateRouterInterface(selectedRouter.id, i, 'cidr', (e.currentTarget as HTMLInputElement).value)}
                      spellcheck="false"
                      autocapitalize="off"
                    />
                    <button
                      type="button"
                      class="iface-del"
                      title="Remove this interface"
                      onclick={() => removeRouterInterface(selectedRouter.id, i)}
                    >✕</button>
                  </div>
                {/each}
                {#if ifs.length === 0}
                  <span class="router-hint">No interfaces yet — add at least 2 to bridge subnets.</span>
                {/if}
              </div>
              <button
                type="button"
                class="iface-add"
                onclick={() => addRouterInterface(selectedRouter.id)}
                title="Add another network interface."
              >+ interface</button>
              <button
                type="button"
                class="power-toggle"
                class:powered-off={routerOff}
                onclick={() => togglePower(selectedRouter.id)}
                title={routerOff ? `Router is POWERED OFF — its interfaces won't bridge any subnets. Click to power on.` : `Simulate cutting power to this router — cross-subnet paths it covers will lose their bridge.`}
              >{routerOff ? '⏼ Power on' : '⏻ Power off'}</button>
              <button
                type="button"
                class="ip-delete"
                title="Delete this router."
                onclick={() => deleteNodeById(selectedRouter.id)}
              >✕ Delete</button>
            </div>
          </Panel>
        {/if}

        {#if selectedIpDevice && !selectedSubnetZone && !selectedRouter}
          {@const ipData = selectedIpDevice.data as {
            ipAddress?: string;
            subnetMask?: string;
            gateway?: string;
            isBBMD?: boolean;
            bdtPeers?: string[];
            poweredOff?: boolean;
          }}
          {@const isBb = !!ipData.isBBMD}
          {@const ipDeviceKind = nodeKind(selectedIpDevice)}
          {@const bbmdToggleDisabled = ipDeviceKind === 'bbmd'}
          {@const isOff = !!ipData.poweredOff}
          <Panel position="top-center">
            <div class="ip-config-panel">
              <span class="ip-config-title">Network —</span>
              <input
                class="ip-rename"
                type="text"
                value={nodeLabel(selectedIpDevice)}
                onblur={(e) => renameNode(selectedIpDevice.id, (e.currentTarget as HTMLInputElement).value)}
                onkeydown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                  if (e.key === 'Escape') {
                    (e.currentTarget as HTMLInputElement).value = nodeLabel(selectedIpDevice);
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                title="Rename this device — press Enter to commit, Esc to cancel."
                aria-label="Device name"
              />
              <label class="ip-field" title="IPv4 address — accepts dotted-quad (10.0.1.10) OR CIDR notation (10.0.1.10/24, which auto-populates the mask).">
                <span>IP</span>
                <input
                  class="ip-input"
                  class:valid={ipAddrState(ipData.ipAddress) === 'valid'}
                  class:invalid={ipAddrState(ipData.ipAddress) === 'invalid'}
                  type="text"
                  value={ipData.ipAddress ?? ''}
                  placeholder="10.0.1.10  or  10.0.1.10/24"
                  title={ipAddrState(ipData.ipAddress) === 'invalid'
                    ? `"${ipData.ipAddress}" isn't a valid IPv4 address. Need four parts, each 0–255 — e.g. 10.0.1.10 (or CIDR like 10.0.1.10/24).`
                    : 'IPv4 address — dotted-quad (10.0.1.10) or CIDR (10.0.1.10/24, which auto-fills the mask).'}
                  oninput={(e) => setIpAddressOrCidr(selectedIpDevice.id, (e.currentTarget as HTMLInputElement).value)}
                  spellcheck="false"
                  autocapitalize="off"
                />
              </label>
              <label class="ip-field" title="Subnet mask — dotted-quad, e.g. 255.255.255.0.">
                <span>Mask</span>
                <input
                  class="ip-input"
                  class:valid={maskState(ipData.subnetMask) === 'valid'}
                  class:invalid={maskState(ipData.subnetMask) === 'invalid'}
                  type="text"
                  value={ipData.subnetMask ?? ''}
                  placeholder="255.255.255.0"
                  title={maskState(ipData.subnetMask) === 'invalid'
                    ? `"${ipData.subnetMask}" isn't a valid subnet mask. It must be a contiguous run of 1-bits, e.g. 255.255.255.0 (/24) or 255.255.0.0 (/16).`
                    : 'Subnet mask — dotted-quad, e.g. 255.255.255.0.'}
                  oninput={(e) => updateNodeField(selectedIpDevice.id, 'subnetMask', (e.currentTarget as HTMLInputElement).value)}
                  spellcheck="false"
                  autocapitalize="off"
                />
              </label>
              <label class="ip-field" title="Default gateway — dotted-quad, e.g. 10.0.1.1.">
                <span>GW</span>
                <input
                  class="ip-input"
                  class:valid={gwState(ipData.gateway) === 'valid'}
                  class:invalid={gwState(ipData.gateway) === 'invalid'}
                  type="text"
                  value={ipData.gateway ?? ''}
                  placeholder="10.0.1.1"
                  title={gwState(ipData.gateway) === 'invalid'
                    ? `"${ipData.gateway}" isn't a valid gateway address. Need a dotted-quad — e.g. 10.0.1.1.`
                    : 'Default gateway — dotted-quad, e.g. 10.0.1.1.'}
                  oninput={(e) => updateNodeField(selectedIpDevice.id, 'gateway', (e.currentTarget as HTMLInputElement).value)}
                  spellcheck="false"
                  autocapitalize="off"
                />
              </label>
              <span class="ip-divider"></span>
              <label
                class="bbmd-toggle"
                class:active={isBb}
                class:dedicated={bbmdToggleDisabled}
                title={bbmdToggleDisabled
                  ? 'This IS a dedicated BBMD appliance — the BBMD role is intrinsic and cannot be turned off. To remove BBMD function, delete this node.'
                  : 'Run BBMD service on this device. Enable when a JACE / NCE / supervisor should also bridge BACnet broadcasts between subnets. For a dedicated BBMD appliance (Contemporary Controls BAS Router, etc.), drag the BBMD tile from the device palette.'}
              >
                <input
                  type="checkbox"
                  checked={isBb}
                  disabled={bbmdToggleDisabled}
                  onchange={(e) => toggleBbmd(selectedIpDevice.id, (e.currentTarget as HTMLInputElement).checked)}
                />
                <span>{bbmdToggleDisabled ? 'BBMD appliance' : 'Run BBMD service'}</span>
              </label>
              {#if isBb}
                {@const peers = ipData.bdtPeers ?? []}
                {@const pickerOpen = bdtPickerOpenFor === selectedIpDevice.id}
                {@const candidates = bbmdCandidatesFor(selectedIpDevice.id).filter(c => !peers.includes(c.ip))}
                <div class="bdt-field" title="Broadcast Distribution Table — peer BBMDs on remote subnets. Each peer must list this BBMD back, or broadcasts only flow one direction.">
                  <span class="bdt-label">BDT peers</span>
                  <div class="bdt-chips">
                    {#each peers as peer (peer)}
                      <span class="bdt-chip">
                        <span class="bdt-chip-ip">{peer}</span>
                        <button
                          type="button"
                          class="bdt-chip-del"
                          title="Remove {peer} from BDT"
                          onclick={() => removeBdtPeer(selectedIpDevice.id, peer)}
                        >✕</button>
                      </span>
                    {/each}
                    <button
                      type="button"
                      class="bdt-add"
                      class:open={pickerOpen}
                      onclick={() => pickerOpen ? closeBdtPicker() : openBdtPicker(selectedIpDevice.id)}
                      title="Add a peer BBMD to this BDT — pick from BBMD-capable devices on the canvas, or type a custom IP for a peer that isn't deployed yet."
                    >
                      + peer
                    </button>
                  </div>
                  {#if pickerOpen}
                    <div class="bdt-picker" role="dialog" aria-label="Add BDT peer">
                      {#if candidates.length > 0}
                        <div class="bdt-picker-section">
                          <span class="bdt-picker-hint">BBMD-capable on canvas:</span>
                          <div class="bdt-picker-options">
                            {#each candidates as c (c.id)}
                              <button
                                type="button"
                                class="bdt-picker-option"
                                onclick={() => { addBdtPeer(selectedIpDevice.id, c.ip); closeBdtPicker(); }}
                                title="Add {c.label} ({c.ip}) to this BBMD's BDT."
                              >
                                <span class="bdt-picker-icon">{c.kind === 'bbmd' ? '◫' : '◉'}</span>
                                <span class="bdt-picker-label">{c.label}</span>
                                <span class="bdt-picker-ip">{c.ip}</span>
                              </button>
                            {/each}
                          </div>
                        </div>
                      {:else}
                        <div class="bdt-picker-section">
                          <span class="bdt-picker-hint muted">No other BBMD-capable devices on the canvas — drop one from the Network tab, or type a custom IP below for a peer that isn't here yet.</span>
                        </div>
                      {/if}
                      <div class="bdt-picker-section">
                        <span class="bdt-picker-hint">Or custom IP:</span>
                        <div class="bdt-picker-manual">
                          <input
                            class="ip-input"
                            type="text"
                            placeholder="10.0.99.10"
                            value={bdtPickerManualText}
                            oninput={(e) => (bdtPickerManualText = (e.currentTarget as HTMLInputElement).value)}
                            onkeydown={(e) => {
                              if (e.key === 'Enter') { commitBdtManual(selectedIpDevice.id); closeBdtPicker(); }
                              if (e.key === 'Escape') closeBdtPicker();
                            }}
                            spellcheck="false"
                            autocapitalize="off"
                          />
                          <button
                            type="button"
                            class="bdt-picker-add"
                            onclick={() => { commitBdtManual(selectedIpDevice.id); closeBdtPicker(); }}
                            disabled={!bdtPickerManualText.trim()}
                          >Add</button>
                        </div>
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
              {#if edges.some((e) => (e.data as { wireKind?: string } | undefined)?.wireKind === 'mstp' && (e.source === selectedIpDevice.id || e.target === selectedIpDevice.id))}
                {@const ipEolOn = (selectedIpDevice.data as { eolTerminated?: boolean } | undefined)?.eolTerminated === true}
                <button
                  type="button"
                  class="eol-toggle"
                  class:active={ipEolOn}
                  title="RS-485 end-of-line termination (the EOL dip switch). An engine at the physical end of its MS/TP chain terminates the segment — flip ON here and at the far chain end, and only there."
                  onclick={() => setNodeEol(selectedIpDevice.id, !ipEolOn)}
                >
                  EOL {ipEolOn ? 'on' : 'off'}
                </button>
              {/if}
              <span class="ip-divider"></span>
              <button
                type="button"
                class="power-toggle"
                class:powered-off={isOff}
                onclick={() => togglePower(selectedIpDevice.id)}
                title={isOff
                  ? 'Device is currently POWERED OFF — broadcasts and validations skip it. Click to power back on.'
                  : `Simulate cutting power to this device. It will be excluded from network validation, broadcast traces, and offline-detection (since it's deliberately off, not comm-lost).`}
              >
                {isOff ? '⏼ Power on' : '⏻ Power off'}
              </button>
              <button
                type="button"
                class="ip-delete"
                title="Delete this device (also: select + press Delete or Backspace)."
                onclick={() => deleteNodeById(selectedIpDevice.id)}
              >
                ✕ Delete
              </button>
            </div>
          </Panel>
        {/if}

        {#if selectedEdge}
          {@const currentKind = (selectedEdge.data?.wireKind as WireKind) ?? 'mstp'}
          {@const baud = selectedEdge.data?.baud as number | undefined}
          {@const isBroken = (selectedEdge.data?.comm as string | undefined) === 'broken'}
          <Panel position="top-center">
            <div class="wire-panel">
              <span class="wire-title">Trunk</span>
              <div class="wire-chips">
                {#each WIRE_KINDS as wk (wk.kind)}
                  <button
                    type="button"
                    class="wire-chip"
                    class:active={currentKind === wk.kind}
                    style:--c={wk.color}
                    title={wk.description}
                    disabled={isBroken}
                    onclick={() => setEdgeKind(selectedEdge.id, wk.kind)}
                  >
                    {wk.label}
                  </button>
                {/each}
              </div>
              {#if currentKind === 'mstp' || currentKind === 'n2'}
                {@const effectiveBaud = baud ?? defaultBaudForKind(currentKind)}
                {@const isAuto = (selectedEdge.data?.baudAuto as boolean | undefined) === true || !baud}
                <label class="wire-baud-edit" title="MS/TP / N2 trunks: pick the segment baud. All devices on the same trunk must match — mismatch = token errors in the next session's packet simulator.">
                  <span class="wire-baud-label">baud</span>
                  <select
                    onchange={(e) => {
                      const v = (e.currentTarget as HTMLSelectElement).value;
                      setEdgeBaud(selectedEdge.id, v === 'auto' ? 'auto' : Number(v));
                    }}
                  >
                    {#each BAUD_RATES as opt}
                      {@const isSelected = opt === 'auto' ? isAuto : opt === effectiveBaud && !isAuto}
                      <option value={opt} selected={isSelected}>
                        {opt === 'auto' ? `auto (${defaultBaudForKind(currentKind)})` : opt >= 1000 ? `${(opt / 1000).toFixed(opt % 1000 === 0 ? 0 : 1)}k` : opt}
                      </option>
                    {/each}
                  </select>
                </label>
              {/if}
              {#if currentKind === 'mstp' && mstpTrunkStates.has(selectedEdge.id)}
                {@const trunkFindings = mstpFindingsByTrunk.get(selectedEdge.id) ?? []}
                {@const errCount = trunkFindings.filter((f) => f.severity === 'error').length}
                {@const warnCount = trunkFindings.filter((f) => f.severity === 'warning').length}
                <button
                  type="button"
                  class="wire-trunk-inspect"
                  class:has-errors={errCount > 0}
                  class:has-warnings={warnCount > 0 && errCount === 0}
                  title={trunkFindings.length === 0
                    ? 'Open the Trunk Inspector — see every device on this MS/TP segment, its MAC, Device Instance, and current token state.'
                    : `${errCount} error${errCount === 1 ? '' : 's'}, ${warnCount} warning${warnCount === 1 ? '' : 's'} on this trunk. Click for details.`}
                  onclick={() => openTrunkInspector(selectedEdge.id)}
                >
                  🔍 Trunk inspector
                  {#if errCount > 0}<span class="badge-err">{errCount}</span>{/if}
                  {#if warnCount > 0}<span class="badge-warn">{warnCount}</span>{/if}
                </button>
              {/if}
              <button
                type="button"
                class="wire-break"
                class:broken={isBroken}
                title={isBroken
                  ? 'Restore this trunk — devices behind it come back online.'
                  : 'Simulate a wire break / comm fail. Devices past this point go offline; their last good values freeze.'}
                onclick={() => setEdgeBroken(selectedEdge.id, !isBroken)}
              >
                {isBroken ? '⟲ Restore trunk' : '✂ Break trunk'}
              </button>
              <button
                type="button"
                class="wire-delete"
                title="Remove this wire from the canvas. (Break simulates a comm fault; Delete pulls the wire entirely.)"
                onclick={() => deleteEdge(selectedEdge.id)}
              >
                ✕ Delete wire
              </button>
            </div>
          </Panel>
        {/if}

        {#if selectedSensor}
          {@const sensorData = selectedSensor.data as
            | { fault?: SensorFault; signal?: SensorSignal }
            | undefined}
          {@const currentFault = (sensorData?.fault ?? 'normal') as SensorFault}
          {@const currentSignal = (sensorData?.signal ?? DEFAULT_SENSOR_SIGNAL) as SensorSignal}
          {@const sensorModelId = (selectedSensor.data as { sensorModelId?: string } | undefined)?.sensorModelId}
          {@const sensorModel = sensorModelId ? findSensorModel(sensorModelId) : undefined}
          {@const installedSignal = (sensorModel?.signal ?? currentSignal) as string}
          {@const wiredHere = wiredTargets.some((t) => t.sensorId === selectedSensor.id)}
          <Panel position="bottom-left">
            <div class="sensor-panel inspector-panel">
              <div class="inspector-head">
                <span class="sensor-title">Sensor —</span>
                <input
                  class="rename-input"
                  type="text"
                  value={nodeLabel(selectedSensor)}
                  onblur={(e) => renameNode(selectedSensor.id, (e.currentTarget as HTMLInputElement).value)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      (e.currentTarget as HTMLInputElement).value = nodeLabel(selectedSensor);
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  title="Rename this sensor — e.g. MA-T, DA-T, OAT"
                  aria-label="Sensor name"
                />
                <button
                  type="button"
                  class="inspector-delete"
                  title="Delete this sensor (also: select + press Delete or Backspace)"
                  onclick={() => deleteNodeById(selectedSensor.id)}
                >
                  ✕ Delete
                </button>
              </div>
              <div class="sensor-row sensor-row-block">
                <span class="sensor-sub">Installed element</span>
                {#if sensorModel}
                  <!-- Model-backed sensor: the element is a physical property of
                       the device you bought — read-only. You don't "select" a
                       BA/1K into a 4-20mA sensor; you'd buy a different sensor.
                       The thing you PROGRAM is the controller terminal. -->
                  <div class="installed-element" title="This is the physical sensor's element — fixed by the model. To change it, install a different sensor. What you program is the controller's terminal (open Terminals on the controller).">
                    <span class="ie-value">{signalLabel(installedSignal)}</span>
                    <span class="ie-fixed">🔒 fixed by {sensorModel.model}</span>
                  </div>
                {:else}
                  <!-- Generic sensor: declare what you installed, grouped by
                       category so resistive elements aren't mixed with
                       transmitter outputs. -->
                  <div class="signal-groups">
                    {#each SIGNAL_GROUPS as grp (grp.label)}
                      <div class="signal-group">
                        <span class="sg-head">{grp.label}</span>
                        <div class="signal-chips">
                          {#each grp.ids as id (id)}
                            {@const tpl = SENSOR_TEMPLATE_BY_ID.get(id)}
                            <button
                              type="button"
                              class="signal-chip"
                              class:active={currentSignal === id}
                              title={tpl ? `${tpl.accuracy} · polled ~${tpl.pollSec}s` : ''}
                              onclick={() => setSensorSignal(selectedSensor.id, id)}
                            >
                              {tpl?.label ?? id}
                            </button>
                          {/each}
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
              <div class="sensor-row">
                <span class="sensor-sub">Fault</span>
                <div class="fault-chips">
                  {#each ['normal', 'open', 'short', 'stuck', 'drift', 'calibration', 'noise', 'intermittent', 'rail'] as f (f)}
                    <button
                      type="button"
                      class="fault-chip"
                      class:active={currentFault === f}
                      class:danger={f !== 'normal'}
                      title={FAULT_TIPS[f as SensorFault]}
                      onclick={() => setSensorFault(selectedSensor.id, f as SensorFault)}
                    >
                      {f}
                    </button>
                  {/each}
                </div>
              </div>
              <p class="fault-note">
                <strong>open</strong> / <strong>short</strong> propagate through the
                signal layer — visible on the controller's
                <strong>Terminals</strong> panel as OPEN / SHORT badges with the
                raw wire reading pegged at the fault rail. The others perturb the
                primary-sensor engineering value upstream (drift, calibration
                offset, noise, etc.) via the thermal-sim's SensorState pipeline.
              </p>
              {#if !wiredHere}
                <span class="sensor-warn"
                  >Not wired to a controller — fault won't affect any sim yet.</span
                >
              {/if}
            </div>
          </Panel>
        {/if}

        {#if selectedZone}
          {@const zCfg = {
            ...DEFAULT_ZONE_CONFIG,
            ...((selectedZone.data as { zoneConfig?: Partial<typeof DEFAULT_ZONE_CONFIG> }).zoneConfig ?? {}),
          }}
          {@const zState = (selectedZone.data as { zoneState?: ZoneState }).zoneState}
          <Panel position="bottom-left">
            <div class="zone-panel inspector-panel">
              <div class="inspector-head">
                <span class="sensor-title">Zone —</span>
                <input
                  class="rename-input"
                  type="text"
                  value={nodeLabel(selectedZone)}
                  onblur={(e) => renameNode(selectedZone.id, (e.currentTarget as HTMLInputElement).value)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      (e.currentTarget as HTMLInputElement).value = nodeLabel(selectedZone);
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  title="Rename this zone — e.g. ZONE-A, CONF-103, SERVER-RM"
                  aria-label="Zone name"
                />
                <button
                  type="button"
                  class="inspector-delete"
                  title="Delete this zone (also: select + press Delete or Backspace)"
                  onclick={() => deleteNodeById(selectedZone.id)}
                >
                  ✕ Delete
                </button>
              </div>
              {#if zState}
                <div class="zone-state-row">
                  <span class="muted">Live:</span>
                  <strong>{zState.T_zone.toFixed(1)}°F</strong>
                </div>
              {/if}
              <div class="zone-fields">
                <label class="zone-field" title="Peak number of occupants when fully populated">
                  <span>peak occupants</span>
                  <input
                    type="number" min="0" max="500" step="1"
                    value={zCfg.peak_occupants}
                    onchange={(e) => updateZoneConfig(selectedZone.id, 'peak_occupants', Number((e.currentTarget as HTMLInputElement).value))}
                  />
                </label>
                <label class="zone-field" title="Floor area in square feet — drives sqft-based loads">
                  <span>floor area (sqft)</span>
                  <input
                    type="number" min="50" max="50000" step="10"
                    value={zCfg.floor_area_sqft}
                    onchange={(e) => updateZoneConfig(selectedZone.id, 'floor_area_sqft', Number((e.currentTarget as HTMLInputElement).value))}
                  />
                </label>
                <label class="zone-field" title="Lighting power density — ~0.5 LED, ~2.0 older fluorescent">
                  <span>lighting W/sqft</span>
                  <input
                    type="number" min="0" max="10" step="0.1"
                    value={zCfg.lighting_w_per_sqft}
                    onchange={(e) => updateZoneConfig(selectedZone.id, 'lighting_w_per_sqft', Number((e.currentTarget as HTMLInputElement).value))}
                  />
                </label>
                <label class="zone-field" title="Equipment / plug load — ~1.0 office, ~5+ server room">
                  <span>equipment W/sqft</span>
                  <input
                    type="number" min="0" max="50" step="0.5"
                    value={zCfg.equipment_w_per_sqft}
                    onchange={(e) => updateZoneConfig(selectedZone.id, 'equipment_w_per_sqft', Number((e.currentTarget as HTMLInputElement).value))}
                  />
                </label>
                <label class="zone-field" title="Exterior wall area in sqft — drives envelope loss/gain">
                  <span>exterior wall sqft</span>
                  <input
                    type="number" min="0" max="10000" step="10"
                    value={zCfg.exterior_wall_area_sqft}
                    onchange={(e) => updateZoneConfig(selectedZone.id, 'exterior_wall_area_sqft', Number((e.currentTarget as HTMLInputElement).value))}
                  />
                </label>
                <label class="zone-field" title="Thermal mass multiplier — 1 bare, 8 heavily furnished">
                  <span>mass multiplier</span>
                  <input
                    type="number" min="1" max="20" step="0.5"
                    value={zCfg.mass_multiplier}
                    onchange={(e) => updateZoneConfig(selectedZone.id, 'mass_multiplier', Number((e.currentTarget as HTMLInputElement).value))}
                  />
                </label>
              </div>
            </div>
          </Panel>
        {/if}

        {#if selectedActuator}
          {@const actModelId = (selectedActuator.data as { actuatorModelId?: string } | undefined)?.actuatorModelId}
          {@const actModel = actModelId ? findActuatorModel(actModelId) : undefined}
          {@const actBinary = actModel?.signal === 'binary-dry' || actModel?.signal === 'three-point'}
          <Panel position="bottom-left">
            <div class="actuator-panel inspector-panel">
              <div class="inspector-head">
                <span class="sensor-title">Actuator —</span>
                <input
                  class="rename-input"
                  type="text"
                  value={nodeLabel(selectedActuator)}
                  onblur={(e) => renameNode(selectedActuator.id, (e.currentTarget as HTMLInputElement).value)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      (e.currentTarget as HTMLInputElement).value = nodeLabel(selectedActuator);
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  title="Rename this actuator — e.g. DMP-OA, RHV-1, SF-VFD"
                  aria-label="Actuator name"
                />
                <button
                  type="button"
                  class="inspector-delete"
                  title="Delete this actuator (also: select + press Delete or Backspace)"
                  onclick={() => deleteNodeById(selectedActuator.id)}
                >
                  ✕ Delete
                </button>
              </div>
              {#if actModel}
                <div class="sensor-row sensor-row-block">
                  <span class="sensor-sub">Device (fixed by model)</span>
                  <div class="installed-element" title="The actuator's signal, fail-safe, stroke and feedback are properties of the physical device — to change them, install a different actuator.">
                    <span class="ie-value">{actModel.vendor} {actModel.model}</span>
                    <span class="ie-fixed">🔒 {actModel.kind}</span>
                  </div>
                </div>
                <div class="actuator-specs">
                  <span class="spec-chip" title="Control signal the controller's AO/BO output must match">{actuatorSignalLabel(actModel.signal)}</span>
                  <span class="spec-chip" title="Position the actuator drives to on power loss">fail-{actModel.failSafe}</span>
                  <span class="spec-chip" title="Time to stroke 0→100%">{actModel.strokeSeconds}s stroke</span>
                  <span class="spec-chip" class:good={actModel.hasPositionFeedback}>
                    {actModel.hasPositionFeedback ? 'position feedback' : 'no feedback'}
                  </span>
                </div>
                {@const actFault = (selectedActuator.data as { fault?: string } | undefined)?.fault}
                <div class="sensor-row">
                  <span class="sensor-sub">Fault</span>
                  <div class="fault-chips">
                    <button
                      type="button"
                      class="fault-chip"
                      class:active={!actFault}
                      title="Clear the fault — the actuator strokes normally"
                      onclick={() => setActuatorFault(selectedActuator.id, undefined)}
                    >
                      normal
                    </button>
                    <button
                      type="button"
                      class="fault-chip danger"
                      class:active={actFault === 'stuck'}
                      title="Jam the actuator at its current position — the controller keeps commanding, nothing moves. With feedback wired to an AI, the divergence is visible; without it, the only tell is the zone."
                      onclick={() => setActuatorFault(selectedActuator.id, 'stuck')}
                    >
                      stuck
                    </button>
                  </div>
                </div>
                <p class="actuator-note">
                  Drive it from a controller <strong>{actBinary ? 'BO (binary)' : 'AO (analog)'}</strong>
                  output — wiring it to the wrong output kind is a real miswire.
                  {#if actModel.hasPositionFeedback}Its feedback line wires back to a controller UI/AI so the program can confirm it moved.{:else}No feedback — the controller infers position from the process variable.{/if}
                </p>
              {:else}
                <p class="actuator-note">
                  Generic actuator — no signal or fail-safe modeled, so wire
                  validation can't help here. Pick a real model (delete + re-drop,
                  or drag from <strong>Devices ▸ Actuators</strong>) for signal-type
                  matching and stroke / fail-safe behavior.
                </p>
              {/if}
            </div>
          </Panel>
        {/if}

        {#if selectedVahu}
          {@const vahuCfg = { ...DEFAULT_VAHU_CONFIG, ...((selectedVahu.data as { vahuConfig?: Partial<VAhuConfig> } | undefined)?.vahuConfig ?? {}) }}
          {@const vahuLive = vahuStates.get(selectedVahu.id)}
          {@const vahuIn = vahuPrevInputs.get(selectedVahu.id)}
          <Panel position="bottom-left">
            <div class="actuator-panel inspector-panel">
              <div class="inspector-head">
                <span class="sensor-title">AHU —</span>
                <input
                  class="rename-input"
                  type="text"
                  value={nodeLabel(selectedVahu)}
                  onblur={(e) => renameNode(selectedVahu.id, (e.currentTarget as HTMLInputElement).value)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      (e.currentTarget as HTMLInputElement).value = nodeLabel(selectedVahu);
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  title="Rename this AHU — e.g. AHU-1, RTU-2"
                  aria-label="AHU name"
                />
                <button
                  type="button"
                  class="inspector-delete"
                  title="Delete this AHU (also: select + press Delete or Backspace)"
                  onclick={() => deleteNodeById(selectedVahu.id)}
                >
                  ✕ Delete
                </button>
              </div>
              <p class="actuator-note">
                ASHRAE G36 §5.18 single-zone AHU. Reads <strong>OAT</strong> (Weather
                drive), <strong>occupancy</strong> (sim clock schedule), and
                <strong>zone temp</strong> from a wired Zone (no Zone → assumes the
                room sits at setpoint). Runs the economizer / heating / cooling
                sequence and exposes 15 BACnet objects in the packet log.
              </p>
              <div class="sensor-row sensor-row-block">
                <span class="sensor-sub">Terminal block (wire sensors / actuators here)</span>
                <div class="actuator-specs">
                  {#each Object.entries(VAHU_TERMINAL_ROLES) as [term, role] (term)}
                    <span class="spec-chip" title={role}>{term} · {role.split(' ')[0]}</span>
                  {/each}
                </div>
                <span class="cond-sub"
                  >Wiring a sensor to AI-1 / AI-4 overrides the synthetic OAT / zone temp; AO/BO
                  terminals drive wired actuators from the live sequence.</span
                >
              </div>
              {#if vahuLive}
                <div class="sensor-row sensor-row-block">
                  <span class="sensor-sub">Live sequence state</span>
                  <div class="actuator-specs">
                    <span class="spec-chip good" title="G36 §5.18.1 operating mode">
                      {vahuLive.mode === 'heating' ? 'Heating'
                        : vahuLive.mode === 'cooling' ? 'Cooling'
                        : vahuLive.mode === 'economizer' ? 'Economizer'
                        : vahuLive.mode === 'unoccupied' ? 'Unoccupied'
                        : 'Off'}
                    </span>
                    <span class="spec-chip" title="Discharge-air-temp setpoint the valves drive toward">SAT sp {vahuLive.satSetpoint.toFixed(1)}°F</span>
                    <span class="spec-chip" title="Outside-air damper position">OA damper {vahuLive.oaDamperPct.toFixed(0)}%</span>
                    <span class="spec-chip" title="Heating valve position">heat valve {vahuLive.heatValvePct.toFixed(0)}%</span>
                    <span class="spec-chip" title="Cooling valve position">cool valve {vahuLive.coolValvePct.toFixed(0)}%</span>
                    <span class="spec-chip" title="Supply fan VFD command">fan {Math.round(vahuLive.fanSpeed * 100)}%</span>
                  </div>
                </div>
                <div class="sensor-row sensor-row-block">
                  <span class="sensor-sub">Air temps</span>
                  <div class="actuator-specs">
                    {#if vahuIn}
                      <span class="spec-chip" title="Outside air temp (from the Weather drive)">OAT {vahuIn.oat.toFixed(1)}°F</span>
                      <span class="spec-chip" title="Return air temp (≈ zone temp on a single-zone unit)">RAT {vahuIn.rat.toFixed(1)}°F</span>
                    {/if}
                    <span class="spec-chip" title="Mixed air temp (after the OA/RA mixing box)">MAT {vahuLive.mat.toFixed(1)}°F</span>
                    <span class="spec-chip" title="Discharge air temp (after coils)">DAT {vahuLive.dat.toFixed(1)}°F</span>
                    {#if vahuIn}
                      <span class="spec-chip" class:good={vahuIn.occupied} title="From the sim-clock occupancy schedule">{vahuIn.occupied ? 'occupied' : 'unoccupied'}</span>
                    {/if}
                  </div>
                </div>
              {:else}
                <p class="actuator-note">
                  Press <strong>▶ Run</strong> to see the live sequence — mode,
                  SAT setpoint, damper / valve positions, and air temps update
                  every tick.
                </p>
              {/if}
              <div class="sensor-row sensor-row-block">
                <span class="sensor-sub">Sequence config (G36 defaults)</span>
                <div class="actuator-specs">
                  <span class="spec-chip" title="Occupied zone temp setpoint">zone sp {vahuCfg.zoneSetpoint}°F</span>
                  <span class="spec-chip" title="SAT setpoint when cooling">SAT cool {vahuCfg.satCoolSetpoint}°F</span>
                  <span class="spec-chip" title="SAT setpoint when heating">SAT heat {vahuCfg.satHeatSetpoint}°F</span>
                  <span class="spec-chip" title="OAT above this locks out the economizer (§5.18.2 fixed dry-bulb)">econ limit {vahuCfg.econHighLimitOAT}°F</span>
                  <span class="spec-chip" title="Minimum OA damper while occupied (ASHRAE 62.1 ventilation)">min OA {vahuCfg.minOaDamperPctOccupied}%</span>
                </div>
              </div>
            </div>
          </Panel>
        {/if}

        {#if selectedController}
          {@const ctrlData = selectedController.data as
            | {
                highAlarm?: number;
                lowAlarm?: number;
                manualOverride?: number;
                forcedMac?: number;
                deviceInstance?: number;
              }
            | undefined}
          {@const overrideOn = typeof ctrlData?.manualOverride === 'number'}
          {@const isWiredTarget = wiredTargets.some(
            (t) => t.controllerId === selectedController.id,
          )}
          {@const isFocusedTarget = focusedTargetId === selectedController.id}
          {@const ctrlHasSensor = findConnectedSensor(selectedController.id) !== null}
          {@const ctrlVendorId = (selectedController.data as { vendorModelId?: string } | undefined)?.vendorModelId}
          {@const ctrlStPortable = !ctrlVendorId || (findControllerModel(ctrlVendorId)?.stPortable ?? true)}
          <Panel position="bottom-left">
            <div class="ctrl-panel inspector-panel">
              <div class="inspector-head">
                <span class="ctrl-title">Controller —</span>
                <input
                  class="rename-input"
                  type="text"
                  value={nodeLabel(selectedController)}
                  onblur={(e) => renameNode(selectedController.id, (e.currentTarget as HTMLInputElement).value)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      (e.currentTarget as HTMLInputElement).value = nodeLabel(selectedController);
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  title="Rename this controller — e.g. AHU-1, VAV-204"
                  aria-label="Controller name"
                />
                <button
                  type="button"
                  class="inspector-terminal"
                  title={ctrlStPortable
                    ? 'Open the programming console — write this controller\'s logic in Structured Text (Cisco-IOS-style CLI). Distinct from "Terminals," which is the I/O wiring view.'
                    : 'Open the programming console (unavailable for this vendor — see show config)'}
                  onclick={() => openCli(selectedController.id, nodeLabel(selectedController))}
                >
                  &gt;_ Programming
                </button>
                {#if ctrlStPortable}
                  <button
                    type="button"
                    class="inspector-diagram"
                    title="Open block diagram editor (IEC 61131-3 FBD)"
                    onclick={() => openFbd(selectedController.id, nodeLabel(selectedController))}
                  >
                    Diagram
                  </button>
                {/if}
                <button
                  type="button"
                  class="inspector-speclang"
                  title="Open SpecLang — plain-English programming. Works on every controller in the catalog."
                  onclick={() => openSpecLang(selectedController.id, nodeLabel(selectedController))}
                >
                  SpecLang
                </button>
                <button
                  type="button"
                  class="inspector-bacnet"
                  title="BACnet objects — see what a supervisor (YABE, Niagara Spy) would discover on this controller."
                  onclick={() => openBacnet(selectedController.id, nodeLabel(selectedController))}
                >
                  BACnet
                </button>
                <button
                  type="button"
                  class="inspector-terminals"
                  title="Terminals — multimeter-style view of every wired terminal. See the raw signal on the wire (mA / V / Ω), pick the input type (Pt1000 vs 0-10V etc.), and spot mismatched / faulted terminals at a glance."
                  onclick={() => openTerminals(selectedController.id, nodeLabel(selectedController))}
                >
                  Terminals
                </button>
                <button
                  type="button"
                  class="inspector-delete"
                  title="Delete this controller (also: select + press Delete or Backspace)"
                  onclick={() => deleteNodeById(selectedController.id)}
                >
                  ✕ Delete
                </button>
              </div>
              <!-- Physics-target status row — makes the relationship between
                   the clicked controller and the active tune panel explicit.
                   Common confusion: user clicks Controller B expecting the
                   tune sliders to update, but B isn't wired so the tune
                   panel keeps showing Controller A. This row tells them
                   exactly what's happening and gives a one-click fix. -->
              <div class="ctrl-physics-row">
                {#if isFocusedTarget}
                  <span class="phys-status phys-good">
                    ✓ Active tune target — sliders below match this controller
                  </span>
                {:else if isWiredTarget}
                  <button
                    type="button"
                    class="phys-action"
                    title="Switch the tune panel to this controller's config"
                    onclick={() => (focusedTargetId = selectedController.id)}
                  >
                    → Make this the tune target
                  </button>
                {:else if ctrlHasSensor}
                  <button
                    type="button"
                    class="phys-action"
                    title="Wire this controller's sensor pair as a physics target"
                    onclick={() => wireAsPhysicsTarget(selectedController.id)}
                  >
                    → Wire as physics target
                  </button>
                {:else}
                  <span class="phys-status phys-warn">
                    Wire a sensor to this controller (drag between handles) to enable physics tuning
                  </span>
                {/if}
              </div>
              {#if ctrlData}
                {@const liveMac = mstpDeviceLookup(selectedController.id)}
                <label
                  class="ctrl-field"
                  title="MS/TP MAC address (0-127). Leave blank to auto-assign — the supervisor gets MAC 0, others get the next free MAC on the trunk. Set explicitly to mimic a dip-switch on a real FEC, or to bake in a deliberate duplicate-MAC fault."
                >
                  <span>MAC</span>
                  <input
                    type="number"
                    min="0"
                    max="127"
                    placeholder={liveMac !== null ? `auto: ${liveMac}` : 'auto'}
                    value={ctrlData.forcedMac ?? ''}
                    oninput={(e) => setControllerMac(selectedController.id, (e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <label
                  class="ctrl-field"
                  title="BACnet Device Instance — site-wide unique ID (0-4194302). The supervisor uses this to address the controller across the network. Defaults to 1000 + MAC if you leave it blank."
                >
                  <span>Inst</span>
                  <input
                    type="number"
                    min="0"
                    max="4194302"
                    placeholder={liveMac !== null ? `auto: ${1000 + liveMac}` : 'auto'}
                    value={ctrlData.deviceInstance ?? ''}
                    oninput={(e) => setControllerDeviceInstance(selectedController.id, (e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                {@const eolOn = (selectedController.data as { eolTerminated?: boolean } | undefined)?.eolTerminated === true}
                <button
                  type="button"
                  class="eol-toggle"
                  class:active={eolOn}
                  title="RS-485 end-of-line termination (the EOL dip switch). Flip it ON at the two physical ends of the MS/TP chain — and only there. Missing termination reflects the signal (intermittent token loss at speed); mid-chain termination overloads the bus."
                  onclick={() => setNodeEol(selectedController.id, !eolOn)}
                >
                  EOL {eolOn ? 'on' : 'off'}
                </button>
                <span class="ctrl-divider"></span>
              {/if}
              <label class="ctrl-field">
                <span>High</span>
                <input
                  type="number"
                  step="0.5"
                  placeholder="off"
                  value={ctrlData?.highAlarm ?? ''}
                  oninput={(e) =>
                    setControllerAlarm(selectedController.id, 'high', e.currentTarget.value)}
                />
                <span class="ctrl-unit">°F</span>
              </label>
              <label class="ctrl-field">
                <span>Low</span>
                <input
                  type="number"
                  step="0.5"
                  placeholder="off"
                  value={ctrlData?.lowAlarm ?? ''}
                  oninput={(e) =>
                    setControllerAlarm(selectedController.id, 'low', e.currentTarget.value)}
                />
                <span class="ctrl-unit">°F</span>
              </label>
              <span class="ctrl-divider"></span>
              <button
                type="button"
                class="override-toggle"
                class:active={overrideOn}
                title={overrideOn
                  ? 'Release the manual override — PI control resumes.'
                  : 'Override the actuator output (bypass PI). Like a tech commanding a damper for balancing or troubleshooting.'}
                onclick={() => toggleOverride(selectedController.id, !overrideOn)}
              >
                {overrideOn ? '◉ Override ON' : '○ Override'}
              </button>
              {#if overrideOn}
                <label class="ctrl-field">
                  <span>Out</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round((ctrlData?.manualOverride ?? 0) * 100)}
                    oninput={(e) =>
                      setOverrideValue(selectedController.id, Number(e.currentTarget.value) / 100)}
                  />
                  <span class="ctrl-unit">{Math.round((ctrlData?.manualOverride ?? 0) * 100)}%</span
                  >
                </label>
              {/if}
            </div>
          </Panel>
        {/if}

        {#if running && focusedTarget && (runningSamples.get(focusedTarget.controllerId)?.length ?? 0) > 0}
          {@const primarySeries = {
            samples: runningSamples.get(focusedTarget.controllerId) ?? [],
            label: physicsTarget?.controllerLabel ?? '?',
            color: colorForTarget(focusedTarget.controllerId),
            setpoint: focusedTarget.config.setpoint,
            oat: focusedTarget.config.outdoorAir,
          }}
          {@const ghostSeries = wiredTargets
            .filter((t) => t.controllerId !== focusedTarget.controllerId)
            .map((t): ChartSeries => {
              const ctrl = nodes.find((n) => n.id === t.controllerId);
              return {
                samples: runningSamples.get(t.controllerId) ?? [],
                label: ctrl ? nodeLabel(ctrl) : '?',
                color: colorForTarget(t.controllerId),
                setpoint: t.config.setpoint,
                oat: t.config.outdoorAir,
              };
            })
            .filter((s) => s.samples.length > 0)}
          <Panel position="top-left">
            <div class="chart-panel" class:collapsed={chartCollapsed}>
              <div class="chart-head">
                <button
                  type="button"
                  class="panel-collapse"
                  onclick={toggleChartCollapsed}
                  title={chartCollapsed ? 'Expand the zone response chart' : 'Collapse the chart to its header — more room for the canvas'}
                  aria-expanded={!chartCollapsed}
                >
                  {chartCollapsed ? '▸' : '▾'}
                </button>
                <span class="chart-title"
                  >Zone response{wiredTargets.length > 1
                    ? ` — ${wiredTargets.length} zones`
                    : ` — ${primarySeries.label}`}</span
                >
                {#if !chartCollapsed}
                  <span class="chart-sub"
                    >{focusedTarget.config.dt}s/tick · τ={(focusedTarget.config.tau / 60).toFixed(
                      0,
                    )}min</span
                  >
                  <button
                    type="button"
                    class="chart-csv"
                    title="Download every running target's sample history as a CSV trend log"
                    onclick={exportSamplesCsv}
                  >
                    ↓ CSV
                  </button>
                {/if}
              </div>
              {#if !chartCollapsed}
                <MiniChart primary={primarySeries} ghosts={ghostSeries} />
              {/if}
            </div>
          </Panel>
        {/if}

        {#if focusedTarget && physicsTarget}
          <Panel position="bottom-left">
            <div class="tune-panel" class:collapsed={tuneCollapsed}>
              <div class="tune-head">
                <button
                  type="button"
                  class="panel-collapse"
                  onclick={toggleTuneCollapsed}
                  title={tuneCollapsed ? 'Expand the tune panel' : 'Collapse the tune panel to its header — more room for the canvas'}
                  aria-expanded={!tuneCollapsed}
                >
                  {tuneCollapsed ? '▸' : '▾'}
                </button>
                <span class="tune-title"
                  >Tune — {physicsTarget.controllerLabel}{wiredTargets.length > 1
                    ? ` (${wiredTargets.findIndex((t) => t.controllerId === focusedTargetId) + 1}/${wiredTargets.length})`
                    : ''}</span
                >
                {#if !tuneCollapsed}
                  <button
                    type="button"
                    class="reset-cfg"
                    onclick={resetConfig}
                    title={activePresetId === 'custom'
                      ? 'Reset to last loaded scenario'
                      : `Reset to preset "${PRESETS.find((p) => p.id === activePresetId)?.name ?? 'Default'}"`}
                  >
                    defaults
                  </button>
                {/if}
              </div>
              {#if !tuneCollapsed}
              <div class="preset-row">
                {#each PRESETS as preset (preset.id)}
                  <button
                    type="button"
                    class="preset-chip"
                    class:active={activePresetId === preset.id}
                    title={preset.description}
                    onclick={() => applyPreset(preset)}
                  >
                    {preset.name}
                  </button>
                {/each}
                {#if activePresetId === 'custom'}
                  <span class="preset-chip custom" title="Values came from a loaded scenario file">
                    Custom
                  </span>
                {/if}
              </div>
              <!-- Mode toggle: cool removes heat from the zone, heat adds it.
                   PI flips its error sign so the slider behavior feels
                   identical — turn the dial, watch the actuator open the
                   right direction. -->
              <div class="mode-row">
                <span class="mode-label">Mode</span>
                <button
                  type="button"
                  class="mode-chip"
                  class:active={(focusedTarget.config.mode ?? 'cool') === 'cool'}
                  title="Cooling — actuator removes heat from the zone"
                  onclick={() => focusedTarget && (focusedTarget.config.mode = 'cool')}
                >
                  ❄ Cool
                </button>
                <button
                  type="button"
                  class="mode-chip heat"
                  class:active={focusedTarget.config.mode === 'heat'}
                  title="Heating — actuator adds heat to the zone"
                  onclick={() => focusedTarget && (focusedTarget.config.mode = 'heat')}
                >
                  ☼ Heat
                </button>
              </div>
              <div class="slider-row">
                <label for="sp-slider">
                  <span class="lbl">Setpoint</span>
                  <span class="val">{focusedTarget.config.setpoint.toFixed(1)} °F</span>
                </label>
                <input
                  id="sp-slider"
                  type="range"
                  bind:value={focusedTarget.config.setpoint}
                  min={65}
                  max={80}
                  step={0.5}
                />
              </div>
              <div class="slider-row">
                <label for="oat-slider">
                  <span class="lbl">OAT</span>
                  <span class="val">{focusedTarget.config.outdoorAir.toFixed(0)} °F</span>
                </label>
                <input
                  id="oat-slider"
                  type="range"
                  bind:value={focusedTarget.config.outdoorAir}
                  min={60}
                  max={105}
                  step={1}
                />
              </div>
              <div class="slider-row">
                <label for="kp-slider">
                  <span class="lbl">Kp <em>(prop. gain)</em></span>
                  <span class="val">{focusedTarget.config.Kp.toFixed(2)}</span>
                </label>
                <input
                  id="kp-slider"
                  type="range"
                  bind:value={focusedTarget.config.Kp}
                  min={0.05}
                  max={1.5}
                  step={0.05}
                />
              </div>
              {#if showAdvanced}
                <div class="slider-row">
                  <label for="tau-slider">
                    <span class="lbl">τ <em>(zone mass)</em></span>
                    <span class="val">{(focusedTarget.config.tau / 60).toFixed(0)} min</span>
                  </label>
                  <input
                    id="tau-slider"
                    type="range"
                    bind:value={focusedTarget.config.tau}
                    min={60}
                    max={1800}
                    step={60}
                  />
                </div>
                <div class="slider-row">
                  <label for="ki-slider">
                    <span class="lbl">Ki <em>(integral)</em></span>
                    <span class="val">{focusedTarget.config.Ki.toFixed(4)}</span>
                  </label>
                  <input
                    id="ki-slider"
                    type="range"
                    bind:value={focusedTarget.config.Ki}
                    min={0}
                    max={0.01}
                    step={0.0005}
                  />
                </div>
                <div class="slider-row">
                  <label for="cool-slider">
                    <span class="lbl"
                      >{(focusedTarget.config.mode ?? 'cool') === 'cool'
                        ? 'Cool max'
                        : 'Heat max'}</span
                    >
                    <span class="val"
                      >{(focusedTarget.config.coolingMax * 60).toFixed(1)} °F/min</span
                    >
                  </label>
                  <input
                    id="cool-slider"
                    type="range"
                    bind:value={focusedTarget.config.coolingMax}
                    min={0}
                    max={0.1}
                    step={0.005}
                  />
                </div>

                <!-- Two-zone coupling slider: 0 = isolated, 1 = neighbor's
                     temp dominates. Only meaningful when there are other
                     wired siblings sharing this controller's parent. -->
                <div class="slider-row">
                  <label for="couple-slider">
                    <span class="lbl">Neighbor pull</span>
                    <span class="val"
                      >{((focusedTarget.config.couplingFactor ?? 0) * 100).toFixed(0)}%</span
                    >
                  </label>
                  <input
                    id="couple-slider"
                    type="range"
                    value={focusedTarget.config.couplingFactor ?? 0}
                    min={0}
                    max={1}
                    step={0.05}
                    oninput={(e) => {
                      if (focusedTarget)
                        focusedTarget.config.couplingFactor = Number(e.currentTarget.value);
                    }}
                  />
                </div>

                <!-- Occupancy schedule: night-setback for whichever VAV
                     you've got selected. Tucked behind a toggle so it
                     doesn't show up unless the user wants it. -->
                <div class="schedule-block">
                  <label class="schedule-toggle">
                    <input
                      type="checkbox"
                      checked={focusedTarget.config.schedule?.enabled ?? false}
                      onchange={(e) => toggleSchedule(e.currentTarget.checked)}
                    />
                    <span>Occupancy schedule (night setback)</span>
                  </label>
                  {#if focusedTarget.config.schedule?.enabled}
                    {@const sched = focusedTarget.config.schedule}
                    {@const tickHours = ((tick * focusedTarget.config.dt) / 3600) % 24}
                    <div class="schedule-grid">
                      <label>
                        <span>Occ SP</span>
                        <input
                          type="number"
                          step="0.5"
                          value={sched.occupiedSetpoint}
                          oninput={(e) =>
                            updateSchedule({ occupiedSetpoint: Number(e.currentTarget.value) })}
                        />
                        <span class="ctrl-unit">°F</span>
                      </label>
                      <label>
                        <span>Unocc SP</span>
                        <input
                          type="number"
                          step="0.5"
                          value={sched.unoccupiedSetpoint}
                          oninput={(e) =>
                            updateSchedule({ unoccupiedSetpoint: Number(e.currentTarget.value) })}
                        />
                        <span class="ctrl-unit">°F</span>
                      </label>
                      <label>
                        <span>Occ start</span>
                        <input
                          type="number"
                          min="0"
                          max="23.5"
                          step="0.5"
                          value={sched.occStartHour}
                          oninput={(e) =>
                            updateSchedule({ occStartHour: Number(e.currentTarget.value) })}
                        />
                        <span class="ctrl-unit">h</span>
                      </label>
                      <label>
                        <span>Occ end</span>
                        <input
                          type="number"
                          min="0"
                          max="23.5"
                          step="0.5"
                          value={sched.occEndHour}
                          oninput={(e) =>
                            updateSchedule({ occEndHour: Number(e.currentTarget.value) })}
                        />
                        <span class="ctrl-unit">h</span>
                      </label>
                    </div>
                    <span class="schedule-now">
                      Sim clock {Math.floor(tickHours).toString().padStart(2, '0')}:{Math.floor(
                        (tickHours % 1) * 60,
                      )
                        .toString()
                        .padStart(2, '0')}
                      — {isOccupiedNow(sched, tickHours) ? 'occupied' : 'setback'}
                    </span>
                  {/if}
                </div>
              {/if}
              <button
                type="button"
                class="advanced-toggle"
                onclick={() => (showAdvanced = !showAdvanced)}
              >
                {showAdvanced
                  ? '− Hide advanced (τ, Ki, cooling)'
                  : '+ Show advanced (τ, Ki, cooling)'}
              </button>
              {/if}
            </div>
          </Panel>
        {/if}

        {#if alarmLog.length > 0}
          <Panel position="bottom-right">
            <div class="alarm-log">
              <div class="alarm-log-head">
                <span class="alarm-log-title">Alarm log ({alarmLog.length})</span>
                <button
                  type="button"
                  class="alarm-log-clear"
                  title="Clear the alarm history"
                  onclick={() => (alarmLog = [])}
                >
                  Clear
                </button>
              </div>
              <ul class="alarm-log-list">
                {#each alarmLog.slice(0, 8) as entry (entry.id)}
                  <li
                    class="alarm-log-row alarm-{entry.kind}"
                    class:cleared={entry.action === 'clear'}
                  >
                    <span class="alarm-log-tick">t={entry.tick}s</span>
                    <span class="alarm-log-action">
                      {entry.action === 'fire' ? (entry.kind === 'high' ? '▲' : '▼') : '✓'}
                    </span>
                    <span class="alarm-log-label">{entry.controllerLabel}</span>
                    <span class="alarm-log-temp">{entry.zoneTemp.toFixed(1)}°F</span>
                  </li>
                {/each}
              </ul>
              {#if alarmLog.length > 8}
                <span class="alarm-log-more">+{alarmLog.length - 8} older entries</span>
              {/if}
            </div>
          </Panel>
        {/if}

        {#if wireRefusal}
          <Panel position="top-center">
            <div class="wire-refusal" role="alert">
              <span class="wire-refusal-glyph">⚠</span>
              <span class="wire-refusal-text">{wireRefusal.reason}</span>
              <button type="button" class="wire-refusal-close" onclick={() => (wireRefusal = null)} aria-label="Dismiss">✕</button>
            </div>
          </Panel>
        {/if}

        {#if checkModalOpen}
          <div
            class="check-modal-overlay"
            role="button"
            tabindex="-1"
            onclick={() => (checkModalOpen = false)}
            onkeydown={(e) => { if (e.key === 'Escape') checkModalOpen = false; }}
          >
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div class="check-modal" role="dialog" aria-modal="true" aria-label="Check my work" onclick={(e) => e.stopPropagation()}>
              <div class="check-modal-head">
                <span class="check-modal-title">🔍 Check my work</span>
                <button type="button" class="check-modal-close" onclick={() => (checkModalOpen = false)} aria-label="Close">✕</button>
              </div>
              {#if checkResults.length === 0}
                <p class="check-empty">
                  ✓ No problems found in what the checks can see right now.
                  <br />
                  <span class="check-empty-sub">
                    Wiring looks compatible. Note: deeper checks (addressing, comms,
                    cross-subnet) populate once you hit ▶ Run — re-check after a run
                    if something still isn't working.
                  </span>
                </p>
              {:else}
                <p class="check-intro">{checkResults.length} thing{checkResults.length === 1 ? '' : 's'} to look at:</p>
                <ul class="check-list">
                  {#each checkResults as item (item.title + item.detail)}
                    <li class="check-item check-{item.severity}">
                      <span class="check-item-glyph">{item.severity === 'error' ? '✕' : item.severity === 'warning' ? '⚠' : 'ℹ'}</span>
                      <div class="check-item-body">
                        <span class="check-item-title">{item.title}</span>
                        <span class="check-item-detail">{item.detail}</span>
                      </div>
                    </li>
                  {/each}
                </ul>
              {/if}
              <p class="check-foot">Tip: the Assistant can explain any of these if you ask it.</p>
            </div>
          </div>
        {/if}

        <Panel position="top-left">
          <div class="canvas-actions">
            <button
              type="button"
              class="ca-btn"
              onclick={saveScenario}
              title="Download the canvas as a .bas-scenario JSON file"
            >
              💾 Save
            </button>
            <button
              type="button"
              class="ca-btn"
              onclick={clearAll}
              title="Remove every node and wire from the canvas"
            >
              ✕ Clear
            </button>
            <button
              type="button"
              class="ca-btn ca-btn-danger"
              onclick={resetCanvas}
              title="Wipe everything (including localStorage) to a fresh empty canvas"
            >
              ⟲ Reset
            </button>
            <CorpusBadge />
            <span class="ca-divider"></span>
            <div
              class="guidance-toggle"
              role="group"
              aria-label="Guidance mode"
              title="Easy: incompatible wiring is blocked (training wheels). Realistic: the field — bad wiring is allowed with no warning; use the AI or 'Check my work' to find it."
            >
              <button
                type="button"
                class="gt-btn"
                class:active={guidanceMode === 'easy'}
                onclick={() => setGuidanceMode('easy')}
              >
                🛟 Easy
              </button>
              <button
                type="button"
                class="gt-btn"
                class:active={guidanceMode === 'realistic'}
                onclick={() => setGuidanceMode('realistic')}
              >
                🔧 Realistic
              </button>
            </div>
            <button
              type="button"
              class="ca-btn ca-btn-check"
              onclick={runCheckMyWork}
              title="Reveal what's wired wrong + other errors. The no-AI fallback when you're stuck — especially useful in Realistic mode where nothing warns you."
            >
              🔍 Check my work
            </button>
          </div>
        </Panel>

        <Panel position="top-right">
          <div class="sim-panel">
            {#if !running}
              <button type="button" class="run" onclick={start} disabled={nodes.length === 0}>
                ▶ Run
              </button>
            {:else}
              <button type="button" class="stop" onclick={stop}> ■ Stop </button>
            {/if}
            <button
              type="button"
              class="reset-sim"
              onclick={resetSim}
              disabled={tick === 0 && !running}
            >
              Reset sim
            </button>
            <span class="tick">t = {tick}s</span>
            <!-- Sim clock readout: shows the current hour-of-day the sim is at.
                 Lets you set a START hour before pressing Run so occupancy
                 schedules can be tested without waiting for the schedule's
                 actual transition time. CCT/SCT don't expose this; here it
                 takes one input. -->
            <label
              class="sim-clock-input"
              title={running
                ? 'Stop the sim to change the start hour'
                : tick > 0
                  ? 'Changing the start hour resets the sim and re-runs the warmup'
                  : 'Wall-clock hour the sim starts at — drives occupancy schedules + solar gain'}
            >
              <span>start</span>
              <input
                type="number"
                min="0"
                max="23.5"
                step="0.5"
                value={simStartHour}
                onchange={(e) => {
                  const v = Number((e.currentTarget as HTMLInputElement).value);
                  if (Number.isFinite(v)) {
                    simStartHour = Math.max(0, Math.min(23.5, v));
                    // If the sim has already produced ticks, reset so the
                    // new start hour actually takes effect on next Run.
                    if (tick > 0 && !running) resetSim();
                  }
                }}
                disabled={running}
              />
              <span class="ctrl-unit">h</span>
            </label>
            {#if tick > 0 || running}
              {@const totalSec = simStartHour * 3600 + simSecondsElapsed}
              {@const h = Math.floor(totalSec / 3600) % 24}
              {@const m = Math.floor((totalSec % 3600) / 60)}
              <span class="sim-clock-readout" title="Current sim hour-of-day">
                sim {h.toString().padStart(2, '0')}:{m.toString().padStart(2, '0')}
              </span>
            {/if}
            <span
              class="sim-speed"
              title="Sim time multiplier — 30× and 300× speed through long thermal warmups. Affects actuator stroke, plant ramp, and zone drift uniformly."
            >
              {#each SIM_SPEED_OPTIONS as opt (opt)}
                <button
                  type="button"
                  class:active={simSpeed === opt}
                  onclick={() => setSimSpeed(opt)}
                >{opt}×</button>
              {/each}
            </span>
            {#if nodes.length > 0}
              <span class="status-divider"></span>
              <span class="status-pill ok" title="Reachable from a supervisor"
                >● {liveCounts.online}</span
              >
              {#if liveCounts.offline > 0}
                <span class="status-pill offline" title="Unreachable (broken trunk)"
                  >⌀ {liveCounts.offline}</span
                >
              {/if}
              {#if liveCounts.faults > 0}
                <span class="status-pill fault" title="Sensors with active fault injection"
                  >⚠ {liveCounts.faults}</span
                >
              {/if}
              {#if liveCounts.alarms > 0}
                <span class="status-pill alarm" title="Controllers in alarm state"
                  >▲ {liveCounts.alarms}</span
                >
              {/if}
            {/if}
            <button
              type="button"
              class="cond-btn"
              class:active={conditionsOpen}
              onclick={() => (conditionsOpen = !conditionsOpen)}
              title="The conditions the sim is running against — outside-air temp and time-of-day / occupancy, in one place"
            >
              🌤 Conditions
            </button>
          </div>
          {#if conditionsOpen}
            {@const weatherLiveOat =
              weatherStore.mode !== 'off' && weatherStore.status === 'ready'
                ? (currentWeatherSample()?.T_F ?? null)
                : null}
            {@const condTotalSec = simStartHour * 3600 + simSecondsElapsed}
            {@const condHour = (condTotalSec / 3600) % 24}
            {@const condH = Math.floor(condHour)}
            {@const condM = Math.floor((condTotalSec % 3600) / 60)}
            {@const condOcc = defaultOccupancySchedule(condHour)}
            <div class="conditions-panel">
              <div class="cond-row">
                <span class="cond-label">Outside air</span>
                <div class="cond-toggle" role="group" aria-label="OAT source">
                  <button
                    type="button"
                    class:active={manualOat === null}
                    onclick={() => setManualOat(null)}
                    title="Follow the Weather tab's live OAT (or the 60°F default when no city is loaded)"
                  >
                    From weather
                  </button>
                  <button
                    type="button"
                    class:active={manualOat !== null}
                    onclick={() => {
                      if (manualOat === null) setManualOat(Math.round(weatherLiveOat ?? 60));
                    }}
                    title="Set the OAT yourself — overrides weather everywhere (AHU, zones, physics targets)"
                  >
                    Manual
                  </button>
                </div>
                {#if manualOat !== null}
                  <input
                    type="range"
                    class="cond-slider"
                    min="-20"
                    max="110"
                    step="1"
                    value={manualOat}
                    oninput={(e) => setManualOat(Number((e.currentTarget as HTMLInputElement).value))}
                    aria-label="Manual outside-air temperature"
                  />
                  <span class="cond-value">{manualOat}°F</span>
                {:else if weatherLiveOat !== null}
                  <span class="cond-value">{weatherLiveOat.toFixed(1)}°F</span>
                  <span class="cond-sub">live from the Weather tab</span>
                {:else}
                  <span class="cond-value">60°F</span>
                  <span class="cond-sub">default — load a city in the Weather tab, or switch to Manual</span>
                {/if}
              </div>
              <div class="cond-row">
                <span class="cond-label">Time / occupancy</span>
                <span class="cond-value"
                  >{condH.toString().padStart(2, '0')}:{condM.toString().padStart(2, '0')}</span
                >
                <span class="cond-pill" class:occupied={condOcc > 0.5}>
                  {condOcc > 0.5 ? `occupied ${(condOcc * 100).toFixed(0)}%` : 'unoccupied'}
                </span>
                <span class="cond-sub"
                  >zones / AHUs · office schedule 06:00–19:00 — set <strong>start</strong> in the
                  toolbar to jump the clock</span
                >
              </div>
              <!-- Controllers with their OWN night-setback schedule can disagree
                   with the global zone/AHU schedule above (e.g. a 06–22 office
                   VAV is still "occupied" at 20:00 while the zones read
                   unoccupied). Surface each one so the two sources are visible
                   together instead of silently contradicting. -->
              {#each wiredTargets.filter((t) => t.config.schedule?.enabled) as t (t.controllerId)}
                {@const tNode = nodes.find((n) => n.id === t.controllerId)}
                {@const sched = t.config.schedule!}
                <div class="cond-row">
                  <span class="cond-label cond-sub-label">{tNode ? nodeLabel(tNode) : t.controllerId}</span>
                  <span class="cond-sub"
                    >own schedule {String(Math.floor(sched.occStartHour)).padStart(2, '0')}:00–{String(Math.floor(sched.occEndHour)).padStart(2, '0')}:00</span
                  >
                  <span class="cond-pill" class:occupied={isOccupiedNow(sched, condHour)}>
                    {isOccupiedNow(sched, condHour)
                      ? `occupied · SP ${sched.occupiedSetpoint}°F`
                      : `setback · SP ${sched.unoccupiedSetpoint}°F`}
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        </Panel>
      </SvelteFlow>
    </div>
  </SvelteFlowProvider>
</div>

<style>
  .build {
    display: grid;
    grid-template-columns: 16rem 1fr;
    height: 72vh;
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    border-radius: 6px;
    overflow: hidden;
    background: Canvas;
  }

  .palette {
    border-right: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    padding: 0.85rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .palette-head h3 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    margin: 0 0 0.35rem 0;
  }

  .hint {
    font-size: 0.78rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    margin: 0 0 0.75rem 0;
    line-height: 1.35;
  }

  .hint kbd {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    background: color-mix(in srgb, CanvasText 10%, transparent);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
  }

  .items {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .item {
    --accent: #888;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.5rem 0.6rem;
    background: color-mix(in srgb, var(--accent) 8%, Canvas);
    border: 1.5px solid var(--accent);
    border-radius: 5px;
    cursor: grab;
    user-select: none;
  }

  .item:active {
    cursor: grabbing;
  }

  .item .icon {
    font-size: 1.1rem;
    color: var(--accent);
    line-height: 1;
  }

  .item .text {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }

  .item strong {
    font-size: 0.83rem;
    font-weight: 500;
  }

  .item .ex {
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .item.kind-supervisor {
    --accent: #4a9eff;
  }
  .item.kind-controller {
    --accent: #9c8cff;
  }
  .item.kind-sensor {
    --accent: #f39c12;
  }
  .item.kind-safety {
    --accent: #e74c3c;
  }

  .points-legend-section {
    border-left: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    padding-left: 0.75rem;
    margin-left: 0.25rem;
    width: 17rem;
    flex-shrink: 0;
  }

  .points-legend-section h3 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    margin: 0 0 0.35rem 0;
  }

  .legend-table {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .legend-table li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
  }

  .legend-table .legend-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .legend-table .legend-code {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .legend-table .legend-desc {
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-size: 0.66rem;
    line-height: 1.25;
  }

  .wires-section {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
  }

  .wires-section h3 {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    margin: 0 0 0.35rem 0;
  }

  .wire-palette {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .wire-row {
    --c: #888;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.32rem 0.55rem;
    background: transparent;
    border: 1.5px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    font: inherit;
    font-size: 0.78rem;
    text-align: left;
  }

  .wire-row:hover {
    background: color-mix(in srgb, var(--c) 8%, transparent);
    color: CanvasText;
  }

  .wire-row.active {
    border-color: var(--c);
    background: color-mix(in srgb, var(--c) 12%, transparent);
    color: CanvasText;
  }

  .wire-swatch {
    width: 1.5rem;
    height: 0.18rem;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .wire-swatch.auto {
    background: linear-gradient(
      90deg,
      #4a9eff 0%,
      #9c8cff 35%,
      #fb923c 60%,
      #2ecc71 85%,
      #aaa 100%
    );
  }

  .wire-row-label {
    flex: 1;
  }

  .wire-row-sub {
    font-size: 0.66rem;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .palette-foot {
    margin-top: auto;
    padding-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .physics-info {
    padding: 0.5rem 0.55rem;
    border: 1px solid color-mix(in srgb, #f59e0b 35%, transparent);
    background: color-mix(in srgb, #f59e0b 6%, Canvas);
    border-radius: 5px;
  }

  .phys-row {
    display: flex;
    gap: 0.45rem;
    align-items: flex-start;
  }

  .phys-clear {
    margin-left: auto;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: transparent;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    font: inherit;
    font-size: 0.7rem;
    line-height: 1;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    cursor: pointer;
    align-self: center;
  }

  .phys-clear:hover:not(:disabled) {
    background: color-mix(in srgb, CanvasText 8%, transparent);
    color: CanvasText;
  }

  .phys-clear:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .phys-icon {
    font-size: 1rem;
    color: #f59e0b;
    line-height: 1.2;
  }

  .phys-icon.idle {
    color: color-mix(in srgb, CanvasText 30%, transparent);
  }

  .phys-text {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }

  .phys-label {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }

  .phys-pair {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.78rem;
    color: CanvasText;
  }

  .phys-hint {
    margin: 0.4rem 0 0;
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    line-height: 1.3;
  }

  .clear {
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.78rem;
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
  }

  .clear:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
  }

  .scenario-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }

  .scenario-btn {
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.78rem;
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    text-align: center;
  }

  .scenario-btn:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
  }

  .scenario-btn.load {
    display: inline-block;
  }

  .slots-section {
    margin-top: 0.6rem;
    padding-top: 0.5rem;
    border-top: 1px dashed color-mix(in srgb, CanvasText 15%, transparent);
  }

  .demos-sub {
    font-size: 0.62rem;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    font-style: italic;
  }

  .demos-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .demo-load {
    width: 100%;
    text-align: left;
    border: 1px solid color-mix(in srgb, #4a9eff 28%, transparent);
    background: color-mix(in srgb, #4a9eff 6%, transparent);
    color: inherit;
    font: inherit;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .demo-load:hover {
    background: color-mix(in srgb, #4a9eff 14%, transparent);
    border-color: color-mix(in srgb, #4a9eff 45%, transparent);
  }

  .demo-name {
    font-size: 0.74rem;
    font-weight: 600;
    color: color-mix(in srgb, #4a9eff 95%, CanvasText);
  }

  .demo-blurb {
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    line-height: 1.3;
  }

  .slots-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.35rem;
  }

  .slots-head h4 {
    margin: 0;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }

  .slot-add {
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    background: transparent;
    color: color-mix(in srgb, CanvasText 80%, transparent);
    font: inherit;
    font-size: 0.68rem;
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    cursor: pointer;
  }

  .slot-add:hover {
    background: color-mix(in srgb, CanvasText 8%, transparent);
    color: CanvasText;
  }

  .slots-empty {
    margin: 0;
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-style: italic;
  }

  .slots-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .slot-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.25rem;
  }

  .slot-load {
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    background: color-mix(in srgb, CanvasText 5%, transparent);
    color: color-mix(in srgb, CanvasText 85%, transparent);
    font: inherit;
    font-size: 0.72rem;
    padding: 0.2rem 0.45rem;
    border-radius: 3px;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slot-load:hover {
    background: color-mix(in srgb, CanvasText 12%, transparent);
    color: CanvasText;
  }

  .slot-delete {
    border: 1px solid color-mix(in srgb, #e74c3c 35%, transparent);
    background: transparent;
    color: color-mix(in srgb, #e74c3c 80%, CanvasText);
    font: inherit;
    font-size: 0.7rem;
    width: 1.6rem;
    padding: 0;
    border-radius: 3px;
    cursor: pointer;
  }

  .slot-delete:hover {
    background: color-mix(in srgb, #e74c3c 14%, transparent);
    color: #e74c3c;
  }

  .load-message {
    margin: 0;
    padding: 0.3rem 0.5rem;
    border-radius: 4px;
    font-size: 0.72rem;
    line-height: 1.3;
  }

  .load-message.ok {
    background: color-mix(in srgb, #2ecc71 14%, transparent);
    color: #2ecc71;
  }

  .load-message.err {
    background: color-mix(in srgb, #e74c3c 14%, transparent);
    color: #e74c3c;
  }

  .meta {
    font-size: 0.72rem;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .trunks-section {
    margin-top: 0.5rem;
  }

  .trunks-section h3 {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    margin: 0 0 0.35rem 0;
  }

  .trunks-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    max-height: 14rem;
    overflow-y: auto;
  }

  .trunk-group {
    border: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    border-radius: 4px;
    padding: 0.35rem 0.5rem;
  }

  .trunk-parent {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.74rem;
    margin-bottom: 0.2rem;
  }

  .trunk-parent-icon {
    font-size: 0.55rem;
  }

  .trunk-parent-icon.kind-supervisor {
    color: #4a9eff;
  }
  .trunk-parent-icon.kind-controller {
    color: #9c8cff;
  }
  .trunk-parent-icon.kind-sensor {
    color: #f39c12;
  }
  .trunk-parent-icon.kind-safety {
    color: #e74c3c;
  }

  .trunk-parent-label {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    color: CanvasText;
  }

  .trunk-line {
    --c: #888;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.15rem 0 0.15rem 1rem;
    font-size: 0.7rem;
  }

  .trunk-swatch {
    width: 1rem;
    height: 0.15rem;
    background: var(--c);
    border-radius: 1px;
    flex-shrink: 0;
  }

  .trunk-label {
    flex: 1;
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }

  .trunk-count {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-variant-numeric: tabular-nums;
    padding: 0.02rem 0.4rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--c) 20%, transparent);
    color: var(--c);
    font-size: 0.66rem;
  }

  .canvas-buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }

  .topology-checks {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .checks-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.78rem;
    padding: 0.35rem 0.55rem;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
  }

  .checks-head:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
  }

  .checks-head.has-errors {
    border-color: color-mix(in srgb, #e74c3c 50%, transparent);
  }

  .checks-head.has-warnings:not(.has-errors) {
    border-color: color-mix(in srgb, #f39c12 50%, transparent);
  }

  .checks-title {
    flex: 1;
  }

  .checks-badges {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .cb {
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    border-radius: 8px;
    font-variant-numeric: tabular-nums;
  }

  .cb.err {
    background: color-mix(in srgb, #e74c3c 18%, transparent);
    color: #e74c3c;
  }

  .cb.warn {
    background: color-mix(in srgb, #f39c12 18%, transparent);
    color: #f39c12;
  }

  .cb.info {
    background: color-mix(in srgb, #4a9eff 18%, transparent);
    color: #4a9eff;
  }

  .cb.ok {
    background: color-mix(in srgb, #2ecc71 18%, transparent);
    color: #2ecc71;
  }

  .checks-chevron {
    color: color-mix(in srgb, CanvasText 50%, transparent);
    font-size: 0.7rem;
    margin-left: 0.15rem;
  }

  .checks-empty {
    margin: 0;
    padding: 0.4rem 0.55rem;
    font-size: 0.72rem;
    color: color-mix(in srgb, #2ecc71 80%, CanvasText);
    background: color-mix(in srgb, #2ecc71 8%, transparent);
    border-radius: 4px;
  }

  .checks-list {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 12rem;
    overflow-y: auto;
    border: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    border-radius: 4px;
  }

  .check {
    display: flex;
    gap: 0.4rem;
    padding: 0.35rem 0.5rem;
    font-size: 0.72rem;
    line-height: 1.3;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 6%, transparent);
  }

  .check:last-child {
    border-bottom: none;
  }

  .check-dot {
    flex-shrink: 0;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    margin-top: 0.3rem;
  }

  .check.level-error .check-dot {
    background: #e74c3c;
  }

  .check.level-warning .check-dot {
    background: #f39c12;
  }

  .check.level-info .check-dot {
    background: #4a9eff;
  }

  .check-msg {
    color: color-mix(in srgb, CanvasText 80%, transparent);
  }

  .flow {
    position: relative;
  }

  :global(.flow .svelte-flow__background) {
    background: Canvas;
  }

  /* Lift node wrappers above the edge SVG layer so wires never visually
     cross through node bodies. xyflow defaults all unselected nodes to
     z-index: 0, which is the same as the edges layer — meaning DOM order
     decides, and edges happen to win for SVG paths inside the bounding
     box of an HTML node. Bumping every node node-side fixes that
     globally without needing to set zIndex on each Node object. */
  :global(.flow .svelte-flow__node) {
    z-index: 10;
  }
  :global(.flow .svelte-flow__edges) {
    z-index: 0;
  }

  .sim-panel {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    background: color-mix(in srgb, Canvas 90%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
    font-size: 0.82rem;
  }

  .cond-btn {
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    background: color-mix(in srgb, CanvasText 6%, transparent);
    color: inherit;
    border-radius: 4px;
    padding: 0.25rem 0.55rem;
    font-size: 0.78rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .cond-btn:hover {
    background: color-mix(in srgb, CanvasText 12%, transparent);
  }
  .cond-btn.active {
    background: color-mix(in srgb, #3b82f6 22%, transparent);
    border-color: color-mix(in srgb, #3b82f6 60%, transparent);
  }

  .conditions-panel {
    margin-top: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.55rem 0.7rem;
    max-width: 30rem;
    background: color-mix(in srgb, Canvas 92%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
    font-size: 0.8rem;
  }
  .cond-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .cond-label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    min-width: 7.5rem;
  }
  .cond-sub-label {
    text-transform: none;
    letter-spacing: 0;
    padding-left: 0.8rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }
  .cond-toggle {
    display: inline-flex;
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    border-radius: 4px;
    overflow: hidden;
  }
  .cond-toggle button {
    border: none;
    background: transparent;
    color: inherit;
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .cond-toggle button.active {
    background: color-mix(in srgb, #3b82f6 28%, transparent);
  }
  .cond-slider {
    width: 8rem;
    accent-color: #3b82f6;
  }
  .cond-value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .cond-sub {
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-size: 0.74rem;
  }
  .cond-pill {
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.74rem;
    background: color-mix(in srgb, CanvasText 10%, transparent);
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  }
  .cond-pill.occupied {
    background: color-mix(in srgb, #2ecc71 18%, transparent);
    border-color: color-mix(in srgb, #2ecc71 50%, transparent);
  }

  .wire-refusal {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    max-width: 36rem;
    padding: 0.55rem 0.85rem;
    background: color-mix(in srgb, #e74c3c 14%, Canvas);
    border: 1px solid color-mix(in srgb, #e74c3c 60%, transparent);
    color: color-mix(in srgb, #e74c3c 100%, CanvasText);
    border-radius: 6px;
    font-size: 0.82rem;
    box-shadow: 0 4px 12px rgba(231, 76, 60, 0.25);
  }

  .wire-refusal-glyph {
    font-size: 1.1rem;
  }

  .wire-refusal-text {
    flex: 1;
  }

  .wire-refusal-close {
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    padding: 0.1rem 0.35rem;
    font-size: 0.9rem;
    opacity: 0.7;
  }

  .wire-refusal-close:hover {
    opacity: 1;
  }

  /* Floating canvas-actions cluster — top-left of the canvas, mirrors the
     header buttons so Save / Clear / Reset are always one click away
     regardless of how the page is scrolled or rendered. */
  .canvas-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.55rem;
    background: color-mix(in srgb, Canvas 90%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
  }
  .ca-divider {
    width: 1px;
    align-self: stretch;
    background: color-mix(in srgb, CanvasText 18%, transparent);
    margin: 0 0.1rem;
  }

  .ca-btn {
    background: transparent;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    color: color-mix(in srgb, CanvasText 85%, transparent);
    padding: 0.25rem 0.6rem;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    line-height: 1.2;
    white-space: nowrap;
  }

  .ca-btn:hover {
    background: color-mix(in srgb, CanvasText 8%, transparent);
    color: CanvasText;
  }

  .ca-btn-danger {
    border-color: color-mix(in srgb, #e74c3c 35%, transparent);
    color: color-mix(in srgb, #e74c3c 85%, CanvasText);
  }

  .ca-btn-danger:hover {
    background: color-mix(in srgb, #e74c3c 14%, transparent);
    color: #e74c3c;
  }

  .ca-btn-check {
    border-color: color-mix(in srgb, #4a9eff 40%, transparent);
    color: color-mix(in srgb, #4a9eff 90%, CanvasText);
  }
  .ca-btn-check:hover {
    background: color-mix(in srgb, #4a9eff 14%, transparent);
    color: #4a9eff;
  }

  /* Guidance-mode toggle — Easy (training wheels) vs Realistic (the field). */
  .guidance-toggle {
    display: inline-flex;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    border-radius: 5px;
    overflow: hidden;
  }
  .gt-btn {
    background: transparent;
    border: none;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    padding: 0.25rem 0.55rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.76rem;
    line-height: 1.2;
    white-space: nowrap;
  }
  .gt-btn:hover {
    background: color-mix(in srgb, CanvasText 8%, transparent);
  }
  .gt-btn.active {
    background: color-mix(in srgb, #4a9eff 22%, transparent);
    color: CanvasText;
    font-weight: 600;
  }

  /* "Check my work" reveal modal. */
  .check-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, #000 45%, transparent);
    backdrop-filter: blur(2px);
  }
  .check-modal {
    width: min(560px, 92vw);
    max-height: 80vh;
    overflow-y: auto;
    background: Canvas;
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
    padding: 1rem 1.1rem 0.9rem;
  }
  .check-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.6rem;
  }
  .check-modal-title {
    font-size: 0.95rem;
    font-weight: 700;
  }
  .check-modal-close {
    background: transparent;
    border: none;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-size: 1rem;
    cursor: pointer;
    padding: 0.1rem 0.3rem;
    border-radius: 4px;
  }
  .check-modal-close:hover {
    background: color-mix(in srgb, CanvasText 10%, transparent);
    color: CanvasText;
  }
  .check-intro {
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }
  .check-empty {
    margin: 0.4rem 0 0.6rem;
    font-size: 0.85rem;
    color: #2ecc71;
  }
  .check-empty-sub {
    font-size: 0.74rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
  }
  .check-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .check-item {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0.6rem;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
    background: color-mix(in srgb, CanvasText 4%, transparent);
  }
  .check-item.check-error {
    border-color: color-mix(in srgb, #e74c3c 40%, transparent);
    background: color-mix(in srgb, #e74c3c 8%, transparent);
  }
  .check-item.check-warning {
    border-color: color-mix(in srgb, #f59e0b 40%, transparent);
    background: color-mix(in srgb, #f59e0b 8%, transparent);
  }
  .check-item-glyph {
    font-size: 0.85rem;
    line-height: 1.4;
  }
  .check-error .check-item-glyph {
    color: #e74c3c;
  }
  .check-warning .check-item-glyph {
    color: #f59e0b;
  }
  .check-item-body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .check-item-title {
    font-size: 0.8rem;
    font-weight: 600;
  }
  .check-item-detail {
    font-size: 0.75rem;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    line-height: 1.4;
  }
  .check-foot {
    margin: 0.8rem 0 0;
    font-size: 0.72rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-style: italic;
  }

  .sim-panel button {
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: Canvas;
    color: CanvasText;
    font: inherit;
    font-size: 0.82rem;
    padding: 0.25rem 0.7rem;
    border-radius: 4px;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }

  .sim-panel button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .sim-panel button.run {
    border-color: #2ecc71;
    color: #2ecc71;
  }

  .sim-panel button.run:hover:not(:disabled) {
    background: color-mix(in srgb, #2ecc71 12%, Canvas);
  }

  .sim-panel button.stop {
    border-color: #e74c3c;
    color: #e74c3c;
  }

  .sim-panel button.stop:hover:not(:disabled) {
    background: color-mix(in srgb, #e74c3c 12%, Canvas);
  }

  .sim-panel .tick {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-variant-numeric: tabular-nums;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    padding: 0 0.25rem;
  }

  .sim-clock-input {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .sim-clock-input input {
    width: 3.5rem;
    padding: 0.1rem 0.3rem;
    background: Canvas;
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    border-radius: 3px;
    color: CanvasText;
    font: inherit;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    text-transform: none;
    outline: none;
  }

  .sim-clock-input input:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .sim-clock-readout {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    padding: 0.1rem 0.45rem;
    border-radius: 10px;
    background: color-mix(in srgb, #4a9eff 14%, transparent);
    color: #4a9eff;
    border: 1px solid color-mix(in srgb, #4a9eff 35%, transparent);
    white-space: nowrap;
  }

  .sim-speed { display: inline-flex; gap: 0.1rem; }
  .sim-speed button {
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    background: transparent;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    padding: 0.1rem 0.4rem;
    font-size: 0.7rem;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.7rem;
  }
  .sim-speed button:hover { color: CanvasText; }
  .sim-speed button.active {
    background: color-mix(in srgb, #16a085 22%, transparent);
    border-color: #16a085;
    color: #16a085;
    font-weight: 600;
  }

  .status-divider {
    width: 1px;
    height: 1.2rem;
    background: color-mix(in srgb, CanvasText 18%, transparent);
    margin: 0 0.15rem;
  }

  .status-pill {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    padding: 0.1rem 0.45rem;
    border-radius: 10px;
    border: 1px solid transparent;
    white-space: nowrap;
  }

  .status-pill.ok {
    color: #2ecc71;
    background: color-mix(in srgb, #2ecc71 14%, transparent);
    border-color: color-mix(in srgb, #2ecc71 35%, transparent);
  }

  .status-pill.offline {
    color: color-mix(in srgb, CanvasText 80%, transparent);
    background: color-mix(in srgb, CanvasText 14%, transparent);
    border-color: color-mix(in srgb, CanvasText 35%, transparent);
  }

  .status-pill.fault {
    color: #e74c3c;
    background: color-mix(in srgb, #e74c3c 14%, transparent);
    border-color: color-mix(in srgb, #e74c3c 40%, transparent);
  }

  .status-pill.alarm {
    color: #e74c3c;
    background: color-mix(in srgb, #e74c3c 22%, transparent);
    border-color: #e74c3c;
    animation: alarm-flash-pill 1.2s ease-in-out infinite alternate;
  }

  @keyframes alarm-flash-pill {
    from {
      opacity: 0.7;
    }
    to {
      opacity: 1;
    }
  }

  .alarm-log {
    width: 280px;
    padding: 0.45rem 0.55rem 0.4rem;
    background: color-mix(in srgb, Canvas 92%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
  }

  .alarm-log-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.3rem;
  }

  .alarm-log-title {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }

  .alarm-log-clear {
    background: transparent;
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    color: color-mix(in srgb, CanvasText 75%, transparent);
    font: inherit;
    font-size: 0.65rem;
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
    cursor: pointer;
  }

  .alarm-log-clear:hover {
    background: color-mix(in srgb, CanvasText 10%, transparent);
    color: CanvasText;
  }

  .alarm-log-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .alarm-log-row {
    display: grid;
    grid-template-columns: 3rem 1rem 1fr auto;
    align-items: center;
    gap: 0.35rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-variant-numeric: tabular-nums;
  }

  .alarm-log-row.alarm-high:not(.cleared) {
    color: #e74c3c;
    background: color-mix(in srgb, #e74c3c 12%, transparent);
  }

  .alarm-log-row.alarm-low:not(.cleared) {
    color: #4a9eff;
    background: color-mix(in srgb, #4a9eff 12%, transparent);
  }

  .alarm-log-row.cleared {
    color: color-mix(in srgb, CanvasText 60%, transparent);
    background: color-mix(in srgb, #2ecc71 8%, transparent);
  }

  .alarm-log-tick {
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }

  .alarm-log-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .alarm-log-more {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.6rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    text-align: center;
    font-style: italic;
  }

  .ctrl-divider {
    width: 1px;
    height: 1.2rem;
    background: color-mix(in srgb, CanvasText 18%, transparent);
  }

  .ctrl-physics-row {
    flex-basis: 100%;
    margin-top: 0.05rem;
  }

  .phys-status {
    display: inline-block;
    font-size: 0.7rem;
    padding: 0.15rem 0.45rem;
    border-radius: 3px;
    line-height: 1.3;
  }

  .phys-status.phys-good {
    background: color-mix(in srgb, #2ecc71 14%, transparent);
    color: #2ecc71;
    border: 1px solid color-mix(in srgb, #2ecc71 40%, transparent);
  }

  .phys-status.phys-warn {
    background: color-mix(in srgb, #f39c12 14%, transparent);
    color: color-mix(in srgb, #f39c12 95%, CanvasText);
    border: 1px solid color-mix(in srgb, #f39c12 35%, transparent);
    font-style: italic;
  }

  .phys-action {
    border: 1px solid color-mix(in srgb, #4a9eff 55%, transparent);
    background: color-mix(in srgb, #4a9eff 14%, transparent);
    color: #4a9eff;
    font: inherit;
    font-size: 0.7rem;
    padding: 0.15rem 0.55rem;
    border-radius: 3px;
    cursor: pointer;
    line-height: 1.2;
  }

  .phys-action:hover {
    background: color-mix(in srgb, #4a9eff 24%, transparent);
  }

  .override-toggle {
    border: 1px solid color-mix(in srgb, #f39c12 55%, transparent);
    background: transparent;
    color: color-mix(in srgb, #f39c12 90%, CanvasText);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.15rem 0.55rem;
    border-radius: 10px;
    cursor: pointer;
    line-height: 1.2;
    white-space: nowrap;
  }

  .eol-toggle {
    border: 1px solid color-mix(in srgb, CanvasText 30%, transparent);
    background: transparent;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.15rem 0.55rem;
    border-radius: 10px;
    cursor: pointer;
    line-height: 1.2;
    white-space: nowrap;
  }
  .eol-toggle:hover {
    background: color-mix(in srgb, CanvasText 10%, transparent);
  }
  .eol-toggle.active {
    border-color: color-mix(in srgb, #2ecc71 55%, transparent);
    background: color-mix(in srgb, #2ecc71 16%, transparent);
    color: color-mix(in srgb, #2ecc71 90%, CanvasText);
  }

  .override-toggle:hover {
    background: color-mix(in srgb, #f39c12 12%, transparent);
  }

  .override-toggle.active {
    background: color-mix(in srgb, #f39c12 22%, transparent);
    color: #f39c12;
    border-color: #f39c12;
  }

  .ctrl-field input[type='range'] {
    width: 8rem;
    accent-color: #f39c12;
  }

  .chart-panel {
    padding: 0.5rem 0.6rem 0.45rem;
    background: color-mix(in srgb, Canvas 90%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
  }

  .chart-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.3rem;
  }

  .chart-panel.collapsed .chart-head,
  .tune-panel.collapsed .tune-head {
    margin-bottom: 0;
  }

  .tune-panel.collapsed {
    width: auto;
  }

  /* Shared collapse chevron for the chart + tune floating panels. */
  .panel-collapse {
    border: 0;
    background: transparent;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font: inherit;
    font-size: 0.75rem;
    line-height: 1;
    padding: 0 0.1rem;
    cursor: pointer;
    flex-shrink: 0;
  }

  .panel-collapse:hover {
    color: inherit;
  }

  .chart-csv {
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    background: transparent;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    font: inherit;
    font-size: 0.65rem;
    padding: 0.1rem 0.45rem;
    border-radius: 3px;
    cursor: pointer;
    line-height: 1.2;
  }

  .chart-csv:hover {
    background: color-mix(in srgb, CanvasText 10%, transparent);
    color: CanvasText;
  }

  .chart-title {
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }

  .chart-sub {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.68rem;
    color: color-mix(in srgb, CanvasText 50%, transparent);
  }

  .wire-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    /* Wrap + cap the width so the trunk chrome (wire kinds + baud + inspector
       + Break + Delete) never slides its right edge under the top-right sim
       panel — which used to clip the "✕ Delete wire" button (G33). On a
       narrow viewport the row wraps instead of overflowing. */
    flex-wrap: wrap;
    max-width: min(42rem, calc(100% - 24rem));
    gap: 0.55rem;
    padding: 0.35rem 0.6rem;
    background: color-mix(in srgb, Canvas 92%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
  }

  /* Subnet zone edit panel (Net.1) — sits in the same top-center slot as
     the trunk inspector chrome so the user has a single place to look
     when configuring whatever's selected. */
  .subnet-edit-panel {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem 0.6rem;
    background: color-mix(in srgb, Canvas 92%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
  }
  .subnet-edit-title {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }
  .subnet-edit-field {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }
  .subnet-edit-field input {
    background: Canvas;
    color: CanvasText;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    border-radius: 4px;
    font: inherit;
    font-size: 0.75rem;
    padding: 0.15rem 0.4rem;
    width: 9rem;
  }
  .subnet-edit-field .cidr-input {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    width: 8.5rem;
  }
  .subnet-edit-color {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 70%, transparent);
  }
  .subnet-edit-color input[type='color'] {
    width: 1.6rem;
    height: 1.4rem;
    padding: 0;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    border-radius: 4px;
    background: Canvas;
    cursor: pointer;
  }
  .subnet-edit-delete {
    font: inherit;
    font-size: 0.7rem;
    padding: 0.2rem 0.55rem;
    background: transparent;
    color: #e74c3c;
    border: 1px solid color-mix(in srgb, #e74c3c 60%, transparent);
    border-radius: 4px;
    cursor: pointer;
  }
  .subnet-edit-delete:hover {
    background: color-mix(in srgb, #e74c3c 15%, transparent);
  }

  /* Net.2 — IP / BBMD config panel. Same chrome as the trunk + subnet
     edit panels so the top-center inspector reads as one consistent
     surface. */
  .ip-config-panel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.5rem;
    padding: 0.35rem 0.6rem;
    background: color-mix(in srgb, Canvas 92%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
    /* Constrain width so this never elbows into the top-right sim
       controls. Wider screens still get a comfortable row; narrower
       screens wrap cleanly onto multiple rows. */
    max-width: min(46rem, calc(100vw - 28rem));
  }
  .ip-config-title {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    color: color-mix(in srgb, CanvasText 75%, transparent);
  }
  /* Rename input lives in the IP config panel + router panel — looks
     like a label until you click it. */
  .ip-rename {
    background: transparent;
    color: CanvasText;
    border: 1px solid transparent;
    border-radius: 4px;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.1rem 0.4rem;
    width: 7rem;
    transition: border-color 120ms ease, background 120ms ease;
  }
  .ip-rename:hover {
    border-color: color-mix(in srgb, CanvasText 20%, transparent);
  }
  .ip-rename:focus {
    outline: none;
    border-color: #4a9eff;
    background: color-mix(in srgb, CanvasText 6%, transparent);
  }
  .ip-delete {
    font: inherit;
    font-size: 0.7rem;
    padding: 0.2rem 0.55rem;
    background: transparent;
    color: #e74c3c;
    border: 1px solid color-mix(in srgb, #e74c3c 60%, transparent);
    border-radius: 4px;
    cursor: pointer;
  }
  .ip-delete:hover {
    background: color-mix(in srgb, #e74c3c 15%, transparent);
  }
  /* Power toggle — green when off (= "click to turn on"), amber when on
     (= "click to cut power"). Visually distinct from Delete so it never
     gets misclicked. */
  .power-toggle {
    font: inherit;
    font-size: 0.7rem;
    padding: 0.2rem 0.55rem;
    background: transparent;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    border-radius: 4px;
    cursor: pointer;
  }
  .power-toggle:hover {
    border-color: #f59e0b;
    color: #f59e0b;
    background: color-mix(in srgb, #f59e0b 12%, transparent);
  }
  .power-toggle.powered-off {
    color: #2ecc71;
    border-color: #2ecc71;
    background: color-mix(in srgb, #2ecc71 14%, transparent);
  }
  .power-toggle.powered-off:hover {
    background: color-mix(in srgb, #2ecc71 24%, transparent);
  }
  .ip-field {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }
  .ip-field input.ip-input {
    /* Inset fill + a clearly visible border so the field reads as an
       editable box, not static text. (The old CanvasText-20% border was
       invisible on the dark panel — a novice read the placeholder as a
       fixed value.) */
    background: color-mix(in srgb, CanvasText 7%, Canvas);
    color: CanvasText;
    border: 1px solid color-mix(in srgb, CanvasText 38%, transparent);
    border-radius: 4px;
    font: inherit;
    font-size: 0.75rem;
    padding: 0.15rem 0.4rem;
    width: 6.5rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }
  .ip-field input.ip-input:hover {
    border-color: color-mix(in srgb, CanvasText 55%, transparent);
  }
  .ip-field input.ip-input:focus {
    outline: none;
    border-color: #4a9eff;
    box-shadow: 0 0 0 2px color-mix(in srgb, #4a9eff 30%, transparent);
  }
  /* Live address-validation state. Empty input stays neutral; as soon as
     there's text it goes red (doesn't parse) or green (parses). Teaches
     correct addressing the instant it's typed. */
  input.ip-input.invalid,
  input.cidr-input.invalid {
    border-color: #e74c3c;
    background: color-mix(in srgb, #e74c3c 8%, Canvas);
  }
  input.ip-input.invalid:focus,
  input.cidr-input.invalid:focus {
    border-color: #e74c3c;
    box-shadow: 0 0 0 2px color-mix(in srgb, #e74c3c 30%, transparent);
  }
  input.ip-input.valid,
  input.cidr-input.valid {
    border-color: #2ecc71;
    background: color-mix(in srgb, #2ecc71 9%, Canvas);
  }
  input.ip-input.valid:focus,
  input.cidr-input.valid:focus {
    border-color: #2ecc71;
    box-shadow: 0 0 0 2px color-mix(in srgb, #2ecc71 30%, transparent);
  }
  .ip-divider {
    width: 1px;
    height: 1.2rem;
    background: color-mix(in srgb, CanvasText 20%, transparent);
    margin: 0 0.2rem;
  }
  .bbmd-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.15rem 0.55rem;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    color: color-mix(in srgb, CanvasText 75%, transparent);
    cursor: pointer;
    user-select: none;
  }
  .bbmd-toggle input {
    margin: 0;
  }
  .bbmd-toggle.active {
    border-color: #4a9eff;
    color: #4a9eff;
    background: color-mix(in srgb, #4a9eff 14%, transparent);
  }
  .bdt-field {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    flex: 1 1 14rem;
  }
  .bdt-input {
    background: Canvas;
    color: CanvasText;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    border-radius: 4px;
    font: inherit;
    font-size: 0.75rem;
    padding: 0.15rem 0.4rem;
    flex: 1 1 12rem;
    min-width: 8rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  /* Chip-style BDT picker (Net.2 UX revision). The CSV input was hard
     to use — users had to remember IPs. Picker offers a one-click
     select-from-canvas affordance plus a free-text fallback for peers
     that haven't been deployed yet. */
  .bdt-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    position: relative;
    flex: 1 1 18rem;
    min-width: 14rem;
  }
  .bdt-label {
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }
  .bdt-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: center;
  }
  .bdt-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.15rem 0.1rem 0.45rem;
    background: color-mix(in srgb, #06b6d4 18%, transparent);
    border: 1px solid color-mix(in srgb, #06b6d4 50%, transparent);
    border-radius: 10px;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.72rem;
    color: #06b6d4;
  }
  .bdt-chip-ip {
    line-height: 1.1;
  }
  .bdt-chip-del {
    font: inherit;
    font-size: 0.6rem;
    background: transparent;
    color: inherit;
    border: none;
    padding: 0 0.2rem;
    cursor: pointer;
    line-height: 1;
    border-radius: 50%;
    opacity: 0.6;
  }
  .bdt-chip-del:hover {
    opacity: 1;
    background: color-mix(in srgb, #06b6d4 30%, transparent);
  }
  .bdt-add {
    font: inherit;
    font-size: 0.7rem;
    padding: 0.15rem 0.55rem;
    background: transparent;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    border: 1px dashed color-mix(in srgb, CanvasText 35%, transparent);
    border-radius: 10px;
    cursor: pointer;
  }
  .bdt-add:hover,
  .bdt-add.open {
    border-style: solid;
    border-color: #06b6d4;
    color: #06b6d4;
    background: color-mix(in srgb, #06b6d4 8%, transparent);
  }
  .bdt-picker {
    position: absolute;
    top: calc(100% + 0.3rem);
    left: 0;
    z-index: 20;
    min-width: 18rem;
    max-width: 24rem;
    background: Canvas;
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    border-radius: 6px;
    padding: 0.5rem 0.6rem;
    box-shadow: 0 4px 12px color-mix(in srgb, CanvasText 18%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .bdt-picker-section {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .bdt-picker-hint {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }
  .bdt-picker-hint.muted {
    text-transform: none;
    letter-spacing: 0;
    font-style: italic;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    line-height: 1.35;
  }
  .bdt-picker-options {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    max-height: 12rem;
    overflow-y: auto;
  }
  .bdt-picker-option {
    display: grid;
    grid-template-columns: 1.4rem 1fr auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.45rem;
    background: transparent;
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    border-radius: 4px;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .bdt-picker-option:hover {
    background: color-mix(in srgb, #06b6d4 10%, transparent);
    border-color: #06b6d4;
  }
  .bdt-picker-icon {
    font-size: 0.95rem;
    color: #06b6d4;
    text-align: center;
  }
  .bdt-picker-label {
    font-size: 0.78rem;
    font-weight: 500;
  }
  .bdt-picker-ip {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
  }
  .bdt-picker-manual {
    display: flex;
    gap: 0.3rem;
    align-items: center;
  }
  .bdt-picker-manual .ip-input {
    flex: 1 1 auto;
    width: auto;
  }
  .bdt-picker-add {
    font: inherit;
    font-size: 0.72rem;
    padding: 0.2rem 0.55rem;
    background: #06b6d4;
    color: white;
    border: 1px solid #06b6d4;
    border-radius: 4px;
    cursor: pointer;
  }
  .bdt-picker-add:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Net.3 — router-interfaces editor. Same chrome family as the IP /
     BBMD panel above. */
  .router-panel {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    background: color-mix(in srgb, Canvas 92%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
    max-width: 50rem;
  }

  /* Virtual controller inspector — purple accent matches the node card. */
  .vctrl-panel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.5rem;
    padding: 0.35rem 0.6rem;
    background: color-mix(in srgb, Canvas 92%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
    max-width: min(40rem, calc(100vw - 28rem));
  }
  .vctrl-title {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    color: #a78bfa;
  }
  .vctrl-host-field {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }
  .vctrl-host-select {
    background: Canvas;
    color: CanvasText;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    border-radius: 4px;
    font: inherit;
    font-size: 0.75rem;
    padding: 0.1rem 0.35rem;
    max-width: 10rem;
  }
  .vctrl-hint {
    font-size: 0.7rem;
    color: #f59e0b;
    font-style: italic;
  }
  .router-title {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    color: #f59e0b;
    margin-top: 0.25rem;
  }
  .router-ifaces-edit {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .router-iface-row {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
  }
  .iface-num {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-weight: 600;
    width: 1.8rem;
  }
  .iface-del {
    font: inherit;
    font-size: 0.7rem;
    background: transparent;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    color: color-mix(in srgb, CanvasText 60%, transparent);
    border-radius: 4px;
    padding: 0 0.4rem;
    cursor: pointer;
  }
  .iface-del:hover {
    border-color: #e74c3c;
    color: #e74c3c;
  }
  .iface-add {
    font: inherit;
    font-size: 0.7rem;
    align-self: flex-start;
    margin-top: 0.25rem;
    background: transparent;
    border: 1px dashed color-mix(in srgb, #f59e0b 60%, transparent);
    color: #f59e0b;
    border-radius: 4px;
    padding: 0.2rem 0.55rem;
    cursor: pointer;
  }
  .iface-add:hover {
    background: color-mix(in srgb, #f59e0b 14%, transparent);
  }
  .router-hint {
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-style: italic;
    padding: 0.15rem 0.25rem;
  }

  .wire-title {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }

  .wire-chips {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  .wire-chip {
    --c: #888;
    border: 1px solid color-mix(in srgb, var(--c) 50%, transparent);
    background: transparent;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.15rem 0.5rem;
    border-radius: 10px;
    cursor: pointer;
    line-height: 1.2;
  }

  .wire-chip:hover {
    background: color-mix(in srgb, var(--c) 12%, transparent);
    color: CanvasText;
  }

  .wire-chip.active {
    border-color: var(--c);
    background: color-mix(in srgb, var(--c) 22%, transparent);
    color: var(--c);
  }

  .wire-baud {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.7rem;
    padding: 0.15rem 0.5rem;
    border-radius: 10px;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    color: color-mix(in srgb, CanvasText 85%, transparent);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .wire-baud-edit {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    border-radius: 10px;
  }

  .wire-baud-label {
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .wire-baud-edit select {
    background: Canvas;
    color: inherit;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    border-radius: 4px;
    font: inherit;
    font-size: 0.7rem;
    padding: 0.05rem 0.3rem;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .wire-break {
    border: 1px solid color-mix(in srgb, #e74c3c 55%, transparent);
    background: transparent;
    color: color-mix(in srgb, #e74c3c 90%, CanvasText);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.15rem 0.55rem;
    border-radius: 10px;
    cursor: pointer;
    line-height: 1.2;
    white-space: nowrap;
  }

  .wire-trunk-inspect {
    border: 1px solid color-mix(in srgb, #06b6d4 55%, transparent);
    background: color-mix(in srgb, #06b6d4 10%, transparent);
    color: color-mix(in srgb, #06b6d4 92%, CanvasText);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.15rem 0.55rem;
    border-radius: 10px;
    cursor: pointer;
    line-height: 1.2;
    white-space: nowrap;
  }

  .wire-trunk-inspect:hover {
    background: color-mix(in srgb, #06b6d4 22%, transparent);
    color: #06b6d4;
  }

  .wire-trunk-inspect.has-errors {
    border-color: color-mix(in srgb, #e74c3c 70%, transparent);
    background: color-mix(in srgb, #e74c3c 15%, transparent);
    color: color-mix(in srgb, #e74c3c 95%, CanvasText);
  }

  .wire-trunk-inspect.has-warnings {
    border-color: color-mix(in srgb, #f39c12 70%, transparent);
    background: color-mix(in srgb, #f39c12 15%, transparent);
    color: color-mix(in srgb, #f39c12 95%, CanvasText);
  }

  .wire-trunk-inspect .badge-err,
  .wire-trunk-inspect .badge-warn {
    display: inline-block;
    margin-left: 0.35rem;
    padding: 0 0.35rem;
    border-radius: 8px;
    font-size: 0.65rem;
    font-weight: 700;
    color: white;
  }

  .wire-trunk-inspect .badge-err {
    background: #e74c3c;
  }
  .wire-trunk-inspect .badge-warn {
    background: #f39c12;
  }

  .wire-break:hover {
    background: color-mix(in srgb, #e74c3c 12%, transparent);
    color: #e74c3c;
  }

  .wire-break.broken {
    background: color-mix(in srgb, #2ecc71 18%, transparent);
    border-color: #2ecc71;
    color: #2ecc71;
  }

  .wire-break.broken:hover {
    background: color-mix(in srgb, #2ecc71 28%, transparent);
  }

  /* Delete is destructive — filled red so it's visually distinct from
     Break (outlined red, which is a reversible toggle). */
  .wire-delete {
    border: 1px solid #b03a2e;
    background: #c0392b;
    color: white;
    font: inherit;
    font-size: 0.7rem;
    padding: 0.15rem 0.55rem;
    border-radius: 10px;
    cursor: pointer;
    line-height: 1.2;
    white-space: nowrap;
  }

  .wire-delete:hover {
    background: #a93226;
    border-color: #922b21;
  }

  .wire-chip:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .zone-panel {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.45rem 0.7rem;
    background: color-mix(in srgb, Canvas 92%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
    min-width: 22rem;
  }
  .zone-state-row {
    display: flex;
    gap: 0.4rem;
    font-size: 0.85rem;
    align-items: baseline;
  }
  .zone-state-row strong { color: #16a085; }
  .zone-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.3rem 0.7rem;
  }
  .zone-field {
    display: grid;
    grid-template-columns: auto 5.5rem;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
  }
  .zone-field input {
    background: color-mix(in srgb, Canvas 98%, transparent);
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    color: CanvasText;
    padding: 0.15rem 0.3rem;
    border-radius: 3px;
    font: inherit;
    font-size: 0.78rem;
    text-align: right;
  }

  .sensor-panel {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem 0.6rem;
    background: color-mix(in srgb, Canvas 92%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
    flex-wrap: wrap;
    max-width: 540px;
  }

  .sensor-title {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }

  .fault-chips {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  .fault-chip {
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    background: transparent;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.15rem 0.5rem;
    border-radius: 10px;
    cursor: pointer;
    line-height: 1.2;
    text-transform: lowercase;
  }

  .fault-chip:hover {
    background: color-mix(in srgb, CanvasText 8%, transparent);
    color: CanvasText;
  }

  .fault-chip.danger {
    border-color: color-mix(in srgb, #e74c3c 50%, transparent);
    color: color-mix(in srgb, #e74c3c 90%, CanvasText);
  }

  .fault-chip.danger:hover {
    background: color-mix(in srgb, #e74c3c 12%, transparent);
  }

  .fault-chip.active {
    background: color-mix(in srgb, #e74c3c 22%, transparent);
    border-color: #e74c3c;
    color: #e74c3c;
  }

  .fault-chip.active:not(.danger) {
    background: color-mix(in srgb, #2ecc71 22%, transparent);
    border-color: #2ecc71;
    color: #2ecc71;
  }

  .sensor-warn {
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    font-style: italic;
  }

  .fault-note {
    margin: 0.45rem 0 0 0;
    padding: 0.45rem 0.6rem;
    font-size: 0.7rem;
    line-height: 1.45;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    background: color-mix(in srgb, CanvasText 4%, transparent);
    border-left: 2px solid color-mix(in srgb, #4a9eff 40%, transparent);
    border-radius: 0 4px 4px 0;
  }

  .fault-note strong {
    color: CanvasText;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.68rem;
  }

  /* Inspector panels (sensor + controller) share a bottom-left anchor with
     the tune-panel. The tune-panel is ~240px wide and always sits at
     bottom-left; we offset the inspector by enough to clear it so the two
     coexist without overlapping. Without this offset xyflow's bottom-left
     position would stack them directly on top of each other. */
  .inspector-panel {
    margin-left: 260px;
    max-width: 600px;
  }

  .inspector-head {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 0.4rem;
    width: 100%;
    margin-bottom: 0.15rem;
  }
  /* Push Delete to the end of the (possibly wrapped) button row so it never
     clips off the panel edge. */
  .inspector-delete {
    margin-left: auto;
  }

  .inspector-delete {
    border: 1px solid color-mix(in srgb, #e74c3c 50%, transparent);
    background: transparent;
    color: color-mix(in srgb, #e74c3c 90%, CanvasText);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    cursor: pointer;
    line-height: 1.2;
    white-space: nowrap;
  }

  .inspector-delete:hover {
    background: color-mix(in srgb, #e74c3c 14%, transparent);
    color: #e74c3c;
  }

  .inspector-terminal {
    border: 1px solid color-mix(in srgb, #4a9eff 50%, transparent);
    background: transparent;
    color: color-mix(in srgb, #4a9eff 90%, CanvasText);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    cursor: pointer;
    line-height: 1.2;
    white-space: nowrap;
    margin-right: 0.35rem;
  }

  .inspector-terminal:hover {
    background: color-mix(in srgb, #4a9eff 14%, transparent);
    color: #4a9eff;
  }

  .rename-input {
    flex: 1;
    min-width: 7rem;
    background: color-mix(in srgb, Canvas 92%, CanvasText 3%);
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    color: CanvasText;
    font: inherit;
    font-size: 0.82rem;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .rename-input:focus {
    outline: none;
    border-color: color-mix(in srgb, #4a9eff 60%, transparent);
    background: Canvas;
  }

  .inspector-diagram {
    border: 1px solid color-mix(in srgb, #2ecc71 50%, transparent);
    background: transparent;
    color: color-mix(in srgb, #2ecc71 90%, CanvasText);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.1rem 0.5rem;
    border-radius: 3px;
    cursor: pointer;
    line-height: 1.2;
    white-space: nowrap;
    margin-right: 0.35rem;
  }

  .inspector-diagram:hover {
    background: color-mix(in srgb, #2ecc71 14%, transparent);
    color: #2ecc71;
  }

  .sensor-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .sensor-sub {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    min-width: 2.5rem;
  }

  .signal-chips {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  .signal-chip {
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    background: transparent;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.15rem 0.5rem;
    border-radius: 10px;
    cursor: pointer;
    line-height: 1.2;
  }

  .signal-chip:hover {
    background: color-mix(in srgb, CanvasText 8%, transparent);
    color: CanvasText;
  }

  .signal-chip.active {
    border-color: #4a9eff;
    background: color-mix(in srgb, #4a9eff 18%, transparent);
    color: #4a9eff;
  }

  /* A sensor row that stacks its label above a multi-line block. */
  .sensor-row-block {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.3rem;
  }

  /* Read-only "installed element" for a model-backed sensor — reads as a
     physical fact of the device, not an editable setting. */
  .installed-element {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .ie-value {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.8rem;
    font-weight: 600;
    color: CanvasText;
  }
  .ie-fixed {
    font-size: 0.66rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    white-space: nowrap;
  }

  /* Generic-sensor element picker, grouped by category. */
  .signal-groups {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    width: 100%;
  }
  .signal-group {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .sg-head {
    font-size: 0.6rem;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    letter-spacing: 0.02em;
  }

  /* Actuator inspector specs row. */
  .actuator-specs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.3rem;
  }
  .spec-chip {
    font-size: 0.66rem;
    padding: 0.1rem 0.45rem;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    color: color-mix(in srgb, CanvasText 75%, transparent);
    white-space: nowrap;
  }
  .spec-chip.good {
    border-color: color-mix(in srgb, #2ecc71 45%, transparent);
    color: #2ecc71;
  }
  .actuator-note {
    margin: 0.4rem 0 0;
    font-size: 0.7rem;
    line-height: 1.4;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    max-width: 28rem;
  }

  .ctrl-panel {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem 0.6rem;
    background: color-mix(in srgb, Canvas 92%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
    flex-wrap: wrap;
  }

  .ctrl-title {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }

  .ctrl-field {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 80%, transparent);
  }

  .ctrl-field input {
    width: 4.5rem;
    padding: 0.15rem 0.35rem;
    background: Canvas;
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    border-radius: 4px;
    color: CanvasText;
    font: inherit;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    outline: none;
  }

  .ctrl-field input:focus {
    border-color: #4a9eff;
    box-shadow: 0 0 0 2px color-mix(in srgb, #4a9eff 30%, transparent);
  }

  .ctrl-unit {
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }

  .tune-panel {
    width: 240px;
    padding: 0.55rem 0.7rem 0.45rem;
    background: color-mix(in srgb, Canvas 90%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
  }

  .tune-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.35rem;
    gap: 0.5rem;
  }

  .preset-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-bottom: 0.6rem;
  }

  .preset-chip {
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    background: transparent;
    color: color-mix(in srgb, CanvasText 75%, transparent);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.18rem 0.55rem;
    border-radius: 12px;
    cursor: pointer;
    line-height: 1.2;
  }

  .preset-chip:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
    color: CanvasText;
  }

  .preset-chip.active {
    border-color: #f59e0b;
    background: color-mix(in srgb, #f59e0b 15%, transparent);
    color: #f59e0b;
  }

  .preset-chip.custom {
    cursor: default;
    border-style: dashed;
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }

  .mode-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 0.55rem;
  }

  .mode-label {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    min-width: 2.5rem;
  }

  .mode-chip {
    border: 1px solid color-mix(in srgb, #4a9eff 50%, transparent);
    background: transparent;
    color: color-mix(in srgb, #4a9eff 90%, CanvasText);
    font: inherit;
    font-size: 0.7rem;
    padding: 0.15rem 0.55rem;
    border-radius: 12px;
    cursor: pointer;
    line-height: 1.2;
  }

  .mode-chip:hover {
    background: color-mix(in srgb, #4a9eff 12%, transparent);
  }

  .mode-chip.active {
    background: color-mix(in srgb, #4a9eff 22%, transparent);
    color: #4a9eff;
  }

  .mode-chip.heat {
    border-color: color-mix(in srgb, #e74c3c 50%, transparent);
    color: color-mix(in srgb, #e74c3c 90%, CanvasText);
  }

  .mode-chip.heat:hover {
    background: color-mix(in srgb, #e74c3c 12%, transparent);
  }

  .mode-chip.heat.active {
    background: color-mix(in srgb, #e74c3c 22%, transparent);
    color: #e74c3c;
  }

  .tune-title {
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reset-cfg {
    border: none;
    background: none;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font: inherit;
    font-size: 0.68rem;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }

  .reset-cfg:hover {
    color: CanvasText;
  }

  .slider-row {
    display: flex;
    flex-direction: column;
    margin-bottom: 0.4rem;
  }

  .slider-row label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 0.72rem;
    gap: 0.5rem;
  }

  .slider-row .lbl {
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }

  .slider-row .lbl em {
    font-style: normal;
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 45%, transparent);
    margin-left: 0.15rem;
  }

  .slider-row .val {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-variant-numeric: tabular-nums;
    color: CanvasText;
  }

  .slider-row input[type='range'] {
    width: 100%;
    margin-top: 0.15rem;
    accent-color: #f59e0b;
  }

  .schedule-block {
    margin-top: 0.3rem;
    padding: 0.4rem 0.5rem;
    border: 1px dashed color-mix(in srgb, CanvasText 18%, transparent);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .schedule-toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    color: color-mix(in srgb, CanvasText 80%, transparent);
    cursor: pointer;
  }

  .schedule-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.25rem 0.4rem;
  }

  .schedule-grid label {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.68rem;
    color: color-mix(in srgb, CanvasText 75%, transparent);
  }

  .schedule-grid label > span:first-child {
    min-width: 3.2rem;
  }

  .schedule-grid input[type='number'] {
    width: 3rem;
    padding: 0.1rem 0.3rem;
    background: Canvas;
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    border-radius: 3px;
    color: CanvasText;
    font: inherit;
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
    outline: none;
  }

  .schedule-now {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 65%, transparent);
    font-variant-numeric: tabular-nums;
  }

  .advanced-toggle {
    border: none;
    background: none;
    color: color-mix(in srgb, CanvasText 55%, transparent);
    font: inherit;
    font-size: 0.7rem;
    cursor: pointer;
    padding: 0.2rem 0;
    text-align: left;
    width: 100%;
  }

  .advanced-toggle:hover {
    color: CanvasText;
  }
</style>
