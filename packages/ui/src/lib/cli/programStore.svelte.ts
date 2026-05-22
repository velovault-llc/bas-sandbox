// Controller-program store.
//
// Each controller node on the canvas can carry an ST program that runs each
// sim tick AFTER the built-in PI loop. The program reads sensed/setpoint/oat
// as inputs and may overwrite actuator and the high/low alarm flags.
//
// Programs are persisted in localStorage keyed by controller id. The same
// program follows a controller across reloads.

import {
  compile,
  compileFbd,
  compileSpecLang,
  type StProgram,
  type FbdGraph,
  type SpecProgram,
  type ControllerBindings,
} from '@bas/core';

const LS_PREFIX = 'bas-sandbox.controller-program.';
const LS_INDEX = 'bas-sandbox.controller-program.__index';
const LS_FBD_PREFIX = 'bas-sandbox.controller-fbd.';
const LS_SPEC_PREFIX = 'bas-sandbox.controller-spec.';
const LS_BINDINGS_PREFIX = 'bas-sandbox.controller-bindings.';

export interface ControllerProgram {
  /** Raw source the user typed (text mode). For FBD-authored programs this
   *  holds the FBD-compiled ST so `show program` still works. */
  source: string;
  /** Compiled AST — null if source failed to compile. */
  compiled: StProgram | null;
  /** Compile error string, if any. */
  error: string | null;
  /** Per-controller persistent state for VAR + PID integrators. */
  state: Record<string, number>;
  /** When the user authored this program via the block diagram editor, the
   *  graph is stored here so the editor can round-trip. ST source is still
   *  derived from this graph (compileFbd) and stored in `source`. */
  fbdGraph: FbdGraph | null;
  /** When authored via SpecLang (plain-English tile editor), the program
   *  is stored here. ST source is derived via compileSpecLang. Mutually
   *  exclusive with fbdGraph — flipping editors clears the other. */
  specProgram: SpecProgram | null;
  /** Point bindings — explicit terminal-to-role assignments. Outlives the
   *  programming editor choice (the same bindings apply whether the user
   *  authors in SpecLang, FBD, or raw ST). */
  bindings: ControllerBindings;
}

interface ProgramStore {
  /** Map of controllerId → program. */
  byId: Record<string, ControllerProgram>;
  /** Controller currently focused in the CLI panel (or null when closed). */
  activeControllerId: string | null;
  /** Display label of the active controller, for the prompt. */
  activeControllerLabel: string | null;
  /** Controller currently focused in the FBD canvas (null when canvas closed). */
  activeFbdControllerId: string | null;
  activeFbdControllerLabel: string | null;
  /** Controller currently focused in the SpecLang editor (null when closed). */
  activeSpecLangControllerId: string | null;
  activeSpecLangControllerLabel: string | null;
  /** Controller currently focused in the BACnet objects inspector. */
  activeBacnetControllerId: string | null;
  activeBacnetControllerLabel: string | null;
}

export const programStore = $state<ProgramStore>({
  byId: {},
  activeControllerId: null,
  activeControllerLabel: null,
  activeFbdControllerId: null,
  activeFbdControllerLabel: null,
  activeSpecLangControllerId: null,
  activeSpecLangControllerLabel: null,
  activeBacnetControllerId: null,
  activeBacnetControllerLabel: null,
});

/** Close every programming surface (CLI, FBD, SpecLang). Used when
 *  opening a new one so the user always has exactly one editor visible
 *  — otherwise overlays stack and the lower one becomes un-clickable. */
function closeAllProgrammingSurfaces(): void {
  programStore.activeControllerId = null;
  programStore.activeControllerLabel = null;
  programStore.activeFbdControllerId = null;
  programStore.activeFbdControllerLabel = null;
  programStore.activeSpecLangControllerId = null;
  programStore.activeSpecLangControllerLabel = null;
  programStore.activeBacnetControllerId = null;
  programStore.activeBacnetControllerLabel = null;
}

/** Open the BACnet objects inspector pointed at this controller. */
export function openBacnet(controllerId: string, label: string): void {
  if (!(controllerId in programStore.byId)) {
    programStore.byId[controllerId] = loadFromStorage(controllerId);
  }
  closeAllProgrammingSurfaces();
  programStore.activeBacnetControllerId = controllerId;
  programStore.activeBacnetControllerLabel = label;
}

