<script lang="ts">
  import { setContext } from 'svelte';
  import {
    Background,
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
  import MiniChart, { type ChartSeries } from './MiniChart.svelte';
  import {
    SingleZoneSystem,
    DEFAULT_CONFIG,
    type Sample,
    type SingleZoneConfig,
    type SensorFault,
  } from './sim/thermal';
  import {
    SENSOR_TEMPLATES,
    SENSOR_TEMPLATE_BY_ID,
    DEFAULT_SENSOR_SIGNAL,
    type SensorSignal,
  } from './sim/sensorModels';
  import { importStore, canvasActions, openModelPicker, selectionStore, canvasSnapshot } from './canvasStore.svelte';
  import { log as logEvent } from './runtime/runtimeLogStore.svelte';
  import { advancePlayback, currentWeatherSample, weatherStore } from './weather/weatherStore.svelte';
  import { openCli, openFbd, openSpecLang, openBacnet, programStore } from './cli/programStore.svelte';
  import { scenarioStore } from './scenarios/scenarioStore.svelte';
  import { validateScenario } from './scenarios/validator';
  import { registerBridge, controllerBridge, type ControllerSnapshot } from './cli/controllerBridge.svelte';
  import { logPacket as logBacnetPacket } from './bacnet/bacnetPacketLog.svelte';
  import { openTrunkInspector, publishTrunkStates, publishMstpFindings } from './bacnet/trunkInspectorStore.svelte';
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
    findTileTemplate,
    formatPointBreakdown,
    computeSensorReading,
    stepLoop,
    initLoopState,
    computeOaLockout,
    HW_LOOP_DEFAULTS,
    CHW_LOOP_DEFAULTS,
    stepZone,
    initZoneState,
    defaultOccupancySchedule,
    DEFAULT_ZONE_CONFIG,
    stepMstpToken,
    initMstpTrunkState,
    defaultDeviceInstance,
    validateMstpTrunks,
    type StEnv,
    type MstpFinding,
    type LoopState,
    type ZoneState,
    type MstpDevice,
    type MstpTrunkState,
  } from '@bas/core';
  import { onMount } from 'svelte';
  import type { BasScenarioV1 } from './scenario';
  import { DEMOS } from './demoScenarios';

  const nodeTypes = { bas: BasNode };

  type Kind = 'supervisor' | 'controller' | 'sensor' | 'safety' | 'expansion' | 'actuator' | 'equipment' | 'zone';

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

  function withStyle(e: Edge): Edge {
    const kind: WireKind = (e.data?.wireKind as WireKind) ?? 'mstp';
    const broken = (e.data?.comm as string | undefined) === 'broken';
    if (broken) {
      // Force animation off — a broken trunk doesn't carry traffic.
      return { ...e, animated: false, style: styleForBrokenWire() };
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
  ];

  let nodes = $state.raw<Node[]>(_initialState.nodes);
  let edges = $state.raw<Edge[]>(_initialState.edges);

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

    // Generic-palette drop with no model attached → force a model pick
    // before finalizing the node. The user can still escape to a "generic
    // placeholder" but the explicit choice matters: it tells them this is
    // not a real-world configuration.
    const needsPick =
      !vendorModel && !sensorModel && !safetyModel && !actuatorModel && !equipmentModel &&
      (kind === 'controller' || kind === 'sensor' || kind === 'safety');

    if (needsPick) {
      openModelPicker(
        kind as 'controller' | 'sensor' | 'safety',
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
      if (dropKind === 'controller') vendorModel = findControllerModel(pickedId);
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
  // MS/TP trunk state by representative-edge-id. Tracks which MAC currently
  // owns the token, rotation counts, etc. Keyed by edge.id so SvelteFlow
  // edge inspectors can read it directly.
  let mstpTrunkStates = $state.raw<Map<string, MstpTrunkState>>(new Map());
  // BACnet app-layer poll scheduler — when (in sim seconds) the supervisor
  // on a given trunk should fire its next ReadProperty, plus which child
  // it will hit next (round-robin). Keyed by trunk edge id; this is a
  // *display* concern, not part of the MstpTrunkState in core.
  let bacnetPollSchedule = new Map<string, { nextSimSec: number; nextChildIdx: number }>();
  // Per-trunk poll cadence (sim-seconds). At 5s, a 4-child trunk gets
  // each child polled every 20s — matches what a typical Niagara supervisor
  // does on a healthy FEC bus.
  const APP_LAYER_POLL_CADENCE_S = 5;
  // MS/TP validation findings keyed by trunk id. Recomputed each tick
  // from the trunk membership; we de-dup against the previous tick so the
  // runtime log only logs new fault transitions, not the same warning
  // forever. Empty array = trunk is healthy.
  let mstpFindingsByTrunk = $state<Map<string, MstpFinding[]>>(new Map());
  // Set of "trunkId:findingId" pairs we've already announced in the
  // runtime log this session — keeps re-logging quiet across ticks.
  const announcedMstpFindings = new Set<string>();
  // Hard cap on Token-Pass packets emitted per trunk per tick. At 300×
  // sim-speed a 32-device trunk would emit hundreds of hops per tick;
  // capping keeps the log readable and the buffer from churning.
  const MAX_TOKEN_HOPS_PER_TICK_PER_TRUNK = 8;

  let showAdvanced = $state(false);

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

  function controllerReading(): string {
    const damper = Math.floor(Math.random() * 100);
    return `Out ${damper}%`;
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

          const reading = computeSensorReading(senModel.subject, {
            hour: simHour,
            actuator: sample.actuator,
            zoneTemp: sample.T_zone,
            outsideTemp: sample.T_OA,
          });
          secondaryInputs[reading.inputKey] = reading.value;
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

    // Build a node-id → physics-driven-value lookup so the runtime pass is direct.
    const physicsValueByNode = new Map<
      string,
      { value: string; status: 'polling' | 'responded' }
    >();
    for (const target of runningSnapshot) {
      const sample = sampleByCtrl.get(target.controllerId);
      if (!sample) continue;
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
        value: `Out ${Math.round(sample.actuator * 100)}% (${progSource})`,
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
      if (nodeKind(srcN) !== 'controller' || nodeKind(tgtN) !== 'actuator') continue;

      const sample = sampleByCtrl.get(srcN.id);
      if (!sample) continue;

      // Multi-actuator routing: look up the binding for the source terminal
      // (the controller's AO-N / BO-N). If bound to a role, use that role's
      // envKey to pull the commanded value from the program's outputs.
      // Falls back to sample.actuator (the primary command) when no binding
      // exists — so a generic single-output controller still works.
      const srcCtrlProgram = programStore.byId[srcN.id];
      const srcOutputs = programOutputsByCtrl.get(srcN.id) ?? {};
      const srcBinding = edge.sourceHandle
        ? srcCtrlProgram?.bindings?.bindings.find((b) => b.terminalId === edge.sourceHandle)
        : undefined;
      const srcRoleTpl = srcBinding ? findTileTemplate(srcBinding.role) : undefined;
      const routedKey = srcRoleTpl?.envKey;
      const routedValue = routedKey && routedKey in srcOutputs ? srcOutputs[routedKey] : undefined;
      const commanded = Math.max(0, Math.min(1, routedValue ?? sample.actuator));

      const tgtData = tgtN.data as { actuatorState?: { actual: number }; actuatorModelId?: string };
      const prevActual = tgtData.actuatorState?.actual ?? 0;

      const actuatorModelId = tgtData.actuatorModelId;
      const actuatorModel = actuatorModelId ? findActuatorModel(actuatorModelId) : undefined;
      const strokeSec = actuatorModel?.strokeSeconds ?? 60;

      // Linear stroke (good enough for v1). Real actuators are slightly
      // S-curve (acceleration + deceleration); we can refine later.
      const maxStep = dtSeconds / strokeSec;
      const diff = commanded - prevActual;
      const actual = Math.abs(diff) <= maxStep ? commanded : prevActual + Math.sign(diff) * maxStep;

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
        ? ` · ${srcTerminal}${srcRoleTpl ? ` → ${srcRoleTpl.display}` : ' → (unbound role)'}`
        : '';
      const positionStr = slewing ? `${pct}% (cmd ${cmdPct}% ↑)` : `${pct}%`;
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

      const cfg = isHotPlant ? HW_LOOP_DEFAULTS : CHW_LOOP_DEFAULTS;
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
    const oatForZones = runningSnapshot[0]
      ? (sampleByCtrl.get(runningSnapshot[0].controllerId)?.T_OA ?? 60)
      : 60;
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
      const prev = zData.zoneState ?? initZoneState(zoneConfig, oatForZones);

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

    // ── MS/TP token-passing simulation ───────────────────────────────
    // Group every MS/TP edge into trunks (connected components via the
    // shared MS/TP wireKind), assign each device a MAC, and advance
    // the token-holder index by dtSeconds. The result drives node-level
    // "I'm holding the token" highlights and per-trunk inspector panels.
    {
      const mstpEdges = edges.filter((e) => (e.data?.wireKind as string) === 'mstp');
      // Build adjacency: device -> set of neighbor devices on MS/TP wires.
      const adj = new Map<string, Set<string>>();
      for (const e of mstpEdges) {
        const a = e.source, b = e.target;
        if (!a || !b) continue;
        if (!adj.has(a)) adj.set(a, new Set());
        if (!adj.has(b)) adj.set(b, new Set());
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
      }
      // BFS into connected components.
      const visited = new Set<string>();
      const trunks: string[][] = [];
      for (const start of adj.keys()) {
        if (visited.has(start)) continue;
        const stack = [start];
        const group: string[] = [];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          if (visited.has(cur)) continue;
          visited.add(cur);
          group.push(cur);
          for (const nb of adj.get(cur) ?? []) {
            if (!visited.has(nb)) stack.push(nb);
          }
        }
        trunks.push(group);
      }
      // For each trunk, build MstpDevice[] (sorted by node label so MAC
      // assignment is deterministic across renders), then step the token.
      const nextStates = new Map<string, MstpTrunkState>();
      const nextPollSchedule = new Map<string, { nextSimSec: number; nextChildIdx: number }>();
      for (const trunk of trunks) {
        // Pick a representative edge id (the lowest-id MS/TP edge whose
        // endpoints are both in this trunk) — used as the trunk's key.
        const trunkEdge = mstpEdges.find((e) =>
          trunk.includes(e.source) && trunk.includes(e.target),
        );
        if (!trunkEdge) continue;
        const baud = ((trunkEdge.data as { baud?: number } | undefined)?.baud) ?? 38400;
        const devices: MstpDevice[] = trunk
          .map((nid) => nodes.find((n) => n.id === nid))
          .filter((n): n is NonNullable<typeof n> => !!n)
          .sort((a, b) => (nodeLabel(a) || a.id).localeCompare(nodeLabel(b) || b.id))
          .map((n, idx) => {
            // `forcedMac` from node data wins over auto-assignment —
            // lets scenarios bake in a deliberate duplicate-MAC fault,
            // and (later) lets the user explicitly set dip-switch
            // addresses on each device. When unset, supervisors get
            // MAC 0 and everyone else gets a sequential MAC.
            const forcedMac = (n.data as { forcedMac?: number } | undefined)?.forcedMac;
            const mac = typeof forcedMac === 'number'
              ? forcedMac
              : (nodeKind(n) === 'supervisor' ? 0 : idx + 1);
            return {
              nodeId: n.id,
              mac,
              label: nodeLabel(n) || n.id,
              // Network-wide BACnet Device Instance — distinct from MAC,
              // which is link-layer only. Default scheme (1000 + mac) is
              // arbitrary but deterministic across renders.
              deviceInstance: defaultDeviceInstance(mac),
            };
          });
        // Re-sort by MAC so the token ring matches the convention.
        devices.sort((a, b) => a.mac - b.mac);
        const prev = mstpTrunkStates.get(trunkEdge.id);
        const seed = prev && prev.devices.length === devices.length
          ? prev
          : initMstpTrunkState(devices, baud);
        // If membership changed (different node ids), re-init.
        const sameMembers = prev && prev.devices.every((d, i) => d.nodeId === devices[i]?.nodeId);
        const start = sameMembers ? seed : initMstpTrunkState(devices, baud);
        const stepped = stepMstpToken(start, dtSeconds);
        nextStates.set(trunkEdge.id, stepped);

        const trunkLabelStr = devices.length > 0
          ? `${devices[0].label} → ${devices[devices.length - 1].label} @ ${baud}`
          : `trunk @ ${baud}`;

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
            trunkId: trunkEdge.id,
            trunkLabel: trunkLabelStr,
            srcMac: initiator.mac,
            // Broadcast — no specific dst.
            dstMac: undefined,
            service: 'Who-Is',
            summary: `${initiator.label} (MAC ${initiator.mac}) Who-Is broadcast (discover devices on this trunk)`,
            layer: 'app',
          });
          for (const d of devices) {
            if (d.nodeId === initiator.nodeId) continue;
            const inst = d.deviceInstance ?? defaultDeviceInstance(d.mac);
            logBacnetPacket({
              simSec: simSecondsElapsed,
              trunkId: trunkEdge.id,
              trunkLabel: trunkLabelStr,
              srcMac: d.mac,
              dstMac: initiator.mac,
              service: 'I-Am',
              summary: `${d.label} (MAC ${d.mac}) I-Am — Device Instance ${inst}`,
              layer: 'app',
            });
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
              trunkId: trunkEdge.id,
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
              trunkId: trunkEdge.id,
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
          const prevSched = bacnetPollSchedule.get(trunkEdge.id) ?? {
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
            // AI to read. Falls back to AI:1 with the value 0 if the child
            // has no bindings yet.
            const childNode = nodes.find((n) => n.id === child.nodeId);
            const vendorModelId = (childNode?.data as { vendorModelId?: string } | undefined)?.vendorModelId;
            const childProg = programStore.byId[child.nodeId];
            const childObjects = synthesizeBacnetObjects({
              vendorModelId,
              bindings: childProg?.bindings,
              envInputs: controllerBridge.envInputsByCtrl.get(child.nodeId),
              envOutputs: controllerBridge.envOutputsByCtrl.get(child.nodeId),
            });
            const targetObj = childObjects.find((o) => o.type === 'analog-input') ?? childObjects[0];
            const objectId = targetObj?.id ?? 'AI:1';
            const objectName = targetObj?.name ?? '(unassigned)';
            const value = targetObj
              ? (typeof targetObj.presentValue === 'boolean'
                  ? (targetObj.presentValue ? 1 : 0)
                  : targetObj.presentValue)
              : 0;
            const trunkLabel = trunkLabelStr;
            logBacnetPacket({
              simSec: simSecondsElapsed,
              trunkId: trunkEdge.id,
              trunkLabel,
              srcMac: 0,
              dstMac: child.mac,
              service: 'ReadProperty',
              objectId,
              summary: `MAC 0 → ${child.label}: ReadProperty ${objectId} (${objectName})`,
              layer: 'app',
            });
            logBacnetPacket({
              simSec: simSecondsElapsed,
              trunkId: trunkEdge.id,
              trunkLabel,
              srcMac: child.mac,
              dstMac: 0,
              service: 'ReadProperty-ACK',
              objectId,
              value,
              summary: `${child.label} → MAC 0: ${objectId} = ${typeof value === 'number' ? value.toFixed(2) : String(value)}`,
              layer: 'app',
            });
            nextChildIdx = (nextChildIdx + 1) % children.length;
            nextSimSec += APP_LAYER_POLL_CADENCE_S;
            firedThisTick += 1;
          }
          // If we still owe polls but ran out of budget, snap forward so we
          // don't accumulate debt that explodes the buffer later.
          if (simSecondsElapsed >= nextSimSec) {
            nextSimSec = simSecondsElapsed + APP_LAYER_POLL_CADENCE_S;
          }
          nextPollSchedule.set(trunkEdge.id, { nextSimSec, nextChildIdx });
        }
      }
      mstpTrunkStates = nextStates;
      bacnetPollSchedule = nextPollSchedule;
      // Mirror the trunk-state map into the inspector store so the modal
      // can re-render against live values without reaching back into
      // BuildCanvas. Cheap — both maps share the same MstpTrunkState objs.
      publishTrunkStates(nextStates);

      // ── MS/TP config validation. Run every tick (cheap — pure
      // function over a small device list), but only log NEW findings to
      // the runtime log to avoid flooding.
      const findingsByTrunk = new Map<string, MstpFinding[]>();
      const snapshots = [...nextStates.entries()].map(([trunkId, st]) => ({
        trunkId,
        devices: st.devices,
      }));
      const allFindings = validateMstpTrunks(snapshots);
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
      switch (data.kind) {
        case 'supervisor':
          value = `uptime t=${tick}s`;
          status = 'idle';
          break;
        case 'controller':
          value = controllerReading();
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
    running = true;

    // Snapshot the current wired targets so config/topology edits during a run
    // don't yank the chart or restart a system mid-trajectory.
    runningSnapshot = wiredTargets.slice();
    // Seed the sim clock from the user-set start hour. Each system's
    // internal simSeconds starts here too so occupancy schedules see the
    // right hour-of-day from tick 0.
    simSecondsElapsed = 0;
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
    tick = 0;
    runningSamples = new Map();
    nodes = parsed.topology.nodes;
    edges = parsed.topology.edges;

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
  function validateWireCompat(srcN: Node, tgtN: Node, kind: WireKind): string | null {
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
        return `${nodeLabel(ctrlNode)} is already hosted by ${supLabel}. Disconnect the existing trunk first — a controller has one upstream engine in real installs (N+1 redundancy is enterprise-tier and isn't modeled here).`;
      }
    }

    // Sensor / safety endpoints: only hardwired makes physical sense in
    // most real installs (intelligent BACnet sensors exist but the
    // sandbox doesn't model them yet).
    if (srcKind === 'sensor' || srcKind === 'safety' || tgtKind === 'sensor' || tgtKind === 'safety') {
      if (kind !== 'hardwired') {
        return `${kind} can't connect to a ${srcKind === 'sensor' || tgtKind === 'sensor' ? 'sensor' : 'safety device'} — use "Hardwired" (or pick a BACnet-MS/TP smart sensor in a future release).`;
      }
      return null;
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

    if (srcModel && !srcModel.protocols.includes(need as never)) {
      return `${srcModel.vendor} ${srcModel.model} doesn't speak ${need} (supports: ${srcModel.protocols.join(', ')}).`;
    }
    if (tgtModel && !tgtModel.protocols.includes(need as never)) {
      return `${tgtModel.vendor} ${tgtModel.model} doesn't speak ${need} (supports: ${tgtModel.protocols.join(', ')}).`;
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
      // not on the node data itself. For a generic controller with no model
      // picked, fall back to a permissive 16-channel default so the user can
      // still wire things up.
      const data = node.data as { vendorModelId?: string } | undefined;
      const model = data?.vendorModelId ? findControllerModel(data.vendorModelId) : undefined;
      const points: Record<string, number> = model?.points
        ? { ...model.points }
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
    if ((srcKind === 'sensor' || srcKind === 'safety' || srcKind === 'actuator') && tgtKind === 'controller') {
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
    if (srcKind === 'controller' && tgtKind === 'actuator') {
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
      if (!sourceIsAllowed || sourceIsTaken || !isTerminal(resolvedSourceHandle)) {
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
    if (srcKind === 'controller' && (tgtKind === 'sensor' || tgtKind === 'safety')) {
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
    if (refusal) {
      flashWireRefusal(refusal);
      return;
    }
    const newEdge: Edge = {
      id: `e-${connection.source}-${connection.target}-${Date.now()}`,
      source: connection.source!,
      target: connection.target!,
      sourceHandle: resolvedSourceHandle,
      targetHandle: resolvedTargetHandle,
      data: { wireKind: kind },
    };
    edges = addEdge(withStyle(newEdge), edges);
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
    for (const n of nodes) {
      // Supervisors themselves never count as "offline" — they're the root.
      if (nodeKind(n) === 'supervisor') continue;
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

  /** Update a sensor's signal template. UI-only change today — the template
   *  feeds the subtitle and (future) poll-cadence sim, but the thermal model
   *  treats every sensor as a generic zone-temp source. */
  function setSensorSignal(sensorId: string, signal: SensorSignal): void {
    nodes = nodes.map((n) =>
      n.id === sensorId ? { ...n, data: { ...(n.data as Record<string, unknown>), signal } } : n,
    );
  }

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
        };
        const level: 'warn' | 'error' = fault === 'open' || fault === 'short' ? 'error' : 'warn';
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

    // 2. Hardwired wires should terminate at a sensor or safety
    for (const e of edges) {
      const wk = (e.data?.wireKind as WireKind) ?? undefined;
      if (wk !== 'hardwired') continue;
      const sk = nodeKind(nodeById.get(e.source)!);
      const tk = nodeKind(nodeById.get(e.target)!);
      const leaf = sk === 'sensor' || sk === 'safety' || tk === 'sensor' || tk === 'safety';
      if (!leaf) {
        findings.push({
          level: 'warning',
          ruleId: 'hardwired-no-leaf',
          message: `Hardwired wire ${labelOf(e.source)} → ${labelOf(e.target)} doesn't end at a sensor or safety`,
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

    // 4. Supervisor downstream — supervisors should be roots
    for (const e of edges) {
      const tgt = nodeById.get(e.target);
      if (tgt && nodeKind(tgt) === 'supervisor') {
        findings.push({
          level: 'warning',
          ruleId: 'supervisor-downstream',
          message: `${labelOf(e.target)} is a Supervisor wired downstream of ${labelOf(e.source)} — supervisors are usually roots`,
          subjectId: e.id,
        });
      }
    }

    // 5. Orphan nodes
    const referenced = new Set<string>();
    for (const e of edges) {
      referenced.add(e.source);
      referenced.add(e.target);
    }
    for (const n of nodes) {
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

    const existing = wiredTargets.find((t) => t.controllerId === node.id);
    if (existing) {
      if (focusedTargetId === node.id) {
        // Click focused → unwire it
        wiredTargets = wiredTargets.filter((t) => t.controllerId !== node.id);
        focusedTargetId = wiredTargets[0]?.controllerId ?? null;
      } else {
        // Click already-wired but not focused → just focus
        focusedTargetId = node.id;
      }
    } else {
      // New wiring — copy the focused target's config (or DEFAULT_CONFIG) as the starting point.
      const startConfig: SingleZoneConfig = focusedTarget
        ? { ...focusedTarget.config }
        : { ...DEFAULT_CONFIG };
      wiredTargets = [
        ...wiredTargets,
        { controllerId: node.id, sensorId: sensor.id, config: startConfig },
      ];
      focusedTargetId = node.id;
    }
    syncRunningState();
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
    // Expose canvas actions to the App header so Clear / Reset / Save
    // are reachable without scrolling through the bottom dock.
    canvasActions.clear = clearAll;
    canvasActions.reset = resetCanvas;
    canvasActions.saveScenario = saveScenario;
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
            if (dev) return { trunkId: tid, mac: dev.mac, label: dev.label, devices: state.devices };
          }
          return null;
        })();
        if (trunkForCtrl) {
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
          logBacnetPacket({
            simSec: simSecondsElapsed,
            trunkId: trunkForCtrl.trunkId,
            trunkLabel: trunkLabelStr,
            srcMac: 0,
            dstMac: trunkForCtrl.mac,
            service: 'WriteProperty',
            objectId,
            value: writeVal,
            summary: `MAC 0 → ${trunkForCtrl.label}: WriteProperty ${objectId} = ${typeof writeVal === 'number' ? writeVal.toFixed(2) : writeVal} (CLI set ${key})`,
            layer: 'app',
          });
          logBacnetPacket({
            simSec: simSecondsElapsed,
            trunkId: trunkForCtrl.trunkId,
            trunkLabel: trunkLabelStr,
            srcMac: trunkForCtrl.mac,
            dstMac: 0,
            service: 'WriteProperty-ACK',
            objectId,
            value: writeVal,
            summary: `${trunkForCtrl.label} → MAC 0: WriteProperty-ACK ${objectId} OK`,
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
          <button
            type="button"
            class="wire-row"
            class:active={selectedWireKind === 'auto'}
            title="Pick the trunk kind automatically based on what's being connected."
            onclick={() => (selectedWireKind = 'auto')}
          >
            <span class="wire-swatch auto"></span>
            <span class="wire-row-label">Auto</span>
            <span class="wire-row-sub">smart-pick</span>
          </button>
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
              <div class="sensor-row">
                <span class="sensor-sub">Signal</span>
                <div class="signal-chips">
                  {#each SENSOR_TEMPLATES as tpl (tpl.id)}
                    <button
                      type="button"
                      class="signal-chip"
                      class:active={currentSignal === tpl.id}
                      title="{tpl.accuracy} · polled ~{tpl.pollSec}s"
                      onclick={() => setSensorSignal(selectedSensor.id, tpl.id)}
                    >
                      {tpl.label}
                    </button>
                  {/each}
                </div>
              </div>
              <div class="sensor-row">
                <span class="sensor-sub">Fault</span>
                <div class="fault-chips">
                  {#each ['normal', 'open', 'short', 'stuck', 'drift'] as f (f)}
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

        {#if selectedController}
          {@const ctrlData = selectedController.data as
            | { highAlarm?: number; lowAlarm?: number; manualOverride?: number }
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
                    ? 'Open Cisco-IOS-style terminal (program this controller in Structured Text)'
                    : 'Open terminal (programming unavailable for this vendor — see show config)'}
                  onclick={() => openCli(selectedController.id, nodeLabel(selectedController))}
                >
                  &gt;_ Terminal
                </button>
                {#if ctrlStPortable}
                  <button
                    type="button"
                    class="inspector-diagram"
                    title="Open block diagram editor (IEC 61131-3 FBD)"
                    onclick={() => openFbd(selectedController.id, nodeLabel(selectedController))}
                  >
                    ▦ Diagram
                  </button>
                {/if}
                <button
                  type="button"
                  class="inspector-speclang"
                  title="Open SpecLang — plain-English programming. Works on every controller in the catalog."
                  onclick={() => openSpecLang(selectedController.id, nodeLabel(selectedController))}
                >
                  📝 SpecLang
                </button>
                <button
                  type="button"
                  class="inspector-bacnet"
                  title="BACnet objects — see what a supervisor (YABE, Niagara Spy) would discover on this controller."
                  onclick={() => openBacnet(selectedController.id, nodeLabel(selectedController))}
                >
                  🔌 BACnet
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
                    onclick={() => onNodeClick({ node: selectedController })}
                  >
                    → Wire as physics target
                  </button>
                {:else}
                  <span class="phys-status phys-warn">
                    Wire a sensor to this controller (drag between handles) to enable physics tuning
                  </span>
                {/if}
              </div>
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
            <div class="chart-panel">
              <div class="chart-head">
                <span class="chart-title"
                  >Zone response{wiredTargets.length > 1
                    ? ` — ${wiredTargets.length} zones`
                    : ` — ${primarySeries.label}`}</span
                >
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
              </div>
              <MiniChart primary={primarySeries} ghosts={ghostSeries} />
            </div>
          </Panel>
        {/if}

        {#if focusedTarget && physicsTarget}
          <Panel position="bottom-left">
            <div class="tune-panel">
              <div class="tune-head">
                <span class="tune-title"
                  >Tune — {physicsTarget.controllerLabel}{wiredTargets.length > 1
                    ? ` (${wiredTargets.findIndex((t) => t.controllerId === focusedTargetId) + 1}/${wiredTargets.length})`
                    : ''}</span
                >
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
              </div>
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
          </div>
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
    gap: 0.4rem;
    padding: 0.35rem 0.55rem;
    background: color-mix(in srgb, Canvas 90%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
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
    gap: 0.55rem;
    padding: 0.35rem 0.6rem;
    background: color-mix(in srgb, Canvas 92%, transparent);
    backdrop-filter: blur(4px);
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
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
    justify-content: space-between;
    gap: 0.4rem;
    width: 100%;
    margin-bottom: 0.15rem;
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
