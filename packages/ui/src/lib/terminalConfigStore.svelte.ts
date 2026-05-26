// Per-controller per-terminal input-type override.
//
// When a sensor is wired to a controller, the sim loop scales the raw
// electrical signal back to engineering units according to the
// terminal's "input type" setting (Pt1000 / 10kΩ / 0-10V / 4-20mA /
// etc.). By default each terminal inherits the signal type of the
// sensor wired to it — the round-trip is identity and behavior is
// unchanged from before signal fidelity landed.
//
// This store lets the user OVERRIDE that default. Setting a terminal
// to the wrong input type is the canonical commissioning mistake —
// the controller doesn't error; it produces a wrong-but-plausible
// number that silently breaks the loop tune. Surfacing it here makes
// it a teachable failure mode.

import type { TerminalConfig, TerminalInputType } from '@bas/core';

const LS_PREFIX = 'bas-sandbox.terminal-config.';
const LS_INDEX = 'bas-sandbox.terminal-config.__index';

/** Override entry for a single terminal. When `inputType` is missing the
 *  sim falls back to the sensor-derived default; explicit engMin/engMax
 *  override the sensor's measurement range. */
export interface TerminalConfigOverride {
  readonly inputType?: TerminalInputType;
  readonly engMin?: number;
  readonly engMax?: number;
}

interface Store {
  /** Outer key = controllerId; inner key = terminalId (e.g. "UI-1"). */
  byCtrl: Record<string, Record<string, TerminalConfigOverride>>;
  /** Bumped each mutation so consumers re-derive. */
  rev: number;
}

export const terminalConfigStore = $state<Store>({
  byCtrl: {},
  rev: 0,
});

function persist(controllerId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const entry = terminalConfigStore.byCtrl[controllerId];
    if (!entry || Object.keys(entry).length === 0) {
      localStorage.removeItem(LS_PREFIX + controllerId);
    } else {
      localStorage.setItem(LS_PREFIX + controllerId, JSON.stringify(entry));
    }
    const idx = new Set<string>(
      JSON.parse(localStorage.getItem(LS_INDEX) ?? '[]') as string[],
    );
    if (entry && Object.keys(entry).length > 0) idx.add(controllerId);
    else idx.delete(controllerId);
    localStorage.setItem(LS_INDEX, JSON.stringify([...idx]));
  } catch {
    // ignore storage errors (quota, private mode, etc.)
  }
}

/** Load every persisted controller's terminal config map into memory.
 *  Called once on app boot. */
export function rehydrateTerminalConfigs(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const idx = JSON.parse(localStorage.getItem(LS_INDEX) ?? '[]') as string[];
    for (const ctrlId of idx) {
      const raw = localStorage.getItem(LS_PREFIX + ctrlId);
      if (!raw) continue;
      try {
        terminalConfigStore.byCtrl[ctrlId] = JSON.parse(raw) as Record<
          string,
          TerminalConfigOverride
        >;
      } catch {
        // skip malformed entry
      }
    }
    terminalConfigStore.rev++;
  } catch {
    // ignore
  }
}

/** Resolve the terminal config for a controller/terminal pair. Returns
 *  the override merged onto a sensor-derived default. Pure-ish read
 *  used by the sim loop and inspector UI. */
export function resolveTerminalConfig(
  controllerId: string,
  terminalId: string,
  fallback: TerminalConfig,
): TerminalConfig {
  const override = terminalConfigStore.byCtrl[controllerId]?.[terminalId];
  if (!override) return fallback;
  return {
    inputType: override.inputType ?? fallback.inputType,
    engMin: override.engMin ?? fallback.engMin,
    engMax: override.engMax ?? fallback.engMax,
  };
}

/** Set (or update) the override for a single terminal. */
export function setTerminalConfig(
  controllerId: string,
  terminalId: string,
  patch: TerminalConfigOverride,
): void {
  const existing = terminalConfigStore.byCtrl[controllerId] ?? {};
  const merged = { ...existing[terminalId], ...patch };
  terminalConfigStore.byCtrl[controllerId] = { ...existing, [terminalId]: merged };
  terminalConfigStore.rev++;
  persist(controllerId);
}

/** Drop a single terminal back to its sensor-derived default. */
export function clearTerminalConfig(controllerId: string, terminalId: string): void {
  const existing = terminalConfigStore.byCtrl[controllerId];
  if (!existing || !existing[terminalId]) return;
  const next = { ...existing };
  delete next[terminalId];
  if (Object.keys(next).length === 0) {
    delete terminalConfigStore.byCtrl[controllerId];
  } else {
    terminalConfigStore.byCtrl[controllerId] = next;
  }
  terminalConfigStore.rev++;
  persist(controllerId);
}

/** Drop every override for a controller (called when the controller is
 *  deleted from the canvas). */
export function clearAllTerminalConfig(controllerId: string): void {
  if (!terminalConfigStore.byCtrl[controllerId]) return;
  delete terminalConfigStore.byCtrl[controllerId];
  terminalConfigStore.rev++;
  persist(controllerId);
}

/** Human-readable label per input type for the dropdown UI. */
export const INPUT_TYPE_LABELS: Record<TerminalInputType, string> = {
  'rtd-pt1000': 'RTD · Pt1000',
  'rtd-pt100': 'RTD · Pt100',
  'thermistor-10k-t2': 'Thermistor · 10 kΩ Type II',
  'thermistor-10k-t3': 'Thermistor · 10 kΩ Type III',
  'thermistor-20k': 'Thermistor · 20 kΩ',
  'analog-0-10v': 'Analog · 0–10 V',
  'analog-2-10v': 'Analog · 2–10 V (live zero)',
  'analog-0-5v': 'Analog · 0–5 V',
  'analog-4-20ma': 'Analog · 4–20 mA (live zero)',
  'analog-0-20ma': 'Analog · 0–20 mA',
  'binary-dry': 'Binary · dry contact',
};

/** Picker order for the dropdown — most-common first. */
export const INPUT_TYPE_ORDER: readonly TerminalInputType[] = [
  'rtd-pt1000',
  'rtd-pt100',
  'thermistor-10k-t2',
  'thermistor-10k-t3',
  'thermistor-20k',
  'analog-0-10v',
  'analog-2-10v',
  'analog-0-5v',
  'analog-4-20ma',
  'analog-0-20ma',
  'binary-dry',
];