export function closeBacnet(): void {
  programStore.activeBacnetControllerId = null;
  programStore.activeBacnetControllerLabel = null;
}

/** Open the CLI panel pointed at this controller. */
export function openCli(controllerId: string, label: string): void {
  if (!(controllerId in programStore.byId)) {
    programStore.byId[controllerId] = loadFromStorage(controllerId);
  }
  closeAllProgrammingSurfaces();
  programStore.activeControllerId = controllerId;
  programStore.activeControllerLabel = label;
}

export function closeCli(): void {
  programStore.activeControllerId = null;
  programStore.activeControllerLabel = null;
}

/** Open the block diagram editor pointed at this controller. */
export function openFbd(controllerId: string, label: string): void {
  if (!(controllerId in programStore.byId)) {
    programStore.byId[controllerId] = loadFromStorage(controllerId);
  }
  closeAllProgrammingSurfaces();
  programStore.activeFbdControllerId = controllerId;
  programStore.activeFbdControllerLabel = label;
}

export function closeFbd(): void {
  programStore.activeFbdControllerId = null;
  programStore.activeFbdControllerLabel = null;
}

/** Open the SpecLang plain-English editor pointed at this controller. */
export function openSpecLang(controllerId: string, label: string): void {
  if (!(controllerId in programStore.byId)) {
    programStore.byId[controllerId] = loadFromStorage(controllerId);
  }
  closeAllProgrammingSurfaces();
  programStore.activeSpecLangControllerId = controllerId;
  programStore.activeSpecLangControllerLabel = label;
}

export function closeSpecLang(): void {
  programStore.activeSpecLangControllerId = null;
  programStore.activeSpecLangControllerLabel = null;
}

/** Replace a controller's program with a SpecLang assembly. Compiles to
 *  ST under the hood + persists both source + the tile structure. */
export function setProgramSpec(controllerId: string, spec: SpecProgram): ControllerProgram {
  const existing = programStore.byId[controllerId];
  const sl = compileSpecLang(spec, existing?.bindings);
  if (!sl.ok || sl.source.trim() === '') {
    const prog: ControllerProgram = {
      source: existing?.source ?? '',
      compiled: existing?.compiled ?? null,
      error: [...sl.errors.values()][0] ?? 'SpecLang compile failed',
      state: existing?.state ?? {},
      fbdGraph: null,
      specProgram: spec,
      bindings: existing?.bindings ?? { bindings: [] },
    };
    programStore.byId[controllerId] = prog;
    persistSpecProgram(controllerId, spec);
    return prog;
  }
  const result = compile(sl.source);
  const prog: ControllerProgram = {
    source: sl.source,
    compiled: result.ok && result.program ? result.program : null,
    error: result.ok ? null : result.error ?? 'compile failed',
    state: existing?.state ?? {},
    // Authoring source flipped — clear FBD graph; SpecLang is the truth now.
    fbdGraph: null,
    specProgram: spec,
    bindings: existing?.bindings ?? { bindings: [] },
  };
  programStore.byId[controllerId] = prog;
  persistToStorage(controllerId, prog.source);
  persistFbdGraph(controllerId, null);
  persistSpecProgram(controllerId, spec);
  return prog;
}

/** Replace a controller's program source. Compiles + persists. */
export function setProgramSource(controllerId: string, source: string): ControllerProgram {
  const result = compile(source);
  const existing = programStore.byId[controllerId];
  const prog: ControllerProgram = {
    source,
    compiled: result.ok && result.program ? result.program : null,
    error: result.ok ? null : result.error ?? 'compile failed',
    state: existing?.state ?? {},
    // Clear any prior FBD graph when the user goes to text mode — the source
    // of truth flipped.
    fbdGraph: null,
    specProgram: null,
    bindings: existing?.bindings ?? { bindings: [] },
  };
  programStore.byId[controllerId] = prog;
  persistToStorage(controllerId, source);
  persistFbdGraph(controllerId, null);
  persistSpecProgram(controllerId, null);
  return prog;
}

