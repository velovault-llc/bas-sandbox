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
  import { importStore } from './canvasStore.svelte';
  import { advancePlayback, currentWeatherSample, weatherStore } from './weather/weatherStore.svelte';
  import { openCli, openFbd, programStore } from './cli/programStore.svelte';
  import { registerBridge, type ControllerSnapshot } from './cli/controllerBridge.svelte';
  import { runProgram, makeEnv, findControllerModel, type StEnv } from '@bas/core';
  import { onMount } from 'svelte';
  import type { BasScenarioV1 } from './scenario';
  import { DEMOS } from './demoScenarios';

  const nodeTypes = { bas: BasNode };

  type Kind = 'supervisor' | 'controller' | 'sensor' | 'safety';

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
    if (involves('sensor') || involves('safety')) return 'hardwired';
    if (involves('supervisor')) return 'bacnet-ip';
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
    edges = edges.map((e) =>
      e.id === edgeId
        ? withStyle({
            ...e,
            data: { ...(e.data ?? {}), comm: broken ? 'broken' : 'normal' },
          })
        : e,
    );
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
    const item = PALETTE.find((p) => p.kind === kind);
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

    // Optional vendor-model payload: when the drag came from the catalog
    // drawer, the model id rides along on a secondary dataTransfer key.
    // Resolve it now so the new node carries the vendor metadata.
    const vendorId = event.dataTransfer?.getData('application/bas-controller-vendor');
    const vendorModel = vendorId ? findControllerModel(vendorId) : undefined;

    const id = `n${nextId++}`;
    const baseLabel = vendorModel ? vendorModel.model : nextName(item.kind);
    const data: Record<string, unknown> = { kind: item.kind, label: baseLabel };
    if (vendorModel) {
      data.vendorModelId = vendorModel.id;
      data.subtitle = `${vendorModel.vendor} · ${vendorModel.programmingLanguage}`;
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

  // Per-target running state, keyed by controllerId.
  let runningSystems = $state.raw<Map<string, SingleZoneSystem>>(new Map());
  let runningSamples = $state.raw<Map<string, Sample[]>>(new Map());
  let runningSnapshot = $state.raw<WiredTarget[]>([]);

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
    const dtSeconds = runningSnapshot[0]?.config.dt ?? DEFAULT_CONFIG.dt;
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
      // (JCI CCT, Niagara Wiresheet, PPCL, etc.), the sandbox doesn't pretend
      // to run their native language, so we don't run ST against them either.
      const ctrlNode = nodes.find((n) => n.id === target.controllerId);
      const vendorModelId = (ctrlNode?.data as { vendorModelId?: string } | undefined)?.vendorModelId;
      const stAllowed = !vendorModelId || (findControllerModel(vendorModelId)?.stPortable ?? true);
      if (userProgram?.compiled && stAllowed) {
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
      physicsValueByNode.set(target.controllerId, {
        value: `Out ${Math.round(sample.actuator * 100)}% (PI)`,
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
      if (physVal) {
        return {
          ...n,
          data: {
            ...data,
            runtime: physVal,
            staleSec: staleNext,
            ageSinceLastPollSec: ageNext,
            ...(alarmNext !== undefined ? { alarm: alarmNext } : {}),
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

    tickOnce();
    intervalId = setInterval(tickOnce, TICK_MS);
  }

  function stop() {
    running = false;
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

  let saveButtonText = $state('Save scenario');
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
    saveButtonText = text;
    if (saveButtonTimer) clearTimeout(saveButtonTimer);
    saveButtonTimer = setTimeout(() => {
      saveButtonText = 'Save scenario';
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

  /** New wires drawn between handles use the currently-pinned trunk kind. */
  function onConnect(connection: Connection) {
    const src = nodes.find((n) => n.id === connection.source);
    const tgt = nodes.find((n) => n.id === connection.target);
    const kind: WireKind =
      selectedWireKind === 'auto'
        ? defaultWireKind(nodeKind(src!), nodeKind(tgt!))
        : selectedWireKind;
    const newEdge: Edge = {
      id: `e-${connection.source}-${connection.target}-${Date.now()}`,
      source: connection.source!,
      target: connection.target!,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
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
    nodes = nodes.map((n) =>
      n.id === sensorId ? { ...n, data: { ...(n.data as Record<string, unknown>), fault } } : n,
    );
    // Find the wired target this sensor belongs to and push the fault into
    // its live SingleZoneSystem so the trace reacts immediately.
    const target = wiredTargets.find((t) => t.sensorId === sensorId);
    if (!target) return;
    const sys = runningSystems.get(target.controllerId);
    if (sys) sys.setFault(fault);
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
          return null;
        }
        if (typeof value !== 'number') return `${key} expects a number`;
        cfg[key] = value;
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
          <button type="button" class="scenario-btn save" onclick={saveScenario}>
            {saveButtonText}
          </button>
          <label class="scenario-btn load">
            Load
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

        <div class="canvas-buttons">
          <button type="button" class="clear" onclick={clearAll}>Clear</button>
          <button
            type="button"
            class="clear"
            onclick={resetCanvas}
            title="Wipe everything (including localStorage) to a fresh empty canvas">Reset</button
          >
        </div>

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
              {#if baud}
                <span class="wire-baud" title="Baud rate pulled from the trunk's JCI property 426">
                  {baud >= 1000 ? `${(baud / 1000).toFixed(baud % 1000 === 0 ? 0 : 1)}k` : baud} baud
                </span>
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
                <span class="sensor-title">Sensor — {nodeLabel(selectedSensor)}</span>
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
                <span class="ctrl-title">Controller — {nodeLabel(selectedController)}</span>
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
              Reset
            </button>
            <span class="tick">t = {tick}s</span>
            <!-- Sim clock readout: shows the current hour-of-day the sim is at.
                 Lets you set a START hour before pressing Run so occupancy
                 schedules can be tested without waiting for the schedule's
                 actual transition time. CCT/SCT don't expose this; here it
                 takes one input. -->
            <label
              class="sim-clock-input"
              title="Wall-clock hour the sim starts at — used to test occupancy schedules"
            >
              <span>start</span>
              <input
                type="number"
                min="0"
                max="23.5"
                step="0.5"
                bind:value={simStartHour}
                disabled={running || tick > 0}
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

  .wire-chip:disabled {
    opacity: 0.45;
    cursor: not-allowed;
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
