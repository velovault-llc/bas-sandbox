// Controller-program store.
//
// Each controller node on the canvas can carry an ST program that runs each
// sim tick AFTER the built-in PI loop. The program reads sensed/setpoint/oat
// as inputs and may overwrite actuator and the high/low alarm flags.
//
// Programs are persisted in localStorage keyed by controller id. The same
// program follows a controller across reloads.

import { compile, type StProgram } from '@bas/core';

const LS_PREFIX = 'bas-sandbox.controller-program.';
const LS_INDEX = 'bas-sandbox.controller-program.__index';

export interface ControllerProgram {
  /** Raw source the user typed. */
  source: string;
  /** Compiled AST — null if source failed to compile. */
  compiled: StProgram | null;
  /** Compile error string, if any. */
  error: string | null;
  /** Per-controller persistent state for VAR + PID integrators. */
  state: Record<string, number>;
}

interface ProgramStore {
  /** Map of controllerId → program. */
  byId: Record<string, ControllerProgram>;
  /** Controller currently focused in the CLI panel (or null when closed). */
  activeControllerId: string | null;
  /** Display label of the active controller, for the prompt. */
  activeControllerLabel: string | null;
}

export const programStore = $state<ProgramStore>({
  byId: {},
  activeControllerId: null,
  activeControllerLabel: null,
});

/** Open the CLI panel pointed at this controller. */
export function openCli(controllerId: string, label: string): void {
  if (!(controllerId in programStore.byId)) {
    programStore.byId[controllerId] = loadFromStorage(controllerId);
  }
  programStore.activeControllerId = controllerId;
  programStore.activeControllerLabel = label;
}

export function closeCli(): void {
  programStore.activeControllerId = null;
  programStore.activeControllerLabel = null;
}

/** Replace a controller's program source. Compiles + persists. */
export function setProgramSource(controllerId: string, source: string): ControllerProgram {
  const result = compile(source);
  const prog: ControllerProgram = {
    source,
    compiled: result.ok && result.program ? result.program : null,
    error: result.ok ? null : result.error ?? 'compile failed',
    state: programStore.byId[controllerId]?.state ?? {},
  };
  programStore.byId[controllerId] = prog;
  persistToStorage(controllerId, source);
  return prog;
}

/** Drop a controller's program entirely. */
export function clearProgram(controllerId: string): void {
  delete programStore.byId[controllerId];
  removeFromStorage(controllerId);
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

function loadFromStorage(controllerId: string): ControllerProgram {
  if (typeof localStorage === 'undefined') return emptyProgram();
  const source = localStorage.getItem(LS_PREFIX + controllerId) ?? '';
  if (!source) return emptyProgram();
  const result = compile(source);
  return {
    source,
    compiled: result.ok && result.program ? result.program : null,
    error: result.ok ? null : result.error ?? 'compile failed',
    state: {},
  };
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
  return { source: '', compiled: null, error: null, state: {} };
}