/** Replace a controller's block-diagram graph. Compiles to ST + persists. */
export function setProgramGraph(controllerId: string, graph: FbdGraph): ControllerProgram {
  const fbd = compileFbd(graph);
  if (!fbd.ok) {
    const existing = programStore.byId[controllerId];
    const prog: ControllerProgram = {
      source: existing?.source ?? '',
      compiled: existing?.compiled ?? null,
      error: fbd.error ?? 'FBD compile failed',
      state: existing?.state ?? {},
      fbdGraph: graph,
      specProgram: null,
      bindings: existing?.bindings ?? { bindings: [] },
    };
    programStore.byId[controllerId] = prog;
    persistFbdGraph(controllerId, graph);
    persistSpecProgram(controllerId, null);
    return prog;
  }
  const result = compile(fbd.source ?? '');
  const existing = programStore.byId[controllerId];
  const prog: ControllerProgram = {
    source: fbd.source ?? '',
    compiled: result.ok && result.program ? result.program : null,
    error: result.ok ? null : result.error ?? 'compile failed',
    state: existing?.state ?? {},
    fbdGraph: graph,
    specProgram: null,
    bindings: existing?.bindings ?? { bindings: [] },
  };
  programStore.byId[controllerId] = prog;
  persistToStorage(controllerId, prog.source);
  persistFbdGraph(controllerId, graph);
  persistSpecProgram(controllerId, null);
  return prog;
}

/** Drop a controller's program entirely. */
export function clearProgram(controllerId: string): void {
  delete programStore.byId[controllerId];
  removeFromStorage(controllerId);
}

/** Replace the point bindings for a controller. Triggers a recompile so
 *  SpecLang warnings update immediately. */
export function setProgramBindings(controllerId: string, bindings: ControllerBindings): void {
  const existing = programStore.byId[controllerId] ?? emptyProgram();
  // If a SpecLang program exists, recompile it so warnings reflect the
  // new bindings. Otherwise just store.
  if (existing.specProgram) {
    const sl = compileSpecLang(existing.specProgram, bindings);
    const result = sl.ok && sl.source ? compile(sl.source) : null;
    programStore.byId[controllerId] = {
      ...existing,
      bindings,
      source: sl.source || existing.source,
      compiled: result?.ok && result.program ? result.program : existing.compiled,
      error: result?.ok === false ? result.error ?? 'compile failed' : null,
    };
  } else {
    programStore.byId[controllerId] = { ...existing, bindings };
  }
  persistBindings(controllerId, bindings);
}

export function getProgram(controllerId: string): ControllerProgram | undefined {
  return programStore.byId[controllerId];
}

/** Eagerly load any persisted programs into memory at app start. */
export function rehydrateAllPrograms(): void {
  if (typeof localStorage === 'undefined') return;
  let index: string[];
  try {
    index = JSON.parse(localStorage.getItem(LS_INDEX) ?? '[]');
  } catch {
    index = [];
  }
  for (const id of index) {
    if (!(id in programStore.byId)) {
      programStore.byId[id] = loadFromStorage(id);
    }
  }
}

// ── persistence helpers ──

function loadBindings(controllerId: string): ControllerBindings {
  if (typeof localStorage === 'undefined') return { bindings: [] };
  const raw = localStorage.getItem(LS_BINDINGS_PREFIX + controllerId);
  if (!raw) return { bindings: [] };
  try {
    const parsed = JSON.parse(raw) as ControllerBindings;
    if (Array.isArray(parsed.bindings)) return parsed;
  } catch {
    // ignore
  }
  return { bindings: [] };
}

