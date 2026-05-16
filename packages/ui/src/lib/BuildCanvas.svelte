<script lang="ts">
  import { setContext } from 'svelte';
  import {
    Background,
    Panel,
    SvelteFlow,
    SvelteFlowProvider,
    type Edge,
    type Node,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import BasNode from './BasNode.svelte';
  import MiniChart from './MiniChart.svelte';
  import {
    SingleZoneSystem,
    DEFAULT_CONFIG,
    type Sample,
    type SingleZoneConfig,
  } from './sim/thermal';

  const nodeTypes = { bas: BasNode };

  type Kind = 'supervisor' | 'controller' | 'sensor' | 'safety';

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

  let nodes = $state.raw<Node[]>([
    {
      id: 'demo-1',
      type: 'bas',
      position: { x: 280, y: 60 },
      data: { kind: 'supervisor', label: 'NAE-1' },
    },
    {
      id: 'demo-2',
      type: 'bas',
      position: { x: 280, y: 210 },
      data: { kind: 'controller', label: 'FEC-1' },
    },
    {
      id: 'demo-3',
      type: 'bas',
      position: { x: 130, y: 360 },
      data: { kind: 'controller', label: 'VAV-1' },
    },
    {
      id: 'demo-4',
      type: 'bas',
      position: { x: 130, y: 510 },
      data: { kind: 'sensor', label: 'ZN-T-1' },
    },
    {
      id: 'demo-5',
      type: 'bas',
      position: { x: 430, y: 360 },
      data: { kind: 'safety', label: 'FZ-1' },
    },
  ]);

  let edges = $state.raw<Edge[]>([
    { id: 'e1-2', source: 'demo-1', target: 'demo-2' },
    { id: 'e2-3', source: 'demo-2', target: 'demo-3' },
    { id: 'e3-4', source: 'demo-3', target: 'demo-4' },
    { id: 'e2-5', source: 'demo-2', target: 'demo-5' },
  ]);

  // Per-kind counter so default names auto-increment ("VAV-1", "VAV-2", ...).
  // Pre-seeded to match the demo topology placed above.
  const counters: Record<string, number> = {
    supervisor: 1,
    controller: 2,
    sensor: 1,
    safety: 1,
  };

  function nextName(kind: Kind): string {
    const item = PALETTE.find((p) => p.kind === kind);
    if (!item) return kind;
    const stem = item.defaultName.replace(/-\d+$/, '');
    counters[kind] = (counters[kind] ?? 0) + 1;
    return `${stem}-${counters[kind]}`;
  }

  let nextId = 100;

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

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const position = {
      x: event.clientX - rect.left - 80,
      y: event.clientY - rect.top - 25,
    };

    const id = `n${nextId++}`;
    nodes = [
      ...nodes,
      {
        id,
        type: 'bas',
        position,
        data: { kind: item.kind, label: nextName(item.kind) },
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

  // Multi-target state. Pre-seeded with the demo VAV-1 ↔ ZN-T-1 pair so the
  // first-time experience still has something to Run.
  let wiredTargets = $state<WiredTarget[]>([
    {
      controllerId: 'demo-3',
      sensorId: 'demo-4',
      config: { ...DEFAULT_CONFIG },
    },
  ]);
  let focusedTargetId = $state<string | null>('demo-3');

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

  // ============ Sim loop ============

  let running = $state(false);
  let tick = $state(0);
  let intervalId: ReturnType<typeof setInterval> | null = null;
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

  let scenarioBaseline = $state<SingleZoneConfig>({ ...DEFAULT_CONFIG });
  let activePresetId = $state<string>('default');

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

    // Step every wired system. Build a fast lookup from controllerId → latest sample
    // so the node-runtime pass below can resolve in O(1).
    const sampleByCtrl = new Map<string, Sample>();
    const samples = runningSamples;
    const systems = runningSystems;
    for (const target of runningSnapshot) {
      const sys = systems.get(target.controllerId);
      if (!sys) continue;
      const sample = sys.step();
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
      physicsValueByNode.set(target.sensorId, {
        value: `${sample.T_zone.toFixed(1)} °F`,
        status: 'responded',
      });
      // If a parent controller exists and isn't itself wired, surface SP/OAT there.
      const parent = findParentController(target.controllerId);
      if (parent && !physicsValueByNode.has(parent.id)) {
        physicsValueByNode.set(parent.id, {
          value: `SP ${sample.setpoint.toFixed(0)}°F · OAT ${sample.T_OA.toFixed(0)}°F`,
          status: 'polling',
        });
      }
    }

    nodes = nodes.map((n) => {
      const data = n.data as { kind: Kind; label: string; runtime?: unknown };
      const physVal = physicsValueByNode.get(n.id);
      if (physVal) {
        return { ...n, data: { ...data, runtime: physVal } };
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
      return { ...n, data: { ...data, runtime: { value, status } } };
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
    const systems = new Map<string, SingleZoneSystem>();
    const samples = new Map<string, Sample[]>();
    for (const t of runningSnapshot) {
      systems.set(t.controllerId, new SingleZoneSystem(t.config));
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
      edges = edges.map((e) => ({ ...e, animated: pathIds.has(e.id) }));
    } else {
      // No physics target → no real traffic — animate all wires lightly so
      // the canvas isn't completely static while the synthetic ticker runs.
      edges = edges.map((e) => ({ ...e, animated: true }));
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
    edges = edges.map((e) => ({ ...e, animated: false }));
  }

  function resetSim() {
    stop();
    tick = 0;
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

  type BasScenarioV1 = {
    version: 1;
    savedAt: string;
    topology: {
      nodes: Node[];
      edges: Edge[];
    };
    /** Legacy single-selection (v1.0/1.1). Still written for back-compat. */
    selection: {
      controllerId: string | null;
    };
    /** Legacy single-config (v1.0/1.1). Mirrors the focused target's config. */
    config: SingleZoneConfig;
    /** v1.2+: explicit multi-target list. */
    wiredTargets?: WiredTarget[];
    focusedTargetId?: string | null;
    counters: Record<string, number>;
    nextId: number;
  };

  let saveButtonText = $state('Save scenario');
  let saveButtonTimer: ReturnType<typeof setTimeout> | null = null;
  let loadMessage = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

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

  function onNodeClick({ node }: { node: Node }) {
    if (running) return; // Lock topology of physics targets while sim is running
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
  }

  /** Remove the focused target. Used by the sidebar ✕ button. */
  function clearPhysicsTarget() {
    if (running) return;
    if (!focusedTargetId) return;
    wiredTargets = wiredTargets.filter((t) => t.controllerId !== focusedTargetId);
    focusedTargetId = wiredTargets[0]?.controllerId ?? null;
  }

  // Auto-cleanup
  $effect(() => {
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  });
</script>

<div class="build">
  <SvelteFlowProvider>
    <aside class="palette">
      <div class="palette-head">
        <h3>Equipment</h3>
        <p class="hint">Drag onto canvas. Wire by dragging between handles.</p>
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
                disabled={running}
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
        <button type="button" class="clear" onclick={clearAll}>Clear canvas</button>
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
      <SvelteFlow bind:nodes bind:edges {nodeTypes} fitView onnodeclick={onNodeClick}>
        <Background />

        {#if running && focusedTarget && (runningSamples.get(focusedTarget.controllerId)?.length ?? 0) > 0}
          <Panel position="top-left">
            <div class="chart-panel">
              <div class="chart-head">
                <span class="chart-title"
                  >Zone response — {physicsTarget?.controllerLabel ?? ''}{wiredTargets.length > 1
                    ? ` (${wiredTargets.findIndex((t) => t.controllerId === focusedTargetId) + 1}/${wiredTargets.length})`
                    : ''}</span
                >
                <span class="chart-sub"
                  >{focusedTarget.config.dt}s/tick · τ={(focusedTarget.config.tau / 60).toFixed(
                    0,
                  )}min</span
                >
              </div>
              <MiniChart
                samples={runningSamples.get(focusedTarget.controllerId) ?? []}
                setpoint={focusedTarget.config.setpoint}
                oat={focusedTarget.config.outdoorAir}
              />
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
                    <span class="lbl">Cool max</span>
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

  .flow {
    position: relative;
  }

  :global(.flow .svelte-flow__background) {
    background: Canvas;
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
