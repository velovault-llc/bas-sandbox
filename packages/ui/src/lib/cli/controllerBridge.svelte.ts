// Bridge between the CLI panel and BuildCanvas's controller config.
//
// BuildCanvas owns the per-controller config + last-tick snapshot. The CLI
// runs in App.svelte / CLIPanel and needs to (a) read snapshot for `show
// points`, (b) mutate config for `set setpoint 72`. Rather than couple the
// two with a deep prop chain, BuildCanvas writes its current bridge here
// and the CLI reads it.

import type { ControllerProgram } from './programStore.svelte';
import type { RawSignal, TerminalConfig, ScaledReading } from '@bas/core';

/** Per-terminal snapshot of what's currently on the wire and what the
 *  controller scaled it to. Populated each tick by the sim loop;
 *  consumed by the (session-2) multimeter / terminal-inspector UI. */
export interface TerminalSignalSnapshot {
  /** Raw electrical signal at the controller's terminal — what a multi-
   *  meter clipped to the wire would read. */
  readonly raw: RawSignal;
  /** The controller's interpretation config for this terminal (input type
   *  + engMin/engMax span). */
  readonly config: TerminalConfig;
  /** What the controller program actually sees on env.inputs.<key>. May
   *  diverge from `raw` due to mismatched config (wrong input type) or
   *  scaling faults. */
  readonly scaled: ScaledReading;
  /** Canvas node id of the sensor feeding this terminal, when known. */
  readonly sensorNodeId?: string;
  /** The element/signal the PHYSICALLY-INSTALLED sensor emits (e.g.
   *  'rtd-ni1000'). Sandbox-omniscient truth — a real controller can't know
   *  this; it only reads ohms. The Terminals panel uses it in EASY mode to
   *  show "Installed: Ni1000 · Programmed: Pt1000 — mismatch". Withheld from
   *  the user in realistic mode. */
  readonly installedSignal?: string;
  /** True when this terminal is wired to the controller's PRIMARY
   *  physics-target sensor. The thermal sim owns that sensor's
   *  engineering value (with the legacy `SensorState` faults applied);
   *  the signal-layer raw + scaled values shown for primary terminals
   *  are descriptive only — overriding the terminal's input type for
   *  a primary sensor won't change what the program sees. */
  readonly isPrimary?: boolean;
}

export interface ControllerSnapshot {
  sensed: number;
  setpoint: number;
  oat: number;
  actuator: number;
  mode: 'cool' | 'heat';
  Kp: number;
  Ki: number;
  /** Vendor model id from VENDOR_CATALOG when the user dragged from the
   *  catalog drawer; null/undefined for generic controllers. */
  vendorModelId?: string;
}

export interface ControllerBridge {
  /** Return the latest sim snapshot for the named controller. */
  getSnapshot(controllerId: string): ControllerSnapshot | null;
  /** Apply a config change. Returns null on success, error message otherwise. */
  setConfig(
    controllerId: string,
    key: 'setpoint' | 'Kp' | 'Ki' | 'mode',
    value: number | string,
  ): string | null;
}

interface BridgeState {
  impl: ControllerBridge | null;
  /** Bump on each tick so reactive consumers (the CLI panel) can re-render. */
  tick: number;
  /** Hook BuildCanvas uses to apply each controller's ST program after PI. */
  runStPrograms?: (snapshots: Map<string, ControllerSnapshot>) => void;
  /** Map of controller programs the canvas should run each tick. */
  programs: Map<string, ControllerProgram>;
  /** Latest env.inputs snapshot per controller — used by the BACnet
   *  inspector to surface live values. Refreshed each tick. */
  envInputsByCtrl: Map<string, Record<string, number | boolean>>;
  /** Latest env.outputs snapshot per controller. */
  envOutputsByCtrl: Map<string, Record<string, number>>;
  /** Per-controller per-terminal signal snapshot. Outer key = controller
   *  node id; inner key = terminal id (e.g., "UI-1"). Refreshed each tick
   *  by the sim loop. The session-2 multimeter UI reads from here. */
  terminalSignalsByCtrl: Map<string, Map<string, TerminalSignalSnapshot>>;
}

export const controllerBridge = $state<BridgeState>({
  impl: null,
  tick: 0,
  programs: new Map(),
  envInputsByCtrl: new Map(),
  envOutputsByCtrl: new Map(),
  terminalSignalsByCtrl: new Map(),
});

export function registerBridge(impl: ControllerBridge): void {
  controllerBridge.impl = impl;
}

export function bumpTick(): void {
  controllerBridge.tick++;
}