function loadFromStorage(controllerId: string): ControllerProgram {
  if (typeof localStorage === 'undefined') return emptyProgram();
  const bindings = loadBindings(controllerId);
  // Priority for round-tripping the editor: SpecLang > FBD > raw ST source.
  // Whichever the user authored last is the source of truth — we re-compile
  // to ST on load so the sim has fresh bytecode.
  const specRaw = localStorage.getItem(LS_SPEC_PREFIX + controllerId);
  let specProgram: SpecProgram | null = null;
  if (specRaw) {
    try {
      specProgram = JSON.parse(specRaw) as SpecProgram;
    } catch {
      specProgram = null;
    }
  }
  if (specProgram) {
    const sl = compileSpecLang(specProgram);
    if (sl.ok && sl.source) {
      const result = compile(sl.source);
      return {
        source: sl.source,
        compiled: result.ok && result.program ? result.program : null,
        error: result.ok ? null : result.error ?? 'compile failed',
        state: {},
        fbdGraph: null,
        specProgram,
        bindings,
      };
    }
  }
  const fbdRaw = localStorage.getItem(LS_FBD_PREFIX + controllerId);
  let fbdGraph: FbdGraph | null = null;
  if (fbdRaw) {
    try {
      fbdGraph = JSON.parse(fbdRaw) as FbdGraph;
    } catch {
      fbdGraph = null;
    }
  }
  if (fbdGraph) {
    const fbd = compileFbd(fbdGraph);
    if (fbd.ok && fbd.source) {
      const result = compile(fbd.source);
      return {
        source: fbd.source,
        compiled: result.ok && result.program ? result.program : null,
        error: result.ok ? null : result.error ?? 'compile failed',
        state: {},
        fbdGraph,
        specProgram: null,
        bindings,
      };
    }
  }
  const source = localStorage.getItem(LS_PREFIX + controllerId) ?? '';
  if (!source) {
    // Even with no program yet, return any existing bindings.
    return { ...emptyProgram(), bindings };
  }
  const result = compile(source);
  return {
    source,
    compiled: result.ok && result.program ? result.program : null,
    error: result.ok ? null : result.error ?? 'compile failed',
    state: {},
    fbdGraph: null,
    specProgram: null,
    bindings,
  };
}

function persistBindings(controllerId: string, bindings: ControllerBindings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (!bindings || bindings.bindings.length === 0) {
      localStorage.removeItem(LS_BINDINGS_PREFIX + controllerId);
      return;
    }
    localStorage.setItem(LS_BINDINGS_PREFIX + controllerId, JSON.stringify(bindings));
  } catch {
    // ignore
  }
}

function persistToStorage(controllerId: string, source: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_PREFIX + controllerId, source);
    let index: string[];
    try {
      index = JSON.parse(localStorage.getItem(LS_INDEX) ?? '[]');
    } catch {
      index = [];
    }
    if (!index.includes(controllerId)) {
      index.push(controllerId);
      localStorage.setItem(LS_INDEX, JSON.stringify(index));
    }
  } catch {
    // quota / disabled — ignore silently
  }
}

function removeFromStorage(controllerId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LS_PREFIX + controllerId);
    const idx = JSON.parse(localStorage.getItem(LS_INDEX) ?? '[]') as string[];
    const next = idx.filter((id) => id !== controllerId);
    localStorage.setItem(LS_INDEX, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function emptyProgram(): ControllerProgram {
  return {
    source: '',
    compiled: null,
    error: null,
    state: {},
    fbdGraph: null,
    specProgram: null,
    bindings: { bindings: [] },
  };
}

function persistSpecProgram(controllerId: string, spec: SpecProgram | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (!spec || spec.rules.length === 0) {
      localStorage.removeItem(LS_SPEC_PREFIX + controllerId);
      return;
    }
    localStorage.setItem(LS_SPEC_PREFIX + controllerId, JSON.stringify(spec));
    let index: string[];
    try {
      index = JSON.parse(localStorage.getItem(LS_INDEX) ?? '[]');
    } catch {
      index = [];
    }
    if (!index.includes(controllerId)) {
      index.push(controllerId);
      localStorage.setItem(LS_INDEX, JSON.stringify(index));
    }
  } catch {
    // ignore
  }
}

function persistFbdGraph(controllerId: string, graph: FbdGraph | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (!graph) {
      localStorage.removeItem(LS_FBD_PREFIX + controllerId);
      return;
    }
    localStorage.setItem(LS_FBD_PREFIX + controllerId, JSON.stringify(graph));
    let index: string[];
    try {
      index = JSON.parse(localStorage.getItem(LS_INDEX) ?? '[]');
    } catch {
      index = [];
    }
    if (!index.includes(controllerId)) {
      index.push(controllerId);
      localStorage.setItem(LS_INDEX, JSON.stringify(index));
    }
  } catch {
    // ignore
  }
}
